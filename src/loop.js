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
  var ORIGINS = ["manual", "bulk", "subdoc", "prior_review", "llm_draft", "legacy", "auto"];
  var LEGACY_SUBDOC_COMMENT = "표준 개인(신용)정보 보안관리약정서(2025.01) 체결로 반영 — 별첨 체결·간인 확인";
  var CURRENT_SUBDOC_COMMENT = "표준 개인(신용)정보 보안관리약정서 적용으로 관련 문서화 항목 반영";

  function emptyCorpus() {
    return { meta: { format: "cr-loop-corpus-v2", schema_version: 2, updated: "",
        contract_count: 0, hashes: [] },
      contracts: {}, byCheck: {}, tag_proposal_decisions: {} };
  }

  // v1 코퍼스도 그대로 읽되, 이후 병합 결과는 v2 구조로 정규화한다.
  function _normalizeCorpus(corpus) {
    var next = JSON.parse(JSON.stringify(corpus || emptyCorpus()));
    if (!next.meta) next.meta = {};
    var sourceVersion = Number(next.meta.schema_version || 0);
    if (!Array.isArray(next.meta.hashes)) next.meta.hashes = [];
    if (typeof next.meta.contract_count !== "number") next.meta.contract_count = next.meta.hashes.length;
    // v1은 재지정 후의 best를 원래 Top1로 저장한 결함이 있어 매칭 정확도·태그 음성표본을
    // 신뢰할 수 없다. 법적 판정·코멘트는 보존하되 학습축만 한 번 제외한다.
    if (sourceVersion < 2 && next.byCheck) Object.keys(next.byCheck).forEach(function (cpId) {
      delete next.byCheck[cpId].matching_counts;
      delete next.byCheck[cpId].tag_learning;
    });
    next.meta.format = "cr-loop-corpus-v2";
    next.meta.schema_version = 2;
    if (typeof next.meta.legacy_matching_excluded !== "number")
      next.meta.legacy_matching_excluded = sourceVersion < 2 ? next.meta.contract_count : 0;
    if (!next.contracts || typeof next.contracts !== "object" || Array.isArray(next.contracts)) next.contracts = {};
    if (!next.byCheck || typeof next.byCheck !== "object" || Array.isArray(next.byCheck)) next.byCheck = {};
    // 과거 시스템 자동문구만 새 업무범위 문구로 이관하고, 같은 문구가 이미 있으면
    // 건수·검토자를 합친다. 사람 작성 코멘트와 다른 문구는 보존한다.
    Object.keys(next.byCheck).forEach(function (cpId) {
      var slot = next.byCheck[cpId], merged = [];
      (slot.comments || []).forEach(function (cm) {
        if (cm.text === LEGACY_SUBDOC_COMMENT) cm.text = CURRENT_SUBDOC_COMMENT;
        var found = null;
        for (var i = 0; i < merged.length; i++) if (merged[i].text === cm.text) { found = merged[i]; break; }
        if (!found) { merged.push(cm); return; }
        found.count = (found.count || 0) + (cm.count || 0);
        if (!found.reviewers) found.reviewers = [];
        (cm.reviewers || []).forEach(function (reviewer) {
          if (reviewer && found.reviewers.indexOf(reviewer) === -1) found.reviewers.push(reviewer);
        });
        if (cm.date && cm.date > (found.date || "")) found.date = cm.date;
      });
      slot.comments = merged;
    });
    if (!next.tag_proposal_decisions) next.tag_proposal_decisions = {};
    return next;
  }

  function _tagCounts() { return {}; }
  function _tagLearningSlot() {
    return { profile_version: "", observed: 0, confirmed: 0, reassigned: 0,
      positive_counts: _tagCounts(), negative_counts: _tagCounts() };
  }
  function _bumpTags(target, observed) {
    Object.keys(observed || {}).forEach(function (facet) {
      var values = observed[facet];
      if (!Array.isArray(values)) return;
      if (!target[facet]) target[facet] = {};
      values.forEach(function (tag) {
        if (!tag) return;
        target[facet][tag] = (target[facet][tag] || 0) + 1;
      });
    });
  }
  function _mergeTagCountMaps(target, source) {
    Object.keys(source || {}).forEach(function (facet) {
      if (!target[facet]) target[facet] = {};
      Object.keys(source[facet] || {}).forEach(function (tag) {
        target[facet][tag] = (target[facet][tag] || 0) + (source[facet][tag] || 0);
      });
    });
  }
  function _mergeTagObservation(slot, observation, source) {
    if (!observation || !observation.human_observed) return;
    if (!slot.tag_learning) slot.tag_learning = _tagLearningSlot();
    var tl = slot.tag_learning;
    tl.profile_version = observation.profile_version || tl.profile_version || "";
    tl.observed++;
    if (source === "reassigned") tl.reassigned++;
    else tl.confirmed++;
    _bumpTags(tl.positive_counts, observation.human_observed);
    // 사람이 다른 조항으로 재지정한 경우에만 기존 Top1 태그를 혼동 음성으로 누적한다.
    if (source === "reassigned" && observation.rule_observed)
      _bumpTags(tl.negative_counts, observation.rule_observed);
  }

  function _ensureCheck(corpus, cpId) {
    if (!corpus.byCheck[cpId]) {
      corpus.byCheck[cpId] = { counts: { "이상없음": 0, "검토의견": 0, "해당없음": 0 }, comments: [], lastSeen: "" };
    }
    var slot = corpus.byCheck[cpId];
    if (!corpus.tag_proposal_decisions) corpus.tag_proposal_decisions = {};
    if (!slot.origin_counts) slot.origin_counts = {};
    if (!slot.reason_counts) slot.reason_counts = {};
    if (!slot.action_counts) slot.action_counts = {};
    if (!slot.system_action_pairs) slot.system_action_pairs = {};
    if (!slot.system_verdict_pairs) slot.system_verdict_pairs = {};
    if (!slot.llm_verdict_pairs) slot.llm_verdict_pairs = {};
    if (!slot.matching_counts) slot.matching_counts = { observed: 0, confirmed: 0, reassigned: 0,
      top1_correct: 0, top1_wrong: 0, gold_in_top3: 0, invalid: 0 };
    if (typeof slot.matching_counts.invalid !== "number") slot.matching_counts.invalid = 0;
    if (!slot.llm_assistance_counts) slot.llm_assistance_counts = {
      analyzed: 0, draft_offered: 0, draft_accepted: 0, accepted_unchanged: 0, accepted_edited: 0
    };
    return slot;
  }

  // 검토의견 내보내기 객체({meta,verdicts})를 코퍼스에 병합(불변 반환).
  // 같은 contract_hash 재적재는 중복 카운트하지 않음(멱등).
  function mergeIntoCorpus(corpus, exportObj) {
    var next = _normalizeCorpus(corpus);
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
    var assistanceItems = (exportObj.llm_assistance && exportObj.llm_assistance.items) || {};
    Object.keys(verdicts).forEach(function (cpId) {
      var v = verdicts[cpId];
      if (!v) return;
      // 이상없음 + 사유 '해당사항 없음' = 구 '해당없음'과 동일 신호로 집계(연속성 유지).
      var vv = (v.verdict === "이상없음" && v.reason === NA_REASON) ? "해당없음" : v.verdict;
      if (VERDICTS.indexOf(vv) === -1) return;
      var slot = _ensureCheck(next, cpId);
      slot.counts[vv]++;
      var reason = v.reason || (v.verdict === "해당없음" ? NA_REASON : "");
      if (reason) slot.reason_counts[reason] = (slot.reason_counts[reason] || 0) + 1;
      var origin = ORIGINS.indexOf(v.origin) !== -1 ? v.origin : "legacy";
      slot.origin_counts[origin] = (slot.origin_counts[origin] || 0) + 1;
      var disposition = v.action_disposition || "";
      if (disposition) {
        slot.action_counts[disposition] = (slot.action_counts[disposition] || 0) + 1;
        var systemAction = systemItems[cpId] && systemItems[cpId].contract_action;
        if (systemAction) {
          var actionPair = systemAction + "::" + disposition;
          slot.system_action_pairs[actionPair] = (slot.system_action_pairs[actionPair] || 0) + 1;
        }
      }
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
    // 조항 확인은 법적 판정과 독립된 축이다. 판정을 아직 남기지 않았더라도 검토자가 명시적으로
    // Top1을 확인·재지정했다면 매칭 원자료로 누적한다.
    Object.keys(matchingItems).forEach(function (cpId) {
      var observation = matchingItems[cpId];
      if (!observation || ["confirmed_match", "reassigned"].indexOf(observation.human_evidence_source) === -1 ||
          typeof observation.human_clause_index !== "number") return;
      var slot = _ensureCheck(next, cpId);
      var mc = slot.matching_counts;
      var source = observation.human_evidence_source;
      // 구버전 결함 방어: 재지정인데 기계 Top1과 사람 정답이 같으면 원래 Top1이 사람 값으로
      // 덮인 손상 표본일 수 있다. 정확도·태그 학습에서 제외하고 진단 카운트만 남긴다.
      var validRule = typeof observation.rule_clause_index === "number";
      var corruptedReassign = source === "reassigned" && validRule &&
        observation.rule_clause_index === observation.human_clause_index;
      if (!validRule || corruptedReassign) mc.invalid++;
      else {
        mc.observed++;
        if (source === "reassigned") mc.reassigned++;
        else mc.confirmed++;
        if (observation.rule_clause_index === observation.human_clause_index) mc.top1_correct++;
        else mc.top1_wrong++;
        var candidates = observation.candidate_clauses || [];
        if (candidates.some(function (c) { return c.clause_index === observation.human_clause_index; })) mc.gold_in_top3++;
        _mergeTagObservation(slot, observation.tag_observation, source);
      }
      slot.lastSeen = date || slot.lastSeen;
    });
    // LLM 보조 노출 자체와 초안 채택은 판정 유무와 별도 집계한다. 관련 원문을 찾은 항목은
    // 최종 판정을 요구하지 않을 수 있으므로 verdicts만 순회하면 사용량이 과소계상된다.
    Object.keys(assistanceItems).forEach(function (cpId) {
      var assistance = assistanceItems[cpId];
      if (!assistance || !assistance.analyzed) return;
      var slot = _ensureCheck(next, cpId);
      var ac = slot.llm_assistance_counts;
      ac.analyzed++;
      if (assistance.draft_offered) ac.draft_offered++;
      if (assistance.draft_accepted) {
        ac.draft_accepted++;
        if (assistance.final_comment_unchanged) ac.accepted_unchanged++;
        else ac.accepted_edited++;
      }
    });
    // 계약 원문·조항 발췌 없이 실행환경과 판정 분포만 보존한다. 체크별 집계만 있던 v1과 달리
    // 앱 버전·유형·적용범위 상태를 계약 단위로 역추적할 수 있어 회귀 원인을 찾을 수 있다.
    if (hash) {
      var contractVerdicts = { "이상없음": 0, "검토의견": 0, "해당없음": 0 };
      var contractReasons = {};
      Object.keys(verdicts).forEach(function (cpId) {
        var v = verdicts[cpId] || {};
        var vv = (v.verdict === "이상없음" && v.reason === NA_REASON) ? "해당없음" : v.verdict;
        if (VERDICTS.indexOf(vv) !== -1) contractVerdicts[vv]++;
        var rs = v.reason || (v.verdict === "해당없음" ? NA_REASON : "");
        if (rs) contractReasons[rs] = (contractReasons[rs] || 0) + 1;
      });
      var scopeStatuses = {};
      var scopes = (exportObj.system_assessments && exportObj.system_assessments.scope_assessments) || {};
      Object.keys(scopes).forEach(function (scopeId) {
        var s = scopes[scopeId] || {};
        scopeStatuses[scopeId] = { status: String(s.status || ""), confidence: String(s.confidence || "") };
      });
      var manualFindingCounts = { total: 0, by_category: {}, by_scope: {}, by_severity: {} };
      Object.keys(exportObj.manual_findings || {}).forEach(function (id) {
        var f = exportObj.manual_findings[id] || {};
        manualFindingCounts.total++;
        var cat = String(f.category || "general"), scope = String(f.scope || "contract"), sev = String(f.severity || "일반");
        manualFindingCounts.by_category[cat] = (manualFindingCounts.by_category[cat] || 0) + 1;
        manualFindingCounts.by_scope[scope] = (manualFindingCounts.by_scope[scope] || 0) + 1;
        manualFindingCounts.by_severity[sev] = (manualFindingCounts.by_severity[sev] || 0) + 1;
      });
      var integrityDecisionCounts = {};
      Object.keys(exportObj.finding_decisions || {}).forEach(function (id) {
        var d = exportObj.finding_decisions[id] || {};
        var rule = String(id).split("-").slice(1, 3).join("-") || "unknown";
        if (!integrityDecisionCounts[rule]) integrityDecisionCounts[rule] = {};
        var decision = String(d.decision || "pending");
        integrityDecisionCounts[rule][decision] = (integrityDecisionCounts[rule][decision] || 0) + 1;
      });
      var requirementCounts = {};
      var requirementItems = (exportObj.contract_requirement_outcomes && exportObj.contract_requirement_outcomes.items) || {};
      Object.keys(requirementItems).forEach(function (cpId) {
        var req = String((requirementItems[cpId] || {}).requirement || "unknown");
        requirementCounts[req] = (requirementCounts[req] || 0) + 1;
      });
      next.contracts[hash] = {
        date: String(date || ""), reviewer: String(reviewer || ""),
        app_version: String(meta.app_version || ""), type_id: meta.type_id || null,
        type_classification: exportObj.type_classification
          ? JSON.parse(JSON.stringify(exportObj.type_classification)) : null,
        subdoc_confirmation: exportObj.subdoc_confirmation
          ? JSON.parse(JSON.stringify(exportObj.subdoc_confirmation)) : null,
        stance: meta.stance || "party", active_modules: (meta.active_modules || []).slice(),
        party_roles: (meta.party_roles || []).slice(), scope_statuses: scopeStatuses,
        verdict_counts: contractVerdicts, reason_counts: contractReasons,
        manual_finding_counts: manualFindingCounts,
        integrity_decision_counts: integrityDecisionCounts,
        contract_requirement_counts: requirementCounts,
        matching_format: String(exportObj.matching_observations && exportObj.matching_observations.format || "")
      };
    }
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
    return { n: n, dist: dist, pct: pct, dominant: dominant, lowSample: n < 5,
      reasons: JSON.parse(JSON.stringify(slot.reason_counts || {})) };
  }

  // 자동화 승격 검토용 원자료. 시스템 평가는 법적 판정이 아니므로 일치율로 단순 환산하지 않고
  // 시스템평가×사람판정 조합과 판정 출처를 그대로 돌려준다.
  function automationStats(corpus, cpId) {
    var slot = corpus && corpus.byCheck && corpus.byCheck[cpId];
    if (!slot) return null;
    return {
      pairs: JSON.parse(JSON.stringify(slot.system_verdict_pairs || {})),
      llmPairs: JSON.parse(JSON.stringify(slot.llm_verdict_pairs || {})),
      origins: JSON.parse(JSON.stringify(slot.origin_counts || {})),
      reasons: JSON.parse(JSON.stringify(slot.reason_counts || {}))
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
    var quickAssessments = ["evidence_found", "covered_by_subdoc", "referenced_subdoc"];
    var confirmedOk = slot && slot.system_verdict_pairs &&
      (slot.system_verdict_pairs[systemAssessment + "::이상없음"] || 0);
    if (quickAssessments.indexOf(systemAssessment) !== -1 && st.n >= minQuick && issue === 0 && na === 0 &&
        ok === st.n && confirmedOk >= minQuick) {
      return { route: "quick", n: st.n,
        reason: "직접근거·이상없음 " + confirmedOk + "건 반복", issue: issue, ok: ok, na: na };
    }
    return { route: "standard", n: st.n, reason: "일반 확인", issue: issue, ok: ok, na: na };
  }

  function matchingStats(corpus) {
    var total = { observed: 0, confirmed: 0, reassigned: 0, top1_correct: 0, top1_wrong: 0,
      gold_in_top3: 0, invalid: 0 };
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

  // 시스템의 계약조치와 검토자의 최종조치를 비교한다. 법적 판단이 본질적으로 남는
  // negotiate/hold는 정확도 분모에서 제외하고, 실행결과가 일대일로 비교 가능한 경로만
  // '측정가능 표본'으로 집계한다. 따라서 이 값은 법률판단 전체 정확도가 아니라
  // 계약조치 라우팅의 사후 일치도다.
  function actionDispositionStats(corpus) {
    var expected = {
      add_or_modify: ["수정요청"],
      remove: ["삭제요청"],
      verify_elsewhere: ["계약외조치"],
      no_action: ["유지", "비적용"]
    };
    var total = { observed: 0, evaluable: 0, agreed: 0, agreement_rate: null,
      unnecessary_modify_candidates: 0, missed_modify_candidates: 0,
      hold_total: 0, hold_resolved: 0, negotiation_total: 0,
      by_system: {}, by_disposition: {} };
    var byCheck = (corpus && corpus.byCheck) || {};
    Object.keys(byCheck).forEach(function (cpId) {
      var pairs = byCheck[cpId].system_action_pairs || {};
      Object.keys(pairs).forEach(function (pair) {
        var splitAt = pair.indexOf("::");
        if (splitAt < 0) return;
        var systemAction = pair.slice(0, splitAt);
        var disposition = pair.slice(splitAt + 2);
        var count = pairs[pair] || 0;
        if (!count) return;
        total.observed += count;
        total.by_system[systemAction] = (total.by_system[systemAction] || 0) + count;
        total.by_disposition[disposition] = (total.by_disposition[disposition] || 0) + count;
        if (expected[systemAction]) {
          total.evaluable += count;
          if (expected[systemAction].indexOf(disposition) !== -1) total.agreed += count;
        }
        if (["add_or_modify", "remove"].indexOf(systemAction) !== -1 &&
            ["유지", "비적용", "계약외조치"].indexOf(disposition) !== -1)
          total.unnecessary_modify_candidates += count;
        if (["no_action", "verify_elsewhere"].indexOf(systemAction) !== -1 &&
            ["수정요청", "삭제요청"].indexOf(disposition) !== -1)
          total.missed_modify_candidates += count;
        if (systemAction === "hold") {
          total.hold_total += count;
          if (disposition !== "보류") total.hold_resolved += count;
        }
        if (systemAction === "negotiate") total.negotiation_total += count;
      });
    });
    total.agreement_rate = total.evaluable ? total.agreed / total.evaluable : null;
    return total;
  }

  function llmAssistanceStats(corpus) {
    var total = { analyzed: 0, draft_offered: 0, draft_accepted: 0,
      accepted_unchanged: 0, accepted_edited: 0 };
    var byCheck = (corpus && corpus.byCheck) || {};
    Object.keys(byCheck).forEach(function (cpId) {
      var ac = byCheck[cpId].llm_assistance_counts || {};
      Object.keys(total).forEach(function (k) { total[k] += ac[k] || 0; });
    });
    total.acceptance_rate = total.draft_offered ? total.draft_accepted / total.draft_offered : null;
    total.unchanged_rate = total.draft_accepted ? total.accepted_unchanged / total.draft_accepted : null;
    return total;
  }

  function corpusSummary(corpus) {
    var out = { contracts: (corpus && corpus.meta && corpus.meta.contract_count) || 0,
      verdicts: 0, issues: 0, no_issue: 0, not_applicable: 0,
      route_checks: { detailed: 0, applicability: 0, quick: 0, standard: 0 },
      matching: matchingStats(corpus), action_disposition: actionDispositionStats(corpus),
      llm_assistance: llmAssistanceStats(corpus) };
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

  function _proposalKey(cpId, additions, avoid) {
    function flat(items) {
      return (items || []).map(function (x) { return x.facet + ":" + x.tag; }).sort().join(",");
    }
    return cpId + "|add=" + flat(additions) + "|avoid=" + flat(avoid);
  }

  // 사람이 확인·재지정한 정답 조항의 태그 분포에서 개선 후보를 만든다.
  // 자동 반영은 하지 않는다. 표본·지지율 기준을 넘은 항목만 사람 승인 대상으로 제시한다.
  function tagLearningProposals(corpus, signatures, opts) {
    opts = opts || {};
    var minN = opts.minN || 5;
    var support = opts.support || 0.8;
    var minNegative = opts.minNegative || 3;
    var out = [];
    var byCheck = (corpus && corpus.byCheck) || {};
    var decisions = (corpus && corpus.tag_proposal_decisions) || {};
    Object.keys(byCheck).forEach(function (cpId) {
      var tl = byCheck[cpId].tag_learning;
      if (!tl || tl.observed < minN) return;
      var sig = (signatures && signatures[cpId]) || {};
      var additions = [], avoid = [];
      Object.keys(tl.positive_counts || {}).forEach(function (facet) {
        var declared = Array.isArray(sig[facet]) ? sig[facet] : [];
        Object.keys(tl.positive_counts[facet] || {}).forEach(function (tag) {
          var count = tl.positive_counts[facet][tag] || 0;
          if (count / tl.observed >= support && declared.indexOf(tag) === -1)
            additions.push({ facet: facet, tag: tag, count: count, ratio: count / tl.observed });
        });
      });
      if (tl.reassigned >= minNegative) {
        Object.keys(tl.negative_counts || {}).forEach(function (facet) {
          Object.keys(tl.negative_counts[facet] || {}).forEach(function (tag) {
            var neg = tl.negative_counts[facet][tag] || 0;
            var pos = ((tl.positive_counts[facet] || {})[tag]) || 0;
            if (neg / tl.reassigned >= support && pos / tl.observed <= (1 - support))
              avoid.push({ facet: facet, tag: tag, count: neg, ratio: neg / tl.reassigned });
          });
        });
      }
      if (!additions.length && !avoid.length) return;
      var key = _proposalKey(cpId, additions, avoid);
      out.push({ key: key, cpId: cpId, n: tl.observed, confirmed: tl.confirmed,
        reassigned: tl.reassigned, profile_version: tl.profile_version || "",
        additions: additions, avoid: avoid, current_signature: sig,
        decision: decisions[key] || null });
    });
    return out.sort(function (a, b) { return b.n - a.n || a.cpId.localeCompare(b.cpId); });
  }

  function decideTagProposal(corpus, key, decision, meta) {
    var next = JSON.parse(JSON.stringify(corpus || emptyCorpus()));
    if (["approved", "held"].indexOf(decision) === -1 || !key) return next;
    if (!next.tag_proposal_decisions) next.tag_proposal_decisions = {};
    next.tag_proposal_decisions[key] = { decision: decision,
      reviewer: String(meta && meta.reviewer || ""), date: String(meta && meta.date || "") };
    return next;
  }

  // 계약별 최초 자동 유형과 검토자 최종 유형을 비교한다. 과거 포맷처럼 비교축이 없는
  // 계약은 분모에서 제외해 버전 혼합 시 정확도가 왜곡되지 않게 한다.
  function typeClassificationStats(corpus) {
    var out = { observed: 0, auto_evaluable: 0, matched: 0, corrected: 0,
      rescued_from_undetermined: 0, unresolved: 0, accuracy: null, confusion: {} };
    Object.keys((corpus && corpus.contracts) || {}).forEach(function (hash) {
      var td = corpus.contracts[hash] && corpus.contracts[hash].type_classification;
      if (!td || td.format !== "cr-type-classification-v1") return;
      out.observed++;
      var initial = td.initial_auto_type_id || null;
      var finalType = td.final_type_id || null;
      if (!finalType) { out.unresolved++; return; }
      if (!initial) { out.rescued_from_undetermined++; return; }
      out.auto_evaluable++;
      var key = initial + "::" + finalType;
      out.confusion[key] = (out.confusion[key] || 0) + 1;
      if (initial === finalType) out.matched++;
      else out.corrected++;
    });
    out.accuracy = out.auto_evaluable ? out.matched / out.auto_evaluable : null;
    return out;
  }

  // 코퍼스 백업({meta:{hashes…}, byCheck}) 병합 — export JSON이 아닌 이미 집계된 코퍼스.
  // 집계라 계약 단위 분해가 불가하므로 멱등 규칙: 백업 해시가 하나라도 기적재면 전체 스킵.
  function mergeCorpusBackup(corpus, backup) {
    var next = _normalizeCorpus(corpus);
    if (!backup || !backup.byCheck || !backup.meta) return next;
    var hashes = backup.meta.hashes || [];
    for (var i = 0; i < hashes.length; i++)
      if (next.meta.hashes.indexOf(hashes[i]) !== -1) return next;
    next.meta.hashes = next.meta.hashes.concat(hashes);
    next.meta.contract_count += backup.meta.contract_count || hashes.length;
    var trustedMatching = Number(backup.meta.schema_version || 0) >= 2;
    if (!trustedMatching) next.meta.legacy_matching_excluded += backup.meta.contract_count || hashes.length;
    Object.keys(backup.byCheck).forEach(function (cpId) {
      var src = backup.byCheck[cpId];
      var slot = _ensureCheck(next, cpId);
      VERDICTS.forEach(function (v) { slot.counts[v] += (src.counts && src.counts[v]) || 0; });
      Object.keys(src.origin_counts || {}).forEach(function (k) {
        slot.origin_counts[k] = (slot.origin_counts[k] || 0) + src.origin_counts[k];
      });
      Object.keys(src.reason_counts || {}).forEach(function (k) {
        slot.reason_counts[k] = (slot.reason_counts[k] || 0) + src.reason_counts[k];
      });
      Object.keys(src.action_counts || {}).forEach(function (k) {
        slot.action_counts[k] = (slot.action_counts[k] || 0) + src.action_counts[k];
      });
      Object.keys(src.system_action_pairs || {}).forEach(function (k) {
        slot.system_action_pairs[k] = (slot.system_action_pairs[k] || 0) + src.system_action_pairs[k];
      });
      Object.keys(src.system_verdict_pairs || {}).forEach(function (k) {
        slot.system_verdict_pairs[k] = (slot.system_verdict_pairs[k] || 0) + src.system_verdict_pairs[k];
      });
      Object.keys(src.llm_verdict_pairs || {}).forEach(function (k) {
        slot.llm_verdict_pairs[k] = (slot.llm_verdict_pairs[k] || 0) + src.llm_verdict_pairs[k];
      });
      if (trustedMatching) Object.keys(src.matching_counts || {}).forEach(function (k) {
        slot.matching_counts[k] = (slot.matching_counts[k] || 0) + src.matching_counts[k];
      });
      Object.keys(src.llm_assistance_counts || {}).forEach(function (k) {
        slot.llm_assistance_counts[k] = (slot.llm_assistance_counts[k] || 0) + src.llm_assistance_counts[k];
      });
      if (trustedMatching && src.tag_learning) {
        if (!slot.tag_learning) slot.tag_learning = _tagLearningSlot();
        slot.tag_learning.profile_version = src.tag_learning.profile_version || slot.tag_learning.profile_version;
        slot.tag_learning.observed += src.tag_learning.observed || 0;
        slot.tag_learning.confirmed += src.tag_learning.confirmed || 0;
        slot.tag_learning.reassigned += src.tag_learning.reassigned || 0;
        _mergeTagCountMaps(slot.tag_learning.positive_counts, src.tag_learning.positive_counts);
        _mergeTagCountMaps(slot.tag_learning.negative_counts, src.tag_learning.negative_counts);
      }
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
    Object.keys(backup.contracts || {}).forEach(function (hash) {
      if (!next.contracts[hash]) next.contracts[hash] = JSON.parse(JSON.stringify(backup.contracts[hash]));
    });
    if (!next.tag_proposal_decisions) next.tag_proposal_decisions = {};
    Object.keys(backup.tag_proposal_decisions || {}).forEach(function (key) {
      var incoming = backup.tag_proposal_decisions[key] || {};
      var current = next.tag_proposal_decisions[key] || {};
      if (!current.date || String(incoming.date || "") >= String(current.date || ""))
        next.tag_proposal_decisions[key] = JSON.parse(JSON.stringify(incoming));
    });
    return next;
  }

  return {
    VERDICTS: VERDICTS,
    emptyCorpus: emptyCorpus,
    normalizeCorpus: _normalizeCorpus,
    mergeIntoCorpus: mergeIntoCorpus,
    checkStats: checkStats,
    automationStats: automationStats,
    reviewRoute: reviewRoute,
    matchingStats: matchingStats,
    actionDispositionStats: actionDispositionStats,
    llmAssistanceStats: llmAssistanceStats,
    typeClassificationStats: typeClassificationStats,
    corpusSummary: corpusSummary,
    topComments: topComments,
    curationSignals: curationSignals,
    tagLearningProposals: tagLearningProposals,
    decideTagProposal: decideTagProposal,
    mergeCorpusBackup: mergeCorpusBackup
  };
})();

if (typeof module !== "undefined") module.exports = Loop;
