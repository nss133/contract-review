"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const {
  detectType, suggestModules, analyze,
  checkText, clauseQuery, buildModel, citationHit,
  scoreClauseCheck, decideTier, normMatches, titleBonus,
  alarmGate, coverageOf, preconditionMet, pickType,
} = require("../src/matcher.js");
const MC = require("../src/matcher_config.js");
const ClauseRole = require("../src/clause_role.js");

// ── 픽스처 ───────────────────────────────────────────────────────
const TYPES = [
  { meta: { type_id: "outsourcing", detect_keywords: ["위탁", "수탁"] }, checkpoints: [] },
  { meta: { type_id: "nda", detect_keywords: ["비밀유지"] }, checkpoints: [] },
];

const CHECK_REWI = {
  id: "CORE-07", module: "M-CORE", norm_type: "임의", absence_check: true, severity: "권장",
  check: "수탁자가 위탁자의 사전 동의 없이 재위탁하지 못하도록 하는 조항이 있는가",
  triggers: { keywords: ["재위탁", "재수탁", "사전 동의", "제3자에게 위탁"] },
  sources: [{
    law: "금융기관의 업무위탁 등에 관한 규정", article: "제3조(업무위탁 등)", clause: "제4항",
    quote: "위탁받은 업무를 제3자에게 재위탁할 수 있다",
  }],
};
const CHECK_BIZ = {
  id: "BIZ", module: "M-CORE", norm_type: "실무", absence_check: true, severity: "참고",
  check: "위탁 대상 업무의 범위가 열거 방식으로 구체적으로 특정되어 있는가",
  triggers: { keywords: ["위탁업무", "업무의 범위", "위탁 대상"] }, sources: [],
};
const CHECK_PRIV = {
  id: "PRIV-01", module: "M-PRIV", norm_type: "강행", absence_check: true, severity: "필수",
  check: "개인정보 처리위탁 시 위탁 내용을 문서화하였는가",
  triggers: { keywords: ["개인정보", "처리위탁", "위탁 문서"] },
  sources: [{
    law: "개인정보 보호법", article: "제26조(업무위탁에 따른 개인정보의 처리 제한)", clause: "제1항",
    quote: "개인정보의 처리 업무를 위탁하는 경우에는 문서로 한다",
  }],
};
const CHECK_DECOY = {
  id: "DECOY", module: "M-CORE", norm_type: "실무", absence_check: true, severity: "참고",
  check: "손해배상 상한이 설정되어 있는가(재위탁으로 인한 손해 포함)",
  triggers: { keywords: ["손해배상", "배상 상한"] }, sources: [],
};
// 필수·부재 알람 확인용: 어떤 조항과도 매칭되지 않는 필수 absence check
const CHECK_ALARM = {
  id: "ALARM", module: "M-CORE", norm_type: "강행", absence_check: true, severity: "필수",
  check: "이행보증을 위한 보증보험 가입 의무가 규정되어 있는가",
  triggers: { keywords: ["보증보험", "이행보증", "지급보증"] }, sources: [],
};
// weak-role(목적) 조항으로 매칭돼 verify로 남는 케이스용 — 인용 근거 없음
const CHECK_PURPOSE = {
  id: "PURP", module: "M-CORE", norm_type: "실무", absence_check: true, severity: "참고",
  check: "계약의 목적이 위탁 업무의 실질과 일치하게 기재되어 있는가",
  triggers: { keywords: ["목적", "계약의 목적", "위탁"] }, sources: [],
};

const OUT_DOC = {
  meta: {
    type_id: "outsourcing",
    modules: [
      { id: "M-CORE", name: "기본", always_on: true, suggest_keywords: [] },
      { id: "M-PRIV", name: "개인정보", always_on: false, suggest_keywords: ["개인정보"] },
    ],
  },
  checkpoints: [CHECK_REWI, CHECK_BIZ, CHECK_PRIV, CHECK_DECOY, CHECK_ALARM, CHECK_PURPOSE],
};

