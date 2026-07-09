"""여러 팀원의 검수 판정(verification.json)을 하나로 병합.

분산 검수 협업: 팀원 각자 검수 화면에서 판정 → verification.json 내보내기 →
한 폴더(예: verifications/)에 모아 이 스크립트로 병합 → apply_verification로 승급.

파일명이 곧 검토자명: `손남수.json` 또는 `verification_손남수.json` → 검토자 "손남수".

병합 규칙 (보수적 — 검수는 안전 우선):
- 어떤 source(check#index)를 전원 "확인"하면 → 병합 결과 "확인" (승급 대상).
- 한 명이라도 "수정필요"면 → 병합 결과 "수정필요" (승급 보류). 서로 다른 판정이
  섞였으면 conflicts에 기록. 전원 "수정필요"는 합의된 수정필요라 충돌 아님.
- 각 병합 항목에 reviewers(참여 검토자)·note(수정필요 메모 합침)를 남김.

사용:
    python3 build/merge_verifications.py verifications/ [-o merged.json]
    python3 build/merge_verifications.py A.json B.json [-o merged.json]
"""
import argparse
import json
import sys
from pathlib import Path


def _reviewer_name(path):
    stem = Path(path).stem
    for prefix in ("verification_", "verification-"):
        if stem.startswith(prefix):
            return stem[len(prefix):]
    return stem


def _load_files(paths):
    """[(reviewer, decisions_dict)] — 검토자명 사전순 정렬."""
    out = []
    for p in paths:
        try:
            data = json.loads(Path(p).read_text())
        except Exception as e:
            print("경고 — 읽기 실패 스킵: {} ({})".format(p, e), file=sys.stderr)
            continue
        if isinstance(data, dict):
            out.append((_reviewer_name(p), data))
    out.sort(key=lambda x: x[0])
    return out


def _merge(loaded):
    """loaded: [(reviewer, decisions)]. 반환 {merged, conflicts, reviewers}."""
    # key -> {reviewer: (decision, note)}
    by_key = {}
    reviewers = []
    for reviewer, decisions in loaded:
        if reviewer not in reviewers:
            reviewers.append(reviewer)
        for key, v in (decisions or {}).items():
            dec = (v or {}).get("decision")
            if dec not in ("확인", "수정필요"):
                continue
            by_key.setdefault(key, {})[reviewer] = (dec, (v or {}).get("note", ""))

    merged, conflicts = {}, []
    for key in sorted(by_key):
        votes = by_key[key]
        decs = {r: d for r, (d, _) in votes.items()}
        who = sorted(votes)
        has_needsfix = any(d == "수정필요" for d in decs.values())
        has_confirm = any(d == "확인" for d in decs.values())
        # 보수적: 수정필요가 하나라도 있으면 수정필요
        final = "수정필요" if has_needsfix else "확인"
        entry = {"decision": final, "reviewers": who}
        if final == "수정필요":
            notes = [n for (_, n) in (votes[r] for r in who) if n]
            if notes:
                entry["note"] = " / ".join(notes)
        merged[key] = entry
        # 충돌: 확인과 수정필요가 섞인 경우만 (전원 동일 판정은 충돌 아님)
        if has_needsfix and has_confirm:
            conflicts.append({"key": key, "decisions": decs})

    return {"merged": merged, "conflicts": conflicts, "reviewers": reviewers}


def merge_dir(path):
    p = Path(path)
    files = sorted(p.glob("*.json")) if p.is_dir() else [p]
    return _merge(_load_files(files))


def merge_files(paths):
    return _merge(_load_files(paths))


def _print_report(res):
    print("검토자 {}명: {}".format(len(res["reviewers"]), ", ".join(res["reviewers"]) or "(없음)"))
    conf = sum(1 for v in res["merged"].values() if v["decision"] == "확인")
    fix = sum(1 for v in res["merged"].values() if v["decision"] == "수정필요")
    print("병합: 확인 {}건(승급 대상) / 수정필요 {}건(보류)".format(conf, fix))
    if res["conflicts"]:
        print("판정 충돌(수정필요로 보류): {}건".format(len(res["conflicts"])))
        for c in res["conflicts"]:
            parts = ["{}={}".format(r, d) for r, d in sorted(c["decisions"].items())]
            print("  - {}: {}".format(c["key"], ", ".join(parts)))


def main(argv=None):
    ap = argparse.ArgumentParser(description="팀원 검수 판정 병합")
    ap.add_argument("inputs", nargs="+", help="검수 JSON 폴더 또는 파일들")
    ap.add_argument("-o", "--out", help="병합 결과 JSON 경로(apply_verification 입력용)")
    args = ap.parse_args(argv)

    if len(args.inputs) == 1 and Path(args.inputs[0]).is_dir():
        res = merge_dir(args.inputs[0])
    else:
        res = merge_files(args.inputs)

    _print_report(res)
    if args.out:
        Path(args.out).write_text(json.dumps(res["merged"], ensure_ascii=False, indent=2))
        print("병합 결과 저장: {}".format(args.out))
        print("승급하려면: python3 build/apply_verification.py {}".format(args.out))
    return res


if __name__ == "__main__":
    main()
