"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("../src/formal.js");

function byId(rs, id) { return rs.filter(function (r) { return r.id === id; })[0]; }

test("FORM-NAME: '미래에셋생명' 뒤 '보험' 누락 → warn", () => {
  const rs = F.checkFormal("갑 미래에셋생명㈜은 … 2026년 1월 2일 … ㈜상대");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "warn");
});

test("FORM-NAME: 정식 상호 → pass", () => {
  const rs = F.checkFormal("갑 미래에셋생명보험주식회사는 … 2026년 1월 2일 … ㈜상대");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "pass");
});

test("FORM-BLANK: OOO·밑줄·0000.00.00·공란 일자 → warn(검출 내역 포함)", () => {
  const rs = F.checkFormal("을: OOO ___ 기간 0000.00.00 … 20  년  월  일");
  const b = byId(rs, "FORM-BLANK");
  assert.strictEqual(b.status, "warn");
  assert.ok(b.detail.includes("OOO"));
});

test("FORM-BLANK: 기입 완료 본문 → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험㈜와 한빛시스템 주식회사는 2026년 1월 2일 체결한다");
  assert.strictEqual(byId(rs, "FORM-BLANK").status, "pass");
});

test("FORM-DATE: 완성 일자 없으면 warn", () => {
  const rs = F.checkFormal("계약을 체결한다. 이상.");
  assert.strictEqual(byId(rs, "FORM-DATE").status, "warn");
});

test("FORM-CORP: 법인 형태 표기 부재 → warn", () => {
  const rs = F.checkFormal("갑 홍길동과 을 김철수는 2026년 1월 2일 계약한다");
  assert.strictEqual(byId(rs, "FORM-CORP").status, "warn");
});

test("FORM-NAME: 별칭 선언('이하 \"미래에셋생명\"이라 한다') 후 stem 다수 등장 → pass", () => {
  const text = 'OOOOO (이하 "제휴사" 이라 한다)와 미래에셋생명보험 주식회사 (이하 "미래에셋생명"이라 한다)는 상호신뢰를 바탕으로 계약한다. ' +
    '"미래에셋생명"이 "제휴사"를 도와 광고를 한다. "미래에셋생명" 상품의 광고. ' +
    '2026년 1월 2일';
  const rs = F.checkFormal(text);
  assert.strictEqual(byId(rs, "FORM-NAME").status, "pass");
});

test("FORM-NAME: 전치형 법인표기('주식회사 미래에셋생명보험') → pass", () => {
  const rs = F.checkFormal("주식회사 미래에셋생명보험(이하 '갑')과 을은 2026년 1월 2일 계약한다");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "pass");
});

test("FORM-NAME: 정식 상호 전무 + stem만 존재('미래에셋생명㈜') → warn(여전히 오기 검출)", () => {
  const rs = F.checkFormal("갑 미래에셋생명㈜은 …를 한다. 미래에셋생명㈜이 … 2026년 1월 2일");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "warn");
});
