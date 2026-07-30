"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const Compare = require("../src/compare.js");

// ── 픽스처: 구 계약(전년) 조항 ─────────────────────────────────────
// segmentContract 출력 형태 [{heading, body, index}]와 동일 구조.
function cl(idx, heading, body) {
  return { heading: heading, body: body, index: idx };
}
const OLD = [
  cl(0, "(전문)", "본 계약은 위탁자와 수탁자 사이의 전산시스템 유지보수 업무에 관하여 다음과 같이 체결한다."),
  cl(1, "제1조(목적)", "이 계약은 전산시스템 유지보수 용역의 범위와 조건을 정함을 목적으로 한다."),
  cl(2, "제2조(계약기간)", "계약기간은 2025년 1월 1일부터 2025년 12월 31일까지로 한다."),
  cl(3, "제3조(재위탁 제한)", "수탁자는 위탁자의 사전 서면 동의 없이 업무의 전부 또는 일부를 제3자에게 재위탁할 수 없다."),
  cl(4, "제4조(손해배상)", "수탁자가 계약을 위반하여 위탁자에게 손해를 입힌 경우 그 손해를 배상하여야 한다."),
];

// ── alignClauses: 동일 계약 → 전 조항 same ─────────────────────────
test("alignClauses: 동일 계약이면 전 조항 same, 신설·삭제 없음", () => {
  const m = Compare.alignClauses(OLD, OLD);
  assert.strictEqual(m.length, OLD.length);
  m.forEach((e) => {
    assert.strictEqual(e.kind, "same");
    assert.strictEqual(e.oldIdx, e.newIdx);
    assert.ok(e.sim >= 0.95);
    assert.strictEqual(e.uncertain, false);
  });
});

// ── alignClauses: 문구 변경 → changed ─────────────────────────────
test("alignClauses: 표제 동일·본문 일부 변경 조항은 changed로 분류", () => {
  const NEW = OLD.map((c, i) =>
    i === 4
      ? cl(4, "제4조(손해배상)", "수탁자가 계약을 위반하여 위탁자에게 손해를 입힌 경우 통상손해의 범위에서 그 손해를 배상하여야 하며, 배상액은 계약금액을 한도로 한다.")
      : cl(i, c.heading, c.body));
  const m = Compare.alignClauses(OLD, NEW);
  const e = m.filter((x) => x.newIdx === 4)[0];
  assert.strictEqual(e.kind, "changed");
  assert.strictEqual(e.oldIdx, 4);
  assert.ok(e.sim < 0.95, "변경 조항 sim은 0.95 미만이어야 함: " + e.sim);
});

// ── alignClauses: 조번호 이동 → moved ─────────────────────────────
test("alignClauses: 내용 동일·조번호만 바뀐 조항은 moved", () => {
  // 구 제3조(재위탁 제한)가 신 계약에서 제5조로 밀림(중간에 조항 신설).
  const NEW = [
    OLD[0], OLD[1], OLD[2],
    cl(3, "제3조(보안유지)", "수탁자는 업무 수행 중 알게 된 위탁자의 비밀정보를 제3자에게 누설하여서는 아니 된다."),
    cl(4, "제5조(재위탁 제한)", "수탁자는 위탁자의 사전 서면 동의 없이 업무의 전부 또는 일부를 제3자에게 재위탁할 수 없다."),
    cl(5, "제4조(손해배상)", OLD[4].body),
  ].map((c, i) => cl(i, c.heading, c.body));
  const m = Compare.alignClauses(OLD, NEW);
  const moved = m.filter((x) => x.newIdx === 4)[0];
  assert.strictEqual(moved.kind, "moved");
  assert.strictEqual(moved.oldIdx, 3);
  assert.ok(moved.sim >= 0.95);
  const added = m.filter((x) => x.kind === "added");
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].newIdx, 3);
  assert.strictEqual(added[0].oldIdx, null);
});

// ── alignClauses: 신설·삭제 ───────────────────────────────────────
test("alignClauses: 매칭 안 되는 신 조항은 added, 구 조항은 removed", () => {
  const NEW = [
    OLD[0], OLD[1], OLD[2], OLD[3],
    cl(4, "제5조(지식재산권)", "용역 수행 과정에서 산출된 결과물의 지식재산권은 위탁자에게 귀속된다."),
  ].map((c, i) => cl(i, c.heading, c.body));
  const m = Compare.alignClauses(OLD, NEW);
  const added = m.filter((x) => x.kind === "added");
  const removed = m.filter((x) => x.kind === "removed");
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].newIdx, 4);
  assert.strictEqual(removed.length, 1);
  assert.strictEqual(removed[0].oldIdx, 4); // 구 제4조(손해배상) 삭제
  assert.strictEqual(removed[0].newIdx, null);
});

