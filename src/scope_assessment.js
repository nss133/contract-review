"use strict";
/* 법규 적용범위 판정기. 체크리스트 매칭 전에 적용/비적용/확인필요를 판정한다.
   문서에 없는 사실을 부정으로 추정하지 않으며, 자동 근거와 사람 보정을 함께 보존한다. */
var ScopeAssessment = (function () {
  var FACTORS = ["financial_business_purpose", "continuous_use", "simple_backoffice_exclusion"];

  function _hits(text, words) {
    var source = String(text || ""), out = [];
    (words || []).forEach(function (word) {
      var from = 0, index;
      while ((index = source.indexOf(word, from)) !== -1) {
        var left = Math.max(source.lastIndexOf(".", index), source.lastIndexOf("\n", index)) + 1;
        var dot = source.indexOf(".", index), nl = source.indexOf("\n", index);
        var right = Math.min(dot === -1 ? source.length : dot, nl === -1 ? source.length : nl);
        var sentence = source.slice(left, right);
        // “보험상담을 포함하지 않는다” 같은 명시적 배제 문언은 양성 신호가 아니다.
        var negated = /(포함|수행|처리|제공|해당|취급).{0,24}(하지\s*(않|아니)|않는다|아니다|없다)|무관/.test(sentence);
        if (!negated) { if (out.indexOf(word) === -1) out.push(word); break; }
        from = index + String(word).length;
      }
    });
    return out;
  }

  function _factor(value, evidence) {
    return { value: value, source: "document", evidence: (evidence || []).slice(0, 8) };
  }

  function _applyManual(factors, answers) {
    FACTORS.forEach(function (key) {
      var value = answers && answers[key];
      if (["yes", "no", "unknown"].indexOf(value) === -1) return;
      factors[key] = { value: value, source: "manual", evidence: [] };
    });
  }

  function _status(factors, context) {
    var financial = factors.financial_business_purpose;
    var continuous = factors.continuous_use;
    var simple = factors.simple_backoffice_exclusion;
    var hasManual = FACTORS.some(function (key) { return factors[key].source === "manual"; });
    if (!hasManual && context && context.nonApplicableContractHits && context.nonApplicableContractHits.length)
      return { status: "non_applicable",
        reason: "계약의 성격상 금융업무위탁 규정은 적용하지 않고 해당 계약 유형의 체크리스트로 검토합니다." };
    // 사람의 명시 판단은 자동 문언보다 우선한다.
    if ((financial.source === "manual" && financial.value === "no") ||
        (continuous.source === "manual" && continuous.value === "no") ||
        (simple.source === "manual" && simple.value === "yes")) {
      return { status: "non_applicable", reason: "검토자가 규정 정의요건의 불충족 또는 단순 후선업무 제외를 확인했습니다." };
    }
    // 법령상 드물거나 위법 가능성이 있는 조합은 일반 업무위탁의 양성 신호로 쓰지 않는다.
    // 사람이 요소를 보정한 경우에는 사람 판단이 이 개연성 제약보다 우선한다.
    var effects = (context && context.scopeEffects) || {};
    if (!hasManual && effects.financial_outsourcing === "non_applicable") {
      return { status: "non_applicable", confidence: "medium",
        reason: "행사 실행용역에 보험모집 신호가 섞였지만 이를 일반 업무위탁의 양성 근거로 쓰지 않고 별도 보험모집 준법 확인으로 분리했습니다." };
    }
    if (financial.value === "yes" && (continuous.value === "no" || simple.value === "yes")) {
      return { status: "needs_confirmation", reason: "금융업무 신호와 단발성·단순 집행용역 신호가 함께 있어 실질 확인이 필요합니다." };
    }
    if (financial.value === "yes" && continuous.value === "yes" && simple.value !== "yes") {
      return { status: "applicable", reason: "금융업 영위 목적의 업무와 제3자 용역의 계속적 활용이 함께 확인됩니다." };
    }
    if (financial.value !== "yes" && (continuous.value === "no" || simple.value === "yes")) {
      return { status: "non_applicable", reason: "금융업무 신호 없이 단발성 또는 단순 후선·집행용역의 성격이 확인됩니다." };
    }
    return { status: "needs_confirmation", reason: "계약 문언만으로 금융업 목적·계속성·단순 후선업무 여부를 확정하기 어렵습니다." };
  }

  function assessFinancialOutsourcing(text, config, answers, context) {
    var signals = (config && config.signals) || {};
    var title = String(context && context.docTitle || "");
    var file = String(context && context.fileName || "");
    if (file.normalize) file = file.normalize("NFC");
    file = file.replace(/\.[A-Za-z0-9]+$/, "");
    var sourceText = [String(text || ""), title, file].filter(Boolean).join("\n");
    var nonApplicableContractHits = _hits(sourceText, signals.non_applicable_contract);
    var financialHits = _hits(sourceText, signals.financial_business);
    var continuousHits = _hits(sourceText, signals.continuous_use);
    var oneOffHits = _hits(sourceText, signals.one_off);
    var backofficeHits = _hits(sourceText, signals.simple_backoffice);
    var factors = {
      financial_business_purpose: _factor(financialHits.length ? "yes" : "unknown", financialHits),
      continuous_use: _factor(continuousHits.length ? "yes" : (oneOffHits.length ? "no" : "unknown"),
        continuousHits.length ? continuousHits : oneOffHits),
      simple_backoffice_exclusion: _factor(backofficeHits.length ? "yes" : "unknown", backofficeHits)
    };
    _applyManual(factors, answers || {});
    var statusContext = Object.assign({}, context || {}, {
      nonApplicableContractHits: nonApplicableContractHits
    });
    var result = _status(factors, statusContext);
    var confidence = result.confidence || (result.status === "needs_confirmation" ? "low" : "high");
    var reviewFactors = result.status === "needs_confirmation" ? FACTORS.filter(function (key) {
      return factors[key].value === "unknown";
    }) : [];
    if (result.status === "needs_confirmation" && !reviewFactors.length) {
      reviewFactors = ["financial_business_purpose", "simple_backoffice_exclusion"];
    }
    return {
      scope_id: "financial_outsourcing",
      label: (config && config.label) || "금융업무위탁 규정",
      module_id: (config && config.module_id) || "X-FINOUT",
      check_source_type: (config && config.check_source_type) || "outsourcing",
      status: result.status,
      confidence: confidence,
      reason: result.reason,
      scope_evidence: nonApplicableContractHits,
      factors: factors,
      review_factors: reviewFactors,
      input_sources: [String(text || "").trim() ? "본문" : "", title.trim() ? "제목" : "", file.trim() ? "파일명" : ""].filter(Boolean)
    };
  }

  function assessAll(text, registry, answers, context) {
    var scopes = (registry && registry.scopes) || {};
    var out = {};
    Object.keys(scopes).forEach(function (scopeId) {
      if (scopeId === "financial_outsourcing") {
        out[scopeId] = assessFinancialOutsourcing(text, scopes[scopeId], (answers || {})[scopeId], context || {});
      }
    });
    return out;
  }

  return { FACTORS: FACTORS, assessFinancialOutsourcing: assessFinancialOutsourcing, assessAll: assessAll };
})();

if (typeof module !== "undefined") module.exports = ScopeAssessment;
