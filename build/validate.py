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
    """계약 지식과 선택적 구조화 태그 정본을 로드·검증한다."""
    kdir = Path(knowledge_dir)
    common = _load_file(kdir / "common.yaml")
    types = [_load_file(p) for p in sorted((kdir / "types").glob("*.yaml"))]
    contract_actions = _load_contract_actions(kdir, common, types)
    _validate(common, types)
    regulatory_scopes = _load_regulatory_scopes(kdir, common, types)
    legal_constraints = _load_legal_constraints(kdir)
    taxonomy, signatures = _load_tag_knowledge(kdir, common, types)
    return {"common": common, "types": types, "tag_taxonomy": taxonomy,
            "tag_signatures": signatures, "regulatory_scopes": regulatory_scopes,
            "legal_constraints": legal_constraints, "contract_actions": contract_actions}


def _load_contract_actions(kdir, common, types):
    """계약조치 메타데이터 정본을 check에 병합한다.

    파일이 없는 임시 테스트 지식은 하위호환한다. 본 저장소에서는 영향이 큰 부재알람
    후보부터 사람이 분류하고, 미분류 항목은 런타임에서 자동 필수로 단정하지 않는다.
    """
    path = kdir / "contract_actions.yaml"
    if not path.exists():
        return {"schema_version": "", "actions": {}}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    actions = data.get("actions")
    if not isinstance(actions, dict):
        raise ValidationError("contract_actions.yaml: actions는 매핑이어야 함")
    check_map = {cp["id"]: cp for doc in [common, *types] for cp in doc["checks"]}
    allowed = {"contract_requirement", "text_effect", "implementation_channel", "action_rationale"}
    for cid, action in actions.items():
        if cid not in check_map:
            raise ValidationError(f"contract action: 알 수 없는 check id '{cid}'")
        if not isinstance(action, dict):
            raise ValidationError(f"{cid}: contract action은 매핑이어야 함")
        unknown = set(action) - allowed
        if unknown:
            raise ValidationError(f"{cid}: contract action 알 수 없는 필드 {sorted(unknown)}")
        required = {"contract_requirement", "text_effect", "implementation_channel"}
        missing = required - set(action)
        if missing:
            raise ValidationError(f"{cid}: contract action 필수 필드 누락 {sorted(missing)}")
        cp = check_map[cid]
        for key, value in action.items():
            if key in cp and cp[key] != value:
                raise ValidationError(f"{cid}: {key}가 체크 원본과 contract_actions 정본에서 충돌함")
            cp[key] = value
        cp["contract_action_curated"] = True
    absence_ids = {cid for cid, cp in check_map.items() if cp.get("absence_check")}
    action_ids = set(actions)
    missing = sorted(absence_ids - action_ids)
    extra = sorted(action_ids - absence_ids)
    if missing or extra:
        detail = []
        if missing:
            detail.append(f"부재점검 미분류 {missing}")
        if extra:
            detail.append(f"부재점검 아닌 action {extra}")
        raise ValidationError("contract_actions.yaml 전수분류 불일치: " + "; ".join(detail))
    return data


def _load_regulatory_scopes(kdir, common, types):
    """법규 적용범위 게이트를 로드한다. 임시 테스트 지식에는 없어도 하위호환한다."""
    path = kdir / "regulatory_scopes.yaml"
    if not path.exists():
        return {"schema_version": "", "scopes": {}}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    scopes = data.get("scopes")
    if not isinstance(scopes, dict):
        raise ValidationError("regulatory_scopes.yaml: scopes는 매핑이어야 함")
    common_modules = {m["id"] for m in common["meta"]["modules"]}
    type_ids = {doc["meta"]["type_id"] for doc in types}
    required_factors = {
        "financial_business_purpose", "continuous_use", "simple_backoffice_exclusion",
    }
    required_signals = {
        "non_applicable_contract", "financial_business", "continuous_use", "one_off",
        "simple_backoffice",
    }
    for sid, scope in scopes.items():
        if not isinstance(scope, dict):
            raise ValidationError(f"regulatory scope {sid}: 매핑이어야 함")
        missing = {"label", "module_id", "check_source_type", "questions", "signals"} - scope.keys()
        if missing:
            raise ValidationError(f"regulatory scope {sid}: 필수 필드 누락 {sorted(missing)}")
        if scope["module_id"] not in common_modules:
            raise ValidationError(f"regulatory scope {sid}: common에 없는 module_id '{scope['module_id']}'")
        if scope["check_source_type"] not in type_ids:
            raise ValidationError(
                f"regulatory scope {sid}: 알 수 없는 check_source_type '{scope['check_source_type']}'"
            )
        questions = scope["questions"]
        if not isinstance(questions, dict) or not required_factors.issubset(questions):
            raise ValidationError(f"regulatory scope {sid}: questions에 {sorted(required_factors)} 필요")
        signals = scope["signals"]
        if not isinstance(signals, dict) or not required_signals.issubset(signals):
            raise ValidationError(f"regulatory scope {sid}: signals에 {sorted(required_signals)} 필요")
        for key in required_signals:
            values = signals[key]
            if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
                raise ValidationError(f"regulatory scope {sid}: signals.{key}는 문자열 리스트여야 함")
    return data


