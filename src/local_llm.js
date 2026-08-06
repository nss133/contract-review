"use strict";
/* localhost companion을 통한 선택형 로컬 LLM 교차검토.
   규칙 결과를 변경하지 않고 advisory만 부착한다. */
var LocalLLM = (function () {
  var MODEL = "qwen3:4b";
  var MAX_ITEMS = 12;
  var MAX_CANDIDATES = 3;
  var MAX_BODY = 1800;

  function isLocalLocation(loc) {
    if (!loc || (loc.protocol !== "http:" && loc.protocol !== "https:")) return false;
    return ["127.0.0.1", "localhost", "::1"].indexOf(loc.hostname) !== -1;
  }

  function _cpMap(checkpoints) {
    var out = {};
    (checkpoints || []).forEach(function (cp) { out[cp.id] = cp; });
    return out;
  }

  function _buildItems(results, checkpoints, clauses) {
    var cps = _cpMap(checkpoints);
    var byIndex = {};
    (clauses || []).forEach(function (cl) { byIndex[cl.index] = cl; });
    var sevRank = { "필수": 0, "권장": 1, "참고": 2 };
    var covRank = { verify: 0, addressed: 1 };
    var rows = (results || []).filter(function (r) {
      return (r.coverage === "verify" || r.coverage === "addressed") && r.best;
    }).sort(function (a, b) {
      var ca = cps[a.cpId] || {}, cb = cps[b.cpId] || {};
      var cr = (covRank[a.coverage] || 0) - (covRank[b.coverage] || 0);
      if (cr) return cr;
      return (sevRank[ca.severity] === undefined ? 3 : sevRank[ca.severity]) -
        (sevRank[cb.severity] === undefined ? 3 : sevRank[cb.severity]);
    });

    return rows.map(function (r) {
      var cp = cps[r.cpId] || {};
      var candidates = (r.ranked || []).slice(0, MAX_CANDIDATES).map(function (hit) {
        var cl = byIndex[hit.clauseIndex] || {};
        return {
          clause_index: hit.clauseIndex,
          heading: String(cl.heading || ""),
          body: String(cl.body || "").slice(0, MAX_BODY),
          rule_score: Math.round((hit.score || 0) * 100) / 100
        };
      });
      return {
        check_id: r.cpId,
        check: String(cp.check || cp.label || ""),
        severity: String(cp.severity || ""),
        rule_coverage: r.coverage,
        rule_best_clause_index: r.best.clauseIndex,
        candidates: candidates
      };
    }).filter(function (item) { return item.candidates.length; });
  }

  function buildBatch(results, checkpoints, clauses, limit) {
    return _buildItems(results, checkpoints, clauses).slice(0, limit || MAX_ITEMS);
  }

  function buildBatches(results, checkpoints, clauses, batchSize) {
    var size = Math.max(1, Math.min(MAX_ITEMS, Number(batchSize) || 4));
    var items = _buildItems(results, checkpoints, clauses);
    var batches = [];
    for (var i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
    return batches;
  }

  function _validFinding(f, requested) {
    if (!f || typeof f !== "object" || !requested[f.check_id]) return null;
    var relation = ["direct", "reference_only", "unrelated"];
    var completeness = ["complete", "partial", "unclear"];
    if (relation.indexOf(f.relation) === -1 || completeness.indexOf(f.completeness) === -1) return null;
    var item = requested[f.check_id];
    var allowed = item.candidates.map(function (c) { return c.clause_index; });
    var selected = Number(f.selected_clause_index);
    if (allowed.indexOf(selected) === -1) return null;
    return {
      check_id: f.check_id,
      selected_clause_index: selected,
      relation: f.relation,
      completeness: f.completeness,
      reason: String(f.reason || "").slice(0, 500)
    };
  }

  function normalizeResponse(obj, items) {
    var requested = {};
    (items || []).forEach(function (item) { requested[item.check_id] = item; });
    var out = [];
    ((obj && obj.findings) || []).forEach(function (f) {
      var valid = _validFinding(f, requested);
      if (valid) out.push(valid);
    });
    return {
      model: String((obj && obj.model) || MODEL),
      duration_ms: Number((obj && obj.duration_ms) || 0),
      findings: out
    };
  }

  function health(fetchFn, loc) {
    if (!isLocalLocation(loc)) return Promise.resolve({ available: false, reason: "local_server_required" });
    return fetchFn("/api/llm/health", { method: "GET" }).then(function (res) {
      if (!res.ok) throw new Error("health " + res.status);
      return res.json();
    }).catch(function () { return { available: false, reason: "unreachable" }; });
  }

  function review(fetchFn, loc, items) {
    if (!isLocalLocation(loc)) return Promise.reject(new Error("local_server_required"));
    return fetchFn("/api/llm/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, items: items })
    }).then(function (res) {
      if (!res.ok) throw new Error("review " + res.status);
      return res.json();
    }).then(function (obj) { return normalizeResponse(obj, items); });
  }

  function attach(results, response) {
    var byId = {};
    ((response && response.findings) || []).forEach(function (f) { byId[f.check_id] = f; });
    (results || []).forEach(function (r) {
      if (byId[r.cpId]) {
        r.localLlm = {
          model: response.model,
          duration_ms: response.duration_ms,
          selected_clause_index: byId[r.cpId].selected_clause_index,
          relation: byId[r.cpId].relation,
          completeness: byId[r.cpId].completeness,
          reason: byId[r.cpId].reason
        };
      }
    });
    return results;
  }

  return {
    MODEL: MODEL, MAX_ITEMS: MAX_ITEMS, isLocalLocation: isLocalLocation,
    buildBatch: buildBatch, buildBatches: buildBatches, normalizeResponse: normalizeResponse,
    health: health, review: review, attach: attach
  };
})();

if (typeof module !== "undefined") module.exports = LocalLLM;
