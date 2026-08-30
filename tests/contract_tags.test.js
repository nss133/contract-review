"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const ContractTags = require("../src/contract_tags.js");
const Matcher = require("../src/matcher.js");
const MatcherConfig = require("../src/matcher_config.js");

test("사전동의 재위탁 조항은 PRIV-15 구조태그를 충족한다", () => {
  const check = { tag_signature: {
    status: "curated",
    topics: ["subcontracting", "personal_information"],
    actors: ["trustee"], actions: ["subcontract", "obtain_consent"],
    objects: ["personal_information"], modalities: ["prior_consent"],
    required_facets: ["topics", "actions", "objects", "modalities"]
  }};
  const trace = ContractTags.matchClause(check, {
    heading: "제12조(재위탁)",
    body: "수탁자는 개인정보 처리업무를 재위탁하려면 위탁자의 사전 동의를 받아야 한다."
  });
  assert.equal(trace.eligible, true);
  assert.equal(trace.comparisonBasis, "proposition_frame");
  assert.match(trace.bestFrame.text, /사전 동의/);
  assert.equal(trace.conflicts.length, 0);
  assert.ok(trace.score > 0);
});

test("서로 다른 문장에 흩어진 개인정보·사전동의는 assist 자격이 없다", () => {
  const check = { tag_signature: {
    status: "curated", topics: ["subcontracting"], actors: ["trustee"],
    actions: ["subcontract"], objects: ["personal_information"],
    modalities: ["prior_consent"],
    required_facets: ["topics", "actors", "actions", "objects", "modalities"]
  } };
  const trace = ContractTags.matchClause(check, {
    heading: "제12조(재위탁)",
    body: "수탁자는 개인정보 처리업무를 재위탁할 수 있다. 다른 업무는 위탁자의 사전 동의를 받아야 한다."
  });
  assert.equal(trace.aggregateEligible, true);
  assert.equal(trace.eligible, false);
  const previous = MatcherConfig.TAG_MATCH_MODE;
  MatcherConfig.TAG_MATCH_MODE = "assist";
  try { assert.equal(Matcher.tagScoreAdjustment(trace), 0); }
  finally { MatcherConfig.TAG_MATCH_MODE = previous; }
});

test("재위탁 사후통지는 사전동의 체크를 충족하지 않는다", () => {
  const check = { tag_signature: {
    status: "curated", topics: ["subcontracting"], actions: ["subcontract"],
    modalities: ["prior_consent"], required_facets: ["topics", "actions", "modalities"]
  }};
  const trace = ContractTags.matchClause(check, {
    heading: "제12조(재위탁)", body: "수탁자는 재위탁 후 위탁자에게 통지하여야 한다."
  });
  assert.equal(trace.eligible, false);
  assert.ok(trace.missing.includes("modalities") || trace.conflicts.length > 0);
});

test("shadow 모드는 태그 점수를 기록하되 기존 매칭 점수를 바꾸지 않는다", () => {
  const previous = MatcherConfig.TAG_MATCH_MODE;
  MatcherConfig.TAG_MATCH_MODE = "shadow";
  try {
    assert.equal(Matcher.tagScoreAdjustment({ score: 30, conflicts: [] }), 0);
  } finally {
    MatcherConfig.TAG_MATCH_MODE = previous;
  }
});

test("assist 모드는 가점 상한과 충돌 감점 상한을 지킨다", () => {
  const previous = MatcherConfig.TAG_MATCH_MODE;
  MatcherConfig.TAG_MATCH_MODE = "assist";
  try {
    assert.equal(Matcher.tagScoreAdjustment({ score: 40, conflicts: [] }), 18);
    assert.equal(Matcher.tagScoreAdjustment({ score: 20, missing: ["objects"], conflicts: [] }), 0);
    assert.equal(Matcher.tagScoreAdjustment({ score: 32, conflicts: [{ facet: "modalities" }] }), -12);
  } finally {
    MatcherConfig.TAG_MATCH_MODE = previous;
  }
});

test("사람 승인 avoid 태그는 혼동 조항에 제한 감점을 만든다", () => {
  const check = { tag_signature: {
    status: "curated", topics: ["subcontracting"], required_facets: ["topics"],
    avoid: { modalities: ["post_notice"] },
  } };
  const clause = { heading: "제3조(재위탁)", body: "수탁자는 재위탁한 후 위탁자에게 사후 통지하여야 한다." };
  const trace = require("../src/contract_tags.js").matchClause(check, clause, "업무위탁계약서");
  assert.ok(trace.conflicts.some((x) => x.facet === "modalities"));
  const previous = MatcherConfig.TAG_MATCH_MODE;
  MatcherConfig.TAG_MATCH_MODE = "assist";
  try { assert.ok(Matcher.tagScoreAdjustment(trace) < 0); }
  finally { MatcherConfig.TAG_MATCH_MODE = previous; }
});

test("보안관리약정서의 제3자 제공 금지는 처리위탁으로 분류한다", () => {
  const relation = ContractTags.detectDataRelationship([{
    index: 0, heading: "제3조(업무 목적 외 이용 금지)",
    body: "수탁자는 업무위탁계약의 목적 외로 고객정보를 이용할 수 없으며 제3자에게 임의로 제공하거나 누설하여서는 아니 된다."
  }], "개인신용정보 보안관리 약정서(일반)");
  assert.equal(relation.kind, "processing_outsourcing");
  assert.equal(relation.tags.third_party_provision, false);
  assert.equal(relation.tags.third_party_provision_prohibited, true);
});

test("제공받는 자와 이용목적·동의를 적은 문서는 제3자 제공으로 분류한다", () => {
  const relation = ContractTags.detectDataRelationship([{
    index: 0, heading: "개인정보 제3자 제공 동의",
    body: "제공받는 자는 제휴사이며 제공받는 자의 이용 목적은 서비스 안내이다. 정보주체는 개인정보 제3자 제공에 동의한다."
  }], "개인정보 제공 동의서");
  assert.equal(relation.kind, "third_party_provision");
  assert.equal(relation.tags.third_party_provision, true);
});

test("위탁관계와 독립 제3자 제공이 함께 있으면 mixed로 분류한다", () => {
  const relation = ContractTags.detectDataRelationship([
    { index: 0, heading: "처리위탁", body: "수탁자는 고객정보 처리 업무를 위탁받아 수행한다." },
    { index: 1, heading: "제3자 제공", body: "제공받는 자의 이용 목적을 고지하고 개인정보 제3자 제공 동의를 받는다." }
  ], "업무위탁 및 제휴 계약서");
  assert.equal(relation.kind, "mixed");
});