const CLAUSES = [
  { heading: "제1조 (목적)", body: "이 계약은 갑이 을에게 위탁하는 상담 업무의 수행에 관한 사항을 정함을 목적으로 한다.", index: 0 },
  { heading: "제2조 (위탁업무의 범위)", body: "을이 수행할 업무는 고객 상담, 고객정보 조회 및 개인정보 처리 업무를 포함한다.", index: 1 },
  { heading: "제3조 (계약기간)", body: "이 계약의 유효기간은 계약 체결일로부터 1년으로 한다.", index: 2 },
  { heading: "제5조 (재위탁 금지)", body: "을은 갑의 사전 서면 동의 없이 위탁업무를 제3자에게 재위탁할 수 없다.", index: 3 },
  { heading: "제6조 (비밀유지)", body: "을은 업무 수행 중 알게 된 갑의 영업비밀을 누설하여서는 아니 된다.", index: 4 },
  { heading: "제8조 (개인정보 처리)", body: "개인정보의 처리 업무 위탁은 개인정보 보호법 제26조에 따라 문서로 정한다.", index: 5 },
];

function model(mods) { return buildModel([OUT_DOC], mods || ["M-CORE", "M-PRIV"]); }
function entry(m, id) { return m.checks.filter((c) => c.cp.id === id)[0]; }

// 판정형(채점기) 어휘가 reason에 남지 않았는지 검사하는 헬퍼.
const VERDICT_WORDS = ["단일 후보", "단일 신호", "검토필요", "임계 미달", "미검출", "누락"];
function hasVerdict(reasons) {
  return (reasons || []).some((r) => VERDICT_WORDS.some((w) => r.indexOf(w) !== -1));
}

// ── 텍스트 생성 ──────────────────────────────────────────────────
test("checkText: 질문·quote·키워드·근거표제를 합쳐 전처리한다", () => {
  const t = checkText(CHECK_REWI);
  assert.ok(t.indexOf("재위탁") !== -1);
  assert.ok(t.indexOf("업무위탁") !== -1); // 근거 조문 표제(업무위탁 등)
  assert.ok(t.indexOf("제3자") !== -1);    // quote
});

test("clauseQuery: 표제 용어를 TITLE_K회 반복해 가중한다", () => {
  const q = clauseQuery(CLAUSES[3]); // 제5조 (재위탁 금지)
  const n = q.split("재위탁").length - 1;
  assert.ok(n >= MC.TITLE_K + 1); // 표제 반복(K) + 본문 최소 1
});

// ── citationHit ──────────────────────────────────────────────────
test("citationHit: 법령명+제N조 명시 조항이면 true", () => {
  assert.strictEqual(
    citationHit("본 업무는 개인정보 보호법 제26조에 따라 문서로 정한다", CHECK_PRIV), true);
});

test("citationHit: 무관 조항이면 false", () => {
  assert.strictEqual(citationHit("을은 비밀을 누설하여서는 아니 된다", CHECK_PRIV), false);
});

test("citationHit: 법령명만 있고 조번호 없으면 false", () => {
  assert.strictEqual(citationHit("개인정보 보호법을 준수한다", CHECK_PRIV), false);
});

test("citationHit: 조번호 불일치면 false", () => {
  assert.strictEqual(citationHit("개인정보 보호법 제15조에 따른다", CHECK_PRIV), false);
});

// ── normMatches 매핑 ─────────────────────────────────────────────
test("normMatches: 강행↔의무/금지, 임의↔권한, 추정/간주↔선언, 실무↔무매치", () => {
  assert.strictEqual(normMatches("의무", "강행"), true);
  assert.strictEqual(normMatches("금지", "강행"), true);
  assert.strictEqual(normMatches("권한", "임의"), true);
  assert.strictEqual(normMatches("선언", "추정"), true);
  assert.strictEqual(normMatches("선언", "간주"), true);
  assert.strictEqual(normMatches("의무", "임의"), false);
  assert.strictEqual(normMatches("의무", "실무"), false);
  assert.strictEqual(normMatches(null, "강행"), false);
});

// ── scoreClauseCheck ─────────────────────────────────────────────
test("scoreClauseCheck: 동일 주제 조항이 무관 조항보다 높은 점수", () => {
  const m = model(["M-CORE"]);
  const e = entry(m, "CORE-07");
  const onTopic = scoreClauseCheck(CLAUSES[3], e, m); // 재위탁 금지
  const offTopic = scoreClauseCheck(CLAUSES[2], e, m); // 계약기간
  assert.ok(onTopic.score > offTopic.score);
  assert.ok(onTopic.signals >= 1);
});

