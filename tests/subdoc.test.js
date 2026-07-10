"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const {
  analyze, buildModel, subDocCoverage,
} = require("../src/matcher.js");

// 픽스처: 재위탁·개인정보 관련 check (기존 matcher.test 패턴 축약)
const CHECK_REWI = {
  id: "CORE-07", module: "M-CORE", norm_type: "강행", absence_check: true, severity: "필수",
  check: "수탁자가 위탁자의 사전 동의 없이 재위탁하지 못하도록 하는 조항이 있는가",
  triggers: { keywords: ["재위탁", "사전 동의"] },
  sources: [{ law: "금융기관의 업무위탁 등에 관한 규정", article: "제3조", quote: "재위탁할 수 있다" }],
};
const CHECK_PRIV = {
  id: "PRIV-01", module: "M-CORE", norm_type: "강행", absence_check: true, severity: "필수",
  check: "개인정보 처리위탁 시 위탁 내용을 문서화하였는가",
  triggers: { keywords: ["개인정보", "문서화"] },
  sources: [{ law: "개인정보 보호법", article: "제26조", quote: "문서로 한다" }],
};
const DOC = { meta: { type_id: "outsourcing", modules: [{ id: "M-CORE", always_on: true }] },
  checkpoints: [CHECK_REWI, CHECK_PRIV] };

// 주 계약서: 재위탁만 있고 개인정보 문서화는 전혀 없음 → PRIV-01이 consider(필수 부재)
const MAIN = [
  { heading: "제1조 (재위탁 금지)", body: "을은 갑의 사전 동의 없이 재위탁하지 못한다.", index: 0 },
  { heading: "제2조 (기간)", body: "이 계약의 유효기간은 1년으로 한다.", index: 1 },
];
// 부속 서류(보안관리약정서): 개인정보 처리위탁 문서화가 여기 있음
const SUBDOC_CLAUSES = [
  { heading: "제1조 (개인정보 처리)", body: "개인정보 처리위탁의 내용을 문서로 정하고 위탁 내용을 문서화한다.", index: 0 },
];

test("주 계약서 분석: 개인정보 문서화(PRIV-01)가 consider로 뜬다", () => {
  const r = analyze(MAIN, [DOC], ["M-CORE"]);
  const priv = r.results.find((x) => x.cpId === "PRIV-01");
  assert.strictEqual(priv.coverage, "consider");
});

test("subDocCoverage: 부속서류가 consider 필수항목을 커버하면 반환", () => {
  const r = analyze(MAIN, [DOC], ["M-CORE"]);
  const considerCps = r.results.filter((x) => x.coverage === "consider")
    .map((x) => r.checkpoints.find((c) => c.id === x.cpId));
  const model = buildModel([DOC], ["M-CORE"]);
  const cov = subDocCoverage(considerCps, [{ name: "보안관리약정서.pdf", clauses: SUBDOC_CLAUSES }], model);
  // PRIV-01이 부속서류에서 커버됨
  assert.ok(cov["PRIV-01"]);
  assert.strictEqual(cov["PRIV-01"].docName, "보안관리약정서.pdf");
  assert.ok(cov["PRIV-01"].score > 0);
});

test("subDocCoverage: 부속서류에 없는 항목은 커버 안 됨", () => {
  const r = analyze(MAIN, [DOC], ["M-CORE"]);
  const model = buildModel([DOC], ["M-CORE"]);
  // 재위탁 검토항목을 관계없는 부속서류(휴가 규정)로는 커버 못함
  const cov = subDocCoverage([CHECK_REWI], [{ name: "무관.pdf", clauses: [
    { heading: "제1조", body: "직원 휴가는 연 15일로 한다.", index: 0 }] }], model);
  assert.ok(!cov["CORE-07"]);
});

test("subDocCoverage: 서브 서류 없으면 빈 객체", () => {
  const model = buildModel([DOC], ["M-CORE"]);
  assert.deepStrictEqual(subDocCoverage([CHECK_PRIV], [], model), {});
});

test("subDocCoverage: 여러 서브 서류 중 커버한 서류명 반환", () => {
  const model = buildModel([DOC], ["M-CORE"]);
  const cov = subDocCoverage([CHECK_PRIV], [
    { name: "무관.pdf", clauses: [{ heading: "제1조", body: "휴가 규정.", index: 0 }] },
    { name: "보안관리약정서.hwp", clauses: SUBDOC_CLAUSES },
  ], model);
  assert.strictEqual(cov["PRIV-01"].docName, "보안관리약정서.hwp");
});
