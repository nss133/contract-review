import json

from experiment_report import _mcnemar_exact, score_documents, summarize, write_outputs


def _prediction(doc_id):
    return {
        "format": "cr-matching-predictions-v1",
        "meta": {"document_id": doc_id},
        "items": [
            {"check_id": "A", "llm_reviewed": True, "rule_clause_index": 1, "hybrid_clause_index": 2},
            {"check_id": "B", "llm_reviewed": True, "rule_clause_index": 3, "hybrid_clause_index": None},
            {"check_id": "C", "llm_reviewed": False, "rule_clause_index": 4, "hybrid_clause_index": None},
        ],
    }


def _gold(doc_id):
    return {
        "format": "cr-matching-gold-v1",
        "meta": {"document_id": doc_id},
        "labels": [
            {"check_id": "A", "applicable": True, "direct_clause_indices": [2], "reference_clause_indices": []},
            {"check_id": "B", "applicable": True, "direct_clause_indices": [], "reference_clause_indices": [3]},
            {"check_id": "C", "applicable": True, "direct_clause_indices": [4], "reference_clause_indices": []},
        ],
    }


def test_score_and_summary_counts_only_paired_llm_rows():
    rows = score_documents({"D": _prediction("D")}, {"D": _gold("D")})
    summary = summarize(rows)
    assert summary["n"] == 2
    assert summary["improved"] == 2
    assert summary["harmed"] == 0
    assert summary["baseline_reference_false_positive"] == 1
    assert summary["hybrid_reference_false_positive"] == 0


def test_mcnemar_exact_is_two_sided():
    assert _mcnemar_exact(0, 0) == 1.0
    assert _mcnemar_exact(5, 0) == 0.0625


def test_write_outputs(tmp_path):
    rows = score_documents({"D": _prediction("D")}, {"D": _gold("D")})
    summary = summarize(rows)
    write_outputs(tmp_path, rows, summary)
    assert json.loads((tmp_path / "summary.json").read_text())["net_improved"] == 2
    assert "McNemar" in (tmp_path / "report.md").read_text()
    assert "document_id,check_id" in (tmp_path / "paired_results.csv").read_text()
