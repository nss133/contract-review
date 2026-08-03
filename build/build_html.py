"""knowledge/ + src/ + vendor/ → dist/contract-review.html 단일 파일 조립."""
import datetime as _dt
import json
import re
import sys
import zipfile
from pathlib import Path

import yaml

import config
from enrich import enrich
from validate import load_knowledge

ROOT = Path(__file__).parent.parent
SRC = ROOT / "src"
# pf.js는 추출기(cfb·extract-*)보다 먼저. cfb는 doc·hwp보다 먼저.
JS_ORDER = [
    "sim.js", "clause_role.js", "matcher_config.js", "segmenter.js", "matcher.js",
    "pf.js", "cfb.js", "extract-pdf.js", "extract-doc.js", "extract-hwp.js", "extract-zip.js", "extract.js",
    "verify.js", "verdict.js", "loop.js", "goldset.js", "tags.js", "formal.js", "evidence.js", "compare.js", "app.js",
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


def build(knowledge_dir, out_path, law_dbs=None, news_db=None, corpus_path=None):
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

    payload = {"common": k["common"], "types": k["types"], "curated_corpus": corpus,
               "app_version": version}
    # </script> 조기 종료 방지: JSON 문자열 내 </ 를 <\/ 로 (JSON 유효 이스케이프)
    data_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    vendor_js = (
        (ROOT / "vendor" / "jszip.min.js").read_text()
        + "\n"
        + (ROOT / "vendor" / "pdf.min.js").read_text()
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

    # 배포 zip 자동 생성 — 파일명에 버전 포함(팀 배포본 식별). 구버전 zip은 정리해
    # dist에 최신 배포본 하나만 유지(zip은 파생물 — git 미추적).
    for old in out.parent.glob("contract-review*.zip"):
        old.unlink()
    zpath = out.parent / f"contract-review-v{version}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(out, out.name)
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
    kb = len(html) // 1024
    print(f"스모크 OK: check {n}개, {kb}KB → {path}")


if __name__ == "__main__":
    build(ROOT / "knowledge", ROOT / "dist" / "contract-review.html")
