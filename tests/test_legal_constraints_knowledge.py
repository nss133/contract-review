from pathlib import Path

from validate import load_knowledge


ROOT = Path(__file__).resolve().parents[1]


def test_legal_constraints_are_separate_from_type_detection():
    knowledge = load_knowledge(ROOT / "knowledge")
    rules = {rule["id"]: rule for rule in knowledge["legal_constraints"]["rules"]}
    assert {"INS-EVENT-SOLICITATION", "INS-EVENT-SPECIAL-BENEFIT"}.issubset(rules)
    assert all(rule.get("affects_type") is not True for rule in rules.values())
    assert rules["INS-EVENT-SPECIAL-BENEFIT"]["sources"][0]["article"] == "제98조"
