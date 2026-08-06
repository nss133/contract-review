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

test("build: 당사 지위 게이트는 비적용으로 명시한다", () => {
  const out = A.build([
    { cpId: "A", coverage: "quiet", tier: "confirmed", roleGated: true,
      best: { reasons: [] }, ranked: [{ clauseIndex: 0, score: 55 }] },
  ], CHECKS, CLAUSES, {});
  assert.strictEqual(out.items.A.applicability, "not_applicable");
  assert.strictEqual(out.items.A.system_assessment, "not_applicable");
  assert.strictEqual(out.items.A.review_route, "no_review");
});

test("build: 로컬 LLM 결과는 규칙 판정을 덮지 않는 advisory로 기록", () => {
  const out = A.build([
    { cpId: "A", coverage: "addressed", tier: "confirmed",
      best: { reasons: [] }, ranked: [{ clauseIndex: 1, score: 50 }],
      localLlm: { model: "qwen3:4b", selected_clause_index: 1, relation: "direct",
        completeness: "partial", reason: "일부 요소만 있음", duration_ms: 1200 } },
  ], CHECKS, CLAUSES, {});
  assert.strictEqual(out.items.A.decision_source.kind, "rule");
  assert.strictEqual(out.items.A.advisory.kind, "local_llm");
  assert.strictEqual(out.items.A.advisory.completeness, "partial");
});
