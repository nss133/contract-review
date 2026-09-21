"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Groups = require("../src/check_groups.js");
const item = (cpId, clauseIndex = 0) => ({ r: { cpId, best: { clauseIndex } }, ev: true });
test("공통·약관 해지권은 동일 조항에서 하나의 표시 묶음이다", () => {
  const input = [item("CMN-08"), item("SP-UNF-09")], before = JSON.stringify(input);
  const groups = Groups.group(input);
  assert.equal(groups.length, 1); assert.equal(groups[0].items.length, 2);
  assert.equal(JSON.stringify(input), before);
});
test("해지권·절차·하자 해제권은 서로 다른 판단 단위로 남는다", () => {
  assert.equal(Groups.group([item("CMN-08"), item("CMN-09"), item("SP-DEL-07")]).length, 3);
});
test("서로 다른 조항의 유사 체크는 묶지 않는다", () => {
  assert.equal(Groups.group([item("CMN-08", 0), item("SP-UNF-09", 1)]).length, 2);
});
test("중복 그룹 멤버와 모든 입력 ID의 보존을 검증한다", () => {
  const ids = Groups.GROUPS.flatMap(g => Object.keys(g.members));
  assert.equal(ids.length, new Set(ids).size);
  const input = ids.map(id => item(id));
  assert.deepEqual(Groups.group(input).flatMap(g => g.items.map(x => x.r.cpId)).sort(), ids.sort());
});
