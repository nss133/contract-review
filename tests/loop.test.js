"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/loop.js");

// 검토의견 내보내기 포맷: { meta:{type_id,date,contract_hash}, verdicts:{cpId:{verdict,comment,date}} }
function exp(hash, reviewer, verdicts) {
  return { meta: { type_id: "outsourcing", date: "2026-07-10", contract_hash: hash, reviewer: reviewer }, verdicts: verdicts };
}

test("emptyCorpus: 초기 구조", () => {
  const c = L.emptyCorpus();
  assert.deepStrictEqual(c.byCheck, {});
  assert.deepStrictEqual(c.contracts, {});
  assert.strictEqual(c.meta.schema_version, 2);
  assert.strictEqual(c.meta.contract_count, 0);
});

test("normalizeCorpus: v1 판정은 보존하고 손상 가능 매칭·태그 집계만 제외", () => {
  const c = L.normalizeCorpus({ meta: { contract_count: 3, hashes: ["a", "b", "c"] }, byCheck: {
    X: { counts: { "이상없음": 2, "검토의견": 1, "해당없음": 0 }, comments: [],
      matching_counts: { observed: 3, top1_correct: 3 }, tag_learning: { observed: 3 } }
  } });
  assert.strictEqual(c.byCheck.X.counts["이상없음"], 2);
  assert.strictEqual(c.byCheck.X.matching_counts, undefined);
  assert.strictEqual(c.byCheck.X.tag_learning, undefined);
  assert.strictEqual(c.meta.legacy_matching_excluded, 3);
  assert.strictEqual(c.meta.schema_version, 2);
});

test("mergeIntoCorpus: 이상없음 사유를 체크별·계약별로 보존", () => {
  const e = exp("reason-1", "김", {
    A: { verdict: "이상없음", reason: "계약 반영 불필요", comment: "", date: "d" },
    B: { verdict: "이상없음", reason: "해당사항 없음", comment: "", date: "d" }
  });
  e.meta.app_version = "1.43.0";
  e.meta.active_modules = ["M-MANDATE"];
  e.system_assessments = { scope_assessments: {
    financial_outsourcing: { status: "non_applicable", confidence: "high", reason: "원문 비저장" }
  } };
  const c = L.mergeIntoCorpus(L.emptyCorpus(), e);
  assert.strictEqual(c.byCheck.A.reason_counts["계약 반영 불필요"], 1);
  assert.strictEqual(c.byCheck.B.reason_counts["해당사항 없음"], 1);
  assert.strictEqual(c.contracts["reason-1"].app_version, "1.43.0");
  assert.deepStrictEqual(c.contracts["reason-1"].active_modules, ["M-MANDATE"]);
  assert.deepStrictEqual(c.contracts["reason-1"].scope_statuses.financial_outsourcing,
    { status: "non_applicable", confidence: "high" });
  assert.strictEqual(c.contracts["reason-1"].reason_counts["계약 반영 불필요"], 1);
  assert.strictEqual(c.contracts["reason-1"].scope_statuses.financial_outsourcing.reason, undefined);
});

test("mergeIntoCorpus: 판정 카운트 집계", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "손", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h2", "김", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h3", "이", { "CORE-07": { verdict: "해당없음", comment: "", date: "d" } }));
  const s = c.byCheck["CORE-07"];
  assert.strictEqual(s.counts["이상없음"], 2);
  assert.strictEqual(s.counts["해당없음"], 1);
  assert.strictEqual(c.meta.contract_count, 3);
});

test("mergeIntoCorpus: 직접 의견·완결성 판정·계약반영 라우팅은 계약 단위 집계로 보존", () => {
  const e = exp("finding-1", "손", {});
  e.manual_findings = {
    "MF-1": { scope: "contract", category: "general", severity: "중요", comment: "전반 의견" },
    "MF-2": { scope: "clause", category: "reference", severity: "일반", comment: "인용 확인" }
  };
  e.finding_decisions = { "IF-REF-02-1-2": { decision: "opinion" }, "IF-NUM-01-2-2": { decision: "no_issue" } };
  e.contract_requirement_outcomes = { items: { A: { requirement: "express" }, B: { requirement: "none" } } };
  const c = L.mergeIntoCorpus(L.emptyCorpus(), e).contracts["finding-1"];
  assert.strictEqual(c.manual_finding_counts.total, 2);
  assert.strictEqual(c.manual_finding_counts.by_category.reference, 1);
  assert.strictEqual(c.integrity_decision_counts["REF-02"].opinion, 1);
  assert.deepStrictEqual(c.contract_requirement_counts, { express: 1, none: 1 });
});

