import json
import gzip
from pathlib import Path
import pytest
from app.domain import agreement_judgment

DATA=json.loads(gzip.decompress((Path(__file__).resolve().parents[2]/'contracts/fixtures/legacy-judgment.json.gz').read_bytes()))

@pytest.mark.parametrize('case',DATA['cases'],ids=lambda r:r['function'])
def test_native_question_judgment(case):
    assert getattr(agreement_judgment,case['function'])(*case['args'])==case['result']
