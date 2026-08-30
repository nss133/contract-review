"""골드셋 회귀 게이트 — 라벨 케이스 전 건 통과를 강제.

지식 YAML·매칭 엔진·게이트를 바꾸면 이 테스트가 정확도 회귀를 잡는다.
실사용 오탐이 새로 발견되면 tests/goldset/cases/에 케이스를 추가할 것.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "build"))
from goldset import run_goldset  # noqa: E402


@pytest.mark.parametrize("tag_mode", ["shadow", "assist"])
def test_goldset_all_pass(monkeypatch, tag_mode):
    monkeypatch.setenv("CONTRACT_TAG_MATCH_MODE", tag_mode)
    rep = run_goldset()
    fails = [f"{r['id']}: {'; '.join(r['errors'])}" for r in rep["rows"] if not r["ok"]]
    assert rep["ok"], "골드셋 실패:\n" + "\n".join(fails)
