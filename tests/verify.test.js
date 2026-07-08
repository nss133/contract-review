"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const V = require("../src/verify.js");

const CR = {
  common: { meta: { type_id: "common", type_name: "공통" }, checks: [
    { id: "CMN-12", check: "손해배상 범위 조항이 있는가", severity: "참고", severity_basis: "임의규정임 — 민법 제393조", note: "",
      sources: [{ law: "민법", article: "제393조", clause: "제1항", quote: "통상의 손해를 그 한도로 한다", text: "제393조(손해배상의 범위) ① 채무불이행으로 인한 손해배상은 통상의 손해를 그 한도로 한다.", verified: false }] },
    { id: "CMN-99", check: "실무 항목", severity: "참고", severity_basis: "실무 관행", note: "", sources: [] },
  ]},
  types: [ { meta: { type_id: "nda", type_name: "NDA" }, checks: [
    { id: "NDA-15", check: "손해배상 조항이 있는가", severity: "필수", severity_basis: "강행규정(의무)임", note: "",
      sources: [{ law: "부정경쟁방지법", article: "제11조", clause: "", quote: "손해를 배상할 책임을 진다", text: "제11조(손해배상책임) 고의 또는 과실로 …손해를 배상할 책임을 진다.", verified: false }] },
  ]}]
};

test("sourceKey: checkId#index", () => {
  assert.strictEqual(V.sourceKey("CMN-12", 0), "CMN-12#0");
});

test("buildVerifyItems: check 단위 그룹 + statute/practice 구분", () => {
  const items = V.buildVerifyItems(CR);
  assert.strictEqual(items.length, 3); // CMN-12, CMN-99, NDA-15
  const cmn12 = items.find((i) => i.checkId === "CMN-12");
  assert.strictEqual(cmn12.typeName, "공통");
  assert.strictEqual(cmn12.sources.length, 1);
  assert.strictEqual(cmn12.sources[0].index, 0);
  assert.strictEqual(cmn12.isPractice, false);
  assert.strictEqual(items.find((i) => i.checkId === "CMN-99").isPractice, true);
  assert.strictEqual(items.find((i) => i.checkId === "NDA-15").typeId, "nda");
});

test("verifyProgress: source 단위 집계, practice 제외", () => {
  const p0 = V.verifyProgress(V.buildVerifyItems(CR), {});
  assert.strictEqual(p0.total, 2); // statute source 2개 (practice 0개 제외)
  assert.strictEqual(p0.confirmed, 0);
  assert.strictEqual(p0.pending, 2);
  const p1 = V.verifyProgress(V.buildVerifyItems(CR), { "CMN-12#0": { decision: "확인" }, "NDA-15#0": { decision: "수정필요" } });
  assert.strictEqual(p1.confirmed, 1);
  assert.strictEqual(p1.needsfix, 1);
  assert.strictEqual(p1.pending, 0);
});

test("verifyProgress: 이미 verified인 source는 confirmed", () => {
  const cr2 = JSON.parse(JSON.stringify(CR));
  cr2.common.checks[0].sources[0].verified = true;
  const p = V.verifyProgress(V.buildVerifyItems(cr2), {});
  assert.strictEqual(p.confirmed, 1);
});

test("filterItems: 미검수만 / 유형별", () => {
  const items = V.buildVerifyItems(CR);
  const dec = { "CMN-12#0": { decision: "확인" } };
  const unrev = V.filterItems(items, dec, { mode: "unreviewed", typeId: "" });
  assert.ok(unrev.some((i) => i.checkId === "NDA-15"));
  assert.ok(!unrev.some((i) => i.checkId === "CMN-12")); // 확인됨 → 제외
  const nda = V.filterItems(items, dec, { mode: "all", typeId: "nda" });
  assert.deepStrictEqual(nda.map((i) => i.checkId), ["NDA-15"]);
});

test("findHighlight: quote를 text에서 찾아 구간 반환, 없으면 null", () => {
  const r = V.findHighlight("통상의 손해를 그 한도로 한다", "제393조(…) ① … 통상의 손해를 그 한도로 한다.");
  assert.ok(r && r[0] >= 0 && r[1] > r[0]);
  assert.strictEqual(V.findHighlight("존재하지 않는 문구", "원문 텍스트"), null);
});

test("exportJson: 판정 객체를 JSON 문자열로", () => {
  const s = V.exportJson({ "CMN-12#0": { decision: "확인", date: "2026-07-09" } });
  assert.strictEqual(JSON.parse(s)["CMN-12#0"].decision, "확인");
});
