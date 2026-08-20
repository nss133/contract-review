import json

from import_archive_cases import FORMAT, combine_cases, write_cases


def test_combine_cases_joins_hash_and_skips_fingerprint_only():
    registry = [
        {"contract_hash": "cr-a", "contract_text": "계약서 전문", "name": "A", "date": "2026-08-20",
         "reviewer": "손", "type_id": "procurement"},
        {"contract_hash": "cr-b", "name": "B", "fp": {"kw": ["계약"]}},
    ]
    verdicts = {"cr-verdict-cr-a": json.dumps({"CMN-01": {"verdict": "이상없음"}}, ensure_ascii=False)}
    reassign = {"cr-reassign-cr-a": json.dumps({"CMN-01": 3})}
    cases = combine_cases(registry, verdicts, reassign)
    assert len(cases) == 1
    assert cases[0]["format"] == FORMAT
    assert cases[0]["verdicts"]["CMN-01"]["verdict"] == "이상없음"
    assert cases[0]["reassign"] == {"CMN-01": 3}
    assert cases[0]["label_status"] == "clause_labeled"


def test_write_cases_uses_private_output(tmp_path):
    cases = [{"format": FORMAT, "id": "cr-a", "meta": {"name": "테스트 계약", "date": ""},
              "text": "본문", "verdicts": {}, "reassign": {}, "label_status": "unlabeled"}]
    summary = write_cases(cases, tmp_path)
    assert summary == {"cases": 1, "verdict_labeled": 0, "clause_labeled": 0, "unlabeled": 1}
    written = list(tmp_path.glob("*.json"))
    assert len(written) == 1
    assert json.loads(written[0].read_text())["text"] == "본문"