// ── alignClauses: 통합(2→1) — greedy 한계로 하나만 매칭·나머지 removed ──
test("alignClauses: 두 조항이 하나로 통합되면 하나만 매칭되고 나머지는 removed", () => {
  const NEW = [
    OLD[0], OLD[1], OLD[2],
    cl(3, "제3조(재위탁 제한 및 손해배상)",
      "수탁자는 위탁자의 사전 서면 동의 없이 업무의 전부 또는 일부를 제3자에게 재위탁할 수 없다. " +
      "수탁자가 계약을 위반하여 위탁자에게 손해를 입힌 경우 그 손해를 배상하여야 한다."),
  ].map((c, i) => cl(i, c.heading, c.body));
  const m = Compare.alignClauses(OLD, NEW);
  const matchedToMerged = m.filter((x) => x.newIdx === 3 && x.oldIdx !== null);
  assert.strictEqual(matchedToMerged.length, 1); // 1:1 매칭만 — 다중 매칭 없음
  const removed = m.filter((x) => x.kind === "removed");
  assert.strictEqual(removed.length, 1); // 통합에 흡수된 나머지 한 조항
  assert.ok([3, 4].indexOf(removed[0].oldIdx) !== -1);
});

// ── alignClauses: 대응 불확실 — 동점 후보(중복 본문) ───────────────
test("alignClauses: 동일 본문 조항이 복수라 후보가 동점이면 uncertain 표시", () => {
  // 표제 문언·본문이 완전히 같고 조번호만 다른 구 조항 2개 — 어느 쪽 대응인지 확정 불가.
  const dupBody = "수탁자는 위탁자의 사전 서면 동의 없이 업무의 전부 또는 일부를 제3자에게 재위탁할 수 없다.";
  const OLD2 = [
    cl(0, "제1조(재위탁 제한)", dupBody),
    cl(1, "제2조(재위탁 제한)", dupBody),
  ];
  const NEW2 = [cl(0, "제3조(재위탁 제한)", dupBody)];
  const m = Compare.alignClauses(OLD2, NEW2);
  const matched = m.filter((x) => x.newIdx === 0 && x.oldIdx !== null)[0];
  assert.ok(matched, "본문 동일 조항은 매칭되어야 함");
  assert.strictEqual(matched.uncertain, true);
});

// ── alignClauses: 빈 입력 안전 ────────────────────────────────────
test("alignClauses: 빈 배열 입력에도 안전", () => {
  assert.deepStrictEqual(Compare.alignClauses([], []), []);
  const onlyNew = Compare.alignClauses([], [cl(0, "제1조(목적)", "내용")]);
  assert.strictEqual(onlyNew.length, 1);
  assert.strictEqual(onlyNew[0].kind, "added");
  const onlyOld = Compare.alignClauses([cl(0, "제1조(목적)", "내용")], []);
  assert.strictEqual(onlyOld.length, 1);
  assert.strictEqual(onlyOld[0].kind, "removed");
});

// ── diffWords ─────────────────────────────────────────────────────
test("diffWords: 어절 추가·삭제를 LCS로 분리한다", () => {
  const ops = Compare.diffWords(
    "수탁자는 사전 동의 없이 재위탁할 수 없다.",
    "수탁자는 사전 서면 동의 없이 재위탁할 수 없다."
  );
  const added = ops.filter((o) => o.op === "add").map((o) => o.text).join(" ");
  const deleted = ops.filter((o) => o.op === "del");
  assert.strictEqual(added, "서면");
  assert.strictEqual(deleted.length, 0);
  // eq 어절을 이어붙이면 구 문장이 복원됨
  const eqAndDel = ops.filter((o) => o.op !== "add").map((o) => o.text).join(" ");
  assert.strictEqual(eqAndDel, "수탁자는 사전 동의 없이 재위탁할 수 없다.");
});

test("diffWords: 빈 문자열 경계 — 양쪽 빈이면 [], 한쪽 빈이면 전량 add/del", () => {
  assert.deepStrictEqual(Compare.diffWords("", ""), []);
  assert.deepStrictEqual(Compare.diffWords("", "신설 문장"), [{ op: "add", text: "신설 문장" }]);
  assert.deepStrictEqual(Compare.diffWords("삭제 문장", ""), [{ op: "del", text: "삭제 문장" }]);
});

