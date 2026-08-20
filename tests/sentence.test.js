"use strict";
const test = require("node:test");
const assert = require("node:assert");
const S = require("../src/sentence.js");

// ── 문장 분리 ──────────────────────────────────────────────────
test("splitSentences: '다.' 종결로 분리하고 날짜 표기는 쪼개지 않는다", () => {
  const t = "본 계약의 기간은 2026. 1. 1.부터 2026. 12. 31.까지로 한다. 기간 만료 1개월 전까지 이의가 없으면 갱신된다.";
  const s = S.splitSentences(t);
  assert.strictEqual(s.length, 2);
  assert.ok(s[0].indexOf("2026. 12. 31.까지로 한다.") !== -1, "날짜가 문장 안에 온전히 남아야 함");
});

test("splitSentences: 줄바꿈(항·호)은 항상 경계", () => {
  const s = S.splitSentences("① 갑은 대금을 지급한다\n② 을은 업무를 수행한다");
  assert.strictEqual(s.length, 2);
});

// ── 문장 성질 판정 ─────────────────────────────────────────────
test("isProviso/isDefinition/isBlank/isNegated", () => {
  assert.ok(S.isProviso("다만, 천재지변의 경우에는 그러하지 아니하다."));
  assert.ok(S.isDefinition("“계약기간”이란 본 계약의 효력이 존속하는 기간을 말한다."));
  assert.ok(S.isBlank("본 계약의 기간은 20  년   월   일부터로 한다."));
  assert.ok(S.isBlank("계약기간: ____ 부터"));
  assert.ok(S.isNegated("계약기간은 별도로 정하지 아니한다."));
  assert.ok(S.isNegated("을은 이를 제3자에게 양도할 수 없다."));
  assert.ok(!S.isNegated("계약기간은 1년으로 한다."));
  assert.ok(!S.isBlank("계약기간은 2026년 1월 1일부터 1년으로 한다."), "숫자가 채워진 날짜는 공란 아님");
});

// ── evaluate ───────────────────────────────────────────────────
const SPEC_TERM = { any_groups: [["계약기간", "계약의 기간", "유효기간"]], require: ["period", "date"] };

test("evaluate: 기간 어휘 + 구체 기간 + 긍정 종결 = 충족", () => {
  const r = S.evaluate("제6조(계약기간) 본 계약의 계약기간은 계약 체결일로부터 1년으로 한다.", SPEC_TERM);
  assert.ok(r.ok);
  assert.ok(r.sentence.indexOf("1년으로 한다") !== -1);
});

test("evaluate: 키워드만 있고 숫자가 없으면 미충족", () => {
  const r = S.evaluate("계약기간은 별도 합의로 정한다.", SPEC_TERM);
  assert.ok(!r.ok);
});

test("evaluate: 부정 종결·정의 문장·공란은 미충족", () => {
  assert.ok(!S.evaluate("계약기간은 1년으로 정하지 아니한다.", SPEC_TERM).ok);
  assert.ok(!S.evaluate("“계약기간”이란 1년의 기간을 말한다.", SPEC_TERM).ok, "정의 조항 오탐 차단");
  assert.ok(!S.evaluate("계약기간은 20  년  월  일부터 1년으로 한다.", SPEC_TERM).ok, "서식 공란");
});

test("evaluate: 요건은 문장 단위 — 키워드와 숫자가 다른 문장이면 미충족", () => {
  const r = S.evaluate("계약기간은 별도로 정한다. 준비 기간은 30일로 한다.", SPEC_TERM);
  assert.ok(!r.ok, "'계약기간' 문장엔 숫자가 없고 '30일' 문장엔 키워드가 없음");
});

test("evaluate: any_groups는 그룹 간 AND — 부가세+포함 문구", () => {
  const spec = { any_groups: [["부가가치세", "부가세"], ["포함", "별도"]] };
  assert.ok(S.evaluate("수수료는 부가가치세 별도 금액으로 한다.", spec).ok);
  assert.ok(!S.evaluate("수수료에는 부가가치세 관련 사항을 적용한다.", spec).ok);
});

test("evaluate: require 종류 — money/rate", () => {
  const money = { any_groups: [["수수료"]], require: ["money", "rate"] };
  assert.ok(S.evaluate("수수료는 건당 5,000원으로 한다.", money).ok);
  assert.ok(S.evaluate("수수료는 거래금액의 1.5%로 한다.", money).ok);
  assert.ok(!S.evaluate("수수료는 별표 기준에 따른다.", money).ok);
});
