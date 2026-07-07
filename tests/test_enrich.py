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
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) "
        "VALUES ('테스트법4', '제9조', '###### 제9조(x) 내용')"
    )
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) "
        "VALUES ('민법', '제393조', '제393조(손해배상의 범위) 통상의 손해를 그 한도로 한다.')"
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


def _make_law_db(path, rows):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE law_articles (id INTEGER PRIMARY KEY, law_name TEXT, "
        "article_ref TEXT, text TEXT, mst TEXT, source TEXT, updated_at TEXT)"
    )
    conn.executemany(
        "INSERT INTO law_articles (law_name, article_ref, text) VALUES (?, ?, ?)", rows
    )
    conn.commit()
    conn.close()
    return path


def test_lookup_falls_through_to_next_db(tmp_path):
    db1 = _make_law_db(tmp_path / "db1.sqlite", [("무관한법", "제9조", "무관한 내용")])
    db2 = _make_law_db(tmp_path / "db2.sqlite", [("폴스루법", "제1조", "폴스루 내용")])
    assert lookup_article("폴스루법", "제1조", [db1, db2]) == "폴스루 내용"


def test_lookup_first_db_wins(tmp_path):
    db1 = _make_law_db(tmp_path / "db1.sqlite", [("중복법", "제1조", "DB1 내용")])
    db2 = _make_law_db(tmp_path / "db2.sqlite", [("중복법", "제1조", "DB2 내용")])
    assert lookup_article("중복법", "제1조", [db1, db2]) == "DB1 내용"


def test_lookup_no_false_prefix(law_db):
    conn = sqlite3.connect(law_db)
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) "
        "VALUES ('테스트법3', '제5조의2(기타)', 'X')"
    )
    conn.commit()
    conn.close()
    assert lookup_article("테스트법3", "제5조", [law_db]) is None


def test_enrich_quote_ok_exact_match(knowledge_dir, law_db):
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    src = k["types"][0]["checks"][0]["sources"][0]
    assert src["status"] == "quote_ok"
    assert "사전 동의" in src["text"]
    assert warnings == []


def test_enrich_quote_ok_normalizes_whitespace(knowledge_dir, law_db):
    p = knowledge_dir / "types" / "outsourcing.yaml"
    p.write_text(
        p.read_text().replace(
            "quote: 사전 동의를 받아야 한다",
            'quote: "사전   동의를\\n받아야    한다"',
        )
    )
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    src = k["types"][0]["checks"][0]["sources"][0]
    assert src["status"] == "quote_ok"
    assert warnings == []


def test_enrich_quote_mismatch_warns(knowledge_dir, law_db):
    p = knowledge_dir / "types" / "outsourcing.yaml"
    p.write_text(
        p.read_text().replace(
            "quote: 사전 동의를 받아야 한다", "quote: 완전히 다른 문언임"
        )
    )
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    src = k["types"][0]["checks"][0]["sources"][0]
    assert src["status"] == "quote_mismatch"
    assert len(warnings) == 1
    assert "OUT-01" in warnings[0] and "불일치" in warnings[0]


def test_enrich_warns_on_missing(knowledge_dir, law_db):
    p = knowledge_dir / "types" / "outsourcing.yaml"
    p.write_text(p.read_text().replace("테스트법", "없는법"))
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    src = k["types"][0]["checks"][0]["sources"][0]
    assert src["status"] == "missing"
    assert len(warnings) == 1


def test_enrich_no_quote_for_second_source(law_db):
    knowledge = {
        "common": {"checks": []},
        "types": [
            {
                "checks": [
                    {
                        "id": "T-01",
                        "sources": [
                            {
                                "law": "테스트법",
                                "article": "제3조",
                                "quote": "사전 동의를 받아야 한다",
                                "verified": True,
                            },
                            {"law": "테스트법", "article": "제3조", "verified": False},
                        ],
                    }
                ]
            }
        ],
    }
    warnings = enrich(knowledge, [law_db])
    sources = knowledge["types"][0]["checks"][0]["sources"]
    assert sources[0]["status"] == "quote_ok"
    assert sources[1]["status"] == "no_quote"
    assert "text" in sources[1]
    assert warnings == []


def test_enrich_strips_markdown_prefix(law_db):
    knowledge = {
        "common": {"checks": []},
        "types": [
            {
                "checks": [
                    {
                        "id": "T-02",
                        "sources": [
                            {"law": "테스트법4", "article": "제9조", "verified": False}
                        ],
                    }
                ]
            }
        ],
    }
    enrich(knowledge, [law_db])
    text = knowledge["types"][0]["checks"][0]["sources"][0]["text"]
    assert "#" not in text
    assert "제9조(x) 내용" in text


def test_enrich_attaches_news(knowledge_dir, law_db, news_db):
    p = knowledge_dir / "common.yaml"
    p.write_text(
        p.read_text().replace(
            "    sources: []\n    note: \"\"\n",
            "    sources: []\n    note: \"\"\n    news_refs: [n1, nope]\n",
        )
    )
    k = load_knowledge(knowledge_dir)
    enrich(k, [law_db], news_db=news_db)
    news = k["common"]["checks"][0]["news"]
    assert len(news) == 1 and news[0]["title"] == "위탁 규정 개정 예고"
