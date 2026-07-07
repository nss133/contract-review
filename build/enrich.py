"""checks[].sources[]의 quote를 DB 원문과 대조 검증하고 원문을 첨부함.

status 의미:
- quote_ok       : quote가 DB 원문에서 확인됨 (배지는 verified 병용 — 원문확인/원문 미대조)
- quote_mismatch : 원문은 찾았으나 quote 문언이 불일치 → 빌드 경고 + [문언 불일치] 배지 (조작·오기 방지)
- no_quote       : 원문은 찾았으나 source에 quote가 없음 (예: 2번째 이후 source)
- missing        : DB에서 원문 자체를 찾지 못함 → 빌드 경고 + [원문 미확인] 배지
"""
import re
import sqlite3

_WS_RE = re.compile(r"[ \t\r\n]+")
_MD_PREFIX_RE = re.compile(r"(?m)^#+\s*")


def _normalize(s):
    """quote 대조용 정규화: 공백류(스페이스·개행·탭 연속)를 단일 스페이스로,
    '#' 문자 제거 후 strip."""
    if not s:
        return ""
    return _WS_RE.sub(" ", s).replace("#", "").strip()


def _strip_md(text):
    """표시용 정리: 줄 시작의 마크다운 헤더 접두(#+)만 제거.
    _normalize와 달리 개행 등 원문 구조는 보존함."""
    if not text:
        return text
    return _MD_PREFIX_RE.sub("", text)


def lookup_article(law, article, db_paths):
    """DB 우선순위 순회. 각 DB 내 매칭 우선순위:
    1. law_name 정확 + article_ref 정확
    2. law_name 정확 + article_ref가 "{article}(" 시작 — 제목 포함 형태.
       '제3조(%'는 '제3조의2(...)'와 오매칭되지 않음
    3. law_name LIKE 폴백 + article_ref 정확
    4. law_name LIKE 폴백 + article_ref가 "{article}(" 시작
    """
    queries = [
        ("law_name = ? AND article_ref = ?", (law, article)),
        ("law_name = ? AND article_ref LIKE ?", (law, f"{article}(%")),
        ("law_name LIKE ? AND article_ref = ?", (f"%{law}%", article)),
        ("law_name LIKE ? AND article_ref LIKE ?", (f"%{law}%", f"{article}(%")),
    ]
    for db in db_paths:
        conn = sqlite3.connect(db)
        try:
            for where, params in queries:
                row = conn.execute(
                    f"SELECT text FROM law_articles WHERE {where} LIMIT 1", params
                ).fetchone()
                if row:
                    return row[0]
        finally:
            conn.close()
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
    """knowledge dict(v2: checks/sources)를 제자리 수정. 경고 문자열 리스트 반환."""
    warnings = []
    for doc in [knowledge["common"], *knowledge["types"]]:
        for check in doc["checks"]:
            cid = check["id"]
            for src in check.get("sources", []):
                text = lookup_article(src["law"], src["article"], law_dbs)
                if not text:
                    src["status"] = "missing"
                    warnings.append(f"{cid}: {src['law']} {src['article']} 원문 미발견")
                    continue
                src["text"] = _strip_md(text)
                quote = src.get("quote")
                if quote:
                    if _normalize(quote) in _normalize(text):
                        src["status"] = "quote_ok"
                    else:
                        src["status"] = "quote_mismatch"
                        warnings.append(
                            f"{cid}: quote 문언이 {src['law']} {src['article']} 원문과 불일치"
                        )
                else:
                    src["status"] = "no_quote"
            refs = check.get("news_refs") or []
            if news_db and refs:
                check["news"] = [n for n in (lookup_news(r, news_db) for r in refs) if n]
    return warnings
