"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const Evidence = require("../src/evidence.js");

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

test("evidenceSnippet: triggers.keywords 겹침 발견 시 주변 발췌 + mark", () => {
  var cp = { check: "지연 시 배상 규정 확인", triggers: { keywords: ["지체상금"] } };
  var clause = {
    heading: "제12조(하자보수서비스)",
    body: "회사는 장애발생 신고 접수 후 24시간 이내 조치하며, 미조치 시 지체상금을 부과할 수 있다."
  };
  var r = Evidence.evidenceSnippet(cp, clause, esc);
  assert.strictEqual(r.heading, "제12조(하자보수서비스)");
  assert.ok(r.snippet.indexOf("<mark>지체상금</mark>") !== -1, r.snippet);
});

test("evidenceSnippet: 겹침 없으면 body 앞부분 폴백", () => {
  var cp = { check: "전혀 관계없는 질문", triggers: { keywords: ["존재하지않는어휘"] } };
  var clause = { heading: "제1조", body: "가나다라마바사".repeat(30) };
  var r = Evidence.evidenceSnippet(cp, clause, esc);
  assert.ok(r.snippet.indexOf("<mark>") === -1);
  assert.ok(r.snippet.length > 0);
});

test("evidenceSnippet: XSS 이스케이프 — mark 삽입 전 esc 적용", () => {
  var cp = { check: "q", triggers: { keywords: ["<script>"] } };
  var clause = { heading: "h", body: "본문<script>alert(1)</script>끝" };
  var r = Evidence.evidenceSnippet(cp, clause, esc);
  assert.ok(r.snippet.indexOf("<script>alert") === -1, r.snippet); // 실제 태그로 남으면 안 됨
  assert.ok(r.snippet.indexOf("&lt;script&gt;") !== -1, r.snippet);
});

test("evidenceSnippet: clause 없으면 null", () => {
  var cp = { check: "q", triggers: { keywords: ["x"] } };
  assert.strictEqual(Evidence.evidenceSnippet(cp, null, esc), null);
});

test("checkTerms: triggers.keywords 없으면 check 텍스트 어휘로 폴백", () => {
  var cp = { check: "지연손해금 이율은 얼마인가" };
  var terms = Evidence.checkTerms(cp);
  assert.ok(terms.indexOf("지연손해금") !== -1 || terms.indexOf("이율") !== -1, terms.join(","));
});
