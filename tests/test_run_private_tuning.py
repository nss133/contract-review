from run_private_tuning import score


def test_score_separates_false_positive_and_clause_mismatch():
    cases = [{
        "id": "cr-a",
        "_verdicts": {
            "A": {"verdict": "이상없음", "reason": "해당사항 없음"},
            "B": {"verdict": "검토의견"},
        },
        "_reassign": {"B": 4},
    }]
    observed = [{"items": {
        "A": {"coverage": "verify", "top1_clause_index": 2, "auto_clear": True,
              "auto_pass": False},
        "B": {"coverage": "addressed", "top1_clause_index": 3, "auto_clear": True,
              "auto_pass": True},
    }}]
    report = score(cases, observed)
    assert report["pairs"] == {"addressed::issue": 1, "verify::not_applicable": 1}
    assert report["false_positive_by_check"][0]["check_id"] == "A"
    assert report["auto_clear_total"] == 2
    assert report["auto_pass_total"] == 1
    assert report["auto_pass_by_check"] == {"B": 1}
    assert report["auto_pass_human"] == {"issue": 1}
    assert report["clause_mismatches"] == [{"contract_id": "cr-a", "check_id": "B",
                                             "expected": 4, "observed": 3}]
