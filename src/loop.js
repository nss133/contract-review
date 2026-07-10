"use strict";
/* 검토의견 지식 루프(#4) 순수 로직 — 폐쇄망 내부 루프.
   검토의견(verdict) 내보내기 JSON을 cpId 단위 코퍼스에 누적 집계하여
   코멘트 추천·판정 분포·큐레이션 신호를 산출한다. LLM·외부요청 0.
   브라우저 전역 Loop + node require 겸용. */
var Loop = (function () {
  var VERDICTS = ["이상없음", "검토의견", "해당없음"];

  function emptyCorpus() {
    return { meta: { updated: "", contract_count: 0, hashes: [] }, byCheck: {} };
  }

  function _ensureCheck(corpus, cpId) {
    if (!corpus.byCheck[cpId]) {
      corpus.byCheck[cpId] = { counts: { "이상없음": 0, "검토의견": 0, "해당없음": 0 }, comments: [], lastSeen: "" };
    }
    return corpus.byCheck[cpId];
  }

  // 검토의견 내보내기 객체({meta,verdicts})를 코퍼스에 병합(불변 반환).
  // 같은 contract_hash 재적재는 중복 카운트하지 않음(멱등).
  function mergeIntoCorpus(corpus, exportObj) {
    var next = JSON.parse(JSON.stringify(corpus || emptyCorpus()));
    if (!exportObj || typeof exportObj !== "object") return next;
    var meta = exportObj.meta || {};
    var hash = meta.contract_hash || "";
    var reviewer = meta.reviewer || "";
    var date = meta.date || "";
    if (hash && next.meta.hashes.indexOf(hash) !== -1) return next; // 이미 적재된 계약서
    if (hash) { next.meta.hashes.push(hash); next.meta.contract_count++; }

    var verdicts = exportObj.verdicts || {};
    Object.keys(verdicts).forEach(function (cpId) {
      var v = verdicts[cpId];
      if (!v || VERDICTS.indexOf(v.verdict) === -1) return;
      var slot = _ensureCheck(next, cpId);
      slot.counts[v.verdict]++;
      slot.lastSeen = date || slot.lastSeen;
      var text = (v.comment || "").trim();
      if (text) {
        var found = null;
        for (var i = 0; i < slot.comments.length; i++) {
          if (slot.comments[i].text === text) { found = slot.comments[i]; break; }
        }
        if (found) {
          found.count++;
          if (found.reviewers.indexOf(reviewer) === -1 && reviewer) found.reviewers.push(reviewer);
        } else {
          slot.comments.push({ text: text, verdict: v.verdict, count: 1,
            reviewers: reviewer ? [reviewer] : [], date: date });
        }
      }
    });
    next.meta.updated = date || next.meta.updated;
    return next;
  }

  // cpId의 판정 분포 통계. 없으면 null.
  function checkStats(corpus, cpId) {
    var slot = corpus && corpus.byCheck && corpus.byCheck[cpId];
    if (!slot) return null;
    var dist = slot.counts;
    var n = dist["이상없음"] + dist["검토의견"] + dist["해당없음"];
    if (n === 0) return null;
    var pct = {}, dominant = null, dmax = -1;
    VERDICTS.forEach(function (v) {
      pct[v] = Math.round((dist[v] / n) * 100);
      if (dist[v] > dmax) { dmax = dist[v]; dominant = v; }
    });
    return { n: n, dist: dist, pct: pct, dominant: dominant, lowSample: n < 5 };
  }

  // cpId의 추천 코멘트(count 내림차순 상위 limit).
  function topComments(corpus, cpId, limit) {
    var slot = corpus && corpus.byCheck && corpus.byCheck[cpId];
    if (!slot || !slot.comments.length) return [];
    return slot.comments.slice().sort(function (a, b) { return b.count - a.count; }).slice(0, limit || 3);
  }

  // 큐레이션 신호: 반복 이상없음(gold) / 반복 해당없음(conditional).
  // opts: {minN, ratio}. 자동 반영 아님 — 큐레이터에게 제시할 후보.
  function curationSignals(corpus, opts) {
    opts = opts || {};
    var minN = opts.minN || 5, ratio = opts.ratio || 0.8;
    var gold = [], conditional = [];
    var byCheck = (corpus && corpus.byCheck) || {};
    Object.keys(byCheck).forEach(function (cpId) {
      var st = checkStats(corpus, cpId);
      if (!st || st.n < minN) return;
      if (st.dist["이상없음"] / st.n >= ratio) gold.push({ cpId: cpId, n: st.n, pct: st.pct["이상없음"] });
      if (st.dist["해당없음"] / st.n >= ratio) conditional.push({ cpId: cpId, n: st.n, pct: st.pct["해당없음"] });
    });
    return { gold: gold, conditional: conditional };
  }

  return {
    VERDICTS: VERDICTS,
    emptyCorpus: emptyCorpus,
    mergeIntoCorpus: mergeIntoCorpus,
    checkStats: checkStats,
    topComments: topComments,
    curationSignals: curationSignals
  };
})();

if (typeof module !== "undefined") module.exports = Loop;
