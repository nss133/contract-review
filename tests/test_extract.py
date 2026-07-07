import sqlite3

import pytest
import yaml

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "build"))

from extract_candidates import build_candidates, is_enumerated, split_items, render_yaml

ENUM_TEXT = (
    "제6조(업무위탁에 따른 개인정보의 처리 제한) 개인정보처리자가 제3자에게 개인정보의 "
    "처리 업무를 위탁하는 경우에는 다음 각 호의 내용이 포함된 문서로 하여야 한다. "
    "<개정 2023.3.14> "
    "1. 위탁업무 수행 목적 외 개인정보의 처리 금지에 관한 사항 "
    "2. 개인정보의 기술적ㆍ관리적 보호조치에 관한 사항 "
    "3. 그 밖에 개인정보의 안전한 관리를 위하여 대통령령으로 정한 사항 "
    "② 제1항에 따라 개인정보의 처리 업무를 위탁하는 개인정보처리자는 공개하여야 한다."
)

NON_ENUM_TEXT = "제5조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다. 위탁이란 업무를 맡기는 것을 말한다."


@pytest.fixture
def law_db(tmp_path):
    path = tmp_path / "laws.sqlite"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE law_articles (id INTEGER PRIMARY KEY, law_name TEXT, "
        "article_ref TEXT, text TEXT, mst TEXT, source TEXT, updated_at TEXT)"
    )
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) VALUES (?, ?, ?)",
        ("테스트법", "제5조", NON_ENUM_TEXT),
    )
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) VALUES (?, ?, ?)",
        ("테스트법", "제6조", ENUM_TEXT),
    )
    conn.commit()
    conn.close()
    return path


def test_enumerated_article_splits_into_items_by_ho_boundary(law_db):
    candidates = build_candidates("테스트법", "제6조", [law_db])
    assert len(candidates) == 3
    quotes = [c["sources"][0]["quote"] for c in candidates]
    assert quotes[0] == "위탁업무 수행 목적 외 개인정보의 처리 금지에 관한 사항"
    assert quotes[1] == "개인정보의 기술적ㆍ관리적 보호조치에 관한 사항"
    # 마지막 호는 다음 항(② ...) 앞에서 잘려야 함 — 항 텍스트가 섞여 들어가면 안 됨
    assert quotes[2] == "그 밖에 개인정보의 안전한 관리를 위하여 대통령령으로 정한 사항"
    for q in quotes:
        assert q in ENUM_TEXT
    ids = [c["id"] for c in candidates]
    assert ids == ["CAND-1", "CAND-2", "CAND-3"]
    for c in candidates:
        assert c["norm_type"] == "강행"
        assert c["basis"] == "statute"
        assert c["severity"] == "필수"
        assert c["absence_check"] is True
        assert c["sources"][0]["article"] == "제6조"
        assert c["sources"][0]["verified"] is False


def test_non_enumerated_article_is_skipped(law_db):
    assert not is_enumerated(NON_ENUM_TEXT)
    candidates = build_candidates("테스트법", "제5조", [law_db])
    assert candidates == []


def test_build_candidates_whole_law_only_keeps_enumerated_articles(law_db):
    candidates = build_candidates("테스트법", None, [law_db])
    articles = {c["sources"][0]["article"] for c in candidates}
    assert articles == {"제6조"}
    assert len(candidates) == 3


def test_split_items_returns_empty_for_non_enumerated_text():
    assert split_items(NON_ENUM_TEXT) == []


def test_output_yaml_is_loadable_and_quote_is_substring(law_db):
    candidates = build_candidates("테스트법", "제6조", [law_db])
    text = render_yaml(candidates)
    loaded = yaml.safe_load(text)
    assert "checks" in loaded
    assert len(loaded["checks"]) == 3
    for check in loaded["checks"]:
        quote = check["sources"][0]["quote"]
        assert quote in ENUM_TEXT
        assert check["check"].endswith("— 질문형 정제 필요")