test("유형 분류: 최초 자동유형과 검토자 최종유형을 계약별로 보존·비교", () => {
  let c = L.emptyCorpus();
  const accepted = exp("type-1", "손", {});
  accepted.type_classification = { format: "cr-type-classification-v1",
    initial_auto_type_id: "procurement", final_type_id: "procurement", outcome: "auto_accepted" };
  const changed = exp("type-2", "손", {});
  changed.type_classification = { format: "cr-type-classification-v1",
    initial_auto_type_id: "outsourcing", final_type_id: "procurement", outcome: "reviewer_changed" };
  changed.subdoc_confirmation = { format: "cr-subdoc-confirmation-v1", confirmed_ids: ["SUBDOC-PII"] };
  const rescued = exp("type-3", "손", {});
  rescued.type_classification = { format: "cr-type-classification-v1",
    initial_auto_type_id: null, final_type_id: "nda", outcome: "reviewer_selected_after_undetermined" };
  c = L.mergeIntoCorpus(c, accepted);
  c = L.mergeIntoCorpus(c, changed);
  c = L.mergeIntoCorpus(c, rescued);
  assert.equal(c.contracts["type-2"].type_classification.final_type_id, "procurement");
  assert.deepStrictEqual(c.contracts["type-2"].subdoc_confirmation.confirmed_ids, ["SUBDOC-PII"]);
  const s = L.typeClassificationStats(c);
  assert.deepStrictEqual({ observed: s.observed, auto_evaluable: s.auto_evaluable, matched: s.matched,
    corrected: s.corrected, rescued: s.rescued_from_undetermined },
    { observed: 3, auto_evaluable: 2, matched: 1, corrected: 1, rescued: 1 });
  assert.equal(s.accuracy, 0.5);
  assert.equal(s.confusion["outsourcing::procurement"], 1);
});

test("mergeIntoCorpus: 코멘트 이력 + 동일 텍스트 count 병합", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "손", { "CMN-11": { verdict: "검토의견", comment: "상한 확인 필요", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h2", "김", { "CMN-11": { verdict: "검토의견", comment: "상한 확인 필요", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h3", "이", { "CMN-11": { verdict: "검토의견", comment: "책임 범위 다름", date: "d" } }));
  const cm = c.byCheck["CMN-11"].comments;
  const same = cm.find((x) => x.text === "상한 확인 필요");
  assert.strictEqual(same.count, 2); // 동일 텍스트 병합
  assert.strictEqual(cm.length, 2);  // 서로 다른 코멘트 2종
});

test("mergeIntoCorpus: 코멘트 없는 판정은 코멘트 이력에 안 남음", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "손", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } }));
  assert.strictEqual(c.byCheck["CORE-07"].comments.length, 0);
});

test("mergeIntoCorpus: 동일 코멘트의 검토자 귀속이 누적된다(P4 팀 취합)", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "손", { "CMN-11": { verdict: "검토의견", comment: "상한 확인 필요", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h2", "김", { "CMN-11": { verdict: "검토의견", comment: "상한 확인 필요", date: "d" } }));
  const same = c.byCheck["CMN-11"].comments.find((x) => x.text === "상한 확인 필요");
  assert.deepStrictEqual(same.reviewers, ["손", "김"]); // 서로 다른 검토자 누적
  // 같은 검토자의 다른 계약 재출현은 중복 등재 안 됨
  c = L.mergeIntoCorpus(c, exp("h3", "손", { "CMN-11": { verdict: "검토의견", comment: "상한 확인 필요", date: "d" } }));
  assert.deepStrictEqual(c.byCheck["CMN-11"].comments.find((x) => x.text === "상한 확인 필요").reviewers, ["손", "김"]);
});

test("mergeIntoCorpus: 같은 계약서(hash) 재적재는 중복 카운트 안 함", () => {
  let c = L.emptyCorpus();
  const e = exp("h1", "손", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } });
  c = L.mergeIntoCorpus(c, e);
  c = L.mergeIntoCorpus(c, e); // 같은 hash 재적재
  assert.strictEqual(c.byCheck["CORE-07"].counts["이상없음"], 1);
  assert.strictEqual(c.meta.contract_count, 1);
});

