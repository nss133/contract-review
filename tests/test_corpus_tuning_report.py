import json

from corpus_tuning_report import analyze_corpus, compare_reports, render_markdown


def corpus(contracts=2, verify_ok=3):
    return {
        "meta": {"updated": "2026-08-20", "contract_count": contracts, "hashes": ["a", "b"]},
        "byCheck": {
            "A": {
                "counts": {"이상없음": verify_ok, "검토의견": 0, "해당없음": 1},
                "system_verdict_pairs": {
                    "possible_evidence::이상없음": verify_ok,
                    "possible_evidence::해당없음": 1,
                },
                "origin_counts": {"manual": verify_ok + 1},
                "matching_counts": {"observed": 2, "reassigned": 1, "top1_correct": 1,
                                    "top1_wrong": 1, "gold_in_top3": 2},
            },
            "B": {
                "counts": {"이상없음": 1, "검토의견": 0, "해당없음": 0},
                "system_verdict_pairs": {"evidence_not_found::이상없음": 1},
            },
        },
    }


def test_analyze_corpus_ranks_and_aggregates():
    report = analyze_corpus(corpus())
    assert report["meta"] == {"updated": "2026-08-20", "contracts": 2, "checks": 2, "verdicts": 5}
    assert report["verify_ok"][0]["check_id"] == "A"
    assert report["verify_ok"][0]["ratio"] == 0.75
    assert report["absence_ok"][0]["check_id"] == "B"
    assert report["matching"][0]["reassignment_rate"] == 0.5
    assert "possible_evidence::이상없음: 3" in render_markdown(report)


def test_compare_reports_reports_deltas():
    before = analyze_corpus(corpus(contracts=2, verify_ok=3))
    after = analyze_corpus(corpus(contracts=4, verify_ok=5))
    comp = compare_reports(before, after)
    assert comp["delta"]["contracts"] == 2
    assert comp["delta"]["verdicts"] == 2
    assert comp["delta"]["system_verdict_pairs"]["possible_evidence::이상없음"] == 2
