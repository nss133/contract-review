"""체크포인트의 legal_basis·news_refs에 원본 DB의 원문을 첨부함.

status 의미:
- verified   : 사람이 원문 대조 완료(verified: true) + DB 원문 존재
- unverified : DB 원문은 찾았으나 사람 검수 전 → HTML에서 [원문 미대조] 배지
- missing    : DB에서 원문을 찾지 못함 → 빌드 경고 + [원문 미확인] 배지
"""
import sqlite3


def lookup_article(law, article, db_paths):
    """DB 우선순위 순회. 정확 일치 → LIKE 포함 폴백."""
    for db in db_paths:
        conn = sqlite3.connect(db)
        try:
            row = conn.execute(
                "SELECT text FROM law_articles WHERE law_name = ? AND article_ref = ?",
                (law, article),
            ).fetchone()
            if not row:
                row = conn.execute(
                    "SELECT text FROM law_articles WHERE law_name LIKE ? "
                    "AND article_ref = ? LIMIT 1",
                    (f"%{law}%", article),
                ).fetchone()
        finally:
            conn.close()
        if row:
            return row[0]
    return None


def lookup_news(item_id, news_db):
    conn = sqlite3.connect(news_db)
    try:
        row = conn.execute(
            "SELECT title, url, published_at, summary FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {"title": row[0], "url": row[1], "published_at": row[2], "summary": row[3]}


def enrich(knowledge, law_dbs, news_db=None):
    """knowledge dict를 제자리 수정. 경고 문자열 리스트 반환."""
    warnings = []
    for doc in [knowledge["common"], *knowledge["types"]]:
        for cp in doc["checkpoints"]:
            for lb in cp.get("legal_basis", []):
                text = lookup_article(lb["law"], lb["article"], law_dbs)
                if text:
                    lb["text"] = text
                    lb["status"] = "verified" if lb["verified"] else "unverified"
                else:
                    lb["status"] = "missing"
                    warnings.append(f"{cp['id']}: {lb['law']} {lb['article']} 원문 미발견")
            refs = cp.get("news_refs") or []
            if news_db and refs:
                cp["news"] = [n for n in (lookup_news(r, news_db) for r in refs) if n]
    return warnings
