"""knowledge/ + src/ + vendor/ → dist/contract-review.html 단일 파일 조립."""
import datetime as _dt
import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path

import yaml

import config
from build_team_guide_docx import build_guide
from build_labeling_form import build as build_labeling_form
from enrich import enrich
from validate import load_knowledge

ROOT = Path(__file__).parent.parent
SRC = ROOT / "src"
# pf.js는 추출기(cfb·extract-*)보다 먼저. cfb는 doc·hwp보다 먼저.
JS_ORDER = [
    "sim.js", "clause_role.js", "contract_tags.js", "legal_constraints.js", "scope_assessment.js", "matcher_config.js", "segmenter.js", "sentence.js", "matcher.js", "action_router.js", "motion.js",
    "pf.js", "cfb.js", "extract-pdf.js", "extract-doc.js", "extract-hwp.js", "extract-zip.js", "extract.js",
    "verify.js", "assessment.js", "local_llm.js", "experiment.js", "verdict.js", "findings.js", "integrity.js", "loop.js", "goldset.js", "tags.js", "formal.js", "evidence.js", "compare.js", "legal_opinion_knowledge.js", "app.js",
]


def attach_std_refs(knowledge, refs_path):
    """knowledge/std_refs.yaml(표준 문안 참고)을 check당 join — 표시 전용.

    가중치·판정·매칭·골드셋 채점에 일절 관여하지 않음(트리아지 §④ 절대 조건):
    goldset 러너는 load_knowledge만 쓰므로 이 필드를 보지 못하고, matcher는
    미지 필드를 무시함. quote 창작 방지는 tests/test_std_refs.py가 게이트.
    파일 없으면 빈 값으로 진행(경고만, 실패 아님)."""
    path = Path(refs_path)
    if not path.is_file():
        print(f"경고: 표준 문안 참고 없음({path}) — std_refs 없이 빌드", file=sys.stderr)
        return
    refs = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    for doc in [knowledge["common"], *knowledge["types"]]:
        for cp in doc["checks"]:
            if cp["id"] in refs:
                cp["std_refs"] = refs[cp["id"]]


