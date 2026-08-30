import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "build"))
from apply_tag_proposals import apply_proposals  # noqa: E402


def test_apply_only_human_approved_proposals():
    signatures = {"profile_version": "1.0.0", "checks": {
        "X": {"status": "candidate", "topics": ["subcontracting"], "required_facets": ["topics"]}
    }}
    payload = {"format": "cr-tag-proposals-v1", "profile_version": "1.0.0", "proposals": [{
        "cpId": "X", "decision": {"decision": "approved"},
        "additions": [{"facet": "modalities", "tag": "prior_consent"}],
        "avoid": [{"facet": "modalities", "tag": "post_notice"}],
    }, {"cpId": "Y", "decision": {"decision": "held"}, "additions": []}]}
    out, applied = apply_proposals(signatures, payload)
    assert applied == ["X"]
    assert out["checks"]["X"]["status"] == "curated"
    assert out["checks"]["X"]["modalities"] == ["prior_consent"]
    assert out["checks"]["X"]["avoid"]["modalities"] == ["post_notice"]
    assert "Y" not in out["checks"]


def test_profile_mismatch_is_rejected():
    with pytest.raises(ValueError, match="profile_version"):
        apply_proposals({"profile_version": "1", "checks": {}},
                        {"format": "cr-tag-proposals-v1", "profile_version": "2", "proposals": []})
