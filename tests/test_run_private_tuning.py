from run_private_tuning import _human_category, score


def test_legacy_review_comment_distinguishes_issue_from_no_problem_memo():
    assert _human_category({"verdict": "검토의견", "comment": "문제될 사항 없음"}) == "ok"
    assert _human_category({"verdict": "검토의견", "comment": "지체상금 요구할 사항 아님"}) == "not_applicable"
    assert _human_category({"verdict": "검토의견", "comment": "반영 필요"}) == "issue"


def test_score_separates_false_positive_and_clause_mismatch():
    cases = [{
        "id": "cr-a",
        "_verdicts": {
            "A": {"verdict": "이상없음", "reason": "해당사항 없음"},
            "B": {"verdict": "검토의견"},
            "C": {"verdict": "이상없음", "reason": "해당사항 없음"},
            "D": {"verdict": "검토의견"},
        },
        "_reassign": {"B": 4},
    }]
    observed = [{"items": {
        "A": {"coverage": "verify", "top1_clause_index": 2, "auto_clear": True,
              "auto_pass": False},
        "B": {"coverage": "addressed", "top1_clause_index": 3, "auto_clear": True,
              "auto_pass": True},
        "C": {"coverage": "consider", "top1_clause_index": None},
    }}]
    report = score(cases, observed)
    assert report["pairs"] == {"addressed::issue": 1, "consider::not_applicable": 1,
                               "not_surfaced::issue": 1, "verify::not_applicable": 1}
    assert report["false_positive_by_check"][0]["check_id"] == "A"
    assert report["auto_clear_total"] == 2
    assert report["auto_pass_total"] == 1
    assert report["auto_pass_by_check"] == {"B": 1}
    assert report["auto_pass_human"] == {"issue": 1}
    assert report["metrics"] == {
        "shown_total": 3,
        "ui_false_positive_total": 2,
        "ui_false_positive_rate": 2 / 3,
        "issue_total": 2,
        "issue_surfaced": 1,
        "issue_recall": 1 / 2,
    }
    assert [x["check_id"] for x in report["ui_false_positive_cases"]] == ["A", "C"]
    assert report["missed_issue_cases"] == [{"contract_id": "cr-a", "check_id": "D",
                                               "coverage": "not_surfaced",
                                               "top1_clause_index": None}]
    assert report["clause_mismatches"] == [{"contract_id": "cr-a", "check_id": "B",
                                             "expected": 4, "observed": 3}]


def test_score_excludes_labels_outside_current_active_context():
    cases = [{"id": "cr-old", "_verdicts": {
        "CURRENT": {"verdict": "검토의견"},
        "OLD": {"verdict": "검토의견"},
    }}]
    observed = [{
        "active_check_ids": ["CURRENT"],
        "available_check_ids": ["CURRENT"],
        "items": {"CURRENT": {"coverage": "consider"}},
    }]
    report = score(cases, observed)
    assert report["verdicts"] == 2
    assert report["evaluated_verdicts"] == 1
    assert report["scope_excluded_total"] == 1
    assert report["scope_excluded_by_reason"] == {"not_in_current_type": 1}
    assert report["metrics"]["issue_recall"] == 1
