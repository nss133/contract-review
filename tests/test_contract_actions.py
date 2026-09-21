from pathlib import Path

from build.validate import load_knowledge


ROOT = Path(__file__).parent.parent


def _checks():
    knowledge = load_knowledge(ROOT / "knowledge")
    return {cp["id"]: cp for doc in [knowledge["common"], *knowledge["types"]]
            for cp in doc["checks"]}


def test_all_absence_checks_have_curated_contract_actions():
    checks = _checks()
    curated = [cp for cp in checks.values() if cp.get("contract_action_curated")]
    absence = [cp for cp in checks.values() if cp.get("absence_check")]
    assert len(absence) == 96
    assert len(curated) == 96
    assert {cp["id"] for cp in absence} == {cp["id"] for cp in curated}
    assert all(cp.get("contract_requirement") in {"express", "derived", "recommended", "none"}
               for cp in curated)
    assert all(cp.get("text_effect") in {
        "required_present", "required_absent", "conditional", "advisory", "none"
    } for cp in curated)
    assert all(cp.get("implementation_channel") for cp in curated)
    assert all(cp.get("action_rationale") for cp in curated)


def test_contract_action_examples_separate_text_and_execution_location():
    checks = _checks()
    assert checks["PRIV-06"]["implementation_channel"] == "standard_subdoc"
    assert checks["REL-02"]["contract_requirement"] == "none"
    assert checks["CORE-09"]["contract_requirement"] == "recommended"
    assert checks["CORE-07"]["contract_requirement"] == "derived"
    assert checks["FIN-GUAR-01"]["text_effect"] == "required_present"
    assert checks["PRIV-16"]["contract_requirement"] == "none"
    assert checks["CNS-IP"]["contract_requirement"] == "recommended"
    assert checks["CNS-LABOR"]["implementation_channel"] == "contract_or_internal_control"


def test_security_standard_form_scope_and_low_value_cards():
    knowledge = load_knowledge(ROOT / "knowledge")
    checks = {cp["id"]: cp for doc in [knowledge["common"], *knowledge["types"]]
              for cp in doc["checks"]}
    standard = next(sd for sd in knowledge["common"]["meta"]["standard_subdocs"]
                    if sd["id"] == "SUBDOC-PII")
    assert {"CNS-PRIVSCOPE", "PRIV-17"}.issubset(set(standard["covers"]))
    assert "체결" not in standard["auto_comment"]
    assert checks["PRIV-17"]["surface_policy"] == "aggregate_only"
    assert checks["CMN-02"]["surface_policy"] == "anomaly_only"
