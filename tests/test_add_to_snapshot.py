"""replay_external 절단 가드 테스트.

배경: korean-law MCP로 조달한 seed(data/external_laws.json) 일부가 발췌본(절단)인데,
replay_external이 무조건 upsert하여 원본 DB에서 추출된 전문 row를 절단본으로
덮어쓴 사고(보험업법 제111조)가 있었음. 가드: 기존 row가 seed보다 길면 skip.
"""
import json
import sqlite3

import pytest
from add_to_snapshot import replay_external

FULL_TEXT = "제3조(재위탁) " + "사전 동의를 받아야 한다. " * 20  # 전문(긴 텍스트)
SHORT_TEXT = "제3조(재위탁) 사전 동의를 받아야 한다."  # 발췌(절단 의심)


def _make_snapshot(path, rows=()):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE law_articles (id INTEGER PRIMARY KEY, law_name TEXT, "
        "article_ref TEXT, text TEXT, mst TEXT, source TEXT, updated_at TEXT)"
    )
    conn.executemany(
        "INSERT INTO law_articles (law_name, article_ref, text, source) "
        "VALUES (?, ?, ?, 'local-db')",
        rows,
    )
    conn.commit()
    conn.close()
    return path


def _make_seed(path, text):
    path.write_text(
        json.dumps(
            [{"law_name": "테스트법", "mst": "1", "articles": [{"article_ref": "제3조", "text": text}]}],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def _snapshot_text(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(
            "SELECT text FROM law_articles WHERE law_name='테스트법' AND article_ref='제3조'"
        ).fetchone()[0]
    finally:
        conn.close()


def test_longer_seed_replaces_shorter_row(tmp_path):
    """seed가 기존 row보다 길거나 같으면 정상 갱신(최신 전문 refresh)."""
    db = _make_snapshot(tmp_path / "snap.sqlite", [("테스트법", "제3조", SHORT_TEXT)])
    seed = _make_seed(tmp_path / "seed.json", FULL_TEXT)
    n = replay_external(db, seed)
    assert n == 1
    assert _snapshot_text(db) == FULL_TEXT


def test_shorter_seed_is_skipped_with_warning(tmp_path, capsys):
    """기존 row가 seed보다 길면 절단 의심 — skip + stderr 경고, 기존 전문 보존."""
    db = _make_snapshot(tmp_path / "snap.sqlite", [("테스트법", "제3조", FULL_TEXT)])
    seed = _make_seed(tmp_path / "seed.json", SHORT_TEXT)
    n = replay_external(db, seed)
    assert n == 0
    assert _snapshot_text(db) == FULL_TEXT  # 전문이 절단본으로 덮이지 않음
    err = capsys.readouterr().err
    assert "경고: seed 건너뜀" in err
    assert "테스트법 제3조" in err
    assert "절단 의심" in err


def test_equal_length_seed_still_upserts(tmp_path):
    """길이가 같으면 정상 refresh로 간주하여 upsert(가드는 '더 긴 기존 row'만 보호)."""
    db = _make_snapshot(tmp_path / "snap.sqlite", [("테스트법", "제3조", SHORT_TEXT)])
    seed = _make_seed(tmp_path / "seed.json", SHORT_TEXT)
    n = replay_external(db, seed)
    assert n == 1
    conn = sqlite3.connect(db)
    try:
        source = conn.execute(
            "SELECT source FROM law_articles WHERE law_name='테스트법'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert source == "korean-law-mcp"  # upsert가 실제로 수행됨


def test_new_article_inserts(tmp_path):
    """스냅샷에 없는 조문은 그대로 삽입."""
    db = _make_snapshot(tmp_path / "snap.sqlite")
    seed = _make_seed(tmp_path / "seed.json", SHORT_TEXT)
    n = replay_external(db, seed)
    assert n == 1
    assert _snapshot_text(db) == SHORT_TEXT
