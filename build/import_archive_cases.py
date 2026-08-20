"""아카이브 레지스트리와 localStorage 판정을 비공개 튜닝 케이스로 결합한다.

출력에는 실계약 전문과 판정이 포함된다. 반드시 gitignored 경로에만 저장한다.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


FORMAT = "cr-private-tuning-case-v1"
VERDICT_PREFIX = "cr-verdict-"
REASSIGN_PREFIX = "cr-reassign-"


def _load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text())


def _decode_store(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


def combine_cases(registry: list[dict[str, Any]], verdict_dump: dict[str, Any],
                  reassign_dump: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    reassign_dump = reassign_dump or {}
    cases = []
    for entry in registry:
        contract_hash = str(entry.get("contract_hash") or "")
        text = entry.get("contract_text")
        if not contract_hash or not isinstance(text, str) or not text.strip():
            continue
        verdicts = _decode_store(verdict_dump.get(VERDICT_PREFIX + contract_hash))
        reassign = _decode_store(reassign_dump.get(REASSIGN_PREFIX + contract_hash))
        cases.append({
            "format": FORMAT,
            "id": contract_hash,
            "meta": {
                "name": str(entry.get("name") or ""),
                "date": str(entry.get("date") or ""),
                "reviewer": str(entry.get("reviewer") or ""),
                "type_id": entry.get("type_id"),
            },
            "text": text,
            "verdicts": verdicts,
            "reassign": reassign,
            "label_status": "clause_labeled" if reassign else ("verdict_labeled" if verdicts else "unlabeled"),
        })
    return sorted(cases, key=lambda x: (x["meta"]["date"], x["id"]))


def _safe_name(case: dict[str, Any]) -> str:
    stem = re.sub(r"[^0-9A-Za-z가-힣._-]+", "_", case["meta"].get("name") or "contract").strip("_")
    return f"{case['id']}_{stem[:50] or 'contract'}.json"


def write_cases(cases: list[dict[str, Any]], output: str | Path) -> dict[str, int]:
    out = Path(output)
    out.mkdir(parents=True, exist_ok=True)
    for case in cases:
        (out / _safe_name(case)).write_text(json.dumps(case, ensure_ascii=False, indent=2))
    return {
        "cases": len(cases),
        "verdict_labeled": sum(bool(c["verdicts"]) for c in cases),
        "clause_labeled": sum(bool(c["reassign"]) for c in cases),
        "unlabeled": sum(not c["verdicts"] for c in cases),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="비공개 실계약 튜닝 케이스 임포터")
    parser.add_argument("registry", type=Path)
    parser.add_argument("verdicts", type=Path)
    parser.add_argument("--reassign", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/private/tuning-cases"))
    args = parser.parse_args()
    cases = combine_cases(_load(args.registry), _load(args.verdicts),
                          _load(args.reassign) if args.reassign else None)
    summary = write_cases(cases, args.output)
    print(json.dumps({"output": str(args.output), **summary}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
