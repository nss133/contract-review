import json
import gzip
from pathlib import Path
import pytest
from app.domain import standard_auto
DATA=json.loads(gzip.decompress((Path(__file__).resolve().parents[2]/'contracts/fixtures/legacy-standard-auto.json.gz').read_bytes()))
@pytest.mark.parametrize('case',DATA['cases'])
def test_native_standard_gate(case):
    assert standard_auto.evaluate(*case['args'])==case['result']
