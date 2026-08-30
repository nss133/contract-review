"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const A = require("../src/assessment.js");

const CHECKS = [
  { id: "A", severity: "필수" },
  { id: "B", severity: "권장" },
  { id: "C", severity: "참고" },
];
const CLAUSES = [
  { index: 0, heading: "제1조(목적)", body: "본문" },
  { index: 1, heading: "제2조(재위탁)", body: "본문" },
];

test("build: 시스템 평가와 사람 판정을 분리한 감사 원장을 만든다", () => {
  const out = A.build([
    { cpId: "A", coverage: "addressed", tier: "confirmed",
      best: { reasons: ["결정 문구 일치"] }, ranked: [{ clauseIndex: 1, score: 42.1234 }] },
    { cpId: "B", coverage: "consider", tier: "none", best: null, ranked: [] },
    { cpId: "C", coverage: "quiet", tier: "none", best: null, ranked: [] },
  ], CHECKS, CLAUSES, { engine_version: "1.18.0", contract_hash: "cr-x", type_id: "nda", generated: "2026-08-06" });

  assert.strictEqual(out.format, "cr-system-assessment-v1");
  assert.strictEqual(out.items.A.system_assessment, "evidence_found");
  assert.strictEqual(out.items.A.review_route, "human_confirm");
  assert.strictEqual(out.items.A.evidence[0].heading, "제2조(재위탁)");
  assert.strictEqual(out.items.A.evidence[0].match_score, 42.12);
  assert.strictEqual(out.items.A.candidate_clauses.length, 1);
  assert.strictEqual(out.items.B.system_assessment, "evidence_not_found");
  assert.strictEqual(out.items.B.review_route, "human_required");
  assert.deepStrictEqual(out.items.B.evidence, []);
  assert.strictEqual(out.items.C.review_route, "not_surfaced");
});

test("build: 계약조치 라우팅을 매칭 상태와 별도 필드로 보존한다", () => {
  const out = A.build(
    [{ cpId: "C1", coverage: "consider", tier: "none", ranked: [] }],
    [{ id: "C1", severity: "필수", contract_requirement: "express",
      text_effect: "required_present", implementation_channel: "contract" }],
    [], {}
  );
  assert.equal(out.items.C1.contract_action, "add_or_modify");
  assert.equal(out.items.C1.action_evidence_state, "absent");
  assert.equal(out.items.C1.contract_requirement, "express");
});

test("build: 법규 적용범위 자동판정과 사람 보정을 감사 원장에 보존", () => {
  const scopes = { financial_outsourcing: { status: "non_applicable", reason: "단순 행사",
    factors: { continuous_use: { value: "no", source: "document", evidence: ["단건"] } } } };
  const answers = { financial_outsourcing: { financial_business_purpose: "no" } };
  const alerts = [{ id: "INS-EVENT-SOLICITATION", affects_type: false }];
  const out = A.build([], [], [], {
    scope_assessments: scopes, scope_answers: answers, legal_alerts: alerts
  });
  assert.strictEqual(out.scope_assessments.financial_outsourcing.status, "non_applicable");
  assert.strictEqual(out.scope_answers.financial_outsourcing.financial_business_purpose, "no");
  assert.strictEqual(out.legal_alerts[0].id, "INS-EVENT-SOLICITATION");
});

test("build: 구조태그 trace를 규칙 판정과 분리해 보존한다", () => {
  const out = A.build([{ cpId: "A", coverage: "verify", tier: "review",
    best: { reasons: [], tagAdjustment: 0, tagTrace: {
      profileVersion: "1.1.0", score: 22, eligible: false,
      comparisonBasis: "proposition_frame", aggregateEligible: true,
      bestFrame: { id: "frame-1", source: "clause_body", at: 0, text: "재위탁 후 통지한다." },
      matches: { topics: ["subcontracting"] }, missing: ["modalities"], conflicts: [],
      observed: { topics: ["subcontracting"] }, evidence: []
    } }, ranked: [{ clauseIndex: 1, score: 30 }] }], CHECKS, CLAUSES, {});
  assert.strictEqual(out.items.A.tag_analysis.profile_version, "1.1.0");
  assert.strictEqual(out.items.A.tag_analysis.applied_adjustment, 0);
  assert.strictEqual(out.items.A.tag_analysis.comparison_basis, "proposition_frame");
  assert.strictEqual(out.items.A.tag_analysis.aggregate_eligible, true);
  assert.match(out.items.A.tag_analysis.best_frame.text, /재위탁/);
  assert.deepStrictEqual(out.items.A.tag_analysis.missing_facets, ["modalities"]);
  assert.strictEqual(out.items.A.decision_source.kind, "rule");
});

test("build: 태그 생산자 버전과 taxonomy 해시를 평가 원장에 보존한다", () => {
  const out = A.build([], [], [], { tag_engine: {
    profileVersion: "1.1.0", producerPackage: "legal-opinion-tagger",
    producerPackageVersion: "0.6.3", artifactSha256: "abc", taxonomySha256: "def"
  } });
  assert.strictEqual(out.tag_engine.profile_version, "1.1.0");
  assert.strictEqual(out.tag_engine.producer_version, "0.6.3");
  assert.strictEqual(out.tag_engine.taxonomy_sha256, "def");
});

