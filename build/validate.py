"""지식 YAML 로드 및 스키마 검증. knowledge/schema.md가 규격 문서임."""
import re
import sys
from pathlib import Path

import yaml

SEVERITIES = {"필수", "권장", "참고"}
NORM_TYPES = {"강행", "임의", "추정", "간주", "선언", "실무"}
BASES = {"statute", "practice"}
REQUIRED_FIELDS = {"id", "check", "severity", "basis", "norm_type"}
SOURCE_REQUIRED_FIELDS = {"law", "article", "verified"}


class ValidationError(Exception):
    pass


def derive_severity(norm_type, basis):
    """규범 효력 → 심각도 도출 규칙. severity = f(norm_type, basis).

    - basis=practice(법령 근거 없는 실무 항목) → 참고
    - 강행(의무·금지) → 필수
    - 임의(권한) → 권장
    - 추정·간주·선언·실무(정의·절차·선언·간주) → 참고
    """
    if basis == "practice":
        return "참고"
    if norm_type == "강행":
        return "필수"
    if norm_type == "임의":
        return "권장"
    return "참고"


def load_knowledge(knowledge_dir):
    """common.yaml + types/*.yaml 로드·검증 → {"common": dict, "types": [dict]}"""
    kdir = Path(knowledge_dir)
    common = _load_file(kdir / "common.yaml")
    types = [_load_file(p) for p in sorted((kdir / "types").glob("*.yaml"))]
    _validate(common, types)
    return {"common": common, "types": types}


def _load_file(path):
    if not path.is_file():
        raise ValidationError(f"{path.name}: 파일을 찾을 수 없음")
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict):
        raise ValidationError(f"{path.name}: 최상위에 meta·checks 키가 필요함")
    if not isinstance(data.get("meta"), dict):
        raise ValidationError(f"{path.name}: meta는 비어 있지 않은 매핑이어야 함")
    if "checkpoints" in data:
        raise ValidationError(f"{path.name}: checkpoints는 v2에서 checks로 변경됨")
    if not isinstance(data.get("checks"), list):
        raise ValidationError(f"{path.name}: checks는 리스트여야 함")
    data["meta"].setdefault("modules", [])
    data["meta"].setdefault("detect_keywords", [])
    return data


def _validate(common, types):
    seen_ids = set()
    for doc in [common, *types]:
        fname = doc["meta"].get("type_id", "?")
        module_ids = {m["id"] for m in doc["meta"]["modules"]}
        for cp in doc["checks"]:
            cid = cp.get("id", "?")
            if "guidance" in cp:
                raise ValidationError(f"{cid}: guidance는 폐지됨 — note 사용")
            missing = REQUIRED_FIELDS - cp.keys()
            if missing:
                raise ValidationError(f"{fname}/{cid}: 필수 필드 누락 {sorted(missing)}")
            if cp["id"] in seen_ids:
                raise ValidationError(f"중복 id: {cp['id']}")
            seen_ids.add(cp["id"])
            if cp["severity"] not in SEVERITIES:
                raise ValidationError(f"{cid}: severity 값 오류 '{cp['severity']}'")
            if cp["norm_type"] not in NORM_TYPES:
                raise ValidationError(f"{cid}: norm_type 값 오류 '{cp['norm_type']}'")
            if cp["basis"] not in BASES:
                raise ValidationError(f"{cid}: basis 값 오류 '{cp['basis']}'")
            if "module" in cp and cp["module"] not in module_ids:
                raise ValidationError(f"{cid}: 선언되지 않은 module '{cp['module']}'")

            sources = cp.get("sources", [])
            if not isinstance(sources, list):
                raise ValidationError(f"{cid}: sources는 리스트여야 함")
            for src in sources:
                missing_src = SOURCE_REQUIRED_FIELDS - src.keys()
                if missing_src:
                    raise ValidationError(f"{cid}: sources 항목에 {sorted(missing_src)} 필요")

            if cp["basis"] == "statute":
                if not sources:
                    raise ValidationError(f"{cid}: basis=statute는 sources가 1개 이상 필요함")
                quote = sources[0].get("quote")
                if not isinstance(quote, str) or not quote.strip():
                    raise ValidationError(f"{cid}: basis=statute는 sources[0].quote가 필요함")

            note = cp.get("note")
            if note is not None and not isinstance(note, str):
                raise ValidationError(f"{cid}: note는 문자열이어야 함")

            sb = cp.get("severity_basis")
            if sb is not None and (not isinstance(sb, str) or not sb.strip()):
                raise ValidationError(f"{cid}: severity_basis는 비어 있지 않은 문자열이어야 함")

            override = cp.get("severity_override", False)
            if not isinstance(override, bool):
                raise ValidationError(f"{cid}: severity_override는 불리언이어야 함")
            expected = derive_severity(cp["norm_type"], cp["basis"])
            if cp["severity"] != expected and not override:
                # 지식 작성 가드: 규칙 불일치는 에러가 아니라 경고 (의도적 예외는 severity_override 사용)
                print(
                    f"[경고] {cid}: severity '{cp['severity']}'가 도출 규칙과 불일치 "
                    f"(norm_type={cp['norm_type']}, basis={cp['basis']} → 기대 '{expected}'). "
                    f"의도적 예외면 severity_override: true 부여",
                    file=sys.stderr,
                )

            # Python re로 컴파일 검증 — JS RegExp과 문법이 미세하게 다르나 현재 패턴 수준(\s* 등)에선 동일함
            for p in (cp.get("triggers") or {}).get("patterns", []):
                try:
                    re.compile(p)
                except re.error:
                    raise ValidationError(f"{cid}: triggers.patterns 정규식 오류 '{p}'")
