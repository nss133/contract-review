"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const Goldset = require("../src/goldset.js");
const { segmentContract } = require("../src/segmenter.js");
const { detectType, pickType, suggestModules, analyze } = require("../src/matcher.js");

// 최소 CR 픽스처 — outsourcing 유형 + 공통 무모듈 check 1개
const CHECK_REWI = {
  id: "CORE-07", module: "M-CORE", norm_type: "임의", absence_check: true, severity: "권장",
  check: "재위탁 사전 동의 조항이 있는가",
  triggers: { keywords: ["재위탁", "사전 동의"] }, sources: [],
};
const CHECK_CMN = {
  id: "CMN-01", norm_type: "실무", absence_check: false, severity: "참고",
  check: "당사자가 특정되어 있는가", triggers: { keywords: ["갑", "을"] }, sources: [],
};
const CR = {
  common: { meta: { type_id: "common", modules: [] }, checks: [CHECK_CMN] },
  types: [{
    meta: {
      type_id: "outsourcing", type_name: "업무위탁",
      detect_keywords: ["위탁", "수탁"],
      modules: [{ id: "M-CORE", name: "기본", always_on: true, suggest_keywords: [] }],
    },
    checks: [CHECK_REWI],
  }],
};
const ENV = { CR, segmentContract, detectType, pickType, suggestModules, analyze };
const TEXT = "업무위탁계약서\n제1조(목적) 갑은 을에게 업무를 위탁한다.\n제2조(재위탁) 을은 갑의 사전 동의 없이 재위탁할 수 없다.";

test("buildCase: 현재 분석 상태를 기대값으로 스냅샷한다", () => {
  const c = Goldset.buildCase({
    text: TEXT, typeId: "outsourcing", autoDetected: "outsourcing",
    activeModules: ["M-CORE"], date: "2026-07-15", hash: "h1", checksCount: 2,
    results: [
      { cpId: "CORE-07", coverage: "addressed" },
      { cpId: "CMN-01", coverage: "quiet" },
    ],
  });
  assert.strictEqual(c.format, "cr-goldset-case-v1");
  assert.strictEqual(c.expect.detected, "outsourcing");
  assert.deepStrictEqual(c.expect.addressed, ["CORE-07"]);
  assert.deepStrictEqual(c.expect.consider, []);
  assert.deepStrictEqual(c.expect.verify, []);
  assert.ok(c.text.indexOf("재위탁") !== -1); // 본문은 케이스 안(폐쇄망 상주)엔 포함
});

test("runCase→diffCase: 동일 지식이면 통과", () => {
  const c = Goldset.buildCase({
    text: TEXT, typeId: "outsourcing", activeModules: ["M-CORE"], date: "d", hash: "h",
    results: Goldset.runCase({ text: TEXT, expect: {} }, ENV).addressed
      .map((id) => ({ cpId: id, coverage: "addressed" })),
  });
  const obs = Goldset.runCase(c, ENV);
  const d = Goldset.diffCase(c, obs);
  assert.strictEqual(d.detectOk, true);
  assert.strictEqual(d.status, "통과");
});

test("diffCase: 유형 감지 불일치는 실패(경성)", () => {
  const c = { id: "c1", expect: { detected: "nda", activeModules: [], consider: [], addressed: [] } };
  const d = Goldset.diffCase(c, { detected: "outsourcing", activeModules: [], consider: [], addressed: [] });
  assert.strictEqual(d.status, "실패");
  assert.strictEqual(d.detectOk, false);
});

test("diffCase: 부재알람 증감은 변화(연성) — 지식 진화 허용", () => {
  const c = { id: "c2", expect: { detected: "outsourcing", activeModules: [], consider: ["A-1"], addressed: [] } };
  const d = Goldset.diffCase(c, { detected: "outsourcing", activeModules: [], consider: ["A-1", "B-2"], addressed: [] });
  assert.strictEqual(d.status, "변화");
  assert.deepStrictEqual(d.consider.added, ["B-2"]);
});

test("diffCase: 확인권장 증감을 별도 추적하고 구 케이스는 하위호환", () => {
  const modern = { id: "c3", expect: { detected: "outsourcing", activeModules: [],
    consider: [], verify: ["A-1"], addressed: [] } };
  const obs = { detected: "outsourcing", activeModules: [], consider: [],
    verify: ["A-1", "B-2"], addressed: [] };
  const d = Goldset.diffCase(modern, obs);
  assert.strictEqual(d.status, "변화");
  assert.deepStrictEqual(d.verify.added, ["B-2"]);

  const legacy = { id: "old", expect: { detected: "outsourcing", activeModules: [],
    consider: [], addressed: [] } };
  assert.strictEqual(Goldset.diffCase(legacy, obs).status, "통과");
});

test("summaryText: 반출 요약에 계약 본문이 포함되지 않는다", () => {
  const c = Goldset.buildCase({
    text: TEXT, typeId: "nda", activeModules: [], date: "d", hash: "h", results: [],
  });
  const d = Goldset.diffCase(c, Goldset.runCase(c, ENV));
  const s = Goldset.summaryText([d], { checksCount: 2, date: "2026-07-15" });
  assert.ok(s.indexOf("실패") !== -1);           // 감지 불일치 보고는 있고
  assert.ok(s.indexOf("재위탁") === -1);          // 본문 문언은 없다
  assert.ok(s.indexOf("갑은 을에게") === -1);
});
