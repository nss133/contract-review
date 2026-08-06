"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/local_llm.js");

const CHECKS = [
  { id: "A", check: "재위탁 시 사전 서면동의를 받는가", severity: "필수" },
  { id: "B", check: "손해배상 범위가 정해졌는가", severity: "권장" },
];
const CLAUSES = [
  { index: 0, heading: "제1조(목적)", body: "목적" },
  { index: 1, heading: "제5조(재위탁)", body: "사전 서면동의 없이 재위탁할 수 없다." },
];

test("isLocalLocation: localhost HTTP만 허용", () => {
  assert.strictEqual(L.isLocalLocation({ protocol: "http:", hostname: "127.0.0.1" }), true);
  assert.strictEqual(L.isLocalLocation({ protocol: "file:", hostname: "" }), false);
  assert.strictEqual(L.isLocalLocation({ protocol: "https:", hostname: "example.com" }), false);
});

test("buildBatch: verify 우선·Top-K 후보만 계약 본문 길이를 제한해 구성", () => {
  const batch = L.buildBatch([
    { cpId: "A", coverage: "addressed", best: { clauseIndex: 1 }, ranked: [{ clauseIndex: 1, score: 40 }] },
    { cpId: "B", coverage: "verify", best: { clauseIndex: 0 }, ranked: [{ clauseIndex: 0, score: 20 }] },
  ], CHECKS, CLAUSES);
  assert.deepStrictEqual(batch.map((x) => x.check_id), ["B", "A"]);
  assert.strictEqual(batch[1].candidates[0].heading, "제5조(재위탁)");
});

test("buildBatches: 실험 항목 전체를 서버 제한 이하 소배치로 나눈다", () => {
  const results = Array.from({ length: 9 }, (_, i) => ({
    cpId: i % 2 ? "A" : "B", coverage: "verify", best: { clauseIndex: 1 },
    ranked: [{ clauseIndex: 1, score: 20 - i }]
  }));
  // 실사용에서는 cpId가 유일하지만, 배치 분할 자체가 전량 보존되는지 확인한다.
  const batches = L.buildBatches(results, CHECKS, CLAUSES, 4);
  assert.deepStrictEqual(batches.map((x) => x.length), [4, 4, 1]);
});

test("normalizeResponse: 요청 후보 밖 조항과 잘못된 enum을 버림", () => {
  const items = L.buildBatch([
    { cpId: "A", coverage: "addressed", best: { clauseIndex: 1 }, ranked: [{ clauseIndex: 1, score: 40 }] },
  ], CHECKS, CLAUSES);
  const out = L.normalizeResponse({ model: "qwen3:4b", findings: [
    { check_id: "A", selected_clause_index: 1, relation: "direct", completeness: "complete", reason: "직접 규정" },
    { check_id: "A", selected_clause_index: 99, relation: "direct", completeness: "complete", reason: "오류" },
    { check_id: "X", selected_clause_index: 1, relation: "direct", completeness: "complete", reason: "오류" },
  ] }, items);
  assert.strictEqual(out.findings.length, 1);
  assert.strictEqual(out.findings[0].reason, "직접 규정");
});

test("health/review: 같은 출처 API를 사용하고 응답을 부착", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.indexOf("health") !== -1
      ? { available: true, model: "qwen3:4b" }
      : { model: "qwen3:4b", duration_ms: 10, findings: [
        { check_id: "A", selected_clause_index: 1, relation: "direct", completeness: "complete", reason: "직접" },
      ] } };
  };
  const loc = { protocol: "http:", hostname: "localhost" };
  assert.strictEqual((await L.health(fakeFetch, loc)).available, true);
  const items = L.buildBatch([
    { cpId: "A", coverage: "addressed", best: { clauseIndex: 1 }, ranked: [{ clauseIndex: 1, score: 40 }] },
  ], CHECKS, CLAUSES);
  const response = await L.review(fakeFetch, loc, items);
  const results = [{ cpId: "A" }];
  L.attach(results, response);
  assert.strictEqual(results[0].localLlm.relation, "direct");
  assert.deepStrictEqual(calls, ["/api/llm/health", "/api/llm/review"]);
});
