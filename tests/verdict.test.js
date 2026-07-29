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

// ── 일괄 판정(통과계약 모드) ─────────────────────────────────────
test("bulkVerdict: 미판정만 채우고 기판정(예외)은 보존한다", () => {
  let store = V.setVerdict({}, "A-1", "검토의견", "예외 코멘트", "d1"); // 예외 먼저 지정
  const r = V.bulkVerdict(store, ["A-1", "B-2", "C-3"], "해당없음", "d2");
  assert.strictEqual(r.applied, 2);                       // B-2, C-3만
  assert.strictEqual(r.store["A-1"].verdict, "검토의견");  // 예외 보존
  assert.strictEqual(r.store["A-1"].comment, "예외 코멘트");
  assert.strictEqual(r.store["B-2"].verdict, "해당없음");
});

test("bulkVerdict: 잘못된 verdict는 무시(원본 반환)", () => {
  const r = V.bulkVerdict({}, ["A-1"], "없는판정", "d");
  assert.strictEqual(r.applied, 0);
});

// ── 일괄 판정+코멘트(보안관리약정서 자동 기재 #B) ────────────────────
const AUTO = "표준 개인(신용)정보 보안관리약정서(2025.01) 체결로 반영 — 별첨 체결·간인 확인";

test("bulkVerdictComment: 미판정만 verdict+코멘트로 채움, 기판정 보존", () => {
  let store = V.setVerdict({}, "PRIV-02", "검토의견", "사람이 찍은 의견", "d1");
  const r = V.bulkVerdictComment(store, ["PRIV-02", "PRIV-03", "PRIV-04"], "이상없음", AUTO, "d2");
  assert.strictEqual(r.applied, 2);                            // PRIV-03·04만
  assert.strictEqual(r.store["PRIV-02"].verdict, "검토의견");   // 기판정 불변
  assert.strictEqual(r.store["PRIV-02"].comment, "사람이 찍은 의견");
  assert.strictEqual(r.store["PRIV-03"].verdict, "이상없음");
  assert.strictEqual(r.store["PRIV-03"].comment, AUTO);
  assert.strictEqual(r.store["PRIV-03"].date, "d2");
});

test("bulkVerdictComment: 재실행해도 이중 기재 없음(멱등)", () => {
  const r1 = V.bulkVerdictComment({}, ["PRIV-03"], "이상없음", AUTO, "d1");
  const r2 = V.bulkVerdictComment(r1.store, ["PRIV-03"], "이상없음", AUTO, "d2");
  assert.strictEqual(r2.applied, 0);
  assert.strictEqual(r2.store["PRIV-03"].date, "d1"); // 최초 기재 유지
});

test("bulkVerdictComment: 잘못된 verdict는 무시(원본 반환)", () => {
  const r = V.bulkVerdictComment({}, ["A-1"], "없는판정", AUTO, "d");
  assert.strictEqual(r.applied, 0);
});

test("revertBulkVerdict: 자동 기재분(판정·코멘트 원형)만 제거", () => {
  let store = V.bulkVerdictComment({}, ["PRIV-03", "PRIV-04", "PRIV-05"], "이상없음", AUTO, "d1").store;
  store = V.setVerdict(store, "PRIV-04", "검토의견", AUTO, "d2");              // 판정을 사람이 변경
  store = V.setVerdict(store, "PRIV-05", "이상없음", "직접 확인함", "d2");      // 코멘트를 사람이 변경
  store = V.setVerdict(store, "PRIV-06", "이상없음", "", "d2");                // 자동 기재와 무관한 판정
  const r = V.revertBulkVerdict(store, ["PRIV-03", "PRIV-04", "PRIV-05", "PRIV-06"], "이상없음", AUTO);
  assert.strictEqual(r.removed, 1);
  assert.ok(!("PRIV-03" in r.store));                          // 원형 그대로 → 제거
  assert.strictEqual(r.store["PRIV-04"].verdict, "검토의견");   // 사람 수정분 생존
  assert.strictEqual(r.store["PRIV-05"].comment, "직접 확인함");
  assert.strictEqual(r.store["PRIV-06"].verdict, "이상없음");   // 코멘트 불일치 → 생존
});

test("revertBulkVerdict: cpIds 밖 항목은 건드리지 않음(불변 반환)", () => {
  const s0 = V.bulkVerdictComment({}, ["PRIV-03", "OUT-01"], "이상없음", AUTO, "d1").store;
  const r = V.revertBulkVerdict(s0, ["PRIV-03"], "이상없음", AUTO);
  assert.strictEqual(r.removed, 1);
  assert.strictEqual(r.store["OUT-01"].comment, AUTO);         // 범위 밖 생존
  assert.strictEqual(s0["PRIV-03"].verdict, "이상없음");        // 원본 미변경
});

test("토글 왕복(#B): ON 기재 → OFF 해제 → 원상 복귀", () => {
  const ids = ["PRIV-02", "PRIV-03"];
  let store = V.setVerdict({}, "PRIV-02", "이상없음", "", "d0"); // 사전에 사람이 찍은 판정
  const on = V.bulkVerdictComment(store, ids, "이상없음", AUTO, "d1");
  assert.strictEqual(on.applied, 1);                            // PRIV-03만 자동 기재
  const off = V.revertBulkVerdict(on.store, ids, "이상없음", AUTO);
  assert.strictEqual(off.removed, 1);
  assert.deepStrictEqual(off.store, store);                     // 사람 판정만 남아 원상 복귀
});

