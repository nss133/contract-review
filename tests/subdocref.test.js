"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const M = require("../src/matcher.js");

const DEFS = [{
  id: "SUBDOC-PII", title: "개인(신용)정보 보안관리약정서",
  ref_signals: ["보안관리약정서", "보안관리 약정", "개인(신용)정보보안관리약정"],
  covers: ["PRIV-02", "PRIV-03"],
}];

test("detectSubdocRefs: 참조 문구 감지 + 주변 quote", () => {
  const text = "제13조(별첨) 본 계약의 별첨으로 개인(신용)정보 보안관리약정서를 체결하여 계약의 일부로 한다.";
  const refs = M.detectSubdocRefs(text, DEFS);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].id, "SUBDOC-PII");
  assert.ok(refs[0].quote.includes("보안관리약정서"));
  assert.deepStrictEqual(refs[0].covers, ["PRIV-02", "PRIV-03"]);
});

test("detectSubdocRefs: 참조 없으면 빈 배열", () => {
  assert.deepStrictEqual(M.detectSubdocRefs("일반 위탁계약 본문", DEFS), []);
});

test("detectSubdocRefs: 한 서류는 첫 신호에서 1회만", () => {
  const text = "보안관리약정서… 보안관리 약정…";
  assert.strictEqual(M.detectSubdocRefs(text, DEFS).length, 1);
});