test("mergeIntoCorpus: 시스템평가×사람판정과 판정 출처를 별도 집계", () => {
  const e = exp("h-auto", "손", {
    "CORE-07": { verdict: "이상없음", comment: "", date: "d", origin: "manual" },
  });
  e.system_assessments = {
    format: "cr-system-assessment-v1",
    items: { "CORE-07": { system_assessment: "evidence_found", advisory: {
      kind: "local_llm", relation: "direct", completeness: "complete"
    } } },
  };
  const c = L.mergeIntoCorpus(L.emptyCorpus(), e);
  const st = L.automationStats(c, "CORE-07");
  assert.strictEqual(st.pairs["evidence_found::이상없음"], 1);
  assert.strictEqual(st.llmPairs["direct/complete::이상없음"], 1);
  assert.strictEqual(st.origins.manual, 1);
});

test("mergeIntoCorpus: 시스템 계약조치와 사람 최종조치를 쌍으로 누적", () => {
  const ex = { meta: { contract_hash: "action-1", date: "2026-08-29" },
    verdicts: { A: { verdict: "검토의견", action_disposition: "수정요청", origin: "manual" } },
    system_assessments: { items: { A: { contract_action: "add_or_modify" } } } };
  const c = L.mergeIntoCorpus(L.emptyCorpus(), ex);
  assert.equal(c.byCheck.A.action_counts["수정요청"], 1);
  assert.equal(c.byCheck.A.system_action_pairs["add_or_modify::수정요청"], 1);
});

test("actionDispositionStats: 결정가능 경로만 일치도에 넣고 협상·보류는 제외", () => {
  const corpus = { byCheck: {
    A: { system_action_pairs: {
      "add_or_modify::수정요청": 3,
      "add_or_modify::유지": 1,
      "remove::삭제요청": 2,
      "verify_elsewhere::계약외조치": 2,
      "verify_elsewhere::수정요청": 1,
      "no_action::비적용": 1,
      "negotiate::유지": 4,
      "hold::보류": 2,
      "hold::계약외조치": 1,
    } }
  } };
  const st = L.actionDispositionStats(corpus);
  assert.strictEqual(st.observed, 17);
  assert.strictEqual(st.evaluable, 10);
  assert.strictEqual(st.agreed, 8);
  assert.strictEqual(st.agreement_rate, 0.8);
  assert.strictEqual(st.unnecessary_modify_candidates, 1);
  assert.strictEqual(st.missed_modify_candidates, 1);
  assert.strictEqual(st.negotiation_total, 4);
  assert.deepStrictEqual([st.hold_total, st.hold_resolved], [3, 1]);
});

test("automationStats: 구 판정은 legacy 출처로 집계", () => {
  const c = L.mergeIntoCorpus(L.emptyCorpus(), exp("h-old", "손", {
    X: { verdict: "검토의견", comment: "", date: "d" },
  }));
  assert.strictEqual(L.automationStats(c, "X").origins.legacy, 1);
});

test("mergeIntoCorpus: 사람 조항 확인·재지정을 매칭 정밀도 원자료로 누적", () => {
  const e1 = exp("m1", "손", { X: { verdict: "이상없음", comment: "", date: "d" } });
  e1.matching_observations = { items: { X: { rule_clause_index: 2, human_clause_index: 2,
    human_evidence_source: "confirmed_match", candidate_clauses: [{ clause_index: 2 }] } } };
  const e2 = exp("m2", "손", { X: { verdict: "이상없음", comment: "", date: "d" } });
  e2.matching_observations = { items: { X: { rule_clause_index: 2, human_clause_index: 4,
    human_evidence_source: "reassigned", candidate_clauses: [{ clause_index: 2 }, { clause_index: 4 }] } } };
  let c = L.mergeIntoCorpus(L.emptyCorpus(), e1);
  c = L.mergeIntoCorpus(c, e2);
  const m = L.matchingStats(c);
  assert.deepStrictEqual([m.observed, m.confirmed, m.reassigned], [2, 1, 1]);
  assert.strictEqual(m.top1_accuracy, 0.5);
  assert.strictEqual(m.top3_recall, 1);
});

