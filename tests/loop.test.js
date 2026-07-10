"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/loop.js");

// 검토의견 내보내기 포맷: { meta:{type_id,date,contract_hash}, verdicts:{cpId:{verdict,comment,date}} }
function exp(hash, reviewer, verdicts) {
  return { meta: { type_id: "outsourcing", date: "2026-07-10", contract_hash: hash, reviewer: reviewer }, verdicts: verdicts };
}

test("emptyCorpus: 초기 구조", () => {
  const c = L.emptyCorpus();
  assert.deepStrictEqual(c.byCheck, {});
  assert.strictEqual(c.meta.contract_count, 0);
});

test("mergeIntoCorpus: 판정 카운트 집계", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "손", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h2", "김", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h3", "이", { "CORE-07": { verdict: "해당없음", comment: "", date: "d" } }));
  const s = c.byCheck["CORE-07"];
  assert.strictEqual(s.counts["이상없음"], 2);
  assert.strictEqual(s.counts["해당없음"], 1);
  assert.strictEqual(c.meta.contract_count, 3);
});

test("mergeIntoCorpus: 코멘트 이력 + 동일 텍스트 count 병합", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "손", { "CMN-11": { verdict: "검토의견", comment: "상한 확인 필요", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h2", "김", { "CMN-11": { verdict: "검토의견", comment: "상한 확인 필요", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("h3", "이", { "CMN-11": { verdict: "검토의견", comment: "책임 범위 다름", date: "d" } }));
  const cm = c.byCheck["CMN-11"].comments;
  const same = cm.find((x) => x.text === "상한 확인 필요");
  assert.strictEqual(same.count, 2); // 동일 텍스트 병합
  assert.strictEqual(cm.length, 2);  // 서로 다른 코멘트 2종
});

test("mergeIntoCorpus: 코멘트 없는 판정은 코멘트 이력에 안 남음", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "손", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } }));
  assert.strictEqual(c.byCheck["CORE-07"].comments.length, 0);
});

test("mergeIntoCorpus: 같은 계약서(hash) 재적재는 중복 카운트 안 함", () => {
  let c = L.emptyCorpus();
  const e = exp("h1", "손", { "CORE-07": { verdict: "이상없음", comment: "", date: "d" } });
  c = L.mergeIntoCorpus(c, e);
  c = L.mergeIntoCorpus(c, e); // 같은 hash 재적재
  assert.strictEqual(c.byCheck["CORE-07"].counts["이상없음"], 1);
  assert.strictEqual(c.meta.contract_count, 1);
});

test("checkStats: 분포 비율 + 표본수", () => {
  let c = L.emptyCorpus();
  ["h1", "h2", "h3", "h4"].forEach((h, i) => {
    c = L.mergeIntoCorpus(c, exp(h, "r" + i, { "X": { verdict: i < 3 ? "이상없음" : "해당없음", comment: "", date: "d" } }));
  });
  const st = L.checkStats(c, "X");
  assert.strictEqual(st.n, 4);
  assert.strictEqual(st.dist["이상없음"], 3);
  assert.strictEqual(st.pct["이상없음"], 75);
  assert.strictEqual(st.dominant, "이상없음");
  assert.strictEqual(st.lowSample, true); // n=4 < 5 → 표본 적음
});

test("checkStats: 표본 5건 이상이면 lowSample 아님", () => {
  let c = L.emptyCorpus();
  ["h1", "h2", "h3", "h4", "h5"].forEach((h, i) => {
    c = L.mergeIntoCorpus(c, exp(h, "r" + i, { "W": { verdict: "이상없음", comment: "", date: "d" } }));
  });
  assert.strictEqual(L.checkStats(c, "W").lowSample, false);
});

test("checkStats: 표본 적으면 lowSample", () => {
  let c = L.emptyCorpus();
  c = L.mergeIntoCorpus(c, exp("h1", "r", { "Y": { verdict: "이상없음", comment: "", date: "d" } }));
  assert.strictEqual(L.checkStats(c, "Y").lowSample, true);
});

test("checkStats: 없는 항목은 null", () => {
  assert.strictEqual(L.checkStats(L.emptyCorpus(), "NOPE"), null);
});

test("topComments: count 내림차순 상위", () => {
  let c = L.emptyCorpus();
  for (let i = 0; i < 3; i++) c = L.mergeIntoCorpus(c, exp("a" + i, "r", { "Z": { verdict: "검토의견", comment: "자주 다는 의견", date: "d" } }));
  c = L.mergeIntoCorpus(c, exp("b1", "r", { "Z": { verdict: "검토의견", comment: "가끔 의견", date: "d" } }));
  const top = L.topComments(c, "Z", 5);
  assert.strictEqual(top[0].text, "자주 다는 의견");
  assert.strictEqual(top[0].count, 3);
  assert.strictEqual(top.length, 2);
});

test("topComments: 없으면 빈 배열", () => {
  assert.deepStrictEqual(L.topComments(L.emptyCorpus(), "NOPE", 5), []);
});

test("curationSignals: 반복 해당없음은 조건부화 후보, 반복 이상없음은 골드", () => {
  let c = L.emptyCorpus();
  for (let i = 0; i < 8; i++) c = L.mergeIntoCorpus(c, exp("na" + i, "r", { "NA": { verdict: "해당없음", comment: "", date: "d" } }));
  for (let i = 0; i < 8; i++) c = L.mergeIntoCorpus(c, exp("ok" + i, "r", { "OK": { verdict: "이상없음", comment: "", date: "d" } }));
  const sig = L.curationSignals(c, { minN: 5, ratio: 0.8 });
  assert.ok(sig.conditional.some((x) => x.cpId === "NA"));
  assert.ok(sig.gold.some((x) => x.cpId === "OK"));
});