test("scoreClauseCheck: normMatch면 NORM_BONUS만큼 점수가 오른다", () => {
  const m = model(["M-CORE", "M-PRIV"]);
  const e = entry(m, "PRIV-01"); // 강행
  // 제6조 본문 "누설하여서는 아니 된다" → 금지, 강행↔금지 매칭
  assert.strictEqual(ClauseRole.normType(CLAUSES[4].body), "금지");
  const s = scoreClauseCheck(CLAUSES[4], e, m);
  assert.strictEqual(s.normMatch, true);
  // 규범유형만 비워 동일 조항 재채점 → 차이가 NORM_BONUS
  const e2 = { cp: Object.assign({}, e.cp, { norm_type: "실무" }), text: e.text, doc: e.doc };
  const s2 = scoreClauseCheck(CLAUSES[4], e2, m);
  assert.strictEqual(s2.normMatch, false);
  assert.ok(Math.abs((s.score - s2.score) - MC.NORM_BONUS) < 1e-9);
});

test("scoreClauseCheck: length-adaptive — 짧은 조항은 jaccard 가중이 커진다", () => {
  const m = model(["M-CORE"]);
  const e = entry(m, "BIZ");
  const shortCl = { heading: "제2조 (위탁업무의 범위)", body: "위탁업무 범위를 정한다.", index: 0 };
  const longBody = shortCl.body + " " + "가".repeat(MC.SHORT_LEN);
  const longCl = { heading: shortCl.heading, body: longBody, index: 0 };
  const sShort = scoreClauseCheck(shortCl, e, m);
  const sLong = scoreClauseCheck(longCl, e, m);
  assert.notStrictEqual(sShort.score, sLong.score);
});

test("scoreClauseCheck: titleBonus — 표제 용어가 check 핵심어와 겹치면 가산", () => {
  const m = model(["M-CORE"]);
  const e = entry(m, "CORE-07");
  const withTitle = titleBonus(CLAUSES[3], e.text);   // 표제 "재위탁 금지"
  const noTitle = titleBonus({ heading: "제9조", body: "..." }, e.text); // 표제 없음
  assert.ok(withTitle > 0 && withTitle <= MC.TITLE_BONUS_MAX);
  assert.strictEqual(noTitle, 0);
});

// ── 핵심어 겹침 게이트 ───────────────────────────────────────────
const { overlapFeatures, passesOverlapGate } = require("../src/matcher.js");

test("overlapFeatures: 표제어∪본문어 ∩ check 핵심어 개수(중복 제거)", () => {
  // 제8조(개인정보 처리) vs CHECK_PRIV — 개인정보·처리·위탁 등 복수 핵심어 겹침
  const f = overlapFeatures(CLAUSES[5], CHECK_PRIV);
  assert.ok(f.uniq >= 2);
  // 무관 조항(계약기간) vs 개인정보 check → 겹침 없음
  const f0 = overlapFeatures(CLAUSES[2], CHECK_PRIV);
  assert.strictEqual(f0.uniq, 0);
});

test("overlapFeatures: 표제 핵심어 대부분이 겹치면 titleStrong", () => {
  // 제6조 (비밀유지) — 표제어 '비밀유지'가 CHECK 하나짜리와 완전 일치하는 상황을 모사
  const check = { id: "SEC", check: "비밀유지 의무 조항이 있는가", triggers: { keywords: ["비밀유지"] }, sources: [] };
  const f = overlapFeatures(CLAUSES[4], check); // 표제 (비밀유지)
  assert.strictEqual(f.titleStrong, true);
  // 표제가 없으면 titleStrong 불가
  const noTitle = overlapFeatures({ heading: "제9조", body: "비밀유지 의무를 진다" }, check);
  assert.strictEqual(noTitle.titleStrong, false);
});

test("passesOverlapGate: 겹침 0(순수 n-gram 잡음)은 탈락", () => {
  // 계약기간 조항 vs 개인정보 check — 핵심어 겹침 없음
  assert.strictEqual(passesOverlapGate(CLAUSES[2], CHECK_PRIV, false), false);
});

