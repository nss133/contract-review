"use strict";
/* 검토의견 지식 루프(#4) 순수 로직 — 폐쇄망 내부 루프.
   검토의견(verdict) 내보내기 JSON을 cpId 단위 코퍼스에 누적 집계하여
   코멘트 추천·판정 분포·큐레이션 신호를 산출한다. LLM·외부요청 0.
   브라우저 전역 Loop + node require 겸용. */
var Loop = (function () {
  // 11.3차: 판정 체계가 2종으로 재구성됨(해당없음 → 이상없음의 사유로 격하).
  // 코퍼스는 과거 회신분에 '해당없음'이 남아 있을 수 있어 집계 키는 유지하되,
  // 신규 집계는 reason('해당사항 없음')을 같은 칸에 합산한다.
  var VERDICTS = ["이상없음", "검토의견", "해당없음"];
  var NA_REASON = "해당사항 없음";
  var ORIGINS = ["manual", "bulk", "subdoc", "prior_review", "legacy"];

  function emptyCorpus() {
    return { meta: { updated: "", contract_count: 0, hashes: [] }, byCheck: {} };
  }

  function _ensureCheck(corpus, cpId) {
    if (!corpus.byCheck[cpId]) {
      corpus.byCheck[cpId] = { counts: { "이상없음": 0, "검토의견": 0, "해당없음": 0 }, comments: [], lastSeen: "" };
    }
    var slot = corpus.byCheck[cpId];
    if (!slot.origin_counts) slot.origin_counts = {};
    if (!slot.system_verdict_pairs) slot.system_verdict_pairs = {};
    if (!slot.llm_verdict_pairs) slot.llm_verdict_pairs = {};
    if (!slot.matching_counts) slot.matching_counts = { observed: 0, confirmed: 0, reassigned: 0,
      top1_correct: 0, top1_wrong: 0, gold_in_top3: 0 };
    return slot;
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
    var systemItems = (exportObj.system_assessments && exportObj.system_assessments.items) || {};
    var matchingItems = (exportObj.matching_observations && exportObj.matching_observations.items) || {};
    Object.keys(verdicts).forEach(function (cpId) {
      var v = verdicts[cpId];
      if (!v) return;
      // 이상없음 + 사유 '해당사항 없음' = 구 '해당없음'과 동일 신호로 집계(연속성 유지).
      var vv = (v.verdict === "이상없음" && v.reason === NA_REASON) ? "해당없음" : v.verdict;
      if (VERDICTS.indexOf(vv) === -1) return;
      var slot = _ensureCheck(next, cpId);
      slot.counts[vv]++;
      var origin = ORIGINS.indexOf(v.origin) !== -1 ? v.origin : "legacy";
      slot.origin_counts[origin] = (slot.origin_counts[origin] || 0) + 1;
      var assessment = systemItems[cpId] && systemItems[cpId].system_assessment;
      if (assessment) {
        var pair = assessment + "::" + vv;
        slot.system_verdict_pairs[pair] = (slot.system_verdict_pairs[pair] || 0) + 1;
      }
      var advisory = systemItems[cpId] && systemItems[cpId].advisory;
      if (advisory && advisory.kind === "local_llm") {
        var llmPair = advisory.relation + "/" + advisory.completeness + "::" + vv;
        slot.llm_verdict_pairs[llmPair] = (slot.llm_verdict_pairs[llmPair] || 0) + 1;
      }
      var observation = matchingItems[cpId];
      if (observation && observation.human_evidence_source && observation.human_evidence_source !== "none" &&
          typeof observation.human_clause_index === "number") {
        var mc = slot.matching_counts;
        mc.observed++;
        if (observation.human_evidence_source === "reassigned") mc.reassigned++;
        else mc.confirmed++;
        if (observation.rule_clause_index === observation.human_clause_index) mc.top1_correct++;
        else mc.top1_wrong++;
        var candidates = observation.candidate_clauses || [];
        if (candidates.some(function (c) { return c.clause_index === observation.human_clause_index; })) mc.gold_in_top3++;
      }
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

  // 자동화 승격 검토용 원자료. 시스템 평가는 법적 판정이 아니므로 일치율로 단순 환산하지 않고
  // 시스템평가×사람판정 조합과 판정 출처를 그대로 돌려준다.
  function automationStats(corpus, cpId) {
    var slot = corpus && corpus.byCheck && corpus.byCheck[cpId];
    if (!slot) return null;
    return {
      pairs: JSON.parse(JSON.stringify(slot.system_verdict_pairs || {})),
      llmPairs: JSON.parse(JSON.stringify(slot.llm_verdict_pairs || {})),
      origins: JSON.parse(JSON.stringify(slot.origin_counts || {}))
    };
  }

  // 누적 사람 판정으로 현재 항목의 검토 강도를 정한다. 자동 법적 판정은 하지 않는다.
  // 우선순위: 과거 이슈 > 반복 비적용 > 안정된 직접근거 > 일반 검토.
  function reviewRoute(corpus, cpId, systemAssessment, opts) {
    opts = opts || {};
    var minQuick = opts.minQuick || 5;
    var minApplicability = opts.minApplicability || 4;
    var applicabilityRatio = opts.applicabilityRatio || 0.4;
    var st = checkStats(corpus, cpId);
    if (!st) return { route: "standard", n: 0, reason: "누적 표본 없음" };
    var issue = st.dist["검토의견"] || 0;
    var na = st.dist["해당없음"] || 0;
    var ok = st.dist["이상없음"] || 0;
    if (issue > 0) return { route: "detailed", n: st.n,
      reason: "과거 검토의견 " + issue + "건", issue: issue, ok: ok, na: na };
    if (st.n >= minApplicability && na / st.n >= applicabilityRatio) {
      return { route: "applicability", n: st.n,
        reason: "과거 해당없음 " + na + "/" + st.n + "건", issue: issue, ok: ok, na: na };
    }
    var slot = corpus && corpus.byCheck && corpus.byCheck[cpId];
    var confirmedOk = slot && slot.system_verdict_pairs &&
      (slot.system_verdict_pairs["evidence_found::이상없음"] || 0);
    if (systemAssessment === "evidence_found" && st.n >= minQuick && issue === 0 && na === 0 &&
        ok === st.n && confirmedOk >= minQuick) {
      return { route: "quick", n: st.n,
        reason: "직접근거·이상없음 " + confirmedOk + "건 반복", issue: issue, ok: ok, na: na };
    }
    return { route: "standard", n: st.n, reason: "일반 확인", issue: issue, ok: ok, na: na };
  }

  function matchingStats(corpus) {
    var total = { observed: 0, confirmed: 0, reassigned: 0, top1_correct: 0, top1_wrong: 0, gold_in_top3: 0 };
    var byCheck = (corpus && corpus.byCheck) || {};
    Object.keys(byCheck).forEach(function (cpId) {
      var mc = byCheck[cpId].matching_counts || {};
      Object.keys(total).forEach(function (k) { total[k] += mc[k] || 0; });
    });
    total.top1_accuracy = total.observed ? total.top1_correct / total.observed : null;
    total.top3_recall = total.observed ? total.gold_in_top3 / total.observed : null;
    total.reassignment_rate = total.observed ? total.reassigned / total.observed : null;
    return total;
  }

  function corpusSummary(corpus) {
    var out = { contracts: (corpus && corpus.meta && corpus.meta.contract_count) || 0,
      verdicts: 0, issues: 0, no_issue: 0, not_applicable: 0,
      route_checks: { detailed: 0, applicability: 0, quick: 0, standard: 0 }, matching: matchingStats(corpus) };
    var byCheck = (corpus && corpus.byCheck) || {};
    Object.keys(byCheck).forEach(function (cpId) {
      var counts = byCheck[cpId].counts || {};
      out.no_issue += counts["이상없음"] || 0;
      out.issues += counts["검토의견"] || 0;
      out.not_applicable += counts["해당없음"] || 0;
      var route = reviewRoute(corpus, cpId, "evidence_found").route;
      out.route_checks[route]++;
    });
    out.verdicts = out.no_issue + out.issues + out.not_applicable;
    out.issue_rate = out.verdicts ? out.issues / out.verdicts : 0;
    return out;
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

  // 코퍼스 백업({meta:{hashes…}, byCheck}) 병합 — export JSON이 아닌 이미 집계된 코퍼스.
  // 집계라 계약 단위 분해가 불가하므로 멱등 규칙: 백업 해시가 하나라도 기적재면 전체 스킵.
  function mergeCorpusBackup(corpus, backup) {
    var next = JSON.parse(JSON.stringify(corpus || emptyCorpus()));
    if (!backup || !backup.byCheck || !backup.meta) return next;
    var hashes = backup.meta.hashes || [];
    for (var i = 0; i < hashes.length; i++)
      if (next.meta.hashes.indexOf(hashes[i]) !== -1) return next;
    next.meta.hashes = next.meta.hashes.concat(hashes);
    next.meta.contract_count += backup.meta.contract_count || hashes.length;
    Object.keys(backup.byCheck).forEach(function (cpId) {
      var src = backup.byCheck[cpId];
      var slot = _ensureCheck(next, cpId);
      VERDICTS.forEach(function (v) { slot.counts[v] += (src.counts && src.counts[v]) || 0; });
      Object.keys(src.origin_counts || {}).forEach(function (k) {
        slot.origin_counts[k] = (slot.origin_counts[k] || 0) + src.origin_counts[k];
      });
      Object.keys(src.system_verdict_pairs || {}).forEach(function (k) {
        slot.system_verdict_pairs[k] = (slot.system_verdict_pairs[k] || 0) + src.system_verdict_pairs[k];
      });
      Object.keys(src.llm_verdict_pairs || {}).forEach(function (k) {
        slot.llm_verdict_pairs[k] = (slot.llm_verdict_pairs[k] || 0) + src.llm_verdict_pairs[k];
      });
      Object.keys(src.matching_counts || {}).forEach(function (k) {
        slot.matching_counts[k] = (slot.matching_counts[k] || 0) + src.matching_counts[k];
      });
      (src.comments || []).forEach(function (cm) {
        var found = null;
        for (var j = 0; j < slot.comments.length; j++)
          if (slot.comments[j].text === cm.text) { found = slot.comments[j]; break; }
        if (found) {
          found.count += cm.count || 1;
          (cm.reviewers || []).forEach(function (r) {
            if (r && found.reviewers.indexOf(r) === -1) found.reviewers.push(r);
          });
        } else slot.comments.push(JSON.parse(JSON.stringify(cm)));
      });
      if (src.lastSeen && src.lastSeen > (slot.lastSeen || "")) slot.lastSeen = src.lastSeen;
    });
    if (backup.meta.updated && backup.meta.updated > (next.meta.updated || ""))
      next.meta.updated = backup.meta.updated;
    return next;
  }

  return {
    VERDICTS: VERDICTS,
    emptyCorpus: emptyCorpus,
    mergeIntoCorpus: mergeIntoCorpus,
    checkStats: checkStats,
    automationStats: automationStats,
    reviewRoute: reviewRoute,
    matchingStats: matchingStats,
    corpusSummary: corpusSummary,
    topComments: topComments,
    curationSignals: curationSignals,
    mergeCorpusBackup: mergeCorpusBackup
  };
})();

if (typeof module !== "undefined") module.exports = Loop;
