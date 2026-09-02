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

test("본문 제1조와 부칙 제1조는 서로 다른 번호 영역으로 구분한다", () => {
  const text = "계약서\n제1조(목적)\n계약의 목적을 정한다.\n제2조(기간)\n1년으로 한다.\n부칙\n제1조(시행일)\n이 계약은 체결일부터 시행한다.";
  const items = run(text);
  assert.ok(!items.some(x => x.rule_id === "NUM-01"));
});

test("같은 본문 영역의 실제 중복 조 번호는 계속 찾는다", () => {
  const text = "계약서\n제1조(목적)\n계약의 목적을 정한다.\n제1조(범위)\n업무 범위를 정한다.";
  const items = run(text);
  assert.ok(items.some(x => x.rule_id === "NUM-01"));
});

test("본문 전체가 중복 추출되면 조 번호 오류 대신 추출 품질 신호 하나를 낸다", () => {
  const once = "제1조(목적)\n계약의 목적과 업무 범위를 명확하게 정한다.\n제2조(기간)\n계약기간은 체결일부터 1년으로 하고 합의로 갱신한다.\n제3조(책임)\n당사자는 계약상 의무 위반으로 발생한 손해를 배상한다.";
  const items = run("계약서\n" + once + "\n" + once);
  assert.ok(items.some(x => x.rule_id === "PARSE-DUP" && x.scope === "contract"));
  assert.ok(!items.some(x => x.rule_id === "NUM-01"));
});

test("괄호 숫자 항 표지가 있으면 해당 항의 존재를 인식한다", () => {
  const items = run("계약서\n제1조(인용)\n제2조 제3항에 따른다.\n제2조(기간)\n(1) 1년으로 한다.\n(2) 합의로 갱신한다.\n(3) 갱신 기간은 1년이다.");
  assert.ok(!items.some(x => x.rule_id === "REF-02" || x.rule_id === "REF-02U"));
});

test("1)·1. 표지는 존재 번호는 인정하고 누락은 고확신으로 단정하지 않는다", () => {
  const present = run("계약서\n제1조(인용)\n제2조 제3항에 따른다.\n제2조(기간)\n1) 최초 기간\n2) 갱신 기간\n3) 종료 기간");
  assert.ok(!present.some(x => x.rule_id === "REF-02" || x.rule_id === "REF-02U"));
  const uncertain = run("계약서\n제1조(인용)\n제2조 제4항에 따른다.\n제2조(기간)\n1. 최초 기간\n2. 갱신 기간\n3. 종료 기간");
  assert.ok(!uncertain.some(x => x.rule_id === "REF-02"));
  assert.ok(uncertain.some(x => x.rule_id === "REF-02U"));
});