test("passesOverlapGate: 복수 겹침(>=OVERLAP_MIN)이면 통과", () => {
  // 개인정보 처리 조항 vs 개인정보 check — 개인정보·처리·위탁 등 복수 겹침
  const f = overlapFeatures(CLAUSES[5], CHECK_PRIV);
  assert.ok(f.uniq >= MC.OVERLAP_MIN);
  assert.strictEqual(passesOverlapGate(CLAUSES[5], CHECK_PRIV, false), true);
});

test("passesOverlapGate: 표제 강일치면 단일 겹침이라도 통과(타이틀 가중)", () => {
  const check = { id: "SEC", check: "비밀유지 조항이 있는가", triggers: { keywords: ["비밀유지"] }, sources: [] };
  const f = overlapFeatures(CLAUSES[4], check);
  assert.ok(f.uniq < MC.OVERLAP_MIN);   // 복수 겹침은 미달
  assert.strictEqual(f.titleStrong, true);
  assert.strictEqual(passesOverlapGate(CLAUSES[4], check, false), true);
});

test("passesOverlapGate: 명시 인용이면 겹침 무관 통과", () => {
  assert.strictEqual(passesOverlapGate(CLAUSES[2], CHECK_PRIV, true), true);
});

// ── decideTier: 단일후보/단일신호 강등 제거 ──────────────────────
function cand(clause, over) {
  return { clause: clause, s: Object.assign(
    { score: 20, tfidf: 20, jaccard: 20, normMatch: false, titleBonus: 0, citation: false, signals: 2 }, over) };
}
const GEN = { heading: "제5조 (재위탁 금지)", body: "을은 재위탁하여서는 아니 된다." };
const PURPOSE = { heading: "제1조 (목적)", body: "이 계약은 ...을 목적으로 한다." };

test("decideTier: 인용 일치면 단일 후보라도 confirmed", () => {
  const r = decideTier([cand(GEN, { citation: true, score: 18 })], CHECK_REWI);
  assert.strictEqual(r, "confirmed");
});

test("decideTier: 큰 점수차 복수 신호면 confirmed", () => {
  const r = decideTier([cand(GEN, { score: 40 }), cand(PURPOSE, { score: 20 })], CHECK_BIZ);
  assert.strictEqual(r, "confirmed");
});

test("decideTier: 단일 후보(비인용)라도 강근거면 강등 없이 confirmed", () => {
  // 계약서 도메인에선 단일 매칭이 정상 — score≥ABS 단독이면 짚음
  const r = decideTier([cand(GEN, { score: 40 })], CHECK_BIZ);
  assert.strictEqual(r, "confirmed");
});

test("decideTier: 단일 신호(signals<2)라도 강등 없이 confirmed", () => {
  const r = decideTier([cand(GEN, { score: 40, signals: 1 })], CHECK_BIZ);
  assert.strictEqual(r, "confirmed");
});

test("decideTier: 절대점수 단독(ABS 이상, 비규범·비인용)이면 confirmed", () => {
  const r = decideTier([cand(GEN, { score: MC.ABS_SCORE + 1, normMatch: false })], CHECK_BIZ);
  assert.strictEqual(r, "confirmed");
});

test("decideTier: floor~ABS 사이 단독(비인용·비margin)이면 확인 권장(review)", () => {
  const r = decideTier([cand(GEN, { score: 25 })], CHECK_BIZ);
  assert.strictEqual(r, "review");
});

test("decideTier: weak 역할 + 인용 없음이면 confirmed 불가(review)", () => {
  // 목적 조항이 절대점수·규범일치를 충족해도 weak 게이트로 review
  const r = decideTier(
    [cand(PURPOSE, { score: 45, normMatch: true }), cand(GEN, { score: 20 })], CHECK_BIZ);
  assert.strictEqual(r, "review");
});

test("decideTier: weak 역할이라도 명시 인용이면 confirmed", () => {
  const r = decideTier([cand(PURPOSE, { score: 20, citation: true })], CHECK_BIZ);
  assert.strictEqual(r, "confirmed");
});

test("decideTier: 후보 없음(전부 floor 미달)이면 none", () => {
  assert.strictEqual(decideTier([], CHECK_BIZ), "none");
});

// ── coverage 파생 + 알람 게이트 ──────────────────────────────────
test("alarmGate: 필수·권장은 통과, 참고는 미통과", () => {
  assert.strictEqual(alarmGate({ severity: "필수" }), true);
  assert.strictEqual(alarmGate({ severity: "권장" }), true);
  assert.strictEqual(alarmGate({ severity: "참고" }), false);
  assert.strictEqual(alarmGate({}), false);
});