test("mergeIntoCorpus: 판정 없이 남긴 명시적 조항 확인도 매칭 원자료로 누적", () => {
  const e = exp("m-no-verdict", "손", {});
  e.matching_observations = { items: { X: { rule_clause_index: 1, human_clause_index: 1,
    human_evidence_source: "confirmed_match", candidate_clauses: [{ clause_index: 1 }] } } };
  const m = L.matchingStats(L.mergeIntoCorpus(L.emptyCorpus(), e));
  assert.deepStrictEqual([m.observed, m.confirmed, m.top1_correct], [1, 1, 1]);
});

test("mergeIntoCorpus: 재지정인데 rule=human인 손상 표본은 정확도·태그학습에서 제외", () => {
  const e = exp("m-corrupt", "손", { X: { verdict: "이상없음", comment: "", date: "d" } });
  e.matching_observations = { items: { X: { rule_clause_index: 4, human_clause_index: 4,
    human_evidence_source: "reassigned", candidate_clauses: [{ clause_index: 4 }],
    tag_observation: { human_observed: { topic: ["재위탁"] }, rule_observed: { topic: ["재위탁"] } }
  } } };
  const c = L.mergeIntoCorpus(L.emptyCorpus(), e);
  const m = L.matchingStats(c);
  assert.deepStrictEqual([m.observed, m.invalid], [0, 1]);
  assert.strictEqual(c.byCheck.X.tag_learning, undefined);
});

test("mergeIntoCorpus: LLM 분석·초안 채택은 판정 없는 항목도 별도 누적", () => {
  const merged = L.mergeIntoCorpus(L.emptyCorpus(), {
    meta: { contract_hash: "llm-a", date: "2026-08-06" },
    verdicts: { A: { verdict: "검토의견", comment: "수정", origin: "llm_draft" } },
    llm_assistance: { items: {
      A: { analyzed: true, draft_offered: true, draft_accepted: true, final_comment_unchanged: false },
      B: { analyzed: true, draft_offered: false, draft_accepted: false }
    } }
  });
  assert.strictEqual(merged.byCheck.A.origin_counts.llm_draft, 1);
  assert.deepStrictEqual(merged.byCheck.A.llm_assistance_counts,
    { analyzed: 1, draft_offered: 1, draft_accepted: 1, accepted_unchanged: 0, accepted_edited: 1 });
  assert.strictEqual(merged.byCheck.B.llm_assistance_counts.analyzed, 1);
});

test("corpusSummary: 판정·라우팅·매칭 상태를 한 번에 요약", () => {
  const c = { meta: { contract_count: 2 }, byCheck: {
    X: { counts: { "이상없음": 4, "검토의견": 1, "해당없음": 0 }, matching_counts: { observed: 2, top1_correct: 1 } },
    Y: { counts: { "이상없음": 0, "검토의견": 0, "해당없음": 4 } }
  } };
  const s = L.corpusSummary(c);
  assert.strictEqual(s.verdicts, 9);
  assert.strictEqual(s.issues, 1);
  assert.strictEqual(s.route_checks.detailed, 1);
  assert.strictEqual(s.route_checks.applicability, 1);
});

test("llmAssistanceStats: 초안 채택률과 무수정 채택률", () => {
  const corpus = { byCheck: {
    A: { llm_assistance_counts: { analyzed: 5, draft_offered: 4, draft_accepted: 2,
      accepted_unchanged: 1, accepted_edited: 1 } },
    B: { llm_assistance_counts: { analyzed: 3, draft_offered: 2, draft_accepted: 1,
      accepted_unchanged: 1, accepted_edited: 0 } }
  } };
  const st = L.llmAssistanceStats(corpus);
  assert.strictEqual(st.analyzed, 8);
  assert.strictEqual(st.acceptance_rate, 0.5);
  assert.strictEqual(st.unchanged_rate, 2 / 3);
});

test("reviewRoute: 과거 검토의견이 있으면 정밀 검토가 최우선", () => {
  const c = { meta: {}, byCheck: { X: { counts: { "이상없음": 8, "검토의견": 1, "해당없음": 3 },
    system_verdict_pairs: { "evidence_found::이상없음": 8 } } } };
  assert.strictEqual(L.reviewRoute(c, "X", "evidence_found").route, "detailed");
});

test("reviewRoute: 반복 해당없음은 적용성 확인", () => {
  const c = { meta: {}, byCheck: { X: { counts: { "이상없음": 2, "검토의견": 0, "해당없음": 3 } } } };
  assert.strictEqual(L.reviewRoute(c, "X", "evidence_not_found").route, "applicability");
});

