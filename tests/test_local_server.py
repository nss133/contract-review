import pytest

from build.serve_local import MODEL, _clean_request, _element_supported


def item():
    return {
        "check_id": "CMN-01",
        "check": "당사자가 특정되어 있는가",
        "rule_best_clause_index": 0,
        "required_elements": ["당사자 명칭", "당사자 식별정보"],
        "candidates": [{"clause_index": 0, "heading": "제1조", "body": "본문"}],
    }


def test_clean_request_accepts_bounded_qwen_payload():
    got = _clean_request({"model": MODEL, "items": [item()]})
    assert got[0]["check_id"] == "CMN-01"
    assert got[0]["candidates"][0]["clause_index"] == 0
    assert got[0]["required_elements"] == ["당사자 명칭", "당사자 식별정보"]
    assert _clean_request({"model": "qwen3:14b", "items": [item()]})[0]["check_id"] == "CMN-01"


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


def test_clean_request_rejects_non_list_required_elements():
    raw = item()
    raw["required_elements"] = "당사자 명칭"
    with pytest.raises(ValueError):
        _clean_request({"model": MODEL, "items": [raw]})


def test_element_support_requires_critical_qualifiers_in_contract_text():
    body = "수탁자는 위탁자의 사전 동의를 받아 재위탁할 수 있다."
    assert not _element_supported("당사의 사전 서면동의", "사전 동의를 받아", body)
    assert not _element_supported("재위탁 제한 또는 금지", "재위탁할 수 있다", body)
    assert _element_supported("위탁자의 사전 동의", "사전 동의를 받아", body)
