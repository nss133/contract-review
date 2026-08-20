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


def run_cases(cases: list[dict[str, Any]], knowledge_dir: str | Path | None = None) -> list[dict[str, Any]]:
    knowledge = load_knowledge(knowledge_dir or ROOT / "knowledge")
    public_cases = [{k: v for k, v in case.items() if not k.startswith("_")} for case in cases]
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
        return "issue"
    return "unknown"


def score(cases: list[dict[str, Any]], observed: list[dict[str, Any]]) -> dict[str, Any]:
    pairs: Counter[str] = Counter()
    by_check: dict[str, Counter[str]] = defaultdict(Counter)
    false_positive = []
    clause_mismatch = []
    auto_clear: Counter[str] = Counter()
    auto_pass: Counter[str] = Counter()
    auto_pass_human: Counter[str] = Counter()
    for case, result in zip(cases, observed):
        verdicts = case.get("_verdicts") or {}
        reassign = case.get("_reassign") or {}
        for check_id, verdict in verdicts.items():
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
    return {
        "contracts": len(cases),
        "verdicts": sum(len(c.get("_verdicts") or {}) for c in cases),
        "pairs": dict(sorted(pairs.items())),
        "by_check_pairs": {check_id: dict(sorted(counts.items()))
                           for check_id, counts in sorted(by_check.items())},
        "auto_clear_by_check": dict(sorted(auto_clear.items(), key=lambda x: (-x[1], x[0]))),
        "auto_clear_total": sum(auto_clear.values()),
        "auto_pass_by_check": dict(sorted(auto_pass.items(), key=lambda x: (-x[1], x[0]))),
        "auto_pass_total": sum(auto_pass.values()),
        "auto_pass_human": dict(sorted(auto_pass_human.items())),
        "false_positive_by_check": ranked_fp,
        "false_positive_cases": false_positive,
        "clause_mismatches": clause_mismatch,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="비공개 실계약 현재 엔진 재평가")
    parser.add_argument("cases", type=Path, nargs="?", default=Path("data/private/tuning-cases"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    cases = load_cases(args.cases)
    report = score(cases, run_cases(cases))
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
