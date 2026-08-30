"use strict";
const test = require("node:test");
const assert = require("node:assert");
const A = require("../src/action_router");

test("반영 기준이 없는 법령 체크는 계약 필수로 추정하지 않고 확인 대상으로 안내한다", () => {
  const out = A.route({ basis: "statute" }, { cpId: "X", coverage: "consider" }, {});
  assert.equal(out.requirement, "unclassified");
  assert.equal(out.action, "hold");
  assert.equal(out.label, "계약서 반영 여부 확인");
});

test("실무 체크는 기본적으로 회사 유불리 검토로 안내한다", () => {
  const out = A.route({ basis: "practice" }, { cpId: "X", coverage: "verify" }, {});
  assert.equal(out.requirement, "recommended");
  assert.equal(out.action, "negotiate");
  assert.equal(out.label, "회사 유불리 검토");
  assert.equal(A.requiresDecision(out), false);
});

test("일부 문구만 찾은 경우에는 반영 기준이 아니라 문구 충분성을 묻는다", () => {
  const cp = { contract_requirement: "express", text_effect: "required_present", implementation_channel: "contract" };
  const out = A.route(cp, { cpId: "X", coverage: "verify" }, {});
  assert.equal(out.action, "hold");
  assert.equal(out.label, "현재 문구로 충분한지 확인");
});

test("계약 명시 필요 항목은 부재 시 수정, 확인 시 조치 없음이다", () => {
  const cp = { contract_requirement: "express", text_effect: "required_present", implementation_channel: "contract" };
  assert.equal(A.route(cp, { cpId: "X", coverage: "consider" }, {}).action, "add_or_modify");
  assert.equal(A.route(cp, { cpId: "X", coverage: "addressed" }, {}).action, "no_action");
});

test("금지 문구는 발견될 때만 삭제·수정 대상으로 라우팅한다", () => {
  const cp = { contract_requirement: "none", text_effect: "required_absent", implementation_channel: "contract" };
  assert.equal(A.route(cp, { cpId: "X", coverage: "addressed" }, {}).action, "remove");
  assert.equal(A.route(cp, { cpId: "X", coverage: "quiet" }, {}).action, "no_action");
});

test("계약 밖 이행항목은 부속서류 후보만으로 완료하지 않고 사람 확인 후 조치 없음이다", () => {
  const cp = { contract_requirement: "none", text_effect: "none", implementation_channel: "standard_subdoc" };
  assert.equal(A.route(cp, { cpId: "X", coverage: "quiet" }, {}).action, "verify_elsewhere");
  assert.equal(A.route(cp, { cpId: "X", coverage: "consider" },
    { subdoc_coverage: { X: { docName: "보안약정" } } }).action, "verify_elsewhere");
  assert.equal(A.route(cp, { cpId: "X", coverage: "consider" }, {
    subdoc_coverage: { X: { docName: "보안약정" } }, confirmed_subdoc_checks: { X: true }
  }).action, "no_action");
});

test("계약서의 약정서 참조도 체결 확인 전에는 별도 자료 확인으로 남긴다", () => {
  const cp = { contract_requirement: "none", text_effect: "none", implementation_channel: "standard_subdoc" };
  const candidate = A.route(cp, { cpId: "X", coverage: "consider" },
    { ref_coverage: { X: { title: "보안약정", signal: "별도 체결" } } });
  assert.equal(candidate.evidence_state, "external_unknown");
  assert.equal(candidate.action, "verify_elsewhere");
});
