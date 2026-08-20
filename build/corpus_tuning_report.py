"""누적 코퍼스에서 정밀도 개선 신호를 재현 가능하게 산출한다.

사용:
  python3 build/corpus_tuning_report.py edge-corpus.json
  python3 build/corpus_tuning_report.py before.json after.json --json

계약 원문은 읽거나 출력하지 않는다. 코퍼스의 집계값만 사용한다.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


PAIR_SEP = "::"


def load_corpus(path: str | Path) -> dict[str, Any]:
    obj = json.loads(Path(path).read_text())
    if not isinstance(obj, dict) or not isinstance(obj.get("byCheck"), dict):
        raise ValueError(f"코퍼스 형식이 아님: {path}")
    return obj


def _pair_count(slot: dict[str, Any], assessment: str, verdict: str) -> int:
    return int((slot.get("system_verdict_pairs") or {}).get(f"{assessment}{PAIR_SEP}{verdict}", 0))


def _rank(corpus: dict[str, Any], assessment: str, verdict: str) -> list[dict[str, Any]]:
    rows = []
    for check_id, slot in corpus.get("byCheck", {}).items():
        n = _pair_count(slot, assessment, verdict)
        if not n:
            continue
        total = sum(
            int(v or 0)
            for k, v in (slot.get("system_verdict_pairs") or {}).items()
            if k.startswith(f"{assessment}{PAIR_SEP}")
        )
        rows.append({
            "check_id": check_id,
            "count": n,
            "assessment_total": total,
            "ratio": n / total if total else 0,
        })
    return sorted(rows, key=lambda x: (-x["count"], -x["ratio"], x["check_id"]))


def analyze_corpus(corpus: dict[str, Any]) -> dict[str, Any]:
    pairs: Counter[str] = Counter()
    origins: Counter[str] = Counter()
    llm_pairs: Counter[str] = Counter()
    matching_rows = []
    for check_id, slot in corpus.get("byCheck", {}).items():
        pairs.update({k: int(v or 0) for k, v in (slot.get("system_verdict_pairs") or {}).items()})
        origins.update({k: int(v or 0) for k, v in (slot.get("origin_counts") or {}).items()})
        llm_pairs.update({k: int(v or 0) for k, v in (slot.get("llm_verdict_pairs") or {}).items()})
        mc = slot.get("matching_counts") or {}
        observed = int(mc.get("observed", 0) or 0)
        reassigned = int(mc.get("reassigned", 0) or 0)
        if observed:
            matching_rows.append({
                "check_id": check_id,
                "observed": observed,
                "reassigned": reassigned,
                "reassignment_rate": reassigned / observed,
                "top1_correct": int(mc.get("top1_correct", 0) or 0),
                "top1_wrong": int(mc.get("top1_wrong", 0) or 0),
                "gold_in_top3": int(mc.get("gold_in_top3", 0) or 0),
            })
    matching_rows.sort(key=lambda x: (-x["reassignment_rate"], -x["observed"], x["check_id"]))
    verdicts = sum(sum(int(v or 0) for v in (s.get("counts") or {}).values())
                   for s in corpus.get("byCheck", {}).values())
    return {
        "meta": {
            "updated": (corpus.get("meta") or {}).get("updated", ""),
            "contracts": int((corpus.get("meta") or {}).get("contract_count", 0) or 0),
            "checks": len(corpus.get("byCheck", {})),
            "verdicts": verdicts,
        },
        "system_verdict_pairs": dict(sorted(pairs.items())),
        "origins": dict(sorted(origins.items())),
        "llm_verdict_pairs": dict(sorted(llm_pairs.items())),
        "verify_ok": _rank(corpus, "possible_evidence", "이상없음"),
        "verify_not_applicable": _rank(corpus, "possible_evidence", "해당없음"),
        "absence_ok": _rank(corpus, "evidence_not_found", "이상없음"),
        "absence_not_applicable": _rank(corpus, "evidence_not_found", "해당없음"),
        "matching": matching_rows,
    }


def compare_reports(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    keys = set(before["system_verdict_pairs"]) | set(after["system_verdict_pairs"])
    pair_delta = {
        k: after["system_verdict_pairs"].get(k, 0) - before["system_verdict_pairs"].get(k, 0)
        for k in sorted(keys)
    }
    return {
        "before": before["meta"],
        "after": after["meta"],
        "delta": {
            "contracts": after["meta"]["contracts"] - before["meta"]["contracts"],
            "verdicts": after["meta"]["verdicts"] - before["meta"]["verdicts"],
            "system_verdict_pairs": pair_delta,
        },
    }


def _fmt_rank(title: str, rows: list[dict[str, Any]], limit: int) -> list[str]:
    out = ["", f"## {title}", ""]
    if not rows:
        return out + ["- 없음"]
    for row in rows[:limit]:
        out.append(f"- {row['check_id']}: {row['count']}/{row['assessment_total']} ({row['ratio']:.0%})")
    return out


def _fmt_matching(rows: list[dict[str, Any]], limit: int) -> list[str]:
    out = ["", "## 재지정률", ""]
    if not rows:
        return out + ["- 없음"]
    for row in rows[:limit]:
        out.append(
            f"- {row['check_id']}: {row['reassigned']}/{row['observed']} "
            f"({row['reassignment_rate']:.0%})"
        )
    return out


def render_markdown(report: dict[str, Any], limit: int = 20) -> str:
    meta = report["meta"]
    lines = [
        "# 코퍼스 정밀도 튜닝 리포트",
        "",
        f"- 기준일: {meta['updated'] or '미상'}",
        f"- 계약: {meta['contracts']}건 · 판정: {meta['verdicts']}건 · 체크: {meta['checks']}개",
        "",
        "## 시스템 평가 × 사람 판정",
        "",
    ]
    for key, count in report["system_verdict_pairs"].items():
        lines.append(f"- {key}: {count}")
    lines += _fmt_rank("verify → 이상없음", report["verify_ok"], limit)
    lines += _fmt_rank("verify → 해당없음", report["verify_not_applicable"], limit)
    lines += _fmt_rank("부재알람 → 이상없음", report["absence_ok"], limit)
    lines += _fmt_matching(report["matching"], limit)
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="코퍼스 정밀도 튜닝 리포트")
    parser.add_argument("corpus", type=Path)
    parser.add_argument("after", type=Path, nargs="?")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    before = analyze_corpus(load_corpus(args.corpus))
    if args.after:
        result: dict[str, Any] = {
            "before_report": before,
            "after_report": analyze_corpus(load_corpus(args.after)),
        }
        result["comparison"] = compare_reports(result["before_report"], result["after_report"])
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.as_json:
        print(json.dumps(before, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(before, args.limit), end="")


if __name__ == "__main__":
    main()
