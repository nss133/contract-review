import json
import re

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