test("diffWords: 완전 교체 — 공통 어절이 없으면 del·add 각 1블록", () => {
  const ops = Compare.diffWords("갑설 을설 병설", "정산 명세 제출");
  assert.deepStrictEqual(ops, [
    { op: "del", text: "갑설 을설 병설" },
    { op: "add", text: "정산 명세 제출" },
  ]);
});

test("diffWords: 공백 정규화 — 연속 공백·개행은 어절 경계로만 취급", () => {
  const ops = Compare.diffWords("가  나\n다", "가 나 다");
  assert.deepStrictEqual(ops, [{ op: "eq", text: "가 나 다" }]);
});

// ── carryVerdicts ─────────────────────────────────────────────────
// mapping: alignClauses 출력 형태를 직접 구성(정렬 로직과 분리해 이관 규칙만 검증).
const MAPPING = [
  { oldIdx: 0, newIdx: 0, kind: "same", sim: 1, uncertain: false },
  { oldIdx: 1, newIdx: 1, kind: "changed", sim: 0.8, uncertain: false },
  { oldIdx: 2, newIdx: 2, kind: "moved", sim: 0.98, uncertain: false },
  { oldIdx: 3, newIdx: 3, kind: "same", sim: 0.97, uncertain: true },
  { oldIdx: null, newIdx: 4, kind: "added", sim: 0, uncertain: false },
];
const OLD_VERDICTS = {
  "CP-1": { verdict: "이상없음", comment: "확인함", date: "2025-07-01" },
  "CP-2": { verdict: "검토의견", comment: "보완 요", date: "2025-07-01" },
  "CP-3": { verdict: "이상없음", comment: "", date: "2025-07-01" },
  "CP-4": { verdict: "해당없음", comment: "비적용", date: "2025-07-01" },
  "CP-5": { verdict: "이상없음", comment: "불확실 조항", date: "2025-07-01" },
};

test("carryVerdicts: same·moved 조항 매칭 체크만 이관 후보 — changed·added 제외", () => {
  const results = [
    { cpId: "CP-1", coverage: "addressed", best: { clauseIndex: 0 } }, // same → 후보
    { cpId: "CP-2", coverage: "addressed", best: { clauseIndex: 1 } }, // changed → 제외
    { cpId: "CP-3", coverage: "verify", best: { clauseIndex: 2 } },    // moved → 후보
    { cpId: "CP-6", coverage: "addressed", best: { clauseIndex: 0 } }, // 전년 판정 없음 → 제외
  ];
  const cands = Compare.carryVerdicts(OLD_VERDICTS, MAPPING, results);
  const ids = cands.map((c) => c.cpId).sort();
  assert.deepStrictEqual(ids, ["CP-1", "CP-3"]);
  const c1 = cands.filter((c) => c.cpId === "CP-1")[0];
  assert.strictEqual(c1.verdict, "이상없음");
  assert.strictEqual(c1.comment, "확인함");
  assert.strictEqual(c1.date, "2025-07-01");
  assert.strictEqual(c1.newIdx, 0);
});

test("carryVerdicts: uncertain 매칭 조항은 same이어도 이관 후보에서 제외", () => {
  const results = [{ cpId: "CP-5", coverage: "addressed", best: { clauseIndex: 3 } }];
  const cands = Compare.carryVerdicts(OLD_VERDICTS, MAPPING, results);
  assert.strictEqual(cands.length, 0);
});

test("carryVerdicts: 부재 알람(consider)은 조항 무관 — 체크 id 기준 이관 후보", () => {
  const results = [
    { cpId: "CP-4", coverage: "consider", best: null },
    { cpId: "CP-9", coverage: "consider", best: null }, // 전년 판정 없음 → 제외
  ];
  const cands = Compare.carryVerdicts(OLD_VERDICTS, MAPPING, results);
  assert.strictEqual(cands.length, 1);
  assert.strictEqual(cands[0].cpId, "CP-4");
  assert.strictEqual(cands[0].verdict, "해당없음");
  assert.strictEqual(cands[0].newIdx, null);
  assert.strictEqual(cands[0].basis, "consider");
});

test("carryVerdicts: quiet 항목은 후보 아님", () => {
  const results = [{ cpId: "CP-1", coverage: "quiet", best: { clauseIndex: 0 } }];
  assert.strictEqual(Compare.carryVerdicts(OLD_VERDICTS, MAPPING, results).length, 0);
});
