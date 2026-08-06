import json
import re
import zipfile
from pathlib import Path

from build_html import build
from test_enrich import law_db  # noqa: F401  (픽스처 재사용)


def test_build_produces_single_html(knowledge_dir, law_db, tmp_path):
    out = tmp_path / "out.html"
    build(knowledge_dir, out, law_dbs=[law_db], news_db=None)
    html = out.read_text()
    assert "__DATA_JSON__" not in html
    assert "/*__" not in html
    assert "segmentContract" in html          # JS 인라인 확인
    assert "JSZip" in html                    # vendor 인라인 확인
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', html, re.S)
    data = json.loads(m.group(1))
    assert data["common"]["checks"][0]["id"] == "CMN-01"
    src = data["types"][0]["checks"][0]["sources"][0]
    assert src["status"] == "quote_ok" and "사전 동의" in src["text"]

    zpath = next(tmp_path.glob("contract-review-v*.zip"))
    with zipfile.ZipFile(zpath) as zf:
        names = set(zf.namelist())
        assert "out.html" in names
        assert any(name.endswith(".docx") for name in names)


def test_build_embeds_curated_corpus(knowledge_dir, law_db, tmp_path):
    # 기본 corpus_path = data/curated_corpus.json (repo 실파일)과 동일한 seed를 내장한다.
    out = tmp_path / "out.html"
    build(knowledge_dir, out, law_dbs=[law_db], news_db=None)
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', out.read_text(), re.S)
    corpus = json.loads(m.group(1))["curated_corpus"]
    expected = json.loads((Path(__file__).parents[1] / "data" / "curated_corpus.json").read_text())
    assert corpus == expected


def test_build_without_corpus_file(knowledge_dir, law_db, tmp_path):
    # 코퍼스 파일 없으면 경고만 내고 빈 seed(null)로 빌드 진행
    out = tmp_path / "out.html"
    build(knowledge_dir, out, law_dbs=[law_db], news_db=None, corpus_path=tmp_path / "no-such.json")
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', out.read_text(), re.S)
    assert json.loads(m.group(1))["curated_corpus"] is None


def test_build_escapes_script_close(knowledge_dir, law_db, tmp_path):
    p = knowledge_dir / "common.yaml"
    p.write_text(p.read_text().replace(
        '    sources: []\n    note: ""\n',
        '    sources: []\n    note: "</script> 포함 텍스트"\n'))
    out = tmp_path / "out.html"
    build(knowledge_dir, out, law_dbs=[law_db], news_db=None)
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', out.read_text(), re.S)
    assert "</script>" not in m.group(1)      # JSON 안에서 조기 종료 없음
    assert json.loads(m.group(1))["common"]["checks"][0]["note"].startswith("</script>")
