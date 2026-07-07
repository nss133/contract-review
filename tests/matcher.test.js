"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { detectType, suggestModules, analyze } = require("../src/matcher.js");

const TYPES = [
  { meta: { type_id: "outsourcing", detect_keywords: ["위탁", "수탁"] }, checkpoints: [] },
  { meta: { type_id: "nda", detect_keywords: ["비밀유지"] }, checkpoints: [] },
];

const OUT_DOC = {
  meta: {
    type_id: "outsourcing",
    modules: [
      { id: "M-CORE", name: "기본", always_on: true, suggest_keywords: [] },
      { id: "M-PRIV", name: "개인정보", always_on: false, suggest_keywords: ["개인정보"] },
    ],
  },
  checkpoints: [
    { id: "OUT-01", title: "재위탁", severity: "필수", module: "M-CORE",
      triggers: { keywords: ["재위탁"] }, absence_check: true, guidance: "g" },
    { id: "OUT-02", title: "처리위탁 문서화", severity: "필수", module: "M-PRIV",
      triggers: { keywords: ["개인정보"] }, absence_check: true, guidance: "g" },
    { id: "OUT-03", title: "손해배상 상한", severity: "권장",
      triggers: { keywords: [], patterns: ["손해\\s*배상"] }, absence_check: false, guidance: "g" },
  ],
};

test("detectType: 키워드 빈도로 유형 순위를 매긴다", () => {
  const ranked = detectType("이 업무위탁 계약에서 수탁자는...", TYPES);
  assert.strictEqual(ranked[0].typeId, "outsourcing");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("suggestModules: 본문 키워드로 모듈 활성화를 제안한다", () => {
  const s = suggestModules("개인정보 처리 업무 포함", OUT_DOC.meta.modules);
  assert.deepStrictEqual(s, ["M-PRIV"]);
  assert.deepStrictEqual(suggestModules("무관한 내용", OUT_DOC.meta.modules), []);
});

test("analyze: 활성 모듈 체크포인트만 매칭하고 누락을 탐지한다", () => {
  const clauses = [
    { heading: "제1조 (재위탁)", body: "재위탁 시 동의를 받는다", index: 0 },
    { heading: "제2조 (손해배상)", body: "손해 배상 책임을 진다", index: 1 },
  ];
  // M-PRIV 비활성 → OUT-02는 대상 제외
  const r1 = analyze(clauses, [OUT_DOC], ["M-CORE"]);
  assert.strictEqual(r1.checkpoints.length, 2); // OUT-01, OUT-03
  assert.deepStrictEqual(r1.matches.map((m) => m.cpId).sort(), ["OUT-01", "OUT-03"]);
  assert.strictEqual(r1.missing.length, 0);
  // M-PRIV 활성인데 개인정보 조항 없음 → OUT-02 누락 의심
  const r2 = analyze(clauses, [OUT_DOC], ["M-CORE", "M-PRIV"]);
  assert.deepStrictEqual(r2.missing.map((c) => c.id), ["OUT-02"]);
});

test("analyze: 정규식 패턴 트리거가 동작한다", () => {
  const clauses = [{ heading: "제2조", body: "손해   배상 범위", index: 0 }];
  const r = analyze(clauses, [OUT_DOC], ["M-CORE"]);
  assert.ok(r.matches.some((m) => m.cpId === "OUT-03"));
});