test("coverageOf: confirmed→addressed, review→verify", () => {
  assert.strictEqual(coverageOf("confirmed", CHECK_PRIV), "addressed");
  assert.strictEqual(coverageOf("review", CHECK_PRIV), "verify");
});

test("coverageOf: none 알람 게이트 — 필수/권장 부재는 consider, 참고 부재는 quiet", () => {
  assert.strictEqual(coverageOf("none", { absence_check: true, severity: "필수" }), "consider");
  assert.strictEqual(coverageOf("none", { absence_check: true, severity: "권장" }), "consider");
  assert.strictEqual(coverageOf("none", { absence_check: true, severity: "참고" }), "quiet");
  // absence_check 아님 → 게이트 이전에 quiet
  assert.strictEqual(coverageOf("none", { absence_check: false, severity: "필수" }), "quiet");
});

// ── analyze 통합 ─────────────────────────────────────────────────
test("analyze: 골든 — 재위탁 단독 조항이 짚음(addressed), 유사어 decoy는 확정 안 됨", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE"]);
  const byId = {};
  r.results.forEach((x) => { byId[x.cpId] = x; });
  // 재위탁 check: 제5조에 addressed — 단일 매칭이지만 강등되지 않음
  assert.strictEqual(byId["CORE-07"].coverage, "addressed");
  assert.strictEqual(byId["CORE-07"].tier, "confirmed");
  assert.strictEqual(byId["CORE-07"].best.clauseIndex, 3);
  // "재위탁"이 quote에 우연히 있는 손해배상 decoy는 확정 안 됨(해당 조항 부재)
  assert.notStrictEqual(byId["DECOY"].tier, "confirmed");
});

test("analyze: 명시 인용 조항이면 addressed + 인용 reason", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE", "M-PRIV"]);
  const priv = r.results.filter((x) => x.cpId === "PRIV-01")[0];
  assert.strictEqual(priv.coverage, "addressed");
  assert.ok(priv.best.reasons.some((s) => s.indexOf("명시 인용 일치") !== -1));
  assert.ok(priv.best.reasons.some((s) => s.indexOf("개인정보 보호법") !== -1 && s.indexOf("제26조") !== -1));
});

test("analyze: consider 게이트 — 필수 미매칭은 consider, 참고 미매칭은 quiet", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE"]);
  const byId = {};
  r.results.forEach((x) => { byId[x.cpId] = x; });
  // 보증보험 조항 없음 + 필수 → consider(검토 제안)
  assert.strictEqual(byId["ALARM"].tier, "none");
  assert.strictEqual(byId["ALARM"].coverage, "consider");
  // 손해배상 조항 없음 + 참고 → 저위험 부재는 조용(quiet)
  assert.strictEqual(byId["DECOY"].tier, "none");
  assert.strictEqual(byId["DECOY"].coverage, "quiet");
});

test("analyze: coverage는 항상 4값 중 하나", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE", "M-PRIV"]);
  const VALID = ["addressed", "verify", "consider", "quiet"];
  r.results.forEach((x) => { assert.ok(VALID.indexOf(x.coverage) !== -1, x.cpId + " " + x.coverage); });
});

test("analyze: reason은 정보형 — 판정형(단일 후보/검토필요/미검출) 문구가 없다", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE", "M-PRIV"]);
  r.results.forEach((x) => {
    if (x.best) assert.ok(!hasVerdict(x.best.reasons), x.cpId + ": " + JSON.stringify(x.best.reasons));
  });
  r.matches.forEach((m) => assert.ok(!hasVerdict(m.hits.reasons)));
});

test("analyze: verify(weak-role) reason은 목적·정의 문구 확인 권장 안내", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE"]);
  const purp = r.results.filter((x) => x.cpId === "PURP")[0];
  // 목적(weak) 조항 매칭 + 인용 없음 → 자동확정 불가, verify
  assert.strictEqual(purp.coverage, "verify");
  assert.ok(purp.best.reasons.some((s) => s.indexOf("목적·정의 조항이라 문구 확인 권장") !== -1));
  // 일반 verify 안내 문구도 존재하는지(충분한지 확인 권장) 확인
  const allVerify = r.results.filter((x) => x.coverage === "verify" && x.best);
  assert.ok(allVerify.every((x) => x.best.reasons.some((s) => s.indexOf("확인 권장") !== -1)));
});

