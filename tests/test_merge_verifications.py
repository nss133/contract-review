import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "build"))
import merge_verifications as mv


def _write(p, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False))


def test_single_reviewer_passthrough(tmp_path):
    _write(tmp_path / "손남수.json", {"CMN-12#0": {"decision": "확인", "date": "2026-07-09"}})
    res = mv.merge_dir(tmp_path)
    assert res["merged"]["CMN-12#0"]["decision"] == "확인"
    assert res["merged"]["CMN-12#0"]["reviewers"] == ["손남수"]
    assert res["conflicts"] == []
    assert res["reviewers"] == ["손남수"]


def test_agreement_confirm(tmp_path):
    _write(tmp_path / "A.json", {"CMN-12#0": {"decision": "확인"}})
    _write(tmp_path / "B.json", {"CMN-12#0": {"decision": "확인"}})
    res = mv.merge_dir(tmp_path)
    assert res["merged"]["CMN-12#0"]["decision"] == "확인"
    assert sorted(res["merged"]["CMN-12#0"]["reviewers"]) == ["A", "B"]
    assert res["conflicts"] == []


def test_conflict_needsfix_wins(tmp_path):
    # 보수적: 한 명이라도 수정필요면 수정필요로 병합 + 충돌 기록
    _write(tmp_path / "A.json", {"CMN-12#0": {"decision": "확인"}})
    _write(tmp_path / "B.json", {"CMN-12#0": {"decision": "수정필요", "note": "조 재확인"}})
    res = mv.merge_dir(tmp_path)
    assert res["merged"]["CMN-12#0"]["decision"] == "수정필요"
    assert len(res["conflicts"]) == 1
    c = res["conflicts"][0]
    assert c["key"] == "CMN-12#0"
    assert c["decisions"]["A"] == "확인"
    assert c["decisions"]["B"] == "수정필요"


def test_needsfix_notes_collected(tmp_path):
    _write(tmp_path / "A.json", {"CMN-12#0": {"decision": "수정필요", "note": "표제 오기"}})
    _write(tmp_path / "B.json", {"CMN-12#0": {"decision": "수정필요", "note": "항 번호 확인"}})
    res = mv.merge_dir(tmp_path)
    assert res["merged"]["CMN-12#0"]["decision"] == "수정필요"
    # 두 검토자 메모 모두 보존
    notes = res["merged"]["CMN-12#0"]["note"]
    assert "표제 오기" in notes and "항 번호 확인" in notes
    # 전원 수정필요는 충돌 아님(합의된 수정필요)
    assert res["conflicts"] == []


def test_multiple_keys_independent(tmp_path):
    _write(tmp_path / "A.json", {"CMN-12#0": {"decision": "확인"}, "NDA-15#0": {"decision": "수정필요"}})
    _write(tmp_path / "B.json", {"CMN-12#0": {"decision": "확인"}})
    res = mv.merge_dir(tmp_path)
    assert res["merged"]["CMN-12#0"]["decision"] == "확인"
    assert res["merged"]["NDA-15#0"]["decision"] == "수정필요"
    assert res["conflicts"] == []  # NDA-15는 A 단독 수정필요 — 충돌 아님


def test_reviewer_name_from_filename(tmp_path):
    _write(tmp_path / "verification_김검토.json", {"CMN-12#0": {"decision": "확인"}})
    res = mv.merge_dir(tmp_path)
    # verification_ 접두사 제거
    assert res["merged"]["CMN-12#0"]["reviewers"] == ["김검토"]


def test_ignores_non_json(tmp_path):
    _write(tmp_path / "A.json", {"CMN-12#0": {"decision": "확인"}})
    (tmp_path / "README.txt").write_text("무시")
    res = mv.merge_dir(tmp_path)
    assert res["reviewers"] == ["A"]


def test_empty_dir(tmp_path):
    res = mv.merge_dir(tmp_path)
    assert res["merged"] == {}
    assert res["reviewers"] == []
    assert res["conflicts"] == []
