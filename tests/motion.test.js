"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Motion = require("../src/motion.js");

test("화면 효과 자동 설정은 시스템의 동작 줄이기를 따른다", () => {
  assert.equal(Motion.isReduced("auto", true), true);
  assert.equal(Motion.isReduced("auto", false), false);
});

test("효과 사용·줄임의 명시 선택은 시스템 설정보다 우선한다", () => {
  assert.equal(Motion.isReduced("full", true), false);
  assert.equal(Motion.isReduced("reduce", false), true);
});

test("잘못된 저장값은 자동 설정으로 복구한다", () => {
  assert.equal(Motion.normalize("unknown"), "auto");
  assert.match(Motion.status("unknown", true).label, /시스템 설정 감지/);
});
