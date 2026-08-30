"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const LegalConstraints = require("../src/legal_constraints.js");

const REGISTRY = { rules: [
  { id: "SOL", requires: ["event", "solicitation"], affects_type: false,
    signals: { event: ["행사", "대관"], solicitation: ["가입 권유", "보험모집"] },
    scope_effects: { financial_outsourcing: "non_applicable" } },
  { id: "BEN", requires: ["event", "solicitation", "benefit"], affects_type: false,
    signals: { event: ["행사"], solicitation: ["가입 권유"], benefit: ["경품"] },
    supersedes: ["SOL"], scope_effects: { financial_outsourcing: "non_applicable" } }
] };

test("일반 행사대행은 준법경보가 없다", () => {
  assert.deepStrictEqual(LegalConstraints.assess("행사 대관과 현장 운영", REGISTRY, {}), []);
});

test("행사와 가입 권유가 함께 있으면 유형과 분리된 준법경보를 만든다", () => {
  const out = LegalConstraints.assess("고객 행사에서 가입 권유를 한다", REGISTRY, {});
  assert.strictEqual(out[0].id, "SOL");
  assert.strictEqual(out[0].affects_type, false);
  assert.strictEqual(out[0].scope_effects.financial_outsourcing, "non_applicable");
});

test("경품까지 있으면 특별이익 경보가 일반 모집경보를 대체한다", () => {
  const out = LegalConstraints.assess("고객 행사에서 가입 권유를 하고 경품을 지급한다", REGISTRY, {});
  assert.deepStrictEqual(out.map(x => x.id), ["BEN"]);
});

test("명시적 금지 문언은 양성 신호에서 제외한다", () => {
  const out = LegalConstraints.assess("행사에서 가입 권유를 하지 않는다", REGISTRY, {});
  assert.deepStrictEqual(out, []);
});