test("reviewRoute: 직접근거와 이상없음이 5건 이상 일치해야 빠른 확인", () => {
  const c = { meta: {}, byCheck: { X: { counts: { "이상없음": 6, "검토의견": 0, "해당없음": 0 },
    system_verdict_pairs: { "evidence_found::이상없음": 6 } } } };
  assert.strictEqual(L.reviewRoute(c, "X", "evidence_found").route, "quick");
  assert.strictEqual(L.reviewRoute(c, "X", "possible_evidence").route, "standard");
});

test("reviewRoute: 부속서류 커버 반복 확인도 빠른 확인으로 분류", () => {
  const c = { meta: {}, byCheck: { X: { counts: { "이상없음": 5, "검토의견": 0, "해당없음": 0 },
    system_verdict_pairs: { "covered_by_subdoc::이상없음": 5 } } } };
  assert.strictEqual(L.reviewRoute(c, "X", "covered_by_subdoc").route, "quick");
  assert.strictEqual(L.reviewRoute(c, "X", "evidence_not_found").route, "standard");
});

test("checkStats: 분포 비율 + 표본수", () => {
  let c = L.emptyCorpus();
  ["h1", "h2", "h3", "h4"].forEach((h, i) => {
    c = L.mergeIntoCorpus(c, exp(h, "r" + i, { "X": { verdict: i < 3 ? "이상없음" : "해당없음", comment: "", date: "d" } }));
  });
  const st = L.checkStats(c, "X");
  assert.strictEqual(st.n, 4);
  assert.strictEqual(st.dist["이상없음"], 3);
  assert.strictEqual(st.pct["이상없음"], 75);
  assert.strictEqual(st.dominant, "이상없음");
  assert.strictEqual(st.lowSample, true); // n=4 < 5 → 표본 적음
});

test("checkStats: 표본 5건 이상이면 lowSample 아님", () => {
  let c = L.emptyCorpus();
  ["h1", "h2", "h3", "h4", "h5"].forEach((h, i) => {
    c = L.mergeIntoCorpus(c, exp(h, "r" + i, { "W": { verdict: "이상없음", comment: "", date: "d" } }));
  });
  assert.strictEqual(L.checkStats(c, "W").lowSample, false);
});

test("checkStats: 표본 적으면 lowSample", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "r", { "Y": { verdict: "이상없음", comment: "", date: "d" } }));
  assert.strictEqual(L.checkStats(c, "Y").lowSample, true);
});

test("checkStats: 없는 항목은 null", () => {
  assert.strictEqual(L.checkStats(L.emptyCorpus(), "NOPE"), null);
});

