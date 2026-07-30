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

// ── 아카이브 레지스트리(자동 안내) — registryPush·용량 강등·후보 매칭 ──
const TEXT_A = "위탁자와 수탁자는 전산시스템 유지보수 용역에 관하여 계약을 체결한다. " +
  "수탁자는 재위탁 금지 의무와 비밀유지 의무를 부담하며 지체상금과 손해배상 조항이 적용된다. " +
  "하자보수 보증기간은 검수 완료일부터 일 년으로 하고 이행보증보험증권을 제출한다.";
const TEXT_A2 = TEXT_A + " 개인정보 보호 조항이 신설되어 수탁자는 개인정보를 안전하게 관리한다."; // 같은 계약의 이듬해 수정본
const TEXT_B = "임대인은 임차인에게 건물을 임대하고 임차인은 차임을 지급한다. " +
  "보증금 반환과 원상회복 의무, 임대차 기간 갱신에 관한 사항을 정한다.";

function regEntry(hash, name, typeId, text) {
  return { name: name, date: "2025-07-30", reviewer: "손남수",
    type_id: typeId, contract_hash: hash, contract_text: text };
}

test("registryPush: 항목 등록 시 지문(fp)이 생성되고 같은 hash는 교체된다", () => {
  let reg = Compare.registryPush([], regEntry("h1", "IT용역", "procurement", TEXT_A));
  assert.strictEqual(reg.length, 1);
  assert.ok(reg[0].fp && Array.isArray(reg[0].fp.kw) && reg[0].fp.kw.length > 0);
  assert.strictEqual(reg[0].contract_text, TEXT_A);
  // 같은 계약(hash) 재등록 → 교체(중복 없음, 최신 유지)
  reg = Compare.registryPush(reg, regEntry("h1", "IT용역(수정)", "procurement", TEXT_A));
  assert.strictEqual(reg.length, 1);
  assert.strictEqual(reg[0].name, "IT용역(수정)");
});

test("registryPush: 용량 초과 시 오래된 항목부터 contract_text를 제거하고 지문만 유지", () => {
  // 한도 = "h1·h2 지문만 + h3 전문" 상태의 크기 — 이 상태로 정확히 강등되는지 검증.
  let full = Compare.registryPush([], regEntry("h1", "A", "procurement", TEXT_A));
  full = Compare.registryPush(full, regEntry("h2", "B", "lease", TEXT_B));
  full = Compare.registryPush(full, regEntry("h3", "C", "procurement", TEXT_A2));
  const degraded = full.map((e, i) => {
    const c = Object.assign({}, e);
    if (i < 2) delete c.contract_text;
    return c;
  });
  const limit = JSON.stringify(degraded).length;
  let reg = Compare.registryPush([], regEntry("h1", "A", "procurement", TEXT_A), { limit });
  reg = Compare.registryPush(reg, regEntry("h2", "B", "lease", TEXT_B), { limit });
  reg = Compare.registryPush(reg, regEntry("h3", "C", "procurement", TEXT_A2), { limit });
  assert.strictEqual(reg.length, 3); // 항목은 유지
  assert.strictEqual(reg[0].contract_text, undefined); // 가장 오래된 h1부터 본문 강등
  assert.ok(reg[0].fp.kw.length > 0); // 지문은 유지
  assert.strictEqual(reg[2].contract_text, TEXT_A2); // 최신은 전문 보유
});

test("registryFind: 같은 계약 수정본을 상위 1건으로 찾고 자기 자신·무관 계약은 제외", () => {
  let reg = Compare.registryPush([], regEntry("h1", "IT용역 위탁", "procurement", TEXT_A));
  reg = Compare.registryPush(reg, regEntry("h2", "건물 임대차", "lease", TEXT_B));
  const cands = Compare.registryFind(reg, { typeId: "procurement", hash: "hNew", name: "IT용역 위탁", text: TEXT_A2 });
  assert.strictEqual(cands.length, 1);
  assert.strictEqual(cands[0].entry.contract_hash, "h1");
  assert.ok(cands[0].score > 0.5);
  // 자기 자신(동일 hash) 제외
  const self = Compare.registryFind(reg, { typeId: "procurement", hash: "h1", name: "IT용역 위탁", text: TEXT_A });
  assert.strictEqual(self.filter((c) => c.entry.contract_hash === "h1").length, 0);
});

test("registryFind: type_id 필터 — 유형 일치만, 미확정(빈)이면 전체 탐색", () => {
  let reg = Compare.registryPush([], regEntry("h1", "IT용역", "procurement", TEXT_A));
  // 유형이 다르면 본문이 같아도 후보 아님
  const other = Compare.registryFind(reg, { typeId: "lease", hash: "hNew", name: "IT용역", text: TEXT_A });
  assert.strictEqual(other.length, 0);
  // 미확정이면 전체 탐색
  const und = Compare.registryFind(reg, { typeId: "", hash: "hNew", name: "IT용역", text: TEXT_A });
  assert.strictEqual(und.length, 1);
});

test("registryFind: 무시 목록(exclude)·임계 미달·동률 근접 2건", () => {
  let reg = Compare.registryPush([], regEntry("h1", "IT용역", "procurement", TEXT_A));
  reg = Compare.registryPush(reg, regEntry("h1b", "IT용역 사본", "procurement", TEXT_A)); // 동률 후보
  reg = Compare.registryPush(reg, regEntry("h2", "임대차", "procurement", TEXT_B));       // 임계 미달(본문 무관)
  const cur = { typeId: "procurement", hash: "hNew", name: "IT용역", text: TEXT_A2 };
  const cands = Compare.registryFind(reg, cur);
  assert.strictEqual(cands.length, 2); // 동률 근접 시 최대 2건 — 임계 미달 h2는 제외
  const hashes = cands.map((c) => c.entry.contract_hash).sort();
  assert.deepStrictEqual(hashes, ["h1", "h1b"]);
  // 무시 목록 — 후보에서 제외
  const rest = Compare.registryFind(reg, cur, { exclude: ["h1"] });
  assert.strictEqual(rest.length, 1);
  assert.strictEqual(rest[0].entry.contract_hash, "h1b");
});

test("registryFind: 지문만 남은 항목(본문 강등)도 후보 매칭된다", () => {
  let reg = Compare.registryPush([], regEntry("h1", "IT용역", "procurement", TEXT_A));
  delete reg[0].contract_text; // 용량 강등 상태 재현
  const cands = Compare.registryFind(reg, { typeId: "procurement", hash: "hNew", name: "IT용역", text: TEXT_A2 });
  assert.strictEqual(cands.length, 1);
  assert.strictEqual(cands[0].entry.contract_hash, "h1");
});
