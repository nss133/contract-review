"""비공개 튜닝 케이스를 현재 엔진으로 재실행하고 판정 대응표를 출력한다.

출력에는 계약 본문·판정 코멘트를 넣지 않는다. 계약 해시와 체크 ID만 출력한다.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from validate import load_knowledge


ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "build" / "goldset_runner.js"


def load_cases(directory: str | Path) -> list[dict[str, Any]]:
    cases = []
    for path in sorted(Path(directory).glob("*.json")):
        obj = json.loads(path.read_text())
        if obj.get("format") != "cr-private-tuning-case-v1":
            continue
        cases.append({
            "id": obj["id"],
            "text": obj["text"],
            "force_type": (obj.get("meta") or {}).get("type_id"),
            "_verdicts": obj.get("verdicts") or {},
            "_reassign": obj.get("reassign") or {},
        })
    return cases


def run_cases(cases: list[dict[str, Any]], knowledge_dir: str | Path | None = None,
              restore_context: bool = True) -> list[dict[str, Any]]:
    knowledge = load_knowledge(knowledge_dir or ROOT / "knowledge")
    common_checks = knowledge["common"].get("checks") or []
    types_by_id = {doc["meta"]["type_id"]: doc for doc in knowledge["types"]}
    public_cases = []
    for case in cases:
        public = {k: v for k, v in case.items() if not k.startswith("_")}
        type_doc = types_by_id.get(case.get("force_type")) or {}
        available = common_checks + (type_doc.get("checks") or [])
        modules_by_check = {cp["id"]: cp.get("module") for cp in available}
        # 아카이브에는 당시 수동 선택 모듈이 저장되지 않는다. 그러나 판정이 존재하는 체크는
        # 그 모듈이 실제 검토 화면에서 활성화됐다는 강한 증거이므로 재실행 컨텍스트를 복원한다.
        inferred = ({modules_by_check.get(check_id)
                     for check_id in (case.get("_verdicts") or {})}
                    if restore_context else set())
        forced = set(public.get("force_active_modules") or []) | {m for m in inferred if m}
        public["force_active_modules"] = sorted(forced)
        public_cases.append(public)
    payload = {"common": knowledge["common"], "types": knowledge["types"], "cases": public_cases}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(payload, fh, ensure_ascii=False)
        tmp = Path(fh.name)
    try:
        out = subprocess.run(["node", str(RUNNER), str(tmp)], cwd=ROOT, text=True,
                             capture_output=True, check=True)
        return json.loads(out.stdout)
    finally:
        tmp.unlink(missing_ok=True)


def _human_category(verdict: dict[str, Any]) -> str:
    if verdict.get("verdict") == "해당없음":
        return "not_applicable"
    if verdict.get("verdict") == "이상없음" and verdict.get("reason") == "해당사항 없음":
        return "not_applicable"
    if verdict.get("verdict") == "이상없음":
        return "ok"
    if verdict.get("verdict") == "검토의견":
        # 구 UI의 '검토의견'은 위험 지적뿐 아니라 판단 메모도 함께 담았다. 명시적으로
        # 문제없음/적용불필요라고 적은 두 표현을 issue로 세면 재현율이 왜곡된다.
        comment = str(verdict.get("comment") or "").replace(" ", "")
        if "문제될사항없음" in comment or "문제없음" in comment:
            return "ok"
        if "요구할사항아님" in comment:
            return "not_applicable"
        return "issue"
    return "unknown"


def score(cases: list[dict[str, Any]], observed: list[dict[str, Any]]) -> dict[str, Any]:
    pairs: Counter[str] = Counter()
    by_check: dict[str, Counter[str]] = defaultdict(Counter)
    false_positive = []
    ui_false_positive = []
    missed_issue = []
    clause_mismatch = []
    auto_clear: Counter[str] = Counter()
    auto_pass: Counter[str] = Counter()
    auto_pass_human: Counter[str] = Counter()
    scope_excluded = []
    evaluated_verdicts = 0
    for case, result in zip(cases, observed):
        verdicts = case.get("_verdicts") or {}
        reassign = case.get("_reassign") or {}
        active_check_ids = set(result.get("active_check_ids") or [])
        available_check_ids = set(result.get("available_check_ids") or [])
        for check_id, verdict in verdicts.items():
            if "active_check_ids" in result and check_id not in active_check_ids:
                reason = ("context_gated" if check_id in available_check_ids
                          else "not_in_current_type")
                scope_excluded.append({"contract_id": case["id"], "check_id": check_id,
                                       "reason": reason})
                continue
            evaluated_verdicts += 1
            item = (result.get("items") or {}).get(check_id, {"coverage": "not_surfaced",
                                                              "top1_clause_index": None})
            coverage = item.get("coverage") or "not_surfaced"
            human = _human_category(verdict)
            if item.get("auto_clear"):
                auto_clear[check_id] += 1
            if item.get("auto_pass"):
                auto_pass[check_id] += 1
                auto_pass_human[human] += 1
            pairs[f"{coverage}::{human}"] += 1
            by_check[check_id][f"{coverage}::{human}"] += 1
            if human == "not_applicable" and coverage in ("addressed", "verify"):
                false_positive.append({"contract_id": case["id"], "check_id": check_id,
                                       "coverage": coverage, "top1_clause_index": item.get("top1_clause_index")})
            if human == "not_applicable" and coverage in ("addressed", "verify", "consider"):
                ui_false_positive.append({"contract_id": case["id"], "check_id": check_id,
                                          "coverage": coverage,
                                          "top1_clause_index": item.get("top1_clause_index")})
            if human == "issue" and coverage not in ("addressed", "verify", "consider"):
                missed_issue.append({"contract_id": case["id"], "check_id": check_id,
                                     "coverage": coverage,
                                     "top1_clause_index": item.get("top1_clause_index")})
            if check_id in reassign and item.get("top1_clause_index") != reassign[check_id]:
                clause_mismatch.append({"contract_id": case["id"], "check_id": check_id,
                                        "expected": reassign[check_id],
                                        "observed": item.get("top1_clause_index")})
    ranked_fp = []
    for check_id, counts in by_check.items():
        n = sum(v for k, v in counts.items() if k.endswith("::not_applicable") and
                k.split("::", 1)[0] in ("addressed", "verify"))
        if n:
            ranked_fp.append({"check_id": check_id, "count": n, "pairs": dict(sorted(counts.items()))})
    ranked_fp.sort(key=lambda x: (-x["count"], x["check_id"]))
    ranked_ui_fp = []
    for check_id, counts in by_check.items():
        n = sum(v for k, v in counts.items() if k.endswith("::not_applicable") and
                k.split("::", 1)[0] in ("addressed", "verify", "consider"))
        if n:
            ranked_ui_fp.append({"check_id": check_id, "count": n,
                                 "pairs": dict(sorted(counts.items()))})
    ranked_ui_fp.sort(key=lambda x: (-x["count"], x["check_id"]))
    shown_total = sum(v for k, v in pairs.items()
                      if k.split("::", 1)[0] in ("addressed", "verify", "consider"))
    issue_total = sum(v for k, v in pairs.items() if k.endswith("::issue"))
    issue_surfaced = sum(v for k, v in pairs.items() if k.endswith("::issue") and
                         k.split("::", 1)[0] in ("addressed", "verify", "consider"))
    return {
        "contracts": len(cases),
        "verdicts": sum(len(c.get("_verdicts") or {}) for c in cases),
        "evaluated_verdicts": evaluated_verdicts,
        "scope_excluded_total": len(scope_excluded),
        "scope_excluded_by_reason": dict(sorted(Counter(x["reason"] for x in scope_excluded).items())),
        "scope_excluded_cases": scope_excluded,
        "pairs": dict(sorted(pairs.items())),
        "by_check_pairs": {check_id: dict(sorted(counts.items()))
                           for check_id, counts in sorted(by_check.items())},
        "auto_clear_by_check": dict(sorted(auto_clear.items(), key=lambda x: (-x[1], x[0]))),
        "auto_clear_total": sum(auto_clear.values()),
        "auto_pass_by_check": dict(sorted(auto_pass.items(), key=lambda x: (-x[1], x[0]))),
        "auto_pass_total": sum(auto_pass.values()),
        "auto_pass_human": dict(sorted(auto_pass_human.items())),
        "metrics": {
            "shown_total": shown_total,
            "ui_false_positive_total": len(ui_false_positive),
            "ui_false_positive_rate": (len(ui_false_positive) / shown_total
                                       if shown_total else None),
            "issue_total": issue_total,
            "issue_surfaced": issue_surfaced,
            "issue_recall": (issue_surfaced / issue_total if issue_total else None),
        },
        "false_positive_by_check": ranked_fp,
        "false_positive_cases": false_positive,
        "ui_false_positive_by_check": ranked_ui_fp,
        "ui_false_positive_cases": ui_false_positive,
        "missed_issue_cases": missed_issue,
        "clause_mismatches": clause_mismatch,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="비공개 실계약 현재 엔진 재평가")
    parser.add_argument("cases", type=Path, nargs="?", default=Path("data/private/tuning-cases"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--context", choices=("reviewer", "automatic"), default="reviewer",
                        help="reviewer=판정 이력으로 수동 활성 모듈 복원, automatic=현재 자동 감지만")
    parser.add_argument("--knowledge-dir", type=Path, default=ROOT / "knowledge",
                        help="비교할 지식 디렉터리(기본: 현재 knowledge)")
    args = parser.parse_args()
    cases = load_cases(args.cases)
    report = score(cases, run_cases(cases, knowledge_dir=args.knowledge_dir,
                                    restore_context=args.context == "reviewer"))
    report["context_mode"] = args.context
    report["knowledge_dir"] = str(args.knowledge_dir)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
