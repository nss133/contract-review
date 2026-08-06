"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const V = require("../src/verdict.js");

test("verdictKey: 계약서 해시별 저장키", () => {
  assert.strictEqual(V.verdictKey("cr-abc"), "cr-verdict-cr-abc");
});

test("VERDICTS: 2택 상수 — 해당없음은 이상없음의 사유로 격하(11.3차)", () => {
  assert.deepStrictEqual(V.VERDICTS, ["이상없음", "검토의견"]);
  assert.deepStrictEqual(V.OK_REASONS, ["반영되어 있음", "해당사항 없음"]);
});

test("setVerdict: 판정 추가(불변 — 원본 미변경)", () => {
  const s0 = {};
  const s1 = V.setVerdict(s0, "CMN-12", "이상없음", "", "2026-07-09");
  assert.deepStrictEqual(s0, {});
  assert.strictEqual(s1["CMN-12"].verdict, "이상없음");
  assert.strictEqual(s1["CMN-12"].date, "2026-07-09");
  assert.strictEqual(s1["CMN-12"].origin, "manual");
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

test("verdictSummary: 판정 집계 + 사유별 집계", () => {
  let s = {};
  s = V.setVerdict(s, "A", "이상없음", "", "d", "반영되어 있음");
  s = V.setVerdict(s, "B", "이상없음", "", "d");
  s = V.setVerdict(s, "C", "검토의견", "x", "d");
  s = V.setVerdict(s, "D", "이상없음", "", "d", "해당사항 없음");
  const sum = V.verdictSummary(s);
  assert.strictEqual(sum["이상없음"], 3);
  assert.strictEqual(sum["검토의견"], 1);
  assert.strictEqual(sum.total, 4);
  assert.strictEqual(sum.reasons["반영되어 있음"], 1);
  assert.strictEqual(sum.reasons["해당사항 없음"], 1);
});

test("verdictSummary: 빈 store", () => {
  assert.deepStrictEqual(V.verdictSummary({}),
    { "이상없음": 0, "검토의견": 0, total: 0, reasons: { "반영되어 있음": 0, "해당사항 없음": 0 } });
});

test("exportVerdicts: meta + verdicts 구조", () => {
  const s = V.setVerdict({}, "CMN-12", "이상없음", "", "2026-07-09");
  const out = V.exportVerdicts(s, { type_id: "nda", date: "2026-07-09", contract_hash: "cr-abc" });
  assert.strictEqual(out.meta.type_id, "nda");
  assert.strictEqual(out.meta.contract_hash, "cr-abc");
  assert.strictEqual(out.verdicts["CMN-12"].verdict, "이상없음");
});

test("exportVerdicts: 시스템 평가 원장을 선택적으로 함께 내보낸다", () => {
  const assessments = { format: "cr-system-assessment-v1", items: { A: {} } };
  const out = V.exportVerdicts({}, { contract_hash: "cr-abc" }, assessments);
  assert.strictEqual(out.system_assessments, assessments);
});

test("판정 출처: 일괄·부속서류 출처를 구분해 보존한다", () => {
  const bulk = V.bulkVerdict({}, ["A"], "이상없음", "d");
  assert.strictEqual(bulk.store.A.origin, "bulk");
  const subdoc = V.bulkVerdictComment({}, ["B"], "이상없음", "별첨", "d", "", "subdoc");
  assert.strictEqual(subdoc.store.B.origin, "subdoc");
  assert.strictEqual(V.migrateStore({ C: { verdict: "이상없음" } }).C.origin, "legacy");
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
  const r = V.bulkVerdict(store, ["A-1", "B-2", "C-3"], "이상없음", "d2", "해당사항 없음");
  assert.strictEqual(r.applied, 2);                       // B-2, C-3만
  assert.strictEqual(r.store["A-1"].verdict, "검토의견");  // 예외 보존
  assert.strictEqual(r.store["A-1"].comment, "예외 코멘트");
  assert.strictEqual(r.store["B-2"].verdict, "이상없음");
  assert.strictEqual(r.store["B-2"].reason, "해당사항 없음");
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

// ── 종합 검토의견 자동 초안(composeOpinion) ─────────────────────────
test("composeOpinion: 특이사항 없음 — 전반 상태 1문장 + 특이사항 없음", () => {
  const t = V.composeOpinion({
    name: "업무위탁계약서", clauseCount: 24, typeName: "조달",
    mustCoreLabels: [], opinions: [], formalWarnTitles: []
  });
  assert.strictEqual(t,
    "업무위탁계약서(24개 조항, 조달 유형) 검토 결과 추가 판단이 필요한 필수 항목 없음. 전반적으로 특이사항 없음.");
});

test("composeOpinion: 검토의견 인용 — 코멘트 전체 인용·필수 우선 정렬·외 N건", () => {
  const long = "가".repeat(100);
  const t = V.composeOpinion({
    name: "계약서", clauseCount: 10, typeName: "조달",
    mustCoreLabels: [],
    opinions: [
      { label: "권장A", severity: "권장", loc: "제3조(대금)", comment: "지급기일 명시 필요" },
      { label: "필수B", severity: "필수", loc: "제8조(지체상금)", comment: long },
      { label: "권장C", severity: "권장", loc: "", comment: "" },
      { label: "참고D", severity: "참고", loc: "제9조", comment: "참고 의견" },
    ],
    formalWarnTitles: []
  });
  // 필수 먼저 인용하고 긴 코멘트도 자르지 않음
  assert.ok(t.indexOf("다만, 제8조(지체상금) 관련 「필수B」에 대하여 ‘" + long + "’ 의견이 있어 보완 필요함.") !== -1);
  // 권장은 "또한"으로 이어짐, 코멘트 없으면 인용부 생략
  assert.ok(t.indexOf("또한 제3조(대금) 관련 「권장A」에 대하여 ‘지급기일 명시 필요’ 의견이 있어 보완 필요함.") !== -1);
  // 조항 미귀속 의견은 "계약서 전체를 기준으로 볼 때"로 지칭(2026-07-30 피드백 — "(전문)" 내부 라벨 노출 금지)
  assert.ok(t.indexOf("또한 계약서 전체를 기준으로 볼 때 「권장C」에 대하여 의견이 있어 보완 필요함.") !== -1);
  // 3건 초과분은 "외 N건"으로 축약(참고D 미인용)
  assert.ok(t.indexOf("참고D") === -1);
  assert.ok(t.indexOf("외 검토의견 1건이 있음.") !== -1);
});

test("composeOpinion: 조항 위치 축약 — 표제 뒤 본문이 붙어도 조번호(+제목)만 인용", () => {
  const t = V.composeOpinion({
    name: "계약서", clauseCount: 6, typeName: "조달", mustCoreLabels: [],
    opinions: [{ label: "지체상금 예정", severity: "권장",
      loc: "제5조(지체상금) 을이 납품을 지체한 경우 지체일수당 1천분의 1의 지체상금을 지급한다.",
      comment: "상한 설정 필요" }],
    formalWarnTitles: []
  });
  assert.ok(t.indexOf("다만, 제5조(지체상금) 관련 「지체상금 예정」에 대하여 ‘상한 설정 필요’ 의견이 있어 보완 필요함.") !== -1);
  assert.ok(t.indexOf("지체일수당") === -1);
});

test("composeOpinion: 추가 판단 필수 항목 — 적용·보완 판단 문장 + 1문장 상태 반영", () => {
  const one = V.composeOpinion({
    name: "계약서", clauseCount: 5, typeName: "업무위탁",
    mustCoreLabels: ["재위탁 사전동의"], opinions: [], formalWarnTitles: []
  });
  assert.ok(one.indexOf("검토 결과 추가 판단이 필요한 필수 항목이 1건 있음.") !== -1);
  assert.ok(one.indexOf("「재위탁 사전동의」 항목은 해당 여부 또는 계약 내용 보완 필요성 판단 요함.") !== -1);
  const many = V.composeOpinion({
    name: "계약서", clauseCount: 5, typeName: "업무위탁",
    mustCoreLabels: ["재위탁 사전동의", "손해배상"], opinions: [], formalWarnTitles: []
  });
  assert.ok(many.indexOf("「재위탁 사전동의」 등 2건은 해당 여부 또는 계약 내용 보완 필요성 판단 요함.") !== -1);
});

test("composeOpinion: 형식 경고 1줄 + 유형 미확정 표기", () => {
  const t = V.composeOpinion({
    clauseCount: 3, typeName: null, mustCoreLabels: [],
    opinions: [], formalWarnTitles: ["대표자 이름 표기", "회사 주소 표기"]
  });
  assert.ok(t.indexOf("계약서(3개 조항, 유형 미확정) 검토 결과") === 0);
  assert.ok(t.indexOf("형식 점검에서 「대표자 이름 표기」 등 2건 경고가 있어 확인 요함.") !== -1);
  // 형식 경고가 있으므로 "특이사항 없음" 미출력
  assert.ok(t.indexOf("특이사항 없음") === -1);
});

test("opinionKey: 계약서 해시별 저장키", () => {
  assert.strictEqual(V.opinionKey("cr-abc"), "cr-opinion-cr-abc");
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


// ── composeOpinion 비교 모드(재검토) — compare 옵션 인자 ─────────────
test("composeOpinion: compare 지정 시 전년 대비 요지 문장이 1문장 뒤에 붙는다", () => {
  const t = V.composeOpinion({
    name: "IT용역계약서", clauseCount: 20, typeName: "조달",
    mustCoreLabels: [], opinions: [], formalWarnTitles: [],
    compare: { date: "2025-07-30", changed: 4, added: 2, removed: 1 }
  });
  assert.ok(t.indexOf("전년(2025-07-30) 검토 대비 변경 4·신설 2·삭제 1개 조항이 달라짐.") !== -1, t);
  // 1문장(전반 상태) 바로 뒤에 위치
  assert.ok(t.indexOf("필수 항목 없음. 전년(") !== -1, t);
});

test("composeOpinion: compare 변동 0건이면 '조항 구성 변동 없음' 문장", () => {
  const t = V.composeOpinion({
    name: "계약서", clauseCount: 10, typeName: null,
    compare: { date: "2025-07-30", changed: 0, added: 0, removed: 0 }
  });
  assert.ok(t.indexOf("전년(2025-07-30) 검토 대비 조항 구성 변동 없음.") !== -1, t);
});

test("composeOpinion: compare 미지정이면 기존 출력 불변(무영향)", () => {
  const t = V.composeOpinion({
    name: "업무위탁계약서", clauseCount: 24, typeName: "조달",
    mustCoreLabels: [], opinions: [], formalWarnTitles: []
  });
  assert.strictEqual(t.indexOf("전년"), -1);
});

// ── 구 판정값 이관(11.3차) ───────────────────────────────────────
test("migrateStore: 구 '해당없음' → 이상없음 + 사유 '해당사항 없음'", () => {
  const legacy = {
    A: { verdict: "해당없음", comment: "우리 케이스 아님", date: "d" },
    B: { verdict: "이상없음", comment: "", date: "d" },
    C: { verdict: "검토의견", comment: "수정 요청", date: "d" },
    D: { verdict: "없는판정" },
  };
  const m = V.migrateStore(legacy);
  assert.strictEqual(m.A.verdict, "이상없음");
  assert.strictEqual(m.A.reason, "해당사항 없음");
  assert.strictEqual(m.A.comment, "우리 케이스 아님", "코멘트 보존");
  assert.strictEqual(m.B.reason, "", "원래 이상없음은 사유 없음");
  assert.strictEqual(m.C.verdict, "검토의견");
  assert.strictEqual(m.D, undefined, "유효하지 않은 판정은 버림");
});

test("importVerdicts: 구 버전 회신 파일도 자동 이관해 받는다", () => {
  const file = { meta: {}, verdicts: { X: { verdict: "해당없음", comment: "" } } };
  const got = V.importVerdicts(file);
  assert.strictEqual(got.X.verdict, "이상없음");
  assert.strictEqual(got.X.reason, "해당사항 없음");
});

test("setReason: 이상없음일 때만 사유가 붙는다", () => {
  let s = V.setVerdict({}, "A", "이상없음", "", "d");
  s = V.setReason(s, "A", "반영되어 있음");
  assert.strictEqual(s.A.reason, "반영되어 있음");
  // 검토의견에는 사유가 붙지 않음
  let s2 = V.setVerdict({}, "B", "검토의견", "메모", "d");
  s2 = V.setReason(s2, "B", "반영되어 있음");
  assert.strictEqual(s2.B.reason || "", "");
  // 허용되지 않은 사유는 빈값
  let s3 = V.setVerdict({}, "C", "이상없음", "", "d", "아무말");
  assert.strictEqual(s3.C.reason, "");
});
