"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const Scope = require("../src/scope_assessment.js");
const { suggestModules } = require("../src/matcher.js");

const CONFIG = {
  label: "금융업무위탁 규정", module_id: "X-FINOUT", check_source_type: "outsourcing",
  signals: {
    non_applicable_contract: ["보험대리점", "보험설계사", "GA", "모집위탁", "신탁계약"],
    financial_business: ["보험 상담", "보험상품 설명", "가입 권유", "보험금 청구", "보험금 심사"],
    continuous_use: ["상시", "매월", "1년", "콜센터"],
    one_off: ["단건", "1회", "행사 종료", "정산 완료일까지"],
    simple_backoffice: ["행사 대행", "행사 운영", "대관", "케이터링", "직원연수"]
  }
};

function assess(text, answers) { return Scope.assessFinancialOutsourcing(text, CONFIG, answers); }

test("단건 행사 운영은 금융업무위탁 규정 비적용", () => {
  const out = assess("단건 행사 대행으로 대관과 케이터링을 제공하고 행사 종료 후 정산한다.");
  assert.strictEqual(out.status, "non_applicable");
  assert.strictEqual(out.factors.continuous_use.value, "no");
  assert.strictEqual(out.factors.simple_backoffice_exclusion.value, "yes");
});

test("상시 보험상담 콜센터는 적용", () => {
  const out = assess("보험 상담 콜센터를 1년 동안 상시 운영하고 매월 실적을 보고한다.");
  assert.strictEqual(out.status, "applicable");
});

test("보험대리점 위촉은 금융업무위탁 규정 비적용", () => {
  assert.strictEqual(assess("보험대리점 GA 위촉계약").status, "non_applicable");
});

test("행사 실행과 보험상품 설명이 섞인 드문 조합은 일반 업무위탁이 아닌 별도 준법경보로 분리", () => {
  const out = Scope.assessFinancialOutsourcing(
    "1회 행사 운영과 대관, 보험상품 설명 및 가입 권유를 수행한다.", CONFIG, {},
    { scopeEffects: { financial_outsourcing: "non_applicable" } });
  assert.strictEqual(out.status, "non_applicable");
  assert.strictEqual(out.confidence, "medium");
});

test("제목과 파일명도 자동 적용범위 판정의 입력으로 사용", () => {
  const out = Scope.assessFinancialOutsourcing("장소와 식사를 준비한다.", CONFIG, {},
    { docTitle: "단건 행사 대행계약서", fileName: "고객행사_대관.docx" });
  assert.strictEqual(out.status, "non_applicable");
  assert.ok(out.input_sources.includes("제목"));
  assert.ok(out.input_sources.includes("파일명"));
});

test("행사 참가자 정보가 언급돼도 금융업무 신호가 없으면 비적용", () => {
  const out = assess("단건 행사 대행사가 참가자 명단을 받아 대관과 식사를 준비하고 정산 완료일까지 처리한다.");
  assert.strictEqual(out.status, "non_applicable");
});

test("사람의 요소별 판단은 문서 자동판정보다 우선", () => {
  const out = assess("보험 상담 콜센터를 1년간 상시 운영한다.", { financial_business_purpose: "no" });
  assert.strictEqual(out.status, "non_applicable");
  assert.strictEqual(out.factors.financial_business_purpose.source, "manual");
});

test("scope 상태가 X-FINOUT 모듈 활성·질문을 통제", () => {
  const modules = [{ id: "X-FINOUT", always_on: false, scope_rule: "financial_outsourcing",
    screening_question: "적용 여부?" }];
  assert.deepStrictEqual(suggestModules("", modules, { scopeAssessments: {
    financial_outsourcing: { status: "applicable" }
  } }), { on: ["X-FINOUT"], ask: [] });
  assert.deepStrictEqual(suggestModules("", modules, { scopeAssessments: {
    financial_outsourcing: { status: "non_applicable" }
  } }), { on: [], ask: [] });
  assert.deepStrictEqual(suggestModules("", modules, { scopeAssessments: {
    financial_outsourcing: { status: "needs_confirmation" }
  } }), { on: [], ask: ["X-FINOUT"] });
});
