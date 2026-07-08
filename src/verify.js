"use strict";
/* 검수 화면 순수 로직. 브라우저 전역 Verify + node require 겸용. */
var Verify = (function () {
  function sourceKey(checkId, index) { return checkId + "#" + index; }

  function buildVerifyItems(CR) {
    var docs = [{ meta: CR.common.meta, checks: CR.common.checks }];
    (CR.types || []).forEach(function (t) { docs.push({ meta: t.meta, checks: t.checks }); });
    var items = [];
    docs.forEach(function (d) {
      var tn = (d.meta && d.meta.type_name) || (d.meta && d.meta.type_id) || "";
      var tid = (d.meta && d.meta.type_id) || "";
      (d.checks || []).forEach(function (cp) {
        var srcs = (cp.sources || []).map(function (s, i) {
          return { index: i, law: s.law, article: s.article, clause: s.clause || "",
                   quote: s.quote || "", text: s.text || "", verified: !!s.verified };
        });
        items.push({ checkId: cp.id, typeId: tid, typeName: tn, check: cp.check,
          severity: cp.severity, severityBasis: cp.severity_basis || "", note: cp.note || "",
          isPractice: srcs.length === 0, sources: srcs });
      });
    });
    return items;
  }

  function srcState(item, s, decisions) {
    if (s.verified) return "확인";
    var d = decisions[sourceKey(item.checkId, s.index)];
    return (d && d.decision) || "미검수";
  }

  function verifyProgress(items, decisions) {
    var total = 0, confirmed = 0, needsfix = 0, pending = 0;
    items.forEach(function (it) {
      it.sources.forEach(function (s) {
        total++;
        var st = srcState(it, s, decisions);
        if (st === "확인") confirmed++;
        else if (st === "수정필요") needsfix++;
        else pending++;
      });
    });
    return { total: total, confirmed: confirmed, needsfix: needsfix, pending: pending };
  }

  function filterItems(items, decisions, filter) {
    var mode = (filter && filter.mode) || "all";
    var typeId = (filter && filter.typeId) || "";
    return items.filter(function (it) {
      if (typeId && it.typeId !== typeId) return false;
      if (mode === "all") return true;
      if (it.sources.length === 0) return false; // practice는 all에서만
      return it.sources.some(function (s) {
        var st = srcState(it, s, decisions);
        if (mode === "unreviewed") return st === "미검수";
        if (mode === "needsfix") return st === "수정필요";
        if (mode === "confirmed") return st === "확인";
        return true;
      });
    });
  }

  function findHighlight(quote, text) {
    if (!quote || !text) return null;
    var i = text.indexOf(quote);
    if (i === -1) return null;
    return [i, i + quote.length];
  }

  function exportJson(decisions) {
    var out = {};
    Object.keys(decisions || {}).forEach(function (k) {
      var d = decisions[k];
      if (d && (d.decision === "확인" || d.decision === "수정필요")) out[k] = d;
    });
    return JSON.stringify(out, null, 2);
  }

  return { sourceKey: sourceKey, buildVerifyItems: buildVerifyItems, srcState: srcState,
    verifyProgress: verifyProgress, filterItems: filterItems, findHighlight: findHighlight, exportJson: exportJson };
})();

if (typeof module !== "undefined") module.exports = Verify;
