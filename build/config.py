"""실제 데이터 소스 경로. 테스트는 이 상수를 쓰지 않고 픽스처 DB를 주입함.

2계층 데이터 구조:
1. 스냅샷(SNAPSHOT_DB): 지식이 실제 인용하는 조문만 담은 소형 SQLite. 리포에 커밋되어
   팀원이 클론만으로 빌드 가능. build/extract_snapshot.py 로 생성·갱신.
2. 원본(EXTERNAL_LAW_DBS): 손남수 로컬 iCloud의 대용량 원본 DB. 지식 확장(새 조문 인용)
   시에만 필요. 리포 밖 절대경로라 팀원 환경엔 부재.

LAW_DBS = [스냅샷] + [존재하는 원본]. 스냅샷 우선, 스냅샷에 없는 조문은 원본으로 폴백.
    - 팀원(스냅샷만): 스냅샷만으로 조회.
    - 손남수(원본 있음): 스냅샷 우선 + 신규 조문은 원본에서 채워짐.
경로 부재는 조용히 스킵됨(enrich.lookup_article이 존재하지 않는 db_path에서도 안전하도록,
아래에서 존재하는 경로만 남김).
"""
from pathlib import Path

_ROOT = Path(__file__).parent.parent
_ICLOUD = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/cursor"

# 1) 공유용 스냅샷 (리포 커밋 대상, 상대경로)
SNAPSHOT_DB = _ROOT / "data" / "law_snapshot.sqlite"

# 2) 확장용 원본 DB (로컬 전용, 절대경로 — 팀원 환경엔 부재)
EXTERNAL_LAW_DBS = [
    _ICLOUD / "comp_matching_auto/data/laws_monitored.sqlite",   # 1순위: 법령 조문
    _ICLOUD / "comp_matching_auto/data/fsc_guidelines.sqlite",   # 2순위: 금융위 가이드라인
    _ICLOUD / "comp_matching_auto/data/klia_regulations.sqlite", # 3순위: 협회 규정
]
_EXTERNAL_NEWS = _ICLOUD / "news clipping/data/briefing.sqlite3"

# 조회용 DB 목록: 스냅샷(존재 시) 우선 + 존재하는 원본 폴백.
# 존재하지 않는 경로는 제외 → 팀원 환경에서 경로 부재로 인한 sqlite 오류 방지.
LAW_DBS = [
    p for p in [SNAPSHOT_DB, *EXTERNAL_LAW_DBS] if Path(p).is_file()
]

# 뉴스 DB는 현재 미사용(news_refs 참조 0건). 존재하면 쓰고 없으면 None.
NEWS_DB = _EXTERNAL_NEWS if _EXTERNAL_NEWS.is_file() else None
