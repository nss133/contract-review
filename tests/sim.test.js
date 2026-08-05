"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const Sim = require("../src/sim.js");

test("preprocess: 불용어 제거 및 어미 표준화", () => {
  const out = Sim.preprocess("다음 각 호의 사항을 신고하여야 한다");
  assert.strictEqual(out, "사항을 신고해야 한다");
});

test("preprocess: 전각숫자 정규화 및 제N호 제거", () => {
  const out = Sim.preprocess("제3호 계약 기간은 ３０개월이다");
  assert.strictEqual(out, "계약 기간은 30개월이다");
});

test("charWb: 2글자 단어의 ngram 개수와 경계", () => {
  const grams = Sim.charWb("가나", 2, 4);
  // 패딩 " 가나 "(길이4) 기준 n=2:3개, n=3:2개, n=4:1개 = 총 6개
  assert.strictEqual(grams.length, 6);
  assert.deepStrictEqual(grams, [" 가", "가나", "나 ", " 가나", "가나 ", " 가나 "]);
});

test("charWb: 1글자 단어는 단어보다 큰 n에서 중단한다", () => {
  const grams = Sim.charWb("가", 2, 5);
  // 패딩 " 가 "(길이3) 기준 n=2:2개, n=3:1개. n=4,5는 off===0이라 진입 즉시 중단
  assert.deepStrictEqual(grams, [" 가", "가 ", " 가 "]);
});

test("buildIdf+tfidfVec: 벡터가 l2 정규화되어 자기 코사인이 1이다", () => {
  const docs = ["재위탁을 하는 경우 사전 동의를 받아야 한다", "손해배상의 범위는 통상손해로 한정한다"].map(Sim.preprocess);
  const model = Sim.buildIdf(docs);
  const vec = Sim.tfidfVec(docs[0], model);
  assert.ok(Sim.cosine(vec, vec) > 0.99);
});

test("tfidfVec+cosine: 동일 문장의 코사인은 ≈1이다", () => {
  const docs = ["재위탁을 하는 경우 사전 동의를 받아야 한다", "손해배상의 범위는 통상손해로 한정한다"].map(Sim.preprocess);
  const model = Sim.buildIdf(docs);
  const vecA = Sim.tfidfVec(docs[0], model);
  const vecACopy = Sim.tfidfVec(docs[0], model);
  assert.ok(Sim.cosine(vecA, vecACopy) > 0.99);
});

test("tfidfVec+cosine: 무관한 문장은 코사인이 낮다(<0.3)", () => {
  const raw = [
    "수탁자는 재위탁을 하는 경우 위탁자의 사전 서면 동의를 받아야 한다",
    "손해배상의 범위는 통상손해로 한정한다"
  ];
  const docs = raw.map(Sim.preprocess);
  const model = Sim.buildIdf(docs);
  const vecs = docs.map((d) => Sim.tfidfVec(d, model));
  assert.ok(Sim.cosine(vecs[0], vecs[1]) < 0.3);
});

test("tfidfVec+cosine: 어미 변형된 유사 문장은 무관 문장보다 코사인이 높다", () => {
  const raw = [
    "수탁자는 재위탁을 하는 경우 위탁자의 사전 서면 동의를 받아야 한다",
    "수탁자가 재위탁을 하고자 하는 경우 위탁자로부터 사전 서면 동의를 받아야 한다",
    "손해배상의 범위는 통상손해로 한정한다"
  ];
  const docs = raw.map(Sim.preprocess);
  const model = Sim.buildIdf(docs);
  const vecs = docs.map((d) => Sim.tfidfVec(d, model));
  const simCos = Sim.cosine(vecs[0], vecs[1]);
  const unrelatedCos = Sim.cosine(vecs[0], vecs[2]);
  assert.ok(simCos > unrelatedCos);
  assert.ok(unrelatedCos < 0.3);
});

test("jaccard: 교집합/합집합을 정확히 계산한다", () => {
  const j = Sim.jaccard("재위탁 금지 조항", "재위탁 승인 필요");
  // 교집합 {재위탁}=1, 합집합 3+3-1=5 -> 0.2
  assert.strictEqual(j, 0.2);
});

test("jaccard: 빈 문자열/키워드 없음에도 안전하게 0을 반환한다", () => {
  assert.strictEqual(Sim.jaccard("", "재위탁 조항"), 0);
  assert.strictEqual(Sim.jaccard("", ""), 0);
  assert.strictEqual(Sim.jaccard("a b c", "d e f"), 0); // 2글자+ 한글 키워드 없음
});

// ── 이형어 정규화(11.7차) ────────────────────────────────────────
test("preprocess: 기밀↔비밀 이형어를 통일한다", () => {
  // 실사고(2026-08-05): "제8조(기밀유지)" 조항에 '비밀정보' 체크가 토큰 겹침 0으로 안 붙음.
  assert.strictEqual(Sim.preprocess("기밀유지 의무"), Sim.preprocess("비밀유지 의무"));
  assert.strictEqual(Sim.preprocess("기밀정보를 누설"), Sim.preprocess("비밀정보를 누설"));
  assert.strictEqual(Sim.preprocess("비밀보장 약정"), Sim.preprocess("비밀유지 약정"));
});

test("preprocess: 법적 효과가 다른 낱말은 통합하지 않는다", () => {
  // 해제↔해지(소급효), 배상↔보상(위법성), 협의↔합의(구속력)는 서로 다른 개념 — 합치면 안 됨.
  assert.notStrictEqual(Sim.preprocess("계약을 해제한다"), Sim.preprocess("계약을 해지한다"));
  assert.notStrictEqual(Sim.preprocess("손해를 배상한다"), Sim.preprocess("손해를 보상한다"));
  assert.notStrictEqual(Sim.preprocess("협의하여 정한다"), Sim.preprocess("합의하여 정한다"));
});
