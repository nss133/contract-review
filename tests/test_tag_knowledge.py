import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "build"))

from validate import load_knowledge  # noqa: E402
from generate_tag_signatures import generate  # noqa: E402


def test_curated_tag_signatures_are_attached_and_valid():
    knowledge = load_knowledge(ROOT / "knowledge")
    checks = {
        cp["id"]: cp
        for doc in [knowledge["common"], *knowledge["types"]]
        for cp in doc["checks"]
    }
    assert knowledge["tag_taxonomy"]["profile_version"] == "1.1.0"
    assert checks["PRIV-15"]["tag_signature"]["modalities"] == ["prior_consent"]
    assert checks["NDA-06"]["tag_signature"]["status"] == "curated"


def test_initial_curated_scope_is_explicit_not_all_checks():
    knowledge = load_knowledge(ROOT / "knowledge")
    all_checks = [cp for doc in [knowledge["common"], *knowledge["types"]] for cp in doc["checks"]]
    curated = [cp for cp in all_checks if cp.get("tag_signature", {}).get("status") == "curated"]
    assert len(all_checks) == 240
    assert len(curated) == 16


def test_vendor_taxonomy_matches_local_registry():
    knowledge = load_knowledge(ROOT / "knowledge")
    vendor = json.loads((ROOT / "vendor" / "contract-tag-taxonomy.json").read_text())
    assert vendor["profileVersion"] == knowledge["tag_taxonomy"]["profile_version"]
    for facet, registry in vendor["facets"].items():
        local = knowledge["tag_taxonomy"]["facets"][facet]
        assert set(registry) == set(local)
        assert {key: value["label"] for key, value in registry.items()} == {
            key: value["label"] for key, value in local.items()
        }


def test_candidate_generator_covers_all_240_checks_without_overwriting_curated_source():
    generated = generate(ROOT / "knowledge")
    assert len(generated["checks"]) == 240
    assert generated["checks"]["PRIV-15"]["status"] == "candidate"
    assert "subcontracting" in generated["checks"]["PRIV-15"]["topics"]