def _load_legal_constraints(kdir):
    """법령상 드문·위법 가능 조합을 별도 경보로 보내는 개연성 제약을 로드한다."""
    path = kdir / "legal_constraints.yaml"
    if not path.exists():
        return {"schema_version": "", "rules": []}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    rules = data.get("rules")
    if not isinstance(rules, list):
        raise ValidationError("legal_constraints.yaml: rules는 리스트여야 함")
    seen = set()
    for rule in rules:
        if not isinstance(rule, dict):
            raise ValidationError("legal constraint: 각 rule은 매핑이어야 함")
        missing = {"id", "label", "requires", "signals", "sources"} - rule.keys()
        if missing:
            raise ValidationError(f"legal constraint: 필수 필드 누락 {sorted(missing)}")
        if rule["id"] in seen:
            raise ValidationError(f"legal constraint 중복 id: {rule['id']}")
        seen.add(rule["id"])
        requires, signals = rule["requires"], rule["signals"]
        if not isinstance(requires, list) or not requires or not isinstance(signals, dict):
            raise ValidationError(f"{rule['id']}: requires와 signals 형식 오류")
        for group in requires:
            values = signals.get(group)
            if not isinstance(values, list) or not values or any(
                not isinstance(value, str) or not value.strip() for value in values
            ):
                raise ValidationError(f"{rule['id']}: signals.{group}는 비어 있지 않은 문자열 리스트여야 함")
        if not isinstance(rule["sources"], list) or not rule["sources"]:
            raise ValidationError(f"{rule['id']}: sources가 필요함")
        if rule.get("affects_type") is True:
            raise ValidationError(f"{rule['id']}: 금지행위 경보는 계약유형을 직접 변경할 수 없음")
    return data


