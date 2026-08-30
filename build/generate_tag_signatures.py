"""240개 체크의 구조화 태그 후보를 생성한다.

후보는 큐레이션 입력이며 knowledge/tag_signatures.yaml을 자동 덮어쓰지 않는다.
기본은 stdout, --output을 명시한 경우에만 파일로 저장한다.
"""
import argparse
from pathlib import Path

import yaml

from validate import load_knowledge

ROOT = Path(__file__).resolve().parent.parent


def _compact(value):
    return "".join(ch.lower() for ch in str(value) if ch.isalnum())


def _check_text(check):
    parts = [check.get("check", ""), check.get("label", "")]
    parts.extend((check.get("triggers") or {}).get("keywords", []))
    parts.extend(check.get("subject_roles", []))
    for source in check.get("sources", []):
        parts.extend([source.get("law", ""), source.get("article", ""), source.get("quote", "")])
    return _compact(" ".join(str(part) for part in parts))


def generate(knowledge_dir=ROOT / "knowledge"):
    knowledge = load_knowledge(knowledge_dir)
    taxonomy = knowledge["tag_taxonomy"]
    signatures = {}
    for doc in [knowledge["common"], *knowledge["types"]]:
        for check in doc["checks"]:
            text = _check_text(check)
            candidate = {"status": "candidate"}
            for facet, registry in taxonomy["facets"].items():
                hits = []
                for tag_id, definition in registry.items():
                    aliases = [definition.get("label", ""), *definition.get("aliases", [])]
                    if any(_compact(alias) and _compact(alias) in text for alias in aliases):
                        hits.append(tag_id)
                if hits:
                    candidate[facet] = hits
            candidate["required_facets"] = ["topics"] if candidate.get("topics") else []
            signatures[check["id"]] = candidate
    return {"profile_version": taxonomy["profile_version"], "checks": signatures}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--knowledge-dir", type=Path, default=ROOT / "knowledge")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = yaml.safe_dump(generate(args.knowledge_dir), allow_unicode=True, sort_keys=False)
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
        print(args.output)
    else:
        print(payload, end="")


if __name__ == "__main__":
    main()