test("analyze: absence 재정의 — missing === coverage 'consider' 집합", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE"]);
  const missingIds = r.missing.map((c) => c.id).sort();
  const considerIds = r.results.filter((x) => x.coverage === "consider").map((x) => x.cpId).sort();
  assert.deepStrictEqual(missingIds, considerIds);
  // 보증보험 미매칭(필수) → consider/누락, 재위탁 조항 존재 → 누락 아님
  assert.ok(missingIds.indexOf("ALARM") !== -1);
  assert.ok(missingIds.indexOf("CORE-07") === -1);
  // 저위험(참고) 미매칭 손해배상은 알람 억제 → missing 아님
  assert.ok(missingIds.indexOf("DECOY") === -1);
});

test("analyze: 겹침 게이트 — 단일 어절만 겹친 약한 후보는 quiet로 강등", () => {
  // '업무'라는 흔한 어절 하나로 여러 조항에 걸리지만 표제·복수겹침 없는 check.
  const WEAK = {
    id: "WEAK", module: "M-CORE", norm_type: "실무", absence_check: false, severity: "참고",
    check: "수급인의 손해배상 예정액 산정 방식이 규정되어 있는가",
    triggers: { keywords: ["손해배상 예정액", "지연손해금"] }, sources: [],
  };
  const doc = { meta: OUT_DOC.meta, checkpoints: [WEAK] };
  const r = analyze(CLAUSES, [doc], ["M-CORE"]);
  const w = r.results.filter((x) => x.cpId === "WEAK")[0];
  // 손해배상 예정액 조항이 계약서에 없음 → 강한 매칭 불가. 걸리더라도 겹침 게이트로 quiet.
  assert.strictEqual(w.coverage, "quiet");
  // quiet면 노출 매칭(matches)에 포함되지 않음
  assert.ok(!r.matches.some((m) => m.cpId === "WEAK"));
});

test("analyze: 겹침 게이트 — 복수 겹침/표제강일치 진짜 매칭은 보존", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE", "M-PRIV"]);
  const byId = {};
  r.results.forEach((x) => { byId[x.cpId] = x; });
  // PRIV-01(개인정보 문서화): 제8조 명시 인용 → 게이트 예외로 보존(addressed)
  assert.strictEqual(byId["PRIV-01"].coverage, "addressed");
  // 재위탁(CORE-07): 제5조 복수 겹침 → 보존
  assert.strictEqual(byId["CORE-07"].coverage, "addressed");
  // gate 메타가 노출 매칭 best에 실림
  assert.ok(byId["CORE-07"].best.gate && byId["CORE-07"].best.gate.passed === true);
});

test("analyze: 활성 모듈만 대상 — M-PRIV 비활성이면 PRIV-01 제외", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE"]);
  assert.ok(r.checkpoints.every((c) => c.id !== "PRIV-01"));
  const r2 = analyze(CLAUSES, [OUT_DOC], ["M-CORE", "M-PRIV"]);
  assert.ok(r2.checkpoints.some((c) => c.id === "PRIV-01"));
});

test("analyze: 하위호환 — checkpoints/results/matches/missing 필드 존재", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE"]);
  assert.ok(Array.isArray(r.checkpoints));
  assert.ok(Array.isArray(r.results));
  assert.ok(Array.isArray(r.matches));
  assert.ok(Array.isArray(r.missing));
  r.matches.forEach((m) => {
    assert.ok(typeof m.cpId === "string" && typeof m.clauseIndex === "number");
  });
  const cpIds = r.matches.map((m) => m.cpId);
  assert.strictEqual(cpIds.length, new Set(cpIds).size);
});

// ── 회귀: detectType·suggestModules ──────────────────────────────
test("detectType: 키워드 빈도로 유형 순위를 매긴다", () => {
  const ranked = detectType("이 업무위탁 계약에서 수탁자는...", TYPES);
  assert.strictEqual(ranked[0].typeId, "outsourcing");
  assert.ok(ranked[0].score > ranked[1].score);
});

