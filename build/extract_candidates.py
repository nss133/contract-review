"""checks v2 후보 대량 추출 도구.

지정 법령(옵션으로 특정 조문)의 조문 중 열거형 패턴("다음 각 호"를 포함하고
"포함" 또는 "하여야 한다"가 함께 있는 조문)을 찾아 호 단위로 분해하고,
checks v2 형태의 후보 YAML을 stdout에 출력함.

산출물은 Phase 2 확장을 위한 "후보 생성기" 수준이다 — 그대로 앱에 들어가지
않으며, id/check 문구/트리거는 사람 또는 Claude가 정제한다.
verified는 항상 false로 고정하고, quote는 반드시 DB 원문의 부분문자열이어야 한다.

사용법:
    python3 build/extract_candidates.py "<law_name>" [--article 제N조] [--db <path>]
"""
import argparse
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import config

# 호 경계: 앞에 공백이 있고(=문장/이전 호 끝) 뒤에 공백이 이어지는 "숫자." 형태만 인정.
# '제22조의2'처럼 숫자 앞에 공백 없이 붙는 조번호 표기나 '2023.3.14' 같은 날짜(공백 없음)는
# 이 조건을 만족하지 않아 오검출되지 않는다.
_ITEM_SPLIT_RE = re.compile(r"(?<=\s)\d{1,2}\.\s+")
# 항(①②③...) 경계 — 마지막 호 뒤에 이어지는 다음 항 텍스트를 잘라내기 위함
_CIRCLED_RE = re.compile(r"[①-⑳]")
_ENUM_HINT_RE = re.compile(r"다음\s*각\s*호")
_MANDATORY_RE = re.compile(r"하여야\s*한다")
_PERMISSIVE_RE = re.compile(r"할\s*수\s*있다")


def fetch_articles(law_name, article, db_paths):
    """law_name(+article 지정 시 해당 조문)의 (article_ref, text) 목록을 DB 우선순위대로 조회.
    enrich.lookup_article과 동일한 폴백 순서를 따르되, 조문 전체가 필요할 수 있어
    LIMIT 1이 아닌 전체 매칭 행을 반환한다. 먼저 매칭이 나온 DB의 결과만 사용한다."""
    if article:
        queries = [
            ("law_name = ? AND article_ref = ?", (law_name, article)),
            ("law_name = ? AND article_ref LIKE ?", (law_name, f"{article}(%")),
            ("law_name LIKE ? AND article_ref = ?", (f"%{law_name}%", article)),
            ("law_name LIKE ? AND article_ref LIKE ?", (f"%{law_name}%", f"{article}(%")),
        ]
    else:
        queries = [
            ("law_name = ?", (law_name,)),
            ("law_name LIKE ?", (f"%{law_name}%",)),
        ]
    for db in db_paths:
        conn = sqlite3.connect(db)
        try:
            for where, params in queries:
                rows = conn.execute(
                    f"SELECT article_ref, text FROM law_articles WHERE {where}", params
                ).fetchall()
                if rows:
                    return rows
        finally:
            conn.close()
    return []


def is_enumerated(text):
    """'다음 각 호'를 포함하고 '포함' 또는 '하여야 한다'가 함께 있는 열거형 조문인지 판정."""
    if not text or not _ENUM_HINT_RE.search(text):
        return False
    return "포함" in text or bool(_MANDATORY_RE.search(text))


def split_items(text):
    """열거형 조문 text를 호(1. 2. 3. ...) 단위로 분해. 각 항목은 원문의 부분문자열이며,
    다음 항(①②③...) 텍스트가 섞이지 않도록 절단한다. 비열거형이면 빈 리스트."""
    parts = _ITEM_SPLIT_RE.split(text)
    if len(parts) < 2:
        return []
    items = []
    for part in parts[1:]:
        m = _CIRCLED_RE.search(part)
        chunk = part[: m.start()] if m else part
        chunk = chunk.strip()
        if chunk:
            items.append(chunk)
    return items


def norm_type_of(article_text):
    """조문 어미로 강행/임의 판정. 판단 불가 시 강행을 기본값으로 둠(스펙 지시)."""
    if _MANDATORY_RE.search(article_text):
        return "강행"
    if _PERMISSIVE_RE.search(article_text):
        return "임의"
    return "강행"


def build_candidates(law_name, article, db_paths):
    """law_name(+article)에 해당하는 열거형 조문에서 checks v2 후보 dict 리스트를 생성."""
    rows = fetch_articles(law_name, article, db_paths)
    candidates = []
    seq = 1
    for article_ref, text in rows:
        if not is_enumerated(text):
            continue
        norm_type = norm_type_of(text)
        for item in split_items(text):
            candidates.append(
                {
                    "id": f"CAND-{seq}",
                    "check": f"{item} — 질문형 정제 필요",
                    "severity": "필수",
                    "norm_type": norm_type,
                    "basis": "statute",
                    "triggers": {"keywords": [], "patterns": []},
                    "absence_check": True,
                    "sources": [
                        {
                            "law": law_name,
                            "article": article_ref,
                            "quote": item,
                            "verified": False,
                        }
                    ],
                }
            )
            seq += 1
    return candidates


def render_yaml(candidates):
    """candidates를 checks v2 형태의 YAML 문자열로 직렬화."""
    import yaml

    return yaml.dump(
        {"checks": candidates}, allow_unicode=True, sort_keys=False, default_flow_style=False
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="checks v2 체크리스트 후보 대량 추출 도구")
    parser.add_argument("law_name", help="DB law_name과 일치하는 법령명")
    parser.add_argument("--article", help="특정 조문만 처리 (예: 제26조)")
    parser.add_argument("--db", help="법령 DB 경로 (생략 시 config.LAW_DBS 사용)")
    args = parser.parse_args(argv)

    db_paths = [Path(args.db)] if args.db else config.LAW_DBS
    candidates = build_candidates(args.law_name, args.article, db_paths)
    sys.stdout.write(render_yaml(candidates))
    if not candidates:
        print("# 후보 없음 — 열거형 조문(다음 각 호 + 포함/하여야 한다)을 찾지 못함", file=sys.stderr)


if __name__ == "__main__":
    main()
