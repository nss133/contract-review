"use strict";
/* 체크리스트에 종속되지 않는 검토 발견사항 순수 로직.
   manual finding과 자동 완결성 finding의 사람 판정을 분리한다. */
var Findings = (function () {
  var SCOPES = ["contract", "clause", "cross_clause", "subdoc"];
  var SEVERITIES = ["중요", "일반", "참고"];
  var CATEGORIES = ["general", "structure", "reference", "consistency", "attachment", "wording", "other"];
  var DECISIONS = ["opinion", "no_issue", "dismissed"];

  function emptyStore() { return { manual: {}, decisions: {} }; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function _anchors(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (a) {
      if (!a || typeof a !== "object") return null;
      var ci = typeof a.clause_index === "number" && a.clause_index >= 0 ? a.clause_index : null;
      return { document: a.document === "subdoc" ? "subdoc" : "main", clause_index: ci,
        heading: String(a.heading || ""), document_name: String(a.document_name || "") };
    }).filter(Boolean).slice(0, 8);
  }
  function normalizeFinding(raw, id) {
    if (!raw || typeof raw !== "object") return null;
    var scope = SCOPES.indexOf(raw.scope) !== -1 ? raw.scope : "contract";
    var severity = SEVERITIES.indexOf(raw.severity) !== -1 ? raw.severity : "일반";
    var category = CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : "general";
    var comment = String(raw.comment || "").trim();
    var title = String(raw.title || "").trim();
    if (!comment && !title) return null;
    return { id: String(id || raw.id || ""), source: "manual", scope: scope, category: category,
      title: title, comment: comment, severity: severity, anchors: _anchors(raw.anchors),
      related_check_id: raw.related_check_id ? String(raw.related_check_id) : null,
      reviewer: String(raw.reviewer || ""), date: String(raw.date || "") };
  }
  function normalizeStore(raw) {
    var out = emptyStore();
    if (!raw || typeof raw !== "object") return out;
    Object.keys(raw.manual || {}).forEach(function (id) {
      var f = normalizeFinding(raw.manual[id], id);
      if (f) out.manual[id] = f;
    });
    Object.keys(raw.decisions || {}).forEach(function (id) {
      var d = raw.decisions[id] || {};
      if (DECISIONS.indexOf(d.decision) === -1) return;
      out.decisions[id] = { decision: d.decision, comment: String(d.comment || ""),
        reviewer: String(d.reviewer || ""), date: String(d.date || "") };
    });
    return out;
  }
  function nextId(store, contractHash) {
    var prefix = "MF-" + String(contractHash || "contract").replace(/[^A-Za-z0-9_-]/g, "") + "-";
    var max = 0;
    Object.keys((store && store.manual) || {}).forEach(function (id) {
      if (id.indexOf(prefix) !== 0) return;
      var n = Number(id.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    });
    return prefix + String(max + 1).padStart(3, "0");
  }
  function upsert(store, raw, contractHash) {
    var next = normalizeStore(store);
    var id = String(raw && raw.id || "") || nextId(next, contractHash);
    var f = normalizeFinding(raw, id);
    if (!f) return { store: next, id: null };
    next.manual[id] = f;
    return { store: next, id: id };
  }
  function remove(store, id) {
    var next = normalizeStore(store);
    delete next.manual[id];
    return next;
  }
  function decide(store, findingId, decision, meta) {
    var next = normalizeStore(store);
    if (DECISIONS.indexOf(decision) === -1 || !findingId) return next;
    next.decisions[findingId] = { decision: decision, comment: String(meta && meta.comment || ""),
      reviewer: String(meta && meta.reviewer || ""), date: String(meta && meta.date || "") };
    return next;
  }
  function manualList(store) {
    var normalized = normalizeStore(store);
    return Object.keys(normalized.manual).map(function (id) { return clone(normalized.manual[id]); })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id); });
  }
  function project(store, integrityItems) {
    var normalized = normalizeStore(store);
    var out = manualList(normalized).map(function (f) {
      f.decision = "opinion";
      f.finding_source = "manual";
      return f;
    });
    (integrityItems || []).forEach(function (item) {
      var f = clone(item);
      var d = normalized.decisions[f.id];
      f.finding_source = "integrity_rule";
      f.decision = d ? d.decision : "pending";
      f.decision_comment = d ? d.comment : "";
      out.push(f);
    });
    return out;
  }
  function summary(store, integrityItems) {
    var projected = project(store, integrityItems);
    var out = { manual: 0, integrity: 0, pending: 0, opinions: 0, no_issue: 0, dismissed: 0 };
    projected.forEach(function (f) {
      if (f.finding_source === "manual") out.manual++; else out.integrity++;
      if (f.decision === "pending") out.pending++;
      else if (f.decision === "opinion") out.opinions++;
      else if (f.decision === "no_issue") out.no_issue++;
      else if (f.decision === "dismissed") out.dismissed++;
    });
    return out;
  }
  return { SCOPES: SCOPES, SEVERITIES: SEVERITIES, CATEGORIES: CATEGORIES,
    emptyStore: emptyStore, normalizeStore: normalizeStore, nextId: nextId, upsert: upsert,
    remove: remove, decide: decide, manualList: manualList, project: project, summary: summary };
})();
if (typeof module !== "undefined") module.exports = Findings;