// ── 유형 감지 v2(P3): 표제 가중·본문 캡·미확정 임계 ──────────────
test("detectType v2: 표제부 키워드는 본문보다 강하게 가중된다", () => {
  const pad = "무관한 내용. ".repeat(50); // 300자 초과 패딩 — 키워드를 본문 영역으로 밀어냄
  const inHead = detectType("업무위탁계약서\n" + pad, TYPES);
  const inBody = detectType(pad + " 위탁", TYPES);
  const h = inHead.find((r) => r.typeId === "outsourcing");
  const b = inBody.find((r) => r.typeId === "outsourcing");
  assert.ok(h.score > b.score, "표제 출현이 본문 출현보다 점수가 높아야 함");
});

test("detectType v2: 본문 반복 출현은 키워드당 캡으로 억제된다", () => {
  const pad = "무관한 내용. ".repeat(50);
  const many = detectType(pad + " 위탁 ".repeat(50), TYPES); // 본문 50회
  const m = many.find((r) => r.typeId === "outsourcing");
  assert.ok(m.score <= MC.DETECT_BODY_CAP, "본문 반복은 DETECT_BODY_CAP 이하로 캡");
});

test("pickType: 임계 미달이면 미확정(null), 표제 1회면 확정", () => {
  const pad = "무관한 내용. ".repeat(50);
  // 본문 1회(점수 1) — 임계(3) 미달 → 미확정
  assert.strictEqual(pickType(detectType(pad + " 위탁", TYPES)), null);
  // 표제 1회(점수 3) — 확정
  assert.strictEqual(pickType(detectType("업무위탁계약서\n" + pad, TYPES)), "outsourcing");
  // 무신호 — 미확정
  assert.strictEqual(pickType(detectType("임대차에 관한 일반 문서", TYPES)), null);
});

test("suggestModules: 본문 키워드로 모듈 활성화를 제안한다", () => {
  const s = suggestModules("개인정보 처리 업무 포함", OUT_DOC.meta.modules);
  assert.deepStrictEqual(s.on, ["M-PRIV"]);
  assert.deepStrictEqual(suggestModules("무관한 내용", OUT_DOC.meta.modules).on, []);
});

// ── activation: confirm(②) — 강신호 자동/약신호 질문/무신호 꺼짐 ──
const CONFIRM_MODS = [
  { id: "M-PII", name: "개인정보", always_on: false, activation: "confirm",
    suggest_keywords: ["개인정보", "신용정보", "정보주체", "고객정보"] },
];
test("suggestModules confirm: 강신호(서로 다른 2개+)면 자동 활성", () => {
  const s = suggestModules("개인정보 및 신용정보의 처리 위탁", CONFIRM_MODS);
  assert.deepStrictEqual(s, { on: ["M-PII"], ask: [] });
});
test("suggestModules confirm: 반복 언급(총 3회+)도 강신호", () => {
  const s = suggestModules("개인정보의 수집, 개인정보의 이용, 개인정보의 파기", CONFIRM_MODS);
  assert.deepStrictEqual(s, { on: ["M-PII"], ask: [] });
});
test("suggestModules confirm: 약신호(상투 준수조항 1회)는 질문(ask)", () => {
  const s = suggestModules("을은 관계 법령 및 개인정보 보호법을 준수한다.", CONFIRM_MODS);
  assert.deepStrictEqual(s, { on: [], ask: ["M-PII"] });
});
test("suggestModules confirm: 무신호는 꺼짐", () => {
  const s = suggestModules("일반 물품 구매 계약", CONFIRM_MODS);
  assert.deepStrictEqual(s, { on: [], ask: [] });
});

// ── 성격 배타 게이트(A3): 화해계약 강신호가 상법 유형을 억제 ──────────
const NATURE_TYPES = [
  { meta: {
    type_id: "settlement",
    detect_keywords: ["화해", "상호양보", "부제소", "청구권 포기"],
    nature_signals: ["화해", "상호양보", "부제소", "청구권 포기"],
    suppresses: ["shareholders"],
  } },
  { meta: {
    type_id: "shareholders",
    detect_keywords: ["주주간", "주식양도", "의결권", "우선매수"],
  } },
];

