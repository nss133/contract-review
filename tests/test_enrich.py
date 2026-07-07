import sqlite3

import pytest
from enrich import enrich, lookup_article
from validate import load_knowledge


@pytest.fixture
def law_db(tmp_path):
    path = tmp_path / "laws.sqlite"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE law_articles (id INTEGER PRIMARY KEY, law_name TEXT, "
        "article_ref TEXT, text TEXT, mst TEXT, source TEXT, updated_at TEXT)"
    )
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) "
        "VALUES ('테스트법', '제3조', '제3조(재위탁) 사전 동의를 받아야 한다.')"
    )
    conn.commit()
    conn.close()
    return path


@pytest.fixture
def news_db(tmp_path):
    path = tmp_path / "briefing.sqlite3"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, url TEXT, "
        "published_at TEXT, summary TEXT)"
    )
    conn.execute(
        "INSERT INTO items VALUES ('n1', '위탁 규정 개정 예고', 'http://x', '2026-06-01', '요약임')"
    )
    conn.commit()
    conn.close()
    return path


def test_lookup_exact(law_db):
    assert "사전 동의" in lookup_article("테스트법", "제3조", [law_db])


def test_lookup_like_fallback(law_db):
    assert lookup_article("테스트", "제3조", [law_db]) is not None


def test_lookup_missing(law_db):
    assert lookup_article("없는법", "제1조", [law_db]) is None


def test_lookup_article_title_suffix(law_db):
    conn = sqlite3.connect(law_db)
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) "
        "VALUES ('테스트법2', '제5조(위탁의 범위)', '제5조 내용임')"
    )
    conn.commit()
    conn.close()
    assert lookup_article("테스트법2", "제5조", [law_db]) == "제5조 내용임"


def test_lookup_no_false_prefix(law_db):
    conn = sqlite3.connect(law_db)
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) "
        "VALUES ('테스트법3', '제5조의2(기타)', 'X')"
    )
    conn.commit()
    conn.close()
    assert lookup_article("테스트법3", "제5조", [law_db]) is None


def test_enrich_attaches_text_and_status(knowledge_dir, law_db):
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    lb = k["types"][0]["checkpoints"][0]["legal_basis"][0]
    assert lb["status"] == "verified"
    assert "사전 동의" in lb["text"]
    assert warnings == []


def test_enrich_warns_on_missing(knowledge_dir, law_db):
    p = knowledge_dir / "types" / "outsourcing.yaml"
    p.write_text(p.read_text().replace("테스트법", "없는법"))
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    lb = k["types"][0]["checkpoints"][0]["legal_basis"][0]
    assert lb["status"] == "missing"
    assert len(warnings) == 1


def test_enrich_attaches_news(knowledge_dir, law_db, news_db):
    p = knowledge_dir / "common.yaml"
    p.write_text(p.read_text().replace("news_refs: []", "").replace(
        "    legal_basis: []", "    legal_basis: []\n    news_refs: [n1, nope]"))
    k = load_knowledge(knowledge_dir)
    enrich(k, [law_db], news_db=news_db)
    news = k["common"]["checkpoints"][0]["news"]
    assert len(news) == 1 and news[0]["title"] == "위탁 규정 개정 예고"
