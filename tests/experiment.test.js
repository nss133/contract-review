"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const Experiment = require("../src/experiment.js");

const input = {
  documentId: "DOC-1", contractHash: "cr-1", typeId: "outsourcing", generated: "2026-08-06",
  results: [
    { cpId: "A", coverage: "addressed", best: { clauseIndex: 1 }, ranked: [
      { clauseIndex: 1, score: 30 }, { clauseIndex: 2, score: 20 }
    ], localLlm: { selected_clause_index: 2, relation: "direct", completeness: "complete" } },
    { cpId: "B", coverage: "verify", best: { clauseIndex: 2 }, ranked: [
      { clauseIndex: 2, score: 19 }
    ], localLlm: { selected_clause_index: 2, relation: "reference_only", completeness: "complete" } }
  ],
  checkpoints: [{ id: "A", check: "직접 조항" }, { id: "B", check: "참조 조항" }],
  clauses: [{ index: 1, heading: "제1조", body: "본문1" }, { index: 2, heading: "제2조", body: "본문2" }]
};

test("buildPredictions: 규칙과 direct Hybrid 예측을 분리한다", () => {
  const p = Experiment.buildPredictions(input);
  assert.strictEqual(p.format, "cr-matching-predictions-v1");
  assert.strictEqual(p.items[0].rule_clause_index, 1);
  assert.strictEqual(p.items[0].hybrid_clause_index, 2);
  assert.strictEqual(p.items[1].hybrid_clause_index, null);
  assert.strictEqual(p.items[0].candidates.length, 2);
});

test("buildGoldTemplate: 예측을 노출하지 않는 블라인드 라벨 형식", () => {
  const g = Experiment.buildGoldTemplate(input);
  assert.strictEqual(g.format, "cr-matching-gold-v1");
  assert.strictEqual(g.meta.blinded, true);
  assert.strictEqual(g.labels[0].applicable, null);
  assert.strictEqual(Object.hasOwn(g.labels[0], "rule_clause_index"), false);
  assert.strictEqual(g.clauses[1].body, "본문2");
});

test("scoreDocument: 규칙 오류를 Hybrid가 고친 쌍대 결과를 계산", () => {
  const p = Experiment.buildPredictions(input);
  const g = Experiment.buildGoldTemplate(input);
  g.labels[0].applicable = true;
  g.labels[0].direct_clause_indices = [2];
  g.labels[1].applicable = true;
  g.labels[1].reference_clause_indices = [2];
  const rows = Experiment.scoreDocument(p, g);
  const summary = Experiment.summarize(rows);
  assert.strictEqual(summary.n, 2);
  assert.strictEqual(summary.improved, 2);
  assert.strictEqual(summary.harmed, 0);
  assert.strictEqual(summary.rule_recall_at_3, 1);
  assert.strictEqual(summary.baseline_reference_false_positive, 1);
  assert.strictEqual(summary.hybrid_reference_false_positive, 0);
});
