"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const I = require("../src/integrity.js");
const S = require("../src/segmenter.js");

function run(text, opts) { return I.analyze(text, S.segmentContract(text), opts).items; }

test("존재하지 않는 내부 조항 인용을 찾는다", () => {
  const items = run("계약서\n제1조(목적)\n본 계약은 제8조에 따른다.\n제2조(기간)\n1년으로 한다.");
  assert.ok(items.some(x => x.rule_id === "REF-01" && x.reference_text.includes("제8조")));
});

test("존재하는 앞·뒤 조항 인용은 오류가 아니다", () => {
  const items = run("계약서\n제1조(목적)\n제2조에 따른다.\n제2조(기간)\n제1조의 업무를 1년간 수행한다.");
  assert.ok(!items.some(x => x.rule_id === "REF-01"));
});

test("법령명이 붙은 외부 조문은 내부 누락으로 보지 않는다", () => {
  const items = run("계약서\n제1조(준수)\n개인정보 보호법 제26조 및 민법 제390조에 따른다.\n제2조(기간)\n1년이다.");
  assert.ok(!items.some(x => x.rule_id === "REF-01"));
});

test("존재하지 않는 항과 중복 조 번호를 찾는다", () => {
  const items = run("계약서\n제1조(목적)\n제2조 제3항에 따른다.\n제2조(기간)\n① 1년이다.\n제2조(중복)\n다른 내용이다.");
  assert.ok(items.some(x => x.rule_id === "REF-02"));
  assert.ok(items.some(x => x.rule_id === "NUM-01"));
});

test("다음 각 호 뒤 목록이 없으면 구조 확인을 제안", () => {
  const items = run("계약서\n제1조(업무)\n다음 각 호의 업무를 수행한다.\n업무 내용은 별도 협의한다.\n제2조(기간)\n1년이다.");
  assert.ok(items.some(x => x.rule_id === "HIER-02"));
});

test("별첨 인용은 업로드된 부속서류가 있으면 경고하지 않는다", () => {
  const text = "계약서\n제1조(별첨)\n별첨 1에 따른다.\n제2조(기간)\n1년이다.";
  assert.ok(run(text).some(x => x.rule_id === "ATT-01"));
  assert.ok(!run(text, { subdocs: [{ name: "별첨 1 보안약정서" }] }).some(x => x.rule_id === "ATT-01"));
});

test("항 번호가 추출되지 않은 문서는 없는 항으로 단정하지 않는다", () => {
  const items = run("계약서\n제1조(목적)\n제2조 제3항에 따른다.\n제2조(기간)\n계약은 1년간 유효하다.");
  assert.ok(!items.some(x => x.rule_id === "REF-02"));
  assert.ok(items.some(x => x.rule_id === "REF-02U" && x.confidence === "medium"));
});

test("본문의 독립된 제1조 참조 조각은 중복 조항으로 판정하지 않는다", () => {
  const clauses = [
    { heading: "제1조(목적)", body: "계약 목적을 정한다.", index: 0 },
    { heading: "제1조", body: "", index: 1 }
  ];
  const items = I.analyze("제1조(목적)\n계약 목적을 정한다.\n제1조", clauses).items;
  assert.ok(!items.some(x => x.rule_id === "NUM-01"));
});

test("표제와 본문이 같은 줄이어도 항 구조를 인식한다", () => {
  const items = run("계약서\n제1조(목적) ① 제2조 제2항에 따른다.\n제2조(기간) ① 1년이다.\n② 갱신할 수 있다.");
  assert.ok(!items.some(x => x.rule_id === "REF-01" || x.rule_id === "REF-02"));
});

test("제N조 번호가 빠진 복수 표제는 개별 오류 대신 파싱 실패로 알린다", () => {
  const text = "계약서\n조(목적)\n목적을 정한다.\n조(기간)\n1년이다.";
  const items = I.analyze(text, S.segmentContract(text)).items;
  assert.ok(items.some(x => x.rule_id === "PARSE-01" && x.confidence === "high"));
  assert.ok(!items.some(x => x.rule_id === "NUM-01"));
});