def _load_tag_knowledge(kdir, common, types):
    """tag_taxonomy/tag_signatures가 있으면 검증 후 check에 signature를 join한다.

    임시 테스트 지식폴더 등 두 파일이 모두 없는 경우에는 빈 태그층으로 진행하여
    기존 빌드 API와 하위호환한다. 한 파일만 있으면 계보가 불완전하므로 실패한다.
    """
    taxonomy_path = kdir / "tag_taxonomy.yaml"
    signatures_path = kdir / "tag_signatures.yaml"
    if not taxonomy_path.exists() and not signatures_path.exists():
        return {"profile_version": "", "facets": {}}, {"profile_version": "", "checks": {}}
    if not taxonomy_path.is_file() or not signatures_path.is_file():
        raise ValidationError("tag_taxonomy.yaml과 tag_signatures.yaml은 함께 있어야 함")
    taxonomy = yaml.safe_load(taxonomy_path.read_text(encoding="utf-8")) or {}
    signatures = yaml.safe_load(signatures_path.read_text(encoding="utf-8")) or {}
    if taxonomy.get("profile_version") != signatures.get("profile_version"):
        raise ValidationError("태그 taxonomy/signatures profile_version 불일치")
    facets = taxonomy.get("facets")
    signature_map = signatures.get("checks")
    if not isinstance(facets, dict) or not isinstance(signature_map, dict):
        raise ValidationError("태그 정본은 facets/checks 매핑이 필요함")
    check_map = {cp["id"]: cp for doc in [common, *types] for cp in doc["checks"]}
    allowed_status = {"candidate", "curated", "disabled"}
    for cid, signature in signature_map.items():
        if cid not in check_map:
            raise ValidationError(f"태그 signature가 알 수 없는 check를 참조함: {cid}")
        if not isinstance(signature, dict):
            raise ValidationError(f"{cid}: tag signature는 매핑이어야 함")
        status = signature.get("status", "candidate")
        if status not in allowed_status:
            raise ValidationError(f"{cid}: tag status 값 오류 '{status}'")
        required = signature.get("required_facets", [])
        if not isinstance(required, list) or any(f not in facets for f in required):
            raise ValidationError(f"{cid}: required_facets가 taxonomy 축과 불일치")
        declared = []
        for facet, registry in facets.items():
            values = signature.get(facet, [])
            if not isinstance(values, list):
                raise ValidationError(f"{cid}: {facet}는 리스트여야 함")
            if not isinstance(registry, dict):
                raise ValidationError(f"taxonomy {facet}: 매핑이어야 함")
            unknown = [value for value in values if value not in registry]
            if unknown:
                raise ValidationError(f"{cid}: 알 수 없는 {facet} 태그 {unknown}")
            if values:
                declared.append(facet)
        avoid = signature.get("avoid", {})
        if not isinstance(avoid, dict):
            raise ValidationError(f"{cid}: avoid는 축별 태그 매핑이어야 함")
        for facet, values in avoid.items():
            if facet not in facets or not isinstance(values, list):
                raise ValidationError(f"{cid}: avoid.{facet} 형식 오류")
            unknown = [value for value in values if value not in facets[facet]]
            if unknown:
                raise ValidationError(f"{cid}: 알 수 없는 avoid.{facet} 태그 {unknown}")
        if status == "curated" and not declared:
            raise ValidationError(f"{cid}: curated signature에는 태그가 필요함")
        missing_required = [facet for facet in required if not signature.get(facet)]
        if missing_required:
            raise ValidationError(f"{cid}: required facet에 값 없음 {missing_required}")
        check_map[cid]["tag_signature"] = signature
    return taxonomy, signatures


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
    common_module_ids = {m["id"] for m in common["meta"]["modules"]}
    for doc in [common, *types]:
        fname = doc["meta"].get("type_id", "?")
        # 유형 체크가 공통 횡단모듈(X-*)을 참조할 수 있다. 적용범위는 common에서
        # 결정하되, 전문 체크셋은 해당 유형 파일에 유지하기 위한 구조다.
        module_ids = {m["id"] for m in doc["meta"]["modules"]} | common_module_ids
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

            for field in ("decision_question", "pass_guidance", "opinion_guidance"):
                value = cp.get(field)
                if value is not None and (not isinstance(value, str) or not value.strip()):
                    raise ValidationError(f"{cid}: {field}는 비어 있지 않은 문자열이어야 함")
            if cp.get("decision_question") and not cp["decision_question"].rstrip().endswith("?"):
                raise ValidationError(f"{cid}: decision_question은 판정 가능한 질문형(?)이어야 함")
            perspective_rule = cp.get("perspective_rule")
            if perspective_rule is not None and perspective_rule not in {"confidentiality_duration"}:
                raise ValidationError(f"{cid}: 알 수 없는 perspective_rule '{perspective_rule}'")

            llm_elements = cp.get("llm_elements")
            if llm_elements is not None and (
                not isinstance(llm_elements, list) or not 1 <= len(llm_elements) <= 8
                or any(not isinstance(x, str) or not x.strip() for x in llm_elements)
            ):
                raise ValidationError(f"{cid}: llm_elements는 비어 있지 않은 문자열 1~8개의 리스트여야 함")

            service_scope = cp.get("service_scope")
            if service_scope is not None and (
                not isinstance(service_scope, list) or not service_scope
                or any(s not in ("completion", "mandate") for s in service_scope)
            ):
                raise ValidationError(f"{cid}: service_scope는 completion|mandate 리스트여야 함")

            relationship_scope = cp.get("relationship_scope")
            allowed_relationships = {"processing_outsourcing", "third_party_provision", "mixed", "unknown"}
            if relationship_scope is not None and (
                not isinstance(relationship_scope, list) or not relationship_scope
                or any(s not in allowed_relationships for s in relationship_scope)
            ):
                raise ValidationError(f"{cid}: relationship_scope 값이 올바르지 않음")

            implementation_channel = cp.get("implementation_channel")
            if implementation_channel is not None and implementation_channel not in {
                "contract", "standard_subdoc", "external_evidence", "contract_or_internal_control",
                "internal_control", "monitoring_evidence", "cooperation_control", "statutory_duty"
            }:
                raise ValidationError(f"{cid}: 알 수 없는 implementation_channel '{implementation_channel}'")

            contract_requirement = cp.get("contract_requirement")
            if contract_requirement is not None and contract_requirement not in {
                "express", "derived", "recommended", "none"
            }:
                raise ValidationError(f"{cid}: 알 수 없는 contract_requirement '{contract_requirement}'")

            text_effect = cp.get("text_effect")
            if text_effect is not None and text_effect not in {
                "required_present", "required_absent", "conditional", "advisory", "none"
            }:
                raise ValidationError(f"{cid}: 알 수 없는 text_effect '{text_effect}'")

            action_rationale = cp.get("action_rationale")
            if action_rationale is not None and (
                not isinstance(action_rationale, str) or not action_rationale.strip()
            ):
                raise ValidationError(f"{cid}: action_rationale은 비어 있지 않은 문자열이어야 함")

            auto_clear = cp.get("auto_clear")
            if auto_clear is not None:
                groups = auto_clear.get("any_groups") if isinstance(auto_clear, dict) else None
                if (
                    not isinstance(groups, list) or not groups
                    or any(not isinstance(g, list) or not g
                           or any(not isinstance(k, str) or not k.strip() for k in g) for g in groups)
                ):
                    raise ValidationError(f"{cid}: auto_clear.any_groups는 비어 있지 않은 문자열 그룹 리스트여야 함")
                req = auto_clear.get("require")
                allowed_req = {"number", "period", "date", "money", "rate"}
                if req is not None and (
                    not isinstance(req, list) or not req or any(r not in allowed_req for r in req)
                ):
                    raise ValidationError(f"{cid}: auto_clear.require는 {sorted(allowed_req)} 중에서만")
                expect = auto_clear.get("expect")
                allowed_expect = {"statement", "prohibition", "definition"}
                if expect is not None and expect not in allowed_expect:
                    raise ValidationError(f"{cid}: auto_clear.expect는 {sorted(allowed_expect)} 중 하나여야 함")

            auto_verdict = cp.get("auto_verdict")
            if auto_verdict is not None and not isinstance(auto_verdict, bool):
                raise ValidationError(f"{cid}: auto_verdict는 불리언이어야 함")

            evidence_groups = cp.get("evidence_required_groups")
            if evidence_groups is not None and (
                not isinstance(evidence_groups, list) or not evidence_groups
                or any(not isinstance(g, list) or not g
                       or any(not isinstance(k, str) or not k.strip() for k in g) for g in evidence_groups)
            ):
                raise ValidationError(f"{cid}: evidence_required_groups는 비어 있지 않은 문자열 그룹 리스트여야 함")

            precondition_groups = cp.get("absence_precondition_groups")
            if precondition_groups is not None and (
                not isinstance(precondition_groups, list) or not precondition_groups
                or any(not isinstance(g, list) or not g
                       or any(not isinstance(k, str) or not k.strip() for k in g)
                       for g in precondition_groups)
            ):
                raise ValidationError(
                    f"{cid}: absence_precondition_groups는 비어 있지 않은 문자열 그룹 리스트여야 함"
                )

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

    subdocs = common["meta"].get("standard_subdocs", [])
    if not isinstance(subdocs, list):
        raise ValidationError("meta.standard_subdocs는 리스트여야 함")
    for sd in subdocs:
        missing = {"id", "title", "ref_signals", "covers"} - sd.keys()
        if missing:
            raise ValidationError(f"standard_subdocs: {sorted(missing)} 필요")
        for cid in sd["covers"]:
            if cid not in seen_ids:
                raise ValidationError(f"standard_subdocs {sd['id']}: 존재하지 않는 check '{cid}'")