test("detectType 성격게이트: 화해 강신호 복수면 shareholders 억제(화해합의서 오탐 차단)", () => {
  // 화해합의서인데 '주식양도' 부수 언급 — 화해 강신호(화해·상호양보·부제소) 3개 검출.
  const text = "화해합의서. 당사자는 상호양보하여 분쟁을 종결하고 향후 부제소한다. " +
    "대상은 갑이 을에게 한 주식양도 대금 정산 분쟁이다.";
  const ranked = detectType(text, NATURE_TYPES);
  assert.strictEqual(ranked[0].typeId, "settlement");
  const sh = ranked.find((r) => r.typeId === "shareholders");
  assert.strictEqual(sh.score, 0, "shareholders 점수가 0으로 억제되어야 함");
});

test("detectType 성격게이트: 진성 주주간계약은 억제 안 됨(화해 부수언급 1회 무시)", () => {
  // 주주간계약 — 화해는 1회만 부수 언급(임계 미달), 상법 신호 지배적.
  const text = "주주간계약. 주식양도 제한, 의결권 공동행사, 우선매수권을 정한다. " +
    "분쟁 시 화해를 시도할 수 있다.";
  const ranked = detectType(text, NATURE_TYPES);
  assert.strictEqual(ranked[0].typeId, "shareholders");
  assert.ok(ranked[0].score > 0, "shareholders가 억제되지 않아야 함");
});

// ── weak-role 강등(전문·목적에 구체 항목 부착 금지) ──────────────
test("analyze: 구체 체크가 목적 조항에만 매칭되면 quiet(코멘트 부착 금지)", () => {
  // 목적 조항에 CHECK_BIZ(위탁범위) 키워드가 다수 겹치는 상황 — 과거엔 verify로 노출돼
  // '위탁범위' 코멘트가 목적 조항에 붙었음. weak-role 게이트로 quiet 강등돼야 함.
  const purposeOnly = [{
    heading: "제1조 (목적)",
    body: "이 계약은 위탁업무, 업무의 범위, 위탁 대상 업무의 수행에 관한 사항을 정함을 목적으로 한다.",
    index: 0,
  }];
  const r = analyze(purposeOnly, [OUT_DOC], ["M-CORE"]);
  const biz = r.results.find((x) => x.cpId === "BIZ");
  assert.strictEqual(biz.coverage, "quiet", "목적 조항 단독 매칭은 quiet");
  // 반면 목적 조항을 직접 겨냥한 체크(PURP — 표제 강일치)는 살아 있어야 함.
  const purp = r.results.find((x) => x.cpId === "PURP");
  assert.ok(purp.coverage === "verify" || purp.coverage === "addressed",
    "목적 겨냥 체크는 표제 강일치 예외로 유지");
});

// ── 조건부 부재체크(전제신호 게이트) ─────────────────────────────
const CHECK_PLEDGE = {
  id: "PLEDGE", severity: "필수", absence_check: true,
  absence_precondition: ["질권", "근질권", "입질"],
};
const CHECK_NOPRE = { id: "NOPRE", severity: "필수", absence_check: true };

test("preconditionMet: 전제어휘가 본문에 있으면 true", () => {
  assert.strictEqual(preconditionMet(CHECK_PLEDGE, "채권에 질권을 설정한다"), true);
});
test("preconditionMet: 전제어휘가 없으면 false", () => {
  assert.strictEqual(preconditionMet(CHECK_PLEDGE, "저당권만 설정하는 담보계약"), false);
});
test("preconditionMet: precondition 없는 check는 항상 true(하위호환)", () => {
  assert.strictEqual(preconditionMet(CHECK_NOPRE, "아무 내용"), true);
});

test("coverageOf: 전제 불충족 부재체크는 consider가 아니라 quiet", () => {
  // 질권 언급 없는 본문 → 질권 부재알람 억제.
  assert.strictEqual(coverageOf("none", CHECK_PLEDGE, "저당권 담보계약"), "quiet");
  // 질권 언급 있는 본문 → 부재알람 유지(누락검출 살림).
  assert.strictEqual(coverageOf("none", CHECK_PLEDGE, "질권 설정할 수 있다"), "consider");
  // precondition 없는 check는 종전대로 consider.
  assert.strictEqual(coverageOf("none", CHECK_NOPRE, "무관 본문"), "consider");
  // text 미전달(하위호환): 게이트 비활성 → consider.
  assert.strictEqual(coverageOf("none", CHECK_PLEDGE), "consider");
});
