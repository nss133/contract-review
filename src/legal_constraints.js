"use strict";
/* 법령 기반 개연성 제약기.
   드문·위법 가능 조합을 계약유형의 양성 신호로 쓰지 않고 별도 준법경보로 분리한다. */
var LegalConstraints = (function () {
  function _normalize(value) {
    var out = String(value || "");
    return out.normalize ? out.normalize("NFC") : out;
  }

  function _hits(text, words) {
    var source = _normalize(text), out = [];
    (words || []).forEach(function (word) {
      var from = 0, index;
      while ((index = source.indexOf(word, from)) !== -1) {
        var left = Math.max(source.lastIndexOf(".", index), source.lastIndexOf("\n", index)) + 1;
        var dot = source.indexOf(".", index), nl = source.indexOf("\n", index);
        var right = Math.min(dot === -1 ? source.length : dot, nl === -1 ? source.length : nl);
        var sentence = source.slice(left, right);
        var negated = /(제공|지급|수행|포함|진행|취급|권유|모집).{0,24}(하지\s*(않|아니)|않는다|아니다|없다)|무관/.test(sentence);
        if (!negated) { out.push(word); break; }
        from = index + String(word).length;
      }
    });
    return out;
  }

  function _groupEvidence(rule, context) {
    var body = _normalize(context.text), title = _normalize(context.docTitle);
    var file = _normalize(context.fileName).replace(/\.[A-Za-z0-9]+$/, "");
    var evidence = {}, sources = [];
    Object.keys(rule.signals || {}).forEach(function (group) {
      var words = rule.signals[group] || [], hits = [];
      [["본문", body], ["제목", title], ["파일명", file]].forEach(function (pair) {
        _hits(pair[1], words).forEach(function (word) {
          var item = pair[0] + ": " + word;
          if (hits.indexOf(item) === -1) hits.push(item);
          if (sources.indexOf(pair[0]) === -1) sources.push(pair[0]);
        });
      });
      evidence[group] = hits;
    });
    return { groups: evidence, sources: sources };
  }

  function assess(text, registry, context) {
    var cfg = registry || {}, ctx = context || {};
    ctx = { text: text, docTitle: ctx.docTitle || "", fileName: ctx.fileName || "" };
    var matched = (cfg.rules || []).map(function (rule) {
      var evidence = _groupEvidence(rule, ctx);
      var ok = (rule.requires || []).every(function (group) {
        return evidence.groups[group] && evidence.groups[group].length;
      });
      if (!ok) return null;
      return {
        id: rule.id, label: rule.label, severity: rule.severity || "확인",
        route: rule.route || "legal_review", affects_type: rule.affects_type === true,
        summary: rule.summary || "", reason: rule.reason || "",
        evidence: evidence.groups, input_sources: evidence.sources,
        scope_effects: rule.scope_effects || {}, sources: rule.sources || [],
        supersedes: rule.supersedes || []
      };
    }).filter(Boolean);
    var suppressed = {};
    matched.forEach(function (alert) {
      alert.supersedes.forEach(function (id) { suppressed[id] = true; });
    });
    return matched.filter(function (alert) { return !suppressed[alert.id]; });
  }

  function scopeEffects(alerts) {
    var out = {};
    (alerts || []).forEach(function (alert) {
      Object.keys(alert.scope_effects || {}).forEach(function (scopeId) {
        out[scopeId] = alert.scope_effects[scopeId];
      });
    });
    return out;
  }

  return { assess: assess, scopeEffects: scopeEffects };
})();

if (typeof module !== "undefined") module.exports = LegalConstraints;