test("build: 당사 지위 게이트는 비적용으로 명시한다", () => {
  const out = A.build([
    { cpId: "A", coverage: "quiet", tier: "confirmed", roleGated: true,
      best: { reasons: [] }, ranked: [{ clauseIndex: 0, score: 55 }] },
  ], CHECKS, CLAUSES, {});
  assert.strictEqual(out.items.A.applicability, "not_applicable");
  assert.strictEqual(out.items.A.system_assessment, "not_applicable");
  assert.strictEqual(out.items.A.review_route, "no_review");
});

test("build: 개인정보 관계 게이트는 비적용으로 명시한다", () => {
  const out = A.build([
    { cpId: "A", coverage: "quiet", tier: "none", relationshipGated: true,
      best: null, ranked: [] },
  ], CHECKS, CLAUSES, { data_relationship: { kind: "processing_outsourcing" } });
  assert.strictEqual(out.items.A.applicability, "not_applicable");
  assert.strictEqual(out.items.A.system_assessment, "not_applicable");
  assert.strictEqual(out.items.A.review_route, "no_review");
  assert.strictEqual(out.items.A.relationship_gated, true);
  assert.strictEqual(out.data_relationship.kind, "processing_outsourcing");
});

test("build: 로컬 LLM 결과는 규칙 판정을 덮지 않는 advisory로 기록", () => {
  const out = A.build([
    { cpId: "A", coverage: "addressed", tier: "confirmed",
      best: { reasons: [] }, ranked: [{ clauseIndex: 1, score: 50 }],
      localLlm: { model: "qwen3:4b", selected_clause_index: 1, relation: "direct",
        completeness: "partial", reason: "일부 요소만 있음", duration_ms: 1200,
        present_elements: ["사전동의"], missing_elements: ["서면 방식"],
        draft_comment: "서면 방식 보완 필요", draft_accepted: true } },
  ], CHECKS, CLAUSES, {});
  assert.strictEqual(out.items.A.decision_source.kind, "rule");
  assert.strictEqual(out.items.A.advisory.kind, "local_llm");
  assert.strictEqual(out.items.A.advisory.completeness, "partial");
  assert.deepStrictEqual(out.items.A.advisory.missing_elements, ["서면 방식"]);
  assert.strictEqual(out.items.A.advisory.draft_accepted, true);
});

test("build: 부속서류 커버와 본문 참조를 부재알람에서 분리한다", () => {
  const results = [
    { cpId: "A", coverage: "consider", tier: "none", best: null, ranked: [] },
    { cpId: "B", coverage: "consider", tier: "none", best: null, ranked: [] },
    { cpId: "C", coverage: "consider", tier: "none", best: null, ranked: [] },
  ];
  const out = A.build(results, CHECKS, CLAUSES, {
    subdoc_coverage: { A: { docName: "보안관리약정서.pdf", score: 51.234 } },
    ref_coverage: {
      B: { title: "보안관리약정서", signal: "체결한다", quote: "별첨 약정서를 체결한다" },
      C: { title: "보안관리약정서", signal: "수동 체크", quote: "검토자 확인" },
    },
  });
  assert.strictEqual(out.items.A.system_assessment, "covered_by_subdoc");
  assert.strictEqual(out.items.A.coverage_source, "uploaded_subdoc");
  assert.strictEqual(out.items.A.evidence[0].match_score, 51.23);
  assert.strictEqual(out.items.B.system_assessment, "referenced_subdoc");
  assert.strictEqual(out.items.B.coverage_source, "contract_reference");
  assert.strictEqual(out.items.C.coverage_source, "reviewer_declared");
  assert.strictEqual(out.items.C.review_route, "human_confirm");
});

test("build: 회사 관점 판정과 계약 당사자 컨텍스트를 감사 원장에 보존", () => {
  const perspective = { rule: "confidentiality_duration", bearer: "counterparty",
    duration: "indefinite", favorable: true, auto_pass: true, reason: "상대방만 부담" };
  const partyContext = { ourAliases: ["갑"], counterpartyAliases: ["을"], roles: ["위탁자"],
    confidence: "explicit_alias" };
  const out = A.build([{ cpId: "C", coverage: "addressed", tier: "confirmed",
    best: { reasons: [] }, ranked: [{ clauseIndex: 0, score: 50 }], perspective }],
  CHECKS, CLAUSES, { stance: "party", party_roles: ["위탁자"], party_context: partyContext,
    active_modules: ["M-CORE"] });
  assert.strictEqual(out.items.C.perspective.obligation_bearer, "counterparty");
  assert.strictEqual(out.items.C.perspective.auto_pass, true);
  assert.deepStrictEqual(out.party_context, partyContext);
  assert.deepStrictEqual(out.active_modules, ["M-CORE"]);
});
