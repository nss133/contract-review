"use strict";
/* 유형 감지·모듈 제안·체크포인트 매칭·누락 탐지. 전부 순수 함수 */

function detectType(text, types) {
  return types
    .map(function (t) {
      var score = (t.meta.detect_keywords || []).reduce(function (s, kw) {
        return s + (text.split(kw).length - 1);
      }, 0);
      return { typeId: t.meta.type_id, score: score };
    })
    .sort(function (a, b) { return b.score - a.score; });
}

function suggestModules(text, modules) {
  return modules
    .filter(function (m) { return !m.always_on; })
    .filter(function (m) {
      return (m.suggest_keywords || []).some(function (kw) { return text.indexOf(kw) !== -1; });
    })
    .map(function (m) { return m.id; });
}

function checkpointHits(clause, cp) {
  var hay = clause.heading + "\n" + clause.body;
  var kws = (cp.triggers && cp.triggers.keywords) || [];
  var pats = (cp.triggers && cp.triggers.patterns) || [];
  var hitKw = kws.filter(function (kw) { return hay.indexOf(kw) !== -1; });
  var hitPat = pats.filter(function (p) { return new RegExp(p).test(hay); });
  if (hitKw.length === 0 && hitPat.length === 0) return null;
  return { keywords: hitKw, patterns: hitPat };
}

function activeCheckpoints(doc, activeModules) {
  return doc.checkpoints.filter(function (cp) {
    return !cp.module || activeModules.indexOf(cp.module) !== -1;
  });
}

function analyze(clauses, docs, activeModules) {
  var cps = [];
  docs.forEach(function (d) { cps = cps.concat(activeCheckpoints(d, activeModules)); });
  var matches = [];
  cps.forEach(function (cp) {
    clauses.forEach(function (clause) {
      var hits = checkpointHits(clause, cp);
      if (hits) matches.push({ cpId: cp.id, clauseIndex: clause.index, hits: hits });
    });
  });
  var matchedIds = {};
  matches.forEach(function (m) { matchedIds[m.cpId] = true; });
  var missing = cps.filter(function (cp) { return cp.absence_check && !matchedIds[cp.id]; });
  return { checkpoints: cps, matches: matches, missing: missing };
}

if (typeof module !== "undefined")
  module.exports = {
    detectType: detectType,
    suggestModules: suggestModules,
    checkpointHits: checkpointHits,
    activeCheckpoints: activeCheckpoints,
    analyze: analyze,
  };
