"use strict";
var _SafetyEvalPolicy = typeof AutoSafety !== "undefined" ? AutoSafety :
  (typeof require !== "undefined" ? require("./auto_safety") : null);
/* 폐쇄망 내부용 평가 계약. 시스템/과거 판정을 정답으로 복사하지 않는다.
   평가파일은 반출 허용자료가 아니며 승인정책을 생성하지 않는다. */
var SafetyEval = (function () {
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function build(input) {
    var results = Object.create(null);
    (input.results || []).forEach(function (r) { results[r.cpId] = r; });
    var signals = _SafetyEvalPolicy.scan(input.documents || []);
    return { format: "cr-safety-observation-v1", run_id: input.runId,
      policy_version: _SafetyEvalPolicy.VERSION, app_version: input.appVersion,
      contract_hash: input.contractHash, family_id: input.familyId,
      context: copy(input.context || {}), documents: copy(input.documents || [{ name: "본문", text: input.text || "" }]),
      clauses: copy(input.clauses || []),
      items: (input.checkpoints || []).map(function (cp) {
        var r = results[cp.id] || {};
        var d = _SafetyEvalPolicy.evaluate(cp, r, { signals: signals });
        return { check_id: cp.id, check: cp.decision_question || cp.check || cp.label || cp.id,
          guidance: { pass: cp.pass_guidance || "", opinion: cp.opinion_guidance || "", sources: copy(cp.sources || []) },
          coverage: r.coverage || "not_selected", surfaced: !!(r.autoSafety && r.autoSafety.requires_review) || ["addressed", "verify", "consider", "base_covered"].indexOf(r.coverage) !== -1,
          candidate: d.candidate || !!(input.subdocIds || {})[cp.id], allowed: d.allowed,
          route: (input.subdocIds || {})[cp.id] ? "subdoc" : "general",
          rule_candidate: d.candidate,
          top1: r.best ? r.best.clauseIndex : null,
          top3: (r.ranked || []).slice(0, 3).map(function (x) { return x.clauseIndex; }),
          reasons: d.reasons, evidence_sentence: d.sentence };
      }) };
  }
  function goldTemplate(p) {
    return { format: "cr-safety-gold-v1", run_id: p.run_id, contract_hash: p.contract_hash,
      family_id: p.family_id, policy_version: p.policy_version, app_version: p.app_version,
      reviewer: "", source_reviewed: false, independent: false,
      instructions: "폐쇄망 내부 전용. 예측파일을 보지 않고 원본·별첨과 질문을 대조. truth: safe/issue/unknown/not_applicable. 미검수는 빈값 유지. note·evidence 필수. 자동/과거 판정 복사 금지.",
      documents: copy(p.documents), clauses: copy(p.clauses),
      labels: p.items.map(function (item) { return { check_id: item.check_id, check: item.check, guidance: copy(item.guidance),
        truth: "", direct_clause_indices: [], note: "", evidence: "" }; }) };
  }
  function required(ok, message) { if (!ok) throw new Error(message); }
  function nonempty(s) { return typeof s === "string" && s.trim().length > 0; }
  function bucket() { return { candidates: 0, reviewed: 0, false_clear: 0, unknown: 0, unreviewed: 0 }; }
  function score(p, g) {
    required(p && p.format === "cr-safety-observation-v1" && g && g.format === "cr-safety-gold-v1", "평가 파일 형식 확인 필요");
    ["run_id", "contract_hash", "family_id", "policy_version", "app_version"].forEach(function (key) {
      required(nonempty(p[key]) && p[key] === g[key], "동일 스냅샷/계약 계열 확인 필요: " + key);
    });
    required(nonempty(g.reviewer) && g.source_reviewed === true && g.independent === true,
      "검수자·원본 대조·예측과 독립된 검수 확인 필요");
    required(Array.isArray(p.items) && p.items.length > 0 && Array.isArray(g.labels), "체크 목록 확인 필요");
    var ids = Object.create(null), labels = Object.create(null), clauseIds = Object.create(null);
    (p.clauses || []).forEach(function (c) { clauseIds[c.index] = true; });
    p.items.forEach(function (i) {
      required(nonempty(i.check_id) && !ids[i.check_id], "중복/빈 체크 ID"); ids[i.check_id] = true;
      required(typeof i.candidate === "boolean" && typeof i.allowed === "boolean" && typeof i.surfaced === "boolean", "예측값 형식 확인 필요");
    });
    g.labels.forEach(function (l) {
      required(ids[l.check_id] && !labels[l.check_id], "중복/알 수 없는 정답 체크 ID");
      required(["", "safe", "issue", "unknown", "not_applicable"].indexOf(l.truth) !== -1, "정답값 확인 필요");
      required(Array.isArray(l.direct_clause_indices) && l.direct_clause_indices.every(function (i) {
        return typeof i === "number" && clauseIds[i];
      }), "정답 조항 위치 확인 필요");
      if (l.truth) required(nonempty(l.note) && nonempty(l.evidence), "확정 라벨의 사유·원본 위치 필요");
      labels[l.check_id] = l;
    });
    var m = { total: p.items.length, reviewed: 0, issue_count: 0, unsurfaced_issues: 0,
      shadow: bucket(), actual: bucket(), mapping: { denominator: 0, top1_correct: 0, top3_found: 0 },
      safety_proven: false, unit: "단일 계약·체크 관측 (독립 계약 표본 아님)", family_id: p.family_id };
    p.items.forEach(function (i) {
      var l = labels[i.check_id], truth = l && l.truth;
      if (truth) m.reviewed++;
      if (truth === "issue") { m.issue_count++; if (!i.surfaced) m.unsurfaced_issues++; }
      [[m.shadow, i.candidate], [m.actual, i.allowed]].forEach(function (pair) {
        var b = pair[0]; if (!pair[1]) return;
        b.candidates++;
        if (!truth) b.unreviewed++;
        else { b.reviewed++; if (truth === "issue") b.false_clear++; if (truth === "unknown") b.unknown++; }
      });
      if (truth && truth !== "unknown" && l.direct_clause_indices.length) {
        m.mapping.denominator++;
        if (l.direct_clause_indices.indexOf(i.top1) !== -1) m.mapping.top1_correct++;
        if ((i.top3 || []).some(function (n) { return l.direct_clause_indices.indexOf(n) !== -1; })) m.mapping.top3_found++;
      }
    });
    [m.shadow, m.actual].forEach(function (b) {
      b.false_clear_rate = b.candidates ? b.false_clear / b.candidates : null;
      b.review_rate = b.candidates ? b.reviewed / b.candidates : null;
      b.automation_rate = m.total ? b.candidates / m.total : null;
      // IID 가정의 참고값. 계약 내 체크들은 독립 표본이 아니므로 안전 승인에 쓰지 않는다.
      b.zero_error_upper95_iid = b.candidates && !b.false_clear && !b.unknown && !b.unreviewed
        ? 1 - Math.pow(0.05, 1 / b.candidates) : null;
    });
    return m;
  }
  return { build: build, goldTemplate: goldTemplate, score: score };
})();
if (typeof module !== "undefined") module.exports = SafetyEval;
