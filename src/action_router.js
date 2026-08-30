"use strict";
/* 계약 쟁점의 중요도·문구 매칭과 실제 처리 안내를 분리한다.
   matcher는 관련 증거를 찾고, 이 모듈은 그 결과를 계약서 수정 / 별도 자료 확인 /
   회사 유불리 검토 / 수정 불필요 / 반영 여부 확인으로 라우팅한다. 최종 법률판정은 사람이 한다. */
var ActionRouter = (function () {
  var ACTIONS = ["add_or_modify", "remove", "verify_elsewhere", "negotiate", "no_action", "hold"];
  var LABELS = {
    add_or_modify: "계약서 수정 검토",
    remove: "문제 문구 삭제·수정 검토",
    verify_elsewhere: "별도 자료에서 확인",
    negotiate: "회사 유불리 검토",
    no_action: "계약서 수정 불필요",
    hold: "계약서 반영 여부 확인"
  };
  var NON_CONTRACT_CHANNELS = ["standard_subdoc", "external_evidence", "internal_control",
    "monitoring_evidence", "statutory_duty"];

  function effectiveRequirement(check) {
    if (!check) return "unclassified";
    if (["express", "derived", "recommended", "none"].indexOf(check.contract_requirement) !== -1)
      return check.contract_requirement;
    var byChannel = {
      contract: "express", cooperation_control: "derived", contract_or_internal_control: "derived",
      internal_control: "none", monitoring_evidence: "none", external_evidence: "none",
      statutory_duty: "none", standard_subdoc: "none"
    };
    if (byChannel[check.implementation_channel]) return byChannel[check.implementation_channel];
    // 법령 근거 없는 실무 체크는 계약 필수라고 추정하지 않고 회사 유불리 검토로 둔다.
    if (check.basis === "practice") return "recommended";
    return "unclassified";
  }

  function effectiveTextEffect(check) {
    if (check && ["required_present", "required_absent", "conditional", "advisory", "none"]
      .indexOf(check.text_effect) !== -1) return check.text_effect;
    return {
      express: "required_present", derived: "conditional",
      recommended: "advisory", none: "none"
    }[effectiveRequirement(check)] || "conditional";
  }

  function _coverageContext(result, ctx) {
    var id = result && result.cpId;
    if (id && ctx && ctx.subdoc_coverage && ctx.subdoc_coverage[id]) return "subdoc";
    if (id && ctx && ctx.ref_coverage && ctx.ref_coverage[id]) return "referenced_subdoc";
    return "";
  }

  function evidenceState(result, ctx) {
    var outside = _coverageContext(result, ctx);
    if (outside) return "external_found";
    if (!result) return "not_evaluated";
    if (result.coverage === "addressed" || result.coverage === "base_covered") return "found";
    if (result.coverage === "verify") return "partial";
    if (result.coverage === "consider") return "absent";
    return "not_surfaced";
  }

  function _out(action, check, result, ctx, reason) {
    var label = LABELS[action];
    // 반영 기준이 불명확한 경우와 문구를 일부 찾은 경우는 팀원의 다음 행동이 다르다.
    if (action === "hold" && reason === "possible_text_requires_confirmation")
      label = "현재 문구로 충분한지 확인";
    return {
      action: action,
      label: label,
      requirement: effectiveRequirement(check),
      text_effect: effectiveTextEffect(check),
      implementation_channel: (check && check.implementation_channel) || "unclassified",
      evidence_state: evidenceState(result, ctx),
      reason_code: reason,
      confidence: action === "hold" ? "low" : "rule"
    };
  }

  function route(check, result, context) {
    var ctx = context || {};
    var req = effectiveRequirement(check);
    var effect = effectiveTextEffect(check);
    var channel = (check && check.implementation_channel) || "";
    var ev = evidenceState(result, ctx);

    if (result && (result.roleGated || result.relationshipGated || result.serviceGated))
      return _out("no_action", check, result, ctx, "not_applicable");

    if (effect === "required_absent") {
      if (ev === "found" || ev === "partial")
        return _out("remove", check, result, ctx, "prohibited_text_found");
      return _out("no_action", check, result, ctx, "prohibited_text_not_found");
    }

    if (NON_CONTRACT_CHANNELS.indexOf(channel) !== -1 || req === "none") {
      if (ev === "external_found")
        return _out("no_action", check, result, ctx, "satisfied_outside_main_contract");
      if (channel === "standard_subdoc" || channel === "external_evidence" ||
          channel === "internal_control" || channel === "monitoring_evidence")
        return _out("verify_elsewhere", check, result, ctx, "non_contract_evidence_required");
      return _out("no_action", check, result, ctx, "no_contract_text_requirement");
    }

    if (effect === "advisory" || req === "recommended") {
      if (ev === "found" || ev === "partial" || ev === "absent")
        return _out("negotiate", check, result, ctx, "risk_allocation_choice");
      return _out("no_action", check, result, ctx, "advisory_not_surfaced");
    }

    if (req === "unclassified") {
      if (ev === "found" || ev === "partial" || ev === "absent")
        return _out("hold", check, result, ctx, "contract_requirement_unclassified");
      return _out("no_action", check, result, ctx, "unclassified_not_surfaced");
    }

    if (ev === "external_found" || ev === "found")
      return _out("no_action", check, result, ctx, "required_text_found");
    if (ev === "partial")
      return _out("hold", check, result, ctx, "possible_text_requires_confirmation");
    if (ev === "absent" && (effect === "required_present" || effect === "conditional"))
      return _out("add_or_modify", check, result, ctx, "required_text_not_found");
    return _out("no_action", check, result, ctx, "no_actionable_evidence");
  }

  function requiresDecision(actionResult) {
    var a = actionResult && actionResult.action;
    return a === "add_or_modify" || a === "remove" || a === "verify_elsewhere" || a === "hold";
  }

  return {
    ACTIONS: ACTIONS, LABELS: LABELS,
    effectiveRequirement: effectiveRequirement,
    effectiveTextEffect: effectiveTextEffect,
    evidenceState: evidenceState,
    route: route,
    requiresDecision: requiresDecision
  };
})();

if (typeof module !== "undefined") module.exports = ActionRouter;
