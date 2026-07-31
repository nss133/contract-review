"""knowledge/std_refs.yaml 검증 게이트 — quote 창작 방지 + check_id 실존 강제.

std_refs는 표시 전용(가중치·판정·매칭·골드셋 채점 무관여)이므로 validate.py
스키마 게이트에 넣지 않고, 이 pytest가 별도 게이트로 강제함:
  1. 각 quote가 data/std_terms/<source_file> 원문의 연속 substring인지
     (공백 정규화 허용 — enrich._normalize와 동일 방식).
  2. 각 check_id가 knowledge/에 실존하는지.
  3. 필수 필드(doc, doc_date, art, quote, source_file) 존재.
"""
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "build"))

from enrich import _normalize  # noqa: E402
from validate import load_knowledge  # noqa: E402

STD_REFS_PATH = ROOT / "knowledge" / "std_refs.yaml"
STD_TERMS_DIR = ROOT / "data" / "std_terms"

REQUIRED_FIELDS = {"doc", "doc_date", "art", "quote", "source_file"}


@pytest.fixture(scope="module")
def std_refs():
    return yaml.safe_load(STD_REFS_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def known_check_ids():
    k = load_knowledge(ROOT / "knowledge")
    ids = set()
    for doc in [k["common"], *k["types"]]:
        for cp in doc["checks"]:
            ids.add(cp["id"])
    return ids


@pytest.fixture(scope="module")
def source_texts():
    """source_file별 원문 캐시 — 주석(#) 헤더 포함 전체를 정규화해 보관."""
    texts = {}
    for p in STD_TERMS_DIR.glob("*.txt"):
        texts[p.name] = _normalize(p.read_text(encoding="utf-8"))
    return texts


def test_file_shape(std_refs):
    """최상위는 {check_id: [ref, ...]} 매핑이고 각 ref는 필수 필드를 갖춤."""
    assert isinstance(std_refs, dict) and std_refs, "std_refs.yaml은 비어 있지 않은 매핑이어야 함"
    for cid, refs in std_refs.items():
        assert isinstance(refs, list) and refs, f"{cid}: 참조 리스트가 비어 있음"
        for ref in refs:
            missing = REQUIRED_FIELDS - ref.keys()
            assert not missing, f"{cid}: 필수 필드 누락 {sorted(missing)}"
            assert str(ref["quote"]).strip(), f"{cid}: quote가 빈 문자열"


def test_check_ids_exist(std_refs, known_check_ids):
    """매핑 대상 check_id가 knowledge/에 실존해야 함 — 오타·폐지 check 잔존 방지."""
    unknown = sorted(set(std_refs) - known_check_ids)
    assert not unknown, f"실존하지 않는 check_id: {unknown}"


def test_source_files_exist(std_refs):
    for cid, refs in std_refs.items():
        for ref in refs:
            path = STD_TERMS_DIR / ref["source_file"]
            assert path.is_file(), f"{cid}: 원문 파일 없음 — {ref['source_file']}"


def test_quotes_are_verbatim(std_refs, source_texts):
    """quote 창작 방지 게이트: 각 quote는 원문의 연속 발췌(공백 정규화 substring)여야 함."""
    failures = []
    for cid, refs in std_refs.items():
        for ref in refs:
            text = source_texts.get(ref["source_file"])
            if text is None:
                failures.append(f"{cid}: {ref['source_file']} 미로드")
                continue
            if _normalize(ref["quote"]) not in text:
                failures.append(f"{cid} [{ref['art']}]: quote가 {ref['source_file']} 원문과 불일치")
    assert not failures, "\n".join(failures)
