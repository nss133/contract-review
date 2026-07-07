"""실제 데이터 소스 경로. 테스트는 이 상수를 쓰지 않고 픽스처 DB를 주입함."""
from pathlib import Path

_ICLOUD = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/cursor"

LAW_DBS = [
    _ICLOUD / "comp_matching_auto/data/laws_monitored.sqlite",   # 1순위: 법령 조문
    _ICLOUD / "comp_matching_auto/data/fsc_guidelines.sqlite",   # 2순위: 금융위 가이드라인
    _ICLOUD / "comp_matching_auto/data/klia_regulations.sqlite", # 3순위: 협회 규정
]

NEWS_DB = _ICLOUD / "news clipping/data/briefing.sqlite3"