test("topComments: count 내림차순 상위", () => {
  let c = L.emptyCorpus();
  for (let i = 0; i < 3; i++) c = L.mergeIntoCorpus(c, exp("a" + i, "r", { "Z": { verdict: "검토의견", comment: "자주 다는 의견", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("b1", "r", { "Z": { verdict: "검토의견", comment: "가끔 의견", date: "d" } }));
  const top = L.topComments(c, "Z", 5);
  assert.strictEqual(top[0].text, "자주 다는 의견");
  assert.strictEqual(top[0].count, 3);
  assert.strictEqual(top.length, 2);
});

test("topComments: 없으면 빈 배열", () => {
  assert.deepStrictEqual(L.topComments(L.emptyCorpus(), "NOPE", 5), []);
});

test("curationSignals: 반복 해당없음은 조건부화 후보, 반복 이상없음은 골드", () => {
  let c = L.emptyCorpus();
  for (let i = 0; i < 8; i++) c = L.mergeIntoCorpus(c, exp("na" + i, "r", { "NA": { verdict: "해당없음", comment: "", date: "d" } }));
  for (let i = 0; i < 8; i++) c = L.mergeIntoCorpus(c, exp("ok" + i, "r", { "OK": { verdict: "이상없음", comment: "", date: "d" } }));
  const sig = L.curationSignals(c, { minN: 5, ratio: 0.8 });
  assert.ok(sig.conditional.some((x) => x.cpId === "NA"));
  assert.ok(sig.gold.some((x) => x.cpId === "OK"));
});

test("tagLearningProposals: 확인·재지정 태그를 누적해 사람 승인 후보를 만든다", () => {
  let c = L.emptyCorpus();
  for (let i = 0; i < 5; i++) {
    const e = exp("tag-" + i, "손", { X: { verdict: "이상없음", comment: "", date: "d" } });
    const reassigned = i < 3;
    e.matching_observations = { items: { X: {
      rule_clause_index: 1, human_clause_index: reassigned ? 2 : 1,
      human_evidence_source: reassigned ? "reassigned" : "confirmed_match",
      candidate_clauses: [{ clause_index: 1 }, { clause_index: 2 }],
      tag_observation: {
        profile_version: "1.0.0",
        human_observed: { topics: ["subcontracting"], modalities: ["prior_consent"] },
        rule_observed: reassigned ? { topics: ["subcontracting"], modalities: ["post_notice"] } : null,
      },
    } } };
    c = L.mergeIntoCorpus(c, e);
  }
  const proposals = L.tagLearningProposals(c,
    { X: { status: "curated", topics: ["subcontracting"] } },
    { minN: 5, support: 0.8, minNegative: 3 });
  assert.strictEqual(proposals.length, 1);
  assert.ok(proposals[0].additions.some((x) => x.facet === "modalities" && x.tag === "prior_consent"));
  assert.ok(proposals[0].avoid.some((x) => x.facet === "modalities" && x.tag === "post_notice"));

  c = L.decideTagProposal(c, proposals[0].key, "approved", { reviewer: "손", date: "2026-08-26" });
  const decided = L.tagLearningProposals(c, { X: { topics: ["subcontracting"] } },
    { minN: 5, support: 0.8, minNegative: 3 })[0];
  assert.strictEqual(decided.decision.decision, "approved");
  assert.strictEqual(decided.decision.reviewer, "손");
});

test("mergeCorpusBackup: 코퍼스 백업(byCheck) 병합", () => {
  const backup = {
    meta: { updated: "2026-07-15", contract_count: 2, hashes: ["cr-a", "cr-b"] },
    byCheck: { "CMN-11": { counts: { "이상없음": 2, "검토의견": 0, "해당없음": 0 },
      action_counts: { "수정요청": 2 }, system_action_pairs: { "add_or_modify::수정요청": 2 },
      comments: [{ text: "조항 있음", verdict: "이상없음", count: 1, reviewers: ["손남수"], date: "2026-07-15" }],
      lastSeen: "2026-07-15" } },
  };
  const c1 = L.mergeCorpusBackup(L.emptyCorpus(), backup);
  assert.strictEqual(c1.meta.contract_count, 2);
  assert.strictEqual(c1.byCheck["CMN-11"].counts["이상없음"], 2);
  assert.strictEqual(c1.byCheck["CMN-11"].action_counts["수정요청"], 2);
  assert.strictEqual(c1.byCheck["CMN-11"].system_action_pairs["add_or_modify::수정요청"], 2);
  assert.strictEqual(c1.byCheck["CMN-11"].comments[0].reviewers[0], "손남수");
  // 멱등: 같은 백업 재투입 — 해시 겹침 → 전체 스킵
  const c2 = L.mergeCorpusBackup(c1, backup);
  assert.strictEqual(c2.meta.contract_count, 2);
  assert.strictEqual(c2.byCheck["CMN-11"].counts["이상없음"], 2);
});

test("mergeCorpusBackup: 기존 코퍼스와 코멘트 병합(동문 합산)", () => {
  const base = L.mergeIntoCorpus(L.emptyCorpus(), {
    meta: { contract_hash: "cr-x", reviewer: "손남수", date: "2026-07-16" },
    verdicts: { "CMN-11": { verdict: "이상없음", comment: "조항 있음" } },
  });
  const backup = {
    meta: { updated: "2026-07-15", contract_count: 1, hashes: ["cr-a"] },
    byCheck: { "CMN-11": { counts: { "이상없음": 1, "검토의견": 0, "해당없음": 0 },
      comments: [{ text: "조항 있음", verdict: "이상없음", count: 2, reviewers: ["김검토"], date: "2026-07-15" }],
      lastSeen: "2026-07-15" } },
  };
  const m = L.mergeCorpusBackup(base, backup);
  assert.strictEqual(m.meta.contract_count, 2);
  assert.strictEqual(m.byCheck["CMN-11"].counts["이상없음"], 2);
  assert.strictEqual(m.byCheck["CMN-11"].comments[0].count, 3); // 1+2 합산
  assert.deepStrictEqual(m.byCheck["CMN-11"].comments[0].reviewers.sort(), ["김검토", "손남수"]);
});
