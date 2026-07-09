"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const V = require("../src/verdict.js");

test("verdictKey: 계약서 해시별 저장키", () => {
  assert.strictEqual(V.verdictKey("cr-abc"), "cr-verdict-cr-abc");
});

test("VERDICTS: 3택 상수", () => {
  assert.deepStrictEqual(V.VERDICTS, ["이상없음", "검토의견", "해당없음"]);
});

test("setVerdict: 판정 추가(불변 — 원본 미변경)", () => {
  const s0 = {};
  const s1 = V.setVerdict(s0, "CMN-12", "이상없음", "", "2026-07-09");
  assert.deepStrictEqual(s0, {});
  assert.strictEqual(s1["CMN-12"].verdict, "이상없음");
  assert.strictEqual(s1["CMN-12"].date, "2026-07-09");
});

test("setVerdict: 검토의견 + 코멘트", () => {
  const s = V.setVerdict({}, "NDA-15", "검토의견", "손해배상 상한 확인 필요", "2026-07-09");
  assert.strictEqual(s["NDA-15"].verdict, "검토의견");
  assert.strictEqual(s["NDA-15"].comment, "손해배상 상한 확인 필요");
});

test("setVerdict: 빈 verdict면 판정 취소(삭제)", () => {
  const s1 = V.setVerdict({}, "CMN-12", "이상없음", "", "2026-07-09");
  const s2 = V.setVerdict(s1, "CMN-12", "", "", "2026-07-09");
  assert.ok(!("CMN-12" in s2));
});

test("setVerdict: 잘못된 verdict 값이면 무시(원본 유지)", () => {
  const s1 = V.setVerdict({}, "CMN-12", "이상없음", "", "2026-07-09");
  const s2 = V.setVerdict(s1, "CMN-12", "합격", "", "2026-07-09"); // 허용 안 되는 값
  assert.deepStrictEqual(s2, s1);
});

test("verdictSummary: 판정 집계", () => {
  let s = {};
  s = V.setVerdict(s, "A", "이상없음", "", "d");
  s = V.setVerdict(s, "B", "이상없음", "", "d");
  s = V.setVerdict(s, "C", "검토의견", "x", "d");
  s = V.setVerdict(s, "D", "해당없음", "", "d");
  const sum = V.verdictSummary(s);
  assert.strictEqual(sum["이상없음"], 2);
  assert.strictEqual(sum["검토의견"], 1);
  assert.strictEqual(sum["해당없음"], 1);
  assert.strictEqual(sum.total, 4);
});

test("verdictSummary: 빈 store", () => {
  assert.deepStrictEqual(V.verdictSummary({}), { "이상없음": 0, "검토의견": 0, "해당없음": 0, total: 0 });
});

test("exportVerdicts: meta + verdicts 구조", () => {
  const s = V.setVerdict({}, "CMN-12", "이상없음", "", "2026-07-09");
  const out = V.exportVerdicts(s, { type_id: "nda", date: "2026-07-09", contract_hash: "cr-abc" });
  assert.strictEqual(out.meta.type_id, "nda");
  assert.strictEqual(out.meta.contract_hash, "cr-abc");
  assert.strictEqual(out.verdicts["CMN-12"].verdict, "이상없음");
});

test("importVerdicts: 정상 구조 파싱", () => {
  const obj = { meta: { type_id: "nda" }, verdicts: { "CMN-12": { verdict: "검토의견", comment: "메모", date: "d" } } };
  const v = V.importVerdicts(obj);
  assert.strictEqual(v["CMN-12"].verdict, "검토의견");
});

test("importVerdicts: verdicts 없거나 잘못된 값 방어", () => {
  assert.deepStrictEqual(V.importVerdicts(null), {});
  assert.deepStrictEqual(V.importVerdicts({}), {});
  assert.deepStrictEqual(V.importVerdicts({ verdicts: "not-obj" }), {});
  // 잘못된 verdict 값은 걸러냄
  const v = V.importVerdicts({ verdicts: { X: { verdict: "합격" }, Y: { verdict: "이상없음", comment: "", date: "d" } } });
  assert.ok(!("X" in v));
  assert.strictEqual(v["Y"].verdict, "이상없음");
});
