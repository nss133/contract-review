"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("../src/findings.js");

test("자유 의견은 체크 id 없이 계약 전반 finding으로 저장", () => {
  const out = F.upsert(F.emptyStore(), { scope: "contract", title: "거래구조",
    comment: "책임 구조 전반 재정리 필요", severity: "중요", date: "2026-08-28" }, "cr-x");
  assert.strictEqual(out.id, "MF-cr-x-001");
  assert.strictEqual(out.store.manual[out.id].related_check_id, null);
  assert.strictEqual(F.summary(out.store, []).opinions, 1);
});

test("조항·복수조항 anchor를 보존하고 잘못된 값은 정규화", () => {
  const out = F.upsert(F.emptyStore(), { scope: "cross_clause", title: "기간 충돌", comment: "서로 다름",
    severity: "일반", anchors: [{ clause_index: 2, heading: "제3조" }, { clause_index: 7, heading: "제8조" }] }, "h");
  assert.deepStrictEqual(out.store.manual[out.id].anchors.map(x => x.clause_index), [2, 7]);
});

test("자동 완결성 finding의 사람 판정은 별도 overlay로 저장", () => {
  let s = F.decide(F.emptyStore(), "IF-REF-01-0-8", "no_issue",
    { comment: "외부 문서 인용", reviewer: "손", date: "2026-08-28" });
  const p = F.project(s, [{ id: "IF-REF-01-0-8", title: "없는 조항", severity: "중요" }]);
  assert.strictEqual(p[0].decision, "no_issue");
  assert.strictEqual(p[0].decision_comment, "외부 문서 인용");
});

test("삭제는 해당 자유 의견만 제거", () => {
  let a = F.upsert(F.emptyStore(), { title: "A" }, "h");
  let b = F.upsert(a.store, { title: "B" }, "h");
  const s = F.remove(b.store, a.id);
  assert.strictEqual(s.manual[a.id], undefined);
  assert.ok(s.manual[b.id]);
});
