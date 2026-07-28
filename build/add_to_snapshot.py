"""data/external_laws.json(MCP 조달분)을 스냅샷 law_articles에 upsert.

배경:
    로컬 원본 DB(config.EXTERNAL_LAW_DBS)에 없는 법령(하도급법·약관규제법·영업비밀보호법·
    저작권법 등)은 korean-law MCP로만 조달 가능함. 이들은 extract_snapshot이 원본에서
    추출할 수 없으므로 스냅샷에 직접 삽입해야 함. 재현성을 위해 조달 원문을 커밋 가능한
    seed(data/external_laws.json)로 관리하고, 이 스크립트가 seed를 스냅샷에 머지함.

동작:
    external_laws.json의 각 조문을 (law_name, article_ref) 키로 upsert(중복 시 갱신).
    source='korean-law-mcp' 로 표기하여 원본 추출분과 구분됨. 스냅샷이 없으면 스키마를
    생성한 뒤 삽입함(extract_snapshot과 동일 스키마).

    extract_snapshot.py가 스냅샷을 재빌드(파일 삭제 후 재생성)해도, 그 말미에서 이
    스크립트의 replay_external()을 호출하므로 조달분이 유실되지 않음.
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import config

ROOT = Path(__file__).parent.parent
EXTERNAL_JSON = ROOT / "data" / "external_laws.json"
SOURCE = "korean-law-mcp"

# extract_snapshot._SCHEMA와 동일 (스냅샷이 없을 때만 생성)
_SCHEMA = """
CREATE TABLE law_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_name TEXT NOT NULL,
    article_ref TEXT NOT NULL,
    text TEXT NOT NULL,
    mst TEXT,
    source TEXT,
    updated_at TEXT
);
CREATE INDEX idx_law_articles_law_name ON law_articles(law_name);
"""


def load_external(json_path=EXTERNAL_JSON):
    """external_laws.json → [(law_name, article_ref, text, mst)] 평탄화."""
    if not Path(json_path).is_file():
        return []
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    rows = []
    for law in data:
        law_name = law["law_name"]
        mst = law.get("mst")
        for art in law["articles"]:
            rows.append((law_name, art["article_ref"], art["text"], mst))
    return rows


def _ensure_schema(conn):
    exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='law_articles'"
    ).fetchone()
    if not exists:
        conn.executescript(_SCHEMA)


def replay_external(db_path, json_path=EXTERNAL_JSON):
    """조달분을 스냅샷에 upsert. 실제 삽입/갱신 건수를 반환(skip 제외).
    extract_snapshot 말미에서도 호출됨(재빌드 후 조달분 재적용).

    절단 가드: 기존 row의 text가 seed보다 길면 seed가 발췌본(절단)일 가능성이
    높으므로 skip하고 stderr에 경고함(보험업법 제111조 절단 사고 재발 방지).
    seed가 기존과 같거나 더 길면 정상 refresh로 보고 upsert함."""
    rows = load_external(json_path)
    if not rows:
        return 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = sqlite3.connect(db_path)
    applied = 0
    try:
        _ensure_schema(conn)
        for law_name, article_ref, text, mst in rows:
            existing = conn.execute(
                "SELECT id, length(text) FROM law_articles "
                "WHERE law_name = ? AND article_ref = ?",
                (law_name, article_ref),
            ).fetchone()
            if existing:
                if existing[1] > len(text):
                    print(
                        f"경고: seed 건너뜀 — {law_name} {article_ref}: "
                        f"기존 row({existing[1]}자)가 seed({len(text)}자)보다 김 (절단 의심)",
                        file=sys.stderr,
                    )
                    continue
                conn.execute(
                    "UPDATE law_articles SET text = ?, mst = ?, source = ?, updated_at = ? "
                    "WHERE id = ?",
                    (text, mst, SOURCE, now, existing[0]),
                )
            else:
                conn.execute(
                    "INSERT INTO law_articles (law_name, article_ref, text, mst, source, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (law_name, article_ref, text, mst, SOURCE, now),
                )
            applied += 1
        conn.commit()
    finally:
        conn.close()
    return applied


def main():
    if not load_external():
        print(f"경고: {EXTERNAL_JSON} 가 없거나 비어 있음. 삽입 없음.", file=sys.stderr)
        return 1
    db_path = config.SNAPSHOT_DB
    db_path.parent.mkdir(parents=True, exist_ok=True)
    n = replay_external(db_path)
    conn = sqlite3.connect(db_path)
    try:
        summary = conn.execute(
            "SELECT law_name, COUNT(*) FROM law_articles WHERE source = ? GROUP BY law_name",
            (SOURCE,),
        ).fetchall()
    finally:
        conn.close()
    print("=" * 60)
    print(f"external_laws.json → {db_path} upsert 완료 ({n}건 처리)")
    for law_name, cnt in summary:
        print(f"  {law_name}: {cnt}건")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