def build(knowledge_dir, out_path, law_dbs=None, news_db=None, corpus_path=None,
          tag_match_mode=None):
    k = load_knowledge(knowledge_dir)
    warnings = enrich(
        k,
        law_dbs if law_dbs is not None else config.LAW_DBS,
        news_db if news_db is not None else config.NEWS_DB,
    )
    for w in warnings:
        print(f"경고: {w}", file=sys.stderr)
    attach_std_refs(k, Path(knowledge_dir) / "std_refs.yaml")

    # 검수자 판정 코퍼스 내장: 반출 백업(data/curated_corpus.json)을 페이지에 seed로 실음 —
    # 새 환경(다른 PC·localStorage 초기화)에서도 판정 분포·추천 코멘트가 보이게.
    # 파일 없으면 빈 코퍼스로 빌드 진행(경고만, 실패 아님).
    cpath = Path(corpus_path) if corpus_path is not None else ROOT / "data" / "curated_corpus.json"
    corpus = None
    if cpath.exists():
        corpus = json.loads(cpath.read_text())
    else:
        print(f"경고: 내장 코퍼스 없음({cpath}) — seed 없이 빌드", file=sys.stderr)

    # 앱 버전(2026-08-03 도입) — 루트 VERSION 파일이 단일 소스. UI 표기·zip 파일명·
    # 내보내기 meta(app_version)에 공용. 부여 규칙: 팀 피드백 라운드 반영 시 minor,
    # 버그·데이터 소수정은 patch (예: 10차 반영 = 1.10.0).
    version = (ROOT / "VERSION").read_text().strip()
    build_date = _dt.date.today().isoformat()

    tag_manifest_path = ROOT / "vendor" / "contract-tag-engine.manifest.json"
    tag_manifest = json.loads(tag_manifest_path.read_text())
    tag_taxonomy_path = ROOT / "vendor" / tag_manifest["taxonomy"]
    tag_taxonomy = json.loads(tag_taxonomy_path.read_text())
    for filename, digest_key in [
        (tag_manifest["artifact"], "artifactSha256"),
        (tag_manifest["cjsArtifact"], "cjsArtifactSha256"),
        (tag_manifest["taxonomy"], "taxonomySha256"),
    ]:
        actual = hashlib.sha256((ROOT / "vendor" / filename).read_bytes()).hexdigest()
        if actual != tag_manifest[digest_key]:
            raise ValueError(f"태그 브리지 해시 불일치: {filename}")
    if tag_taxonomy.get("profileVersion") != tag_manifest.get("profileVersion"):
        raise ValueError("태그 엔진/taxonomy profileVersion 불일치")
    local_taxonomy = k.get("tag_taxonomy", {})
    if local_taxonomy.get("profile_version"):
        if local_taxonomy["profile_version"] != tag_manifest.get("profileVersion"):
            raise ValueError("계약검토 taxonomy와 태그 엔진 profileVersion 불일치")
        for facet, registry in tag_taxonomy.get("facets", {}).items():
            local_registry = local_taxonomy.get("facets", {}).get(facet, {})
            if set(registry) != set(local_registry):
                raise ValueError(f"계약검토 taxonomy ID 드리프트: {facet}")
            for tag_id, definition in registry.items():
                if definition.get("label") != local_registry[tag_id].get("label"):
                    raise ValueError(f"계약검토 taxonomy label 드리프트: {facet}.{tag_id}")
    # 검수 완료된 curated signature 16개는 shadow↔assist 골드셋을 모두 통과해 제한 보조로 승격.
    # candidate는 계속 0점이며 태그만으로 노출·자동판정은 만들지 않는다.
    tag_mode = tag_match_mode or os.environ.get("CONTRACT_TAG_MATCH_MODE", "assist")
    if tag_mode not in {"off", "shadow", "assist"}:
        raise ValueError(f"알 수 없는 tag_match_mode: {tag_mode}")
    payload = {"common": k["common"], "types": k["types"],
               "regulatory_scopes": k.get("regulatory_scopes", {"scopes": {}}),
               "legal_constraints": k.get("legal_constraints", {"rules": []}),
               "contract_action_profile": k.get("contract_actions", {}),
               "tag_taxonomy": k.get("tag_taxonomy", {}), "tag_engine": tag_manifest,
               "tag_match_mode": tag_mode, "curated_corpus": corpus, "app_version": version}
    # </script> 조기 종료 방지: JSON 문자열 내 </ 를 <\/ 로 (JSON 유효 이스케이프)
    data_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    vendor_js = (
        (ROOT / "vendor" / "jszip.min.js").read_text()
        + "\n"
        + (ROOT / "vendor" / "pdf.min.js").read_text()
        + "\n"
        + (ROOT / "vendor" / "contract-tag-engine.js").read_text()
    )
    # pdf.worker.min.js는 <script type="text/plain">에 인라인 → blob 워커 소스로 사용.
    # </script 조기 종료 방지(text/plain이라 이스케이프 필요).
    worker_src = (ROOT / "vendor" / "pdf.worker.min.js").read_text().replace("</script", "<\\/script")

    html = (SRC / "template.html").read_text()
    html = html.replace("/*__STYLE__*/", (SRC / "style.css").read_text())
    html = html.replace("/*__VENDOR_JS__*/", vendor_js)
    html = html.replace("/*__PDF_WORKER_SRC__*/", worker_src)
    html = html.replace("/*__APP_JS__*/", "\n".join((SRC / f).read_text() for f in JS_ORDER))
    html = html.replace("__DATA_JSON__", data_json)
    html = html.replace("__APP_VERSION__", version)
    html = html.replace("__BUILD_DATE__", build_date)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    _smoke(out)

    # 폐쇄망 영구 실행기: 실행기 파일은 최초 설치 후 같은 위치에서 계속 사용하고,
    # 이후에는 .crupdate만 가져온다. 앱 HTML을 실행기 IndexedDB에 교체하므로
    # legal-opinion 태깅자료와 계약검토 로컬 상태의 origin이 버전마다 바뀌지 않는다.
    launcher_path = out.parent / "contract-review-launcher.html"
    launcher_path.write_text((SRC / "launcher.html").read_text())
    update_path = out.parent / f"contract-review-v{version}.crupdate"
    update_payload = {
        "format": "contract-review-update-v1",
        "version": version,
        "build_date": build_date,
        "sha256": hashlib.sha256(html.encode("utf-8")).hexdigest(),
        "html": html,
    }
    update_path.write_text(json.dumps(update_payload, ensure_ascii=False))
    parsed_update = json.loads(update_path.read_text())
    assert parsed_update["format"] == "contract-review-update-v1"
    assert hashlib.sha256(parsed_update["html"].encode("utf-8")).hexdigest() == parsed_update["sha256"]

    install_guide_path = out.parent / "폐쇄망_설치및업데이트.txt"
    install_guide_path.write_text(
        "계약서 리뷰 가이드 폐쇄망 설치·업데이트\n\n"
        "1. 최초 설치\n"
        "- 최초설치_계약서검토_실행기.html을 사용할 위치에 한 번만 저장합니다.\n"
        f"- 실행기를 열고 contract-review-v{version}.crupdate를 선택합니다.\n"
        "- 앱의 지식 데이터 탭에서 legal-opinion-tagger 결과 XLSX를 최초 1회 가져옵니다.\n"
        "- 지식팩 백업 파일도 폐쇄망 내부의 승인된 폴더에 1회 보관합니다.\n\n"
        "2. 이후 버전 업데이트\n"
        "- 새 ZIP의 실행기 파일을 새로 열지 않습니다. 최초 설치 때 쓰던 실행기를 엽니다.\n"
        "- 버전 설치·업데이트에서 새 .crupdate 파일만 선택합니다.\n"
        "- 법률검토 태깅자료를 다시 넣을 필요가 없습니다.\n\n"
        "3. 주의\n"
        "- 실행기 파일의 위치를 옮기거나 이름을 바꾸면 브라우저가 다른 저장영역으로 인식할 수 있습니다.\n"
        "- 직접실행용 contract-review.html은 비상용입니다. 지속 사용은 실행기를 권장합니다.\n"
        "- 브라우저 데이터 삭제·프로필 변경에 대비해 지식팩 백업을 보관하십시오.\n",
        encoding="utf-8",
    )

    # 배포 zip 자동 생성 — 파일명에 버전 포함(팀 배포본 식별). 구버전 zip은 정리해
    # dist에 최신 배포본 하나만 유지(zip은 파생물 — git 미추적).
    for old in out.parent.glob("contract-review*.zip"):
        old.unlink()
    zpath = out.parent / f"contract-review-v{version}.zip"
    guide_path = out.parent / f"contract-review-user-guide-v{version}.docx"
    build_guide(version, guide_path)
    labeling_path = build_labeling_form()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(launcher_path, "최초설치_계약서검토_실행기.html")
        zf.write(update_path, update_path.name)
        zf.write(out, out.name)
        zf.write(out, "비상용_직접실행_contract-review.html")
        zf.write(install_guide_path, install_guide_path.name)
        zf.write(guide_path, guide_path.name)
        zf.write(labeling_path, "matching-labeling-form.html")
    print(f"배포 zip: {zpath.name} ({zpath.stat().st_size // 1024}KB)")
    return out


def _smoke(path):
    html = path.read_text()
    assert "__DATA_JSON__" not in html and "/*__" not in html, "플레이스홀더 잔존"
    assert "__APP_VERSION__" not in html and "__BUILD_DATE__" not in html, "버전 플레이스홀더 잔존"
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', html, re.S)
    assert m, "cr-data 스크립트 블록 없음"
    data = json.loads(m.group(1))
    n = len(data["common"]["checks"]) + sum(len(t["checks"]) for t in data["types"])
    assert n > 0, "check 0개"
    assert data.get("tag_match_mode") in {"off", "shadow", "assist"}, "태그 매칭 모드 오류"
    assert data.get("tag_engine", {}).get("profileVersion"), "태그 엔진 manifest 누락"
    assert data["tag_engine"].get("taxonomySha256"), "태그 taxonomy 계보 누락"
    kb = len(html) // 1024
    print(f"스모크 OK: check {n}개, {kb}KB → {path}")


if __name__ == "__main__":
    build(ROOT / "knowledge", ROOT / "dist" / "contract-review.html")
