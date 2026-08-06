import pytest

from build.serve_local import MODEL, _clean_request


def item():
    return {
        "check_id": "CMN-01",
        "check": "당사자가 특정되어 있는가",
        "rule_best_clause_index": 0,
        "candidates": [{"clause_index": 0, "heading": "제1조", "body": "본문"}],
    }


def test_clean_request_accepts_bounded_qwen_payload():
    got = _clean_request({"model": MODEL, "items": [item()]})
    assert got[0]["check_id"] == "CMN-01"
    assert got[0]["candidates"][0]["clause_index"] == 0


def test_clean_request_rejects_unknown_model_and_duplicate_ids():
    with pytest.raises(ValueError):
        _clean_request({"model": "other", "items": [item()]})
    with pytest.raises(ValueError):
        _clean_request({"model": MODEL, "items": [item(), item()]})


def test_clean_request_truncates_contract_text():
    raw = item()
    raw["candidates"][0]["body"] = "가" * 3000
    got = _clean_request({"model": MODEL, "items": [raw]})
    assert len(got[0]["candidates"][0]["body"]) == 1800
