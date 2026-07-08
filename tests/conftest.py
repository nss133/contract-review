import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "build"))

import pytest

VALID_COMMON = """\
meta:
  type_id: common
  type_name: 공통
  detect_keywords: []
  modules: []
checks:
  - id: CMN-01
    check: 손해배상 조항이 있는가
    severity: 참고
    severity_basis: "실무 관행 항목(법령 강제 아님)"
    norm_type: 실무
    basis: practice
    triggers:
      keywords: [손해배상, 배상]
    absence_check: true
    sources: []
    note: ""
  - id: CMN-02
    check: 손해배상 범위를 민법 제393조에 맞게 통상손해로 한정하는가
    severity: 필수
    severity_basis: "근거 조문이 강행규정(의무)임 — 민법 제393조"
    norm_type: 강행
    basis: statute
    triggers:
      keywords: [통상손해]
    absence_check: false
    sources:
      - law: 민법
        article: 제393조
        clause: 제1항
        quote: 통상의 손해를 그 한도로 한다
        verified: false
"""

VALID_TYPE = """\
meta:
  type_id: outsourcing
  type_name: 업무위탁
  detect_keywords: [위탁, 수탁]
  modules:
    - id: M-PRIV
      name: 개인정보 처리위탁
      always_on: false
      screening_question: 개인정보 처리가 포함되는가?
      suggest_keywords: [개인정보]
checks:
  - id: OUT-01
    check: 재위탁 시 사전 동의를 받도록 규정하는가
    severity: 필수
    severity_basis: "근거 조문이 강행규정(의무)임 — 테스트법 제3조"
    module: M-PRIV
    norm_type: 강행
    basis: statute
    triggers:
      keywords: [재위탁]
    absence_check: true
    sources:
      - law: 테스트법
        article: 제3조
        verified: true
        quote: 사전 동의를 받아야 한다
"""


@pytest.fixture
def knowledge_dir(tmp_path):
    (tmp_path / "types").mkdir()
    (tmp_path / "common.yaml").write_text(VALID_COMMON)
    (tmp_path / "types" / "outsourcing.yaml").write_text(VALID_TYPE)
    return tmp_path
