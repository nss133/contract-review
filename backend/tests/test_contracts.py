import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.schemas import EvidenceLocation, ReviewInput, VerdictInput
from app.domain.compat import legacy_hash, utf16_offset, codepoint_offset


@pytest.mark.parametrize("text", ["", "가나다", "😀계약", "가", "가\r\n나", "𐐀"])
def test_legacy_hash_matches_captured_js(text):
    path = Path(__file__).resolve().parents[2] / "contracts/fixtures/legacy-compat.json"
    rows = json.loads(path.read_text())["cases"]
    row = next(row for row in rows if row["text"] == text)
    assert legacy_hash(text) == row["hash"]


def test_utf16_positions_roundtrip_and_reject_split_surrogate():
    text = "가😀나"
    assert utf16_offset(text, 2) == 3
    assert codepoint_offset(text, 3) == 2
    with pytest.raises(ValueError):
        codepoint_offset(text, 2)
    with pytest.raises(ValueError):
        utf16_offset(text, 4)


def test_api_input_rejects_silent_type_coercion_and_unknown_fields():
    with pytest.raises(ValidationError):
        ReviewInput(text="계약", revision="1")
    with pytest.raises(ValidationError):
        ReviewInput(text="계약", auto_approved=True)
    assert ReviewInput(text="가\r\n😀", revision=0).text == "가\r\n😀"


def test_browser_cannot_submit_automatic_verdict():
    with pytest.raises(ValidationError):
        VerdictInput(verdict="이상없음", origin="auto", revision=0)
    with pytest.raises(ValidationError):
        VerdictInput(verdict="검토의견", comment="  ", revision=0)


def test_evidence_location_is_half_open_and_ordered():
    value = EvidenceLocation(document_id="doc", start=0, end=3, quote="가😀")
    assert value.offset_unit == "utf16"
    with pytest.raises(ValidationError):
        EvidenceLocation(document_id="doc", start=3, end=2, quote="가")
