import json
import gzip
import re
from pathlib import Path
import pytest
from app.domain import clause_semantics

DATA=json.loads(gzip.decompress((Path(__file__).resolve().parents[2]/'contracts/fixtures/legacy-semantics.json.gz').read_bytes()))

@pytest.mark.parametrize('case',DATA['cases'],ids=lambda r:r['function'])
def test_native_semantics_matches_frozen_rules(case):
    name=re.sub(r'(?<!^)(?=[A-Z])','_',case['function']).lower()
    assert getattr(clause_semantics,name)(*case['args'])==case['result']
