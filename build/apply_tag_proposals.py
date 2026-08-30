"""사람이 승인한 구조태그 개선안을 회귀검증 후 정본에 반영한다.

입력은 앱의 ``승인한 태그 개선안 내보내기`` JSON이다. 실제 knowledge를 건드리기 전에
임시 지식본에서 validate와 shadow/assist 골드셋을 모두 통과해야 한다.
"""
import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

import yaml

from goldset import run_goldset
from validate import load_knowledge

ROOT = Path(__file__).resolve().parent.parent


def apply_proposals(signatures, payload):
    if payload.get("format") != "cr-tag-proposals-v1":
        raise ValueError("승인 태그 개선안 형식이 아님")
    if payload.get("profile_version") != signatures.get("profile_version"):
        raise ValueError("태그 profile_version 불일치")
    out = json.loads(json.dumps(signatures, ensure_ascii=False))
    checks = out.setdefault("checks", {})
    applied = []
    for proposal in payload.get("proposals") or []:
        decision = (proposal.get("decision") or {}).get("decision")
        if decision != "approved":
            continue
        cid = proposal.get("cpId")
        if not cid:
            continue
        sig = checks.setdefault(cid, {"status": "curated", "required_facets": []})
        sig["status"] = "curated"
        for item in proposal.get("additions") or []:
            facet, tag = item.get("facet"), item.get("tag")
            if facet and tag and tag not in sig.setdefault(facet, []):
                sig[facet].append(tag)
        for item in proposal.get("avoid") or []:
            facet, tag = item.get("facet"), item.get("tag")
            if facet and tag and tag not in sig.setdefault("avoid", {}).setdefault(facet, []):
                sig["avoid"][facet].append(tag)
        applied.append(cid)
    if not applied:
        raise ValueError("승인 상태의 개선안이 없음")
    return out, sorted(set(applied))


def _assert_goldset(knowledge_dir, mode):
    previous = os.environ.get("CONTRACT_TAG_MATCH_MODE")
    os.environ["CONTRACT_TAG_MATCH_MODE"] = mode
    try:
        report = run_goldset(knowledge_dir)
    finally:
        if previous is None:
            os.environ.pop("CONTRACT_TAG_MATCH_MODE", None)
        else:
            os.environ["CONTRACT_TAG_MATCH_MODE"] = previous
    if not report["ok"]:
        failures = [f"{row['id']}: {'; '.join(row['errors'])}" for row in report["rows"] if not row["ok"]]
        raise RuntimeError(f"{mode} 골드셋 실패\n" + "\n".join(failures))


def validate_and_apply(proposal_path, knowledge_dir=ROOT / "knowledge", dry_run=False):
    proposal_path = Path(proposal_path)
    knowledge_dir = Path(knowledge_dir)
    payload = json.loads(proposal_path.read_text(encoding="utf-8"))
    signature_path = knowledge_dir / "tag_signatures.yaml"
    signatures = yaml.safe_load(signature_path.read_text(encoding="utf-8")) or {}
    updated, applied = apply_proposals(signatures, payload)
    with tempfile.TemporaryDirectory(prefix="contract-tag-approval-") as tmp:
        staged = Path(tmp) / "knowledge"
        shutil.copytree(knowledge_dir, staged)
        (staged / "tag_signatures.yaml").write_text(
            yaml.safe_dump(updated, allow_unicode=True, sort_keys=False), encoding="utf-8")
        load_knowledge(staged)
        _assert_goldset(staged, "shadow")
        _assert_goldset(staged, "assist")
    if not dry_run:
        signature_path.write_text(yaml.safe_dump(updated, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return {"applied": applied, "dry_run": bool(dry_run), "goldset": ["shadow", "assist"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("proposal_json", type=Path)
    parser.add_argument("--knowledge-dir", type=Path, default=ROOT / "knowledge")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(validate_and_apply(args.proposal_json, args.knowledge_dir, args.dry_run),
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
