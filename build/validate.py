"""지식 YAML 로드 및 스키마 검증. knowledge/schema.md가 규격 문서임."""
import re
from pathlib import Path

import yaml

SEVERITIES = {"필수", "권장", "참고"}
REQUIRED_FIELDS = {"id", "title", "severity", "guidance"}


class ValidationError(Exception):
    pass


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
        raise ValidationError(f"{path.name}: 최상위에 meta·checkpoints 키가 필요함")
    if not isinstance(data.get("meta"), dict):
        raise ValidationError(f"{path.name}: meta는 비어 있지 않은 매핑이어야 함")
    if not isinstance(data.get("checkpoints"), list):
        raise ValidationError(f"{path.name}: checkpoints는 리스트여야 함")
    data["meta"].setdefault("modules", [])
    data["meta"].setdefault("detect_keywords", [])
    return data


def _validate(common, types):
    seen_ids = set()
    for doc in [common, *types]:
        fname = doc["meta"].get("type_id", "?")
        module_ids = {m["id"] for m in doc["meta"]["modules"]}
        for cp in doc["checkpoints"]:
            cid = cp.get("id", "?")
            missing = REQUIRED_FIELDS - cp.keys()
            if missing:
                raise ValidationError(f"{fname}/{cid}: 필수 필드 누락 {sorted(missing)}")
            if cp["id"] in seen_ids:
                raise ValidationError(f"중복 id: {cp['id']}")
            seen_ids.add(cp["id"])
            if cp["severity"] not in SEVERITIES:
                raise ValidationError(f"{cid}: severity 값 오류 '{cp['severity']}'")
            if "module" in cp and cp["module"] not in module_ids:
                raise ValidationError(f"{cid}: 선언되지 않은 module '{cp['module']}'")
            for lb in cp.get("legal_basis", []):
                if not {"law", "article", "verified"} <= set(lb.keys()):
                    raise ValidationError(f"{cid}: legal_basis에 law·article·verified 필요")
            # Python re로 컴파일 검증 — JS RegExp과 문법이 미세하게 다르나 현재 패턴 수준(\s* 등)에선 동일함
            for p in (cp.get("triggers") or {}).get("patterns", []):
                try:
                    re.compile(p)
                except re.error:
                    raise ValidationError(f"{cid}: triggers.patterns 정규식 오류 '{p}'")
