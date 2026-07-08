"""지식이 실제 인용하는 조문만 추려 공유용 스냅샷 DB로 추출함.

배경:
    원본 법령 DB(config.EXTERNAL_LAW_DBS)는 손남수 로컬 iCloud에만 있는 대용량 파일이라
    팀원이 리포를 클론해도 존재하지 않아 빌드가 실패함. 그러나 빌드가 실제로 꺼내 쓰는 건
    knowledge/의 지식이 인용하는 소수의 조문뿐임. 그 조문만 원본과 동일한 스키마의 작은
    SQLite(data/law_snapshot.sqlite)로 추출해 리포에 커밋하면, 팀원은 클론만으로 빌드 가능함.

동작:
    knowledge/를 validate.load_knowledge로 로드 → 모든 check의 sources에서 (law, article)
    쌍을 수집 → 각 쌍을 원본 DB에서 enrich.lookup_article과 동일한 4단계 폴백으로 조회 →
    찾은 실제 row(law_name, article_ref, text, mst, source, updated_at)를 스냅샷에 기록함.
    스냅샷은 원본과 동일한 law_articles 스키마이므로 enrich.lookup_article이 코드 변경 없이
    그대로 재사용됨.

실행 환경:
    원본 DB가 있는 손남수 로컬에서만 실행함. config.EXTERNAL_LAW_DBS를 원본으로 사용함.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
스냅샷 갱신 절차 (지식에 새 조문 인용을 추가한 경우):
    1. knowledge/의 check.sources에 새 (law, article) + quote를 추가함.
    2. 원본 DB가 있는 로컬에서 `python3 build/extract_snapshot.py` 를 재실행함.
       (새 조문이 원본 DB에 있어야 스냅샷에 담김. 없으면 경고가 출력되므로 원본 DB를 먼저 보강)
    3. 갱신된 data/law_snapshot.sqlite 를 커밋함.
       → 팀원은 pull 후 클론만으로 새 조문까지 포함해 빌드 가능함.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
import sqlite3
import sys
from pathlib import Path

import config
from validate import load_knowledge

ROOT = Path(__file__).parent.parent

# 원본과 동일한 law_articles 스키마 (enrich.lookup_article이 그대로 재사용)
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


def _lookup_row(law, article, db_paths):
    """enrich.lookup_article과 동일한 DB 우선순위·4단계 매칭 폴백.
    단, text만이 아니라 스냅샷 기록에 필요한 전체 컬럼 row를 반환함."""
    queries = [
        ("law_name = ? AND article_ref = ?", (law, article)),
        ("law_name = ? AND article_ref LIKE ?", (law, f"{article}(%")),
        ("law_name LIKE ? AND article_ref = ?", (f"%{law}%", article)),
        ("law_name LIKE ? AND article_ref LIKE ?", (f"%{law}%", f"{article}(%")),
    ]
    for db in db_paths:
        if not Path(db).is_file():
            continue
        conn = sqlite3.connect(db)
        try:
            for where, params in queries:
                row = conn.execute(
                    "SELECT law_name, article_ref, text, mst, source, updated_at "
                    f"FROM law_articles WHERE {where} LIMIT 1",
                    params,
                ).fetchone()
                if row:
                    return row
        finally:
            conn.close()
    return None


def collect_pairs(knowledge):
    """모든 check의 sources에서 (law, article) 쌍을 순서 보존·중복 제거로 수집."""
    pairs = []
    seen = set()
    for doc in [knowledge["common"], *knowledge["types"]]:
        for check in doc["checks"]:
            for src in check.get("sources", []):
                key = (src["law"], src["article"])
                if key not in seen:
                    seen.add(key)
                    pairs.append(key)
    return pairs


def main():
    src_dbs = config.EXTERNAL_LAW_DBS
    existing = [d for d in src_dbs if Path(d).is_file()]
    if not existing:
        print(
            "오류: 원본 법령 DB를 찾을 수 없음. 이 스크립트는 원본 DB가 있는 로컬에서만 실행함.\n"
            "  기대 경로:\n" + "\n".join(f"    {d}" for d in src_dbs),
            file=sys.stderr,
        )
        return 1

    knowledge = load_knowledge(ROOT / "knowledge")
    pairs = collect_pairs(knowledge)

    out_path = config.SNAPSHOT_DB
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    conn = sqlite3.connect(out_path)
    found = 0
    missing = []
    written_keys = set()
    try:
        conn.executescript(_SCHEMA)
        for law, article in pairs:
            row = _lookup_row(law, article, existing)
            if row is None:
                missing.append((law, article))
                continue
            found += 1
            # 저장된 실제 (law_name, article_ref) 기준으로 스냅샷 내 중복 삽입 방지
            store_key = (row[0], row[1])
            if store_key in written_keys:
                continue
            written_keys.add(store_key)
            conn.execute(
                "INSERT INTO law_articles (law_name, article_ref, text, mst, source, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                row,
            )
        conn.commit()
    finally:
        conn.close()

    size_kb = out_path.stat().st_size / 1024
    print("=" * 60)
    print(f"스냅샷 추출 완료: {out_path}")
    print(f"  인용 (law, article) 쌍   : {len(pairs)}건")
    print(f"  원본에서 찾은 쌍          : {found}건")
    print(f"  스냅샷에 기록된 조문 row  : {len(written_keys)}건 (중복 제거 후)")
    print(f"  스냅샷 크기               : {size_kb:.1f} KB")
    if missing:
        print(f"  경고: 원본 DB에서 미발견 {len(missing)}건 (원본에도 없으면 정상):")
        for law, article in missing:
            print(f"    - {law} {article}", file=sys.stderr)
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
