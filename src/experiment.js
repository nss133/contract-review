"use strict";
/* 규칙 Top-1 대비 로컬 LLM 재정렬의 순증가분을 측정하는 실험 데이터 계약.
   누적 코퍼스와 분리하며 계약 본문은 골드 템플릿에만 선택적으로 포함한다. */
var Experiment = (function () {
  var PREDICTION_FORMAT = "cr-matching-predictions-v1";
  var GOLD_FORMAT = "cr-matching-gold-v1";

  function _checkMap(checkpoints) {
    var out = {};
    (checkpoints || []).forEach(function (cp) { out[cp.id] = cp; });
    return out;
  }

  function _clauseMap(clauses) {
    var out = {};
    (clauses || []).forEach(function (cl) { out[cl.index] = cl; });
    return out;
  }

  function _numOrNull(value) {
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  function buildPredictions(input) {
    var results = input.results || [];
    var checks = _checkMap(input.checkpoints);
    var clauses = _clauseMap(input.clauses);
    var items = [];
    results.forEach(function (r) {
      var cp = checks[r.cpId] || {};
      var candidates = (r.ranked || []).slice(0, 3).map(function (hit) {
        var cl = clauses[hit.clauseIndex] || {};
        return {
          clause_index: hit.clauseIndex,
          heading: String(cl.heading || ""),
          rule_score: Math.round(Number(hit.score || 0) * 100) / 100
        };
      });
      var llm = r.localLlm || null;
      var hybrid = null;
      if (llm && llm.relation === "direct") hybrid = _numOrNull(llm.selected_clause_index);
      items.push({
        check_id: r.cpId,
        check: String(cp.check || cp.label || ""),
        coverage: String(r.coverage || ""),
        rule_clause_index: r.best ? _numOrNull(r.best.clauseIndex) : null,
        candidates: candidates,
        llm_reviewed: !!llm,
        llm_selected_clause_index: llm ? _numOrNull(llm.selected_clause_index) : null,
        llm_relation: llm ? String(llm.relation || "") : "",
        llm_completeness: llm ? String(llm.completeness || "") : "",
        hybrid_clause_index: hybrid
      });
    });
    return {
      format: PREDICTION_FORMAT,
      meta: {
        document_id: String(input.documentId || input.contractHash || ""),
        contract_hash: String(input.contractHash || ""),
        type_id: input.typeId || null,
        generated: String(input.generated || ""),
        app_version: String(input.appVersion || ""),
        model: String(input.model || "qwen3:4b")
      },
      items: items
    };
  }

  function buildGoldTemplate(input) {
    var checks = _checkMap(input.checkpoints);
    return {
      format: GOLD_FORMAT,
      meta: {
        document_id: String(input.documentId || input.contractHash || ""),
        contract_hash: String(input.contractHash || ""),
        type_id: input.typeId || null,
        created: String(input.created || ""),
        blinded: true
      },
      clauses: (input.clauses || []).map(function (cl) {
        return { clause_index: cl.index, heading: String(cl.heading || ""), body: String(cl.body || "") };
      }),
      labels: (input.results || []).map(function (r) {
        var cp = checks[r.cpId] || {};
        return {
          check_id: r.cpId,
          check: String(cp.check || cp.label || ""),
          applicable: null,
          direct_clause_indices: [],
          reference_clause_indices: [],
          completeness: "",
          confidence: "",
          note: ""
        };
      })
    };
  }

  function _indexLabels(gold) {
    var out = {};
    ((gold && gold.labels) || []).forEach(function (label) { out[label.check_id] = label; });
    return out;
  }

  function _correct(predicted, label) {
    var direct = (label && label.direct_clause_indices) || [];
    if (!direct.length) return predicted === null;
    return direct.indexOf(predicted) !== -1;
  }

  function scoreDocument(predictions, gold) {
    var labels = _indexLabels(gold);
    var documentId = String((predictions.meta && predictions.meta.document_id) ||
      (gold.meta && gold.meta.document_id) || "");
    var rows = [];
    (predictions.items || []).forEach(function (item) {
      var label = labels[item.check_id];
      if (!label || label.applicable === null || label.applicable === undefined || !item.llm_reviewed) return;
      var baselineCorrect = _correct(item.rule_clause_index, label);
      var hybridCorrect = _correct(item.hybrid_clause_index, label);
      var refs = label.reference_clause_indices || [];
      var direct = label.direct_clause_indices || [];
      var top3 = (item.candidates || []).map(function (c) { return c.clause_index; });
      rows.push({
        document_id: documentId,
        check_id: item.check_id,
        baseline_correct: baselineCorrect,
        hybrid_correct: hybridCorrect,
        improved: !baselineCorrect && hybridCorrect,
        harmed: baselineCorrect && !hybridCorrect,
        gold_in_rule_top3: !direct.length || direct.some(function (index) { return top3.indexOf(index) !== -1; }),
        baseline_reference_false_positive: item.rule_clause_index !== null &&
          !(label.direct_clause_indices || []).length && refs.indexOf(item.rule_clause_index) !== -1,
        hybrid_reference_false_positive: item.hybrid_clause_index !== null &&
          !(label.direct_clause_indices || []).length && refs.indexOf(item.hybrid_clause_index) !== -1
      });
    });
    return rows;
  }

  function summarize(rows) {
    var n = rows.length;
    function count(key) { return rows.filter(function (r) { return !!r[key]; }).length; }
    var baseline = count("baseline_correct");
    var hybrid = count("hybrid_correct");
    var improved = count("improved");
    var harmed = count("harmed");
    return {
      n: n,
      baseline_correct: baseline,
      hybrid_correct: hybrid,
      baseline_accuracy: n ? baseline / n : 0,
      hybrid_accuracy: n ? hybrid / n : 0,
      delta_accuracy: n ? (hybrid - baseline) / n : 0,
      improved: improved,
      harmed: harmed,
      net_improved: improved - harmed,
      rule_recall_at_3: n ? count("gold_in_rule_top3") / n : 0,
      baseline_reference_false_positive: count("baseline_reference_false_positive"),
      hybrid_reference_false_positive: count("hybrid_reference_false_positive")
    };
  }

  return {
    PREDICTION_FORMAT: PREDICTION_FORMAT,
    GOLD_FORMAT: GOLD_FORMAT,
    buildPredictions: buildPredictions,
    buildGoldTemplate: buildGoldTemplate,
    scoreDocument: scoreDocument,
    summarize: summarize
  };
})();

if (typeof module !== "undefined") module.exports = Experiment;
