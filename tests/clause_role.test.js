"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { parseTitle, clauseRole, normType, clauseSubjects } = require("../src/clause_role.js");

// ── parseTitle ──────────────────────────────────────────────
test("parseTitle: 정상 — 표제 괄호 내용을 추출한다", () => {
  assert.strictEqual(parseTitle("제5조(재위탁 금지)"), "재위탁 금지");
});

test("parseTitle: 공백 변형 — '제 N 조 (표제)' 형태도 처리한다", () => {
  assert.strictEqual(parseTitle("제 5 조 (목적)"), "목적");
});

test("parseTitle: 괄호 없으면 빈 문자열", () => {
  assert.strictEqual(parseTitle("제7조"), "");
});

test("parseTitle: segmenter 특수 heading '(전문)'/'(전체)'은 빈 문자열", () => {
  assert.strictEqual(parseTitle("(전문)"), "");
  assert.strictEqual(parseTitle("(전체)"), "");
});

// ── clauseRole ──────────────────────────────────────────────
test("clauseRole: 제1조(목적) → purpose/weak", () => {
  const r = clauseRole("제1조(목적)", "이 계약은 갑과 을의 업무위탁에 관한 사항을 정함을 목적으로 한다.");
  assert.strictEqual(r.role, "purpose");
  assert.strictEqual(r.weak, true);
});

test("clauseRole: 제5조(재위탁 금지) → general/!weak (실체 의무 조항)", () => {
  const r = clauseRole("제5조(재위탁 금지)", "을은 갑의 사전 서면 동의 없이 위탁받은 업무를 제3자에게 재위탁하여서는 아니 된다.");
  assert.strictEqual(r.role, "general");
  assert.strictEqual(r.weak, false);
});

test("clauseRole: 제3조(정의) → definition/weak", () => {
  const r = clauseRole("제3조(정의)", "이 계약에서 '수탁자'란 위탁업무를 수행하는 자를 말한다.");
  assert.strictEqual(r.role, "definition");
  assert.strictEqual(r.weak, true);
});

test("clauseRole: 제6조(계약기간) → term/weak", () => {
  const r = clauseRole("제6조(계약기간)", "이 계약의 유효기간은 계약체결일로부터 1년으로 한다.");
  assert.strictEqual(r.role, "term");
  assert.strictEqual(r.weak, true);
});

test("clauseRole: 완전합의 표제 → general/weak (순수 boilerplate)", () => {
  const r = clauseRole("제15조(완전합의)", "이 계약은 당사자 간 완전한 합의를 구성하며 종전의 합의를 대체한다.");
  assert.strictEqual(r.role, "general");
  assert.strictEqual(r.weak, true);
});

// 회귀 방지: 통지·비용부담은 실체 규제의무일 수 있어 weak 게이트 대상이 아님(스펙: weak는
// 목적·정의·전문·계약기간·완전합의 boilerplate 한정). general/weak=false 로 판정되어야 함.
test("clauseRole: 제10조(통지) → general/!weak (통지의무는 실체조항)", () => {
  const r = clauseRole("제10조(통지)", "을은 개인정보 유출 사실을 인지한 즉시 갑에게 통지하여야 한다.");
  assert.strictEqual(r.role, "general");
  assert.strictEqual(r.weak, false);
});

test("clauseRole: 제12조(비용부담) → general/!weak (비용부담은 실체조항)", () => {
  const r = clauseRole("제12조(비용부담)", "위탁업무 수행에 소요되는 비용은 을이 부담한다.");
  assert.strictEqual(r.role, "general");
  assert.strictEqual(r.weak, false);
});

test("clauseRole: 표제 없는 실체조항 → general/!weak (본문도 declaration 패턴 무매치)", () => {
  const r = clauseRole("제9조", "갑은 을에게 위탁 업무와 관련하여 발생한 손해를 배상하여야 한다.");
  assert.strictEqual(r.role, "general");
  assert.strictEqual(r.weak, false);
});

test("clauseRole: '(전문)' heading → preamble/weak", () => {
  const r = clauseRole("(전문)", "본 계약은 다음과 같은 목적 하에 체결되었다...");
  assert.strictEqual(r.role, "preamble");
  assert.strictEqual(r.weak, true);
});

test("clauseRole: '(전체)' heading (조항 분리 실패) → entire/weak", () => {
  const r = clauseRole("(전체)", "전체 계약서 원문 텍스트...");
  assert.strictEqual(r.role, "entire");
  assert.strictEqual(r.weak, true);
});

// ── normType ────────────────────────────────────────────────
test("normType: 금지", () => {
  assert.strictEqual(normType("을은 갑의 동의 없이 재위탁하여서는 아니 된다."), "금지");
});

test("normType: 의무", () => {
  assert.strictEqual(normType("을은 지체 없이 갑에게 통지하여야 한다."), "의무");
});

test("normType: 권한", () => {
  assert.strictEqual(normType("갑은 계약을 즉시 해지할 수 있다."), "권한");
});

test("normType: 선언", () => {
  assert.strictEqual(normType("'개인정보'란 생존하는 개인에 관한 정보를 말한다."), "선언");
});

test("normType: 해당 없으면 null", () => {
  assert.strictEqual(normType("특별한 규범 표지가 없는 서술."), null);
});

test("normType: 우선순위 — 금지와 의무 표현이 함께 있으면 금지가 우선", () => {
  const t = "재위탁하여서는 아니 된다. 다만 사전 통지의무가 있는 경우 통지하여야 한다.";
  assert.strictEqual(normType(t), "금지");
});

// 회귀(2026-07-08): '할 수 없다'·'하지 못한다'·'해서는 안' 형 금지 표현도 금지로 판정해야 함.
// 이 누락으로 샘플 제5조 "재위탁할 수 없다"가 null → CORE-07 자동확정이 review로 강등됐음.
test("normType: '할 수 없다' 형 금지 (재위탁할 수 없다)", () => {
  assert.strictEqual(normType("을은 갑의 동의 없이 재위탁할 수 없다."), "금지");
});

test("normType: '하지 못한다' 형 금지 (제공하지 못한다)", () => {
  assert.strictEqual(normType("을은 개인정보를 제3자에게 제공하지 못한다."), "금지");
});

test("normType: '할 수 없다'가 '할 수 있다'(권한)보다 우선 매칭된다", () => {
  // 금지 표현이 있으면 권한이 아니라 금지
  assert.strictEqual(normType("을은 재위탁할 수 없다."), "금지");
  // 순수 권한 표현은 여전히 권한
  assert.strictEqual(normType("갑은 계약을 즉시 해지할 수 있다."), "권한");
});

// ── 조항 주어 추출(11.6차) ───────────────────────────────────────
test("clauseSubjects: 항별 주어를 순서대로 수집", () => {
  const body = "① 집합투자업자는 신탁계약을 변경하여야 한다.\n② 수익자는 이의를 제기할 수 있다.";
  assert.deepStrictEqual(clauseSubjects(body), ["집합투자업자", "수익자"]);
});

test("clauseSubjects: 비인격 주어·문장부사는 제외", () => {
  assert.deepStrictEqual(clauseSubjects("다음 각 호의 사항은 별도로 정한다."), []);
  assert.deepStrictEqual(clauseSubjects("다만 그에 대하여는 별도 합의한다."), []);
});

test("clauseSubjects: 주어 없으면 빈 배열(게이트 비활성 신호)", () => {
  assert.deepStrictEqual(clauseSubjects(""), []);
  assert.deepStrictEqual(clauseSubjects("본 계약의 목적을 정한다."), []);
});
