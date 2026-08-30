from pathlib import Path

from validate import load_knowledge


ROOT = Path(__file__).resolve().parents[1]


def test_regulatory_scope_registry_and_cross_type_checks_are_connected():
    knowledge = load_knowledge(ROOT / "knowledge")
    scope = knowledge["regulatory_scopes"]["scopes"]["financial_outsourcing"]
    assert scope["module_id"] == "X-FINOUT"
    assert scope["check_source_type"] == "outsourcing"
    outsourcing = next(doc for doc in knowledge["types"] if doc["meta"]["type_id"] == "outsourcing")
    core_checks = [cp for cp in outsourcing["checks"] if cp["id"].startswith("CORE-")]
    assert len(core_checks) == 13
    assert {cp["module"] for cp in core_checks} == {"X-FINOUT"}


def test_common_module_ids_are_globally_unique():
    knowledge = load_knowledge(ROOT / "knowledge")
    ids = [m["id"] for m in knowledge["common"]["meta"]["modules"]]
    assert len(ids) == len(set(ids))
    assert "X-FINOUT" in ids
