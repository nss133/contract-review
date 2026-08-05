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

test("analyze: verify(weak-role) reason은 목적·정의 해당 여부 확인 안내", () => {
  const r = analyze(CLAUSES, [OUT_DOC], ["M-CORE"]);
  const purp = r.results.filter((x) => x.cpId === "PURP")[0];
  // 목적(weak) 조항 매칭 + 인용 없음 → 자동확정 불가, verify
  assert.strictEqual(purp.coverage, "verify");
  assert.ok(purp.best.reasons.some((s) => s.indexOf("목적·정의 조항이라 해당 여부 확인 필요") !== -1));
  // 일반 verify 안내 문구(매칭 확신 의미 — 내용 충분성 평가 아님, 2026-08-03 교정) 확인
  const allVerify = r.results.filter((x) => x.coverage === "verify" && x.best);
  assert.ok(allVerify.every((x) => x.best.reasons.some((s) => s.indexOf("확인 필요") !== -1)));
});

// ── 결정 문구 승격(decisive_patterns, 2026-08-03) ──────────────────
test("decideTier: 결정 문구 일치 시 review→confirmed 승격 (전속관할)", () => {
  const check = { id: "J-1", check: "분쟁해결 방식과 관할 법원 지정 조항이 있는가",
    severity: "참고", norm_type: "실무", decisive_patterns: ["전속관할", "제1심"] };
  const jur = { heading: "제20조 (관할)",
    body: "이 계약과 관련한 분쟁은 서울중앙지방법원을 제1심 전속관할 법원으로 한다." };
  const other = { heading: "제10조 (손해배상)", body: "분쟁이 발생한 경우 손해를 배상한다." };
  // 점수 20(REVIEW_FLOOR 이상·ABS_SCORE 미만), 마진 2(<MARGIN_HIGH) → 본래 review
  const ranked = [
    { clause: jur, s: { score: 20, citation: false } },
    { clause: other, s: { score: 18, citation: false } },
  ];
  assert.strictEqual(decideTier(ranked, check), "confirmed");
  // 패턴 없으면 원래대로 review — 전역 임계값 무영향 확인
  assert.strictEqual(decideTier(ranked, { ...check, decisive_patterns: [] }), "review");
});

test("decideTier: weak-role 게이트가 결정 문구 승격보다 우선 (정의 조항 오탐 차단)", () => {
  const check = { id: "J-2", check: "관할 법원 지정 조항이 있는가",
    severity: "참고", norm_type: "실무", decisive_patterns: ["전속관할"] };
  const def = { heading: "제2조 (정의)",
    body: "이 계약에서 전속관할이라 함은 특정 법원에만 소를 제기할 수 있는 관할을 말한다." };
  const ranked = [{ clause: def, s: { score: 20, citation: false } }];
  assert.strictEqual(decideTier(ranked, check), "review");
});

test("decisiveHit: 표제·본문에서 패턴 탐지, 없으면 null", () => {
  const { decisiveHit } = require("../src/matcher.js");
  const check = { decisive_patterns: ["대한상사중재원"] };
  assert.strictEqual(
    decisiveHit({ heading: "제21조 (중재)", body: "분쟁은 대한상사중재원의 중재로 해결한다." }, check),
    "대한상사중재원");
  assert.strictEqual(decisiveHit({ heading: "제1조", body: "목적 조항" }, check), null);
  assert.strictEqual(decisiveHit({ heading: "제1조", body: "무엇이든" }, {}), null);
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

// ── 검토 국면(stance) 게이트 — 11차 ──────────────────────────────
const {
  detectStance, normalizeStance, moduleAllowedInStance, checkAllowedInStance,
  activeCheckpoints,
} = require("../src/matcher.js");

const MOD_PARTY_ONLY = { id: "X-ASSET", name: "보험업 자산운용", suggest_keywords: ["자산운용", "대주주"], requires_stance: ["party"] };
const MOD_ANY = { id: "X-PII", name: "개인정보", suggest_keywords: ["개인정보", "신용정보"] };
const MOD_BENEF_ONLY = { id: "M-BENEF", name: "수익자 보호", suggest_keywords: ["수익자", "수익증권"], requires_stance: ["beneficiary"] };

test("normalizeStance: 미지정·이상값은 party(기본)", () => {
  assert.strictEqual(normalizeStance(undefined), "party");
  assert.strictEqual(normalizeStance(""), "party");
  assert.strictEqual(normalizeStance("이상값"), "party");
  assert.strictEqual(normalizeStance("beneficiary"), "beneficiary");
});

test("moduleAllowedInStance: requires_stance 없으면 전 국면 허용", () => {
  assert.strictEqual(moduleAllowedInStance(MOD_ANY, "party"), true);
  assert.strictEqual(moduleAllowedInStance(MOD_ANY, "beneficiary"), true);
});

test("moduleAllowedInStance: party 전용 모듈은 수익자 국면에서 차단", () => {
  assert.strictEqual(moduleAllowedInStance(MOD_PARTY_ONLY, "party"), true);
  assert.strictEqual(moduleAllowedInStance(MOD_PARTY_ONLY, "beneficiary"), false);
  assert.strictEqual(moduleAllowedInStance(MOD_BENEF_ONLY, "party"), false);
  assert.strictEqual(moduleAllowedInStance(MOD_BENEF_ONLY, "beneficiary"), true);
});

test("suggestModules: 수익자 국면에서는 party 전용 모듈이 본문 검출돼도 켜지지 않는다", () => {
  // 실사고 재현(2026-08-04): 신탁계약 본문의 '자산운용·대주주' 문구로 X-ASSET이 오활성했던 건.
  const text = "제5조 집합투자업자는 신탁재산의 자산운용을 하며 대주주와의 거래를 제한한다. 수익자는 수익증권을 소유한다.";
  const asParty = suggestModules(text, [MOD_PARTY_ONLY, MOD_ANY], "party");
  assert.ok(asParty.on.indexOf("X-ASSET") !== -1, "당사자 국면에서는 종전대로 활성");

  const asBenef = suggestModules(text, [MOD_PARTY_ONLY, MOD_ANY], "beneficiary");
  assert.strictEqual(asBenef.on.indexOf("X-ASSET"), -1, "수익자 국면에서는 문구가 있어도 비활성");
  assert.strictEqual(asBenef.ask.indexOf("X-ASSET"), -1, "질문으로도 노출되지 않음");
});

test("suggestModules: stance 미전달 시 종전 동작(하위호환)", () => {
  const text = "자산운용 및 대주주 거래";
  assert.ok(suggestModules(text, [MOD_PARTY_ONLY]).on.indexOf("X-ASSET") !== -1);
});

test("checkAllowedInStance: stance_scope로 체크 단위 노출 제어", () => {
  const cpBenef = { id: "INV-BEN-01", stance_scope: ["beneficiary"] };
  const cpAny = { id: "CMN-01" };
  assert.strictEqual(checkAllowedInStance(cpBenef, "beneficiary"), true);
  assert.strictEqual(checkAllowedInStance(cpBenef, "party"), false);
  assert.strictEqual(checkAllowedInStance(cpAny, "party"), true);
  assert.strictEqual(checkAllowedInStance(cpAny, "beneficiary"), true);
});

test("activeCheckpoints: 국면 게이트가 모듈 게이트와 함께 적용", () => {
  const doc = { checkpoints: [
    { id: "A", module: "X-ASSET" },
    { id: "B", stance_scope: ["beneficiary"] },
    { id: "C" },
  ] };
  const party = activeCheckpoints(doc, ["X-ASSET"], "party").map((c) => c.id);
  assert.deepStrictEqual(party, ["A", "C"], "party 국면: beneficiary 전용 체크 제외");
  const benef = activeCheckpoints(doc, ["X-ASSET"], "beneficiary").map((c) => c.id);
  assert.deepStrictEqual(benef, ["A", "B", "C"], "beneficiary 국면: 전용 체크 노출");
});

test("detectStance: 투자신탁 수익자 구조를 수익자 국면으로 추정", () => {
  const trust = "이 투자신탁의 수익자는 수익증권을 보유하며, 집합투자업자와 신탁업자가 집합투자규약에 따라 신탁원본을 관리한다.";
  const r = detectStance(trust);
  assert.strictEqual(r.stance, "beneficiary");
  assert.ok(r.hits.length >= 3, "근거어가 함께 반환되어야 함(사용자에게 추정 근거 노출)");
});

test("detectStance: 일반 위탁계약은 기본(party) — 확신 없으면 게이트 안 검", () => {
  assert.strictEqual(detectStance("수탁자는 위탁업무를 성실히 수행한다").stance, "party");
  assert.strictEqual(detectStance("").stance, "party");
  // 수익자 어휘가 1~2개 스치듯 나오는 정도로는 국면을 바꾸지 않음
  assert.strictEqual(detectStance("보험금의 수익자를 지정한다").stance, "party");
});

// ── 변경합의서 모드(원계약 전제) — 11차 ──────────────────────────
test("analyze: 원계약이 다루는 항목은 부재알람이 아니라 '원계약에 반영'", () => {
  const docs = [{ checkpoints: [CHECK_REWI] }];
  // 변경합의서 본문 — 재위탁 조항이 없음(원계약에 있으므로 변경합의서엔 불필요)
  const amend = [
    { index: 0, heading: "제1조(목적)", body: "원계약 제5조의 계약기간을 다음과 같이 변경한다." },
    { index: 1, heading: "제2조(계약기간)", body: "계약기간을 2027년 12월 31일까지로 연장한다." },
  ];
  // 원계약 첨부 없음 → 종전대로 부재알람(consider)
  const alone = analyze(amend, docs, { modules: ["M-CORE"] });
  assert.strictEqual(alone.results[0].coverage, "consider", "원계약 없으면 종전대로 누락 알람");

  // 원계약 첨부 → 원계약이 재위탁을 다루므로 알람이 아님
  const base = [
    { index: 0, heading: "제7조(재위탁)", body: "수탁자는 위탁자의 사전 동의 없이 위탁받은 업무를 제3자에게 재위탁하지 못한다." },
  ];
  const withBase = analyze(amend, docs, { modules: ["M-CORE"], baseClauses: base });
  assert.strictEqual(withBase.results[0].coverage, "base_covered", "원계약 커버분은 알람 이탈");
  assert.ok(withBase.results[0].inBase, "원계약 내 위치가 기록되어야 함");
  assert.strictEqual(withBase.missing.length, 0, "부재 목록에서 제외");
});

test("analyze: 원계약에도 없으면 부재알람 유지(누락검출 보존)", () => {
  const docs = [{ checkpoints: [CHECK_REWI] }];
  const amend = [{ index: 0, heading: "제1조(목적)", body: "계약기간을 변경한다." }];
  const base = [{ index: 0, heading: "제3조(대금)", body: "대금은 매월 말일 지급한다." }];
  const r = analyze(amend, docs, { modules: ["M-CORE"], baseClauses: base });
  assert.strictEqual(r.results[0].coverage, "consider", "원계약에도 없으면 알람 유지");
  assert.strictEqual(r.results[0].inBase, null);
});

test("analyze: 하위호환 — 3번째 인자에 모듈 배열을 넘기던 종전 호출 유지", () => {
  const docs = [{ checkpoints: [CHECK_REWI] }];
  const clauses = [{ index: 0, heading: "제7조(재위탁)", body: "수탁자는 위탁자의 사전 동의 없이 재위탁하지 못한다." }];
  const legacy = analyze(clauses, docs, ["M-CORE"]);
  const modern = analyze(clauses, docs, { modules: ["M-CORE"] });
  assert.strictEqual(legacy.results[0].coverage, modern.results[0].coverage);
  assert.strictEqual(legacy.results[0].tier, modern.results[0].tier);
});

test("analyze: 국면 게이트가 체크 단위로 결과에 반영", () => {
  const cpBenef = Object.assign({}, CHECK_REWI, { id: "BEN-X", stance_scope: ["beneficiary"] });
  const docs = [{ checkpoints: [CHECK_REWI, cpBenef] }];
  const clauses = [{ index: 0, heading: "제1조", body: "재위탁 금지" }];
  const party = analyze(clauses, docs, { modules: ["M-CORE"], stance: "party" });
  assert.deepStrictEqual(party.checkpoints.map((c) => c.id), ["CORE-07"]);
  const benef = analyze(clauses, docs, { modules: ["M-CORE"], stance: "beneficiary" });
  assert.deepStrictEqual(benef.checkpoints.map((c) => c.id), ["CORE-07", "BEN-X"]);
});

// ── 성격 게이트 과잉발동 회귀(11차 발견) ─────────────────────────
// nature_signals에 "위탁자·수탁자"(신탁·업무위탁 공유 어휘)가 있어 전형적 업무위탁계약의
// 유형감지가 통째로 죽던 잠복 버그. 신호는 신탁 전용어로 한정되어야 함.
test("detectType: 전형적 업무위탁계약이 신탁 성격게이트에 눌리지 않는다", () => {
  const types = [
    { meta: { type_id: "outsourcing", detect_keywords: ["위탁", "수탁", "업무위탁"] }, checkpoints: [] },
    { meta: { type_id: "investment", detect_keywords: ["신탁계약", "투자신탁"],
      nature_signals: ["신탁계약", "신탁재산", "신탁업자", "수익증권"], suppresses: ["outsourcing"] }, checkpoints: [] },
  ];
  const t = "업무위탁계약서 제1조(목적) 위탁자는 수탁자에게 콜센터 업무를 위탁하고 수탁자는 이를 수탁한다.";
  const r = detectType(t, types);
  const out = r.find((x) => x.typeId === "outsourcing");
  assert.ok(out.score > 0, "위탁자·수탁자 어휘만으로 outsourcing이 억제되면 안 됨");
  assert.strictEqual(pickType(r), "outsourcing");
});

test("detectType: 진짜 신탁계약서는 여전히 outsourcing을 억제", () => {
  const types = [
    { meta: { type_id: "outsourcing", detect_keywords: ["위탁", "수탁", "업무위탁"] }, checkpoints: [] },
    { meta: { type_id: "investment", detect_keywords: ["신탁계약", "투자신탁"],
      nature_signals: ["신탁계약", "신탁재산", "신탁업자", "수익증권"], suppresses: ["outsourcing"] }, checkpoints: [] },
  ];
  const t = "투자신탁 신탁계약서 — 집합투자업자와 신탁업자는 신탁재산의 운용에 관하여 다음과 같이 신탁계약을 체결한다. 수익증권을 발행한다.";
  const r = detectType(t, types);
  assert.ok(r.find((x) => x.typeId === "outsourcing").suppressed, "신탁 전용어 복수 검출 시 억제 유지");
  assert.strictEqual(pickType(r), "investment");
});

// ── 제목 가중·문서 성격 게이트·당사 지위(11.1차) ──────────────────
const { titleHits, docTitleAllows, detectPartyRoles, hasAffiliateParty,
  partyRoleAllows } = require("../src/matcher.js");

test("detectType: 문서 제목이 최상위 신호 — 제목 1회로 유형 확정", () => {
  const types = [
    { meta: { type_id: "outsourcing", detect_keywords: ["위탁", "업무위탁"] }, checkpoints: [] },
    { meta: { type_id: "nda", detect_keywords: ["비밀유지"] }, checkpoints: [] },
  ];
  // 본문엔 비밀유지가 여러 번, 제목엔 업무위탁 — 제목이 이겨야 함
  const t = "업무위탁계약서\n제5조 비밀유지 의무를 진다. 비밀유지 대상은 다음과 같다. 비밀유지 기간은 3년.";
  const ranked = detectType(t, types, "업무위탁계약서");
  assert.strictEqual(pickType(ranked), "outsourcing");
  assert.ok(ranked[0].titleHit, "제목 적중 표시");
});

test("detectType: docTitle 미전달 시 종전 동작(하위호환)", () => {
  const types = [{ meta: { type_id: "nda", detect_keywords: ["비밀유지"] }, checkpoints: [] }];
  assert.strictEqual(pickType(detectType("비밀유지계약서\n제1조", types)), "nda");
});

test("titleHits: 제목에 성격어가 있는지", () => {
  assert.deepStrictEqual(titleHits("근질권설정계약서", ["질권", "저당"]), ["질권"]);
  assert.deepStrictEqual(titleHits("신탁계약 변경합의서", ["질권", "저당"]), []);
  assert.deepStrictEqual(titleHits("", ["질권"]), []);
});

test("suggestModules: title_required 모듈은 제목에 없으면 본문 언급만으로 안 켜짐", () => {
  const MOD = { id: "X-SEC", suggest_keywords: ["질권", "근질권"],
    title_signals: ["질권", "담보설정"], title_required: true,
    screening_question: "담보를 설정하는가?" };
  // 실사고 재현: 신탁계약서 본문의 "질권을 설정하는 경우 전자등록" 한 문장
  const trust = "수익증권에 질권을 설정하는 경우에는 전자등록의 방법으로 하여야 한다.";
  const r1 = suggestModules(trust, [MOD], { docTitle: "신탁계약 변경합의서" });
  assert.strictEqual(r1.on.indexOf("X-SEC"), -1, "제목에 담보 성격 없으면 자동 활성 안 함");
  assert.ok(r1.ask.indexOf("X-SEC") !== -1, "대신 질문으로 노출(사람이 판단)");

  // 진짜 담보설정계약서는 제목만으로 활성
  const r2 = suggestModules("예금채권에 근질권을 설정한다", [MOD], { docTitle: "근질권설정계약서" });
  assert.ok(r2.on.indexOf("X-SEC") !== -1, "제목이 담보계약이면 활성");
});

test("docTitleAllows: requires_doc_title 체크는 그 성격 문서에서만 적용", () => {
  const cp = { id: "FIN-SEC-02", requires_doc_title: ["질권", "담보설정"] };
  assert.strictEqual(docTitleAllows(cp, "근질권설정계약서"), true);
  assert.strictEqual(docTitleAllows(cp, "신탁계약 변경합의서"), false);
  assert.strictEqual(docTitleAllows(cp, ""), false, "제목 미상이면 근거 없음 → 미적용");
  assert.strictEqual(docTitleAllows({ id: "X" }, "아무 제목"), true, "미선언은 전 문서 적용");
});

test("coverageOf: 문서 성격 불일치면 매칭돼도 quiet", () => {
  const cp = { id: "FIN-SEC-02", requires_doc_title: ["질권"], absence_check: true, severity: "필수" };
  assert.strictEqual(coverageOf("confirmed", cp, "본문", "신탁계약 변경합의서"), "quiet");
  assert.strictEqual(coverageOf("confirmed", cp, "본문", "근질권설정계약서"), "addressed");
  assert.strictEqual(coverageOf("none", cp, "본문", "신탁계약 변경합의서"), "quiet", "부재알람도 안 뜸");
  // docTitle 미전달 = 하위호환(게이트 비활성)
  assert.strictEqual(coverageOf("confirmed", cp, "본문"), "addressed");
});

test("detectPartyRoles: 당사 상호 주변 지위어를 읽는다", () => {
  const t = "질권자 미래에셋생명보험 주식회사(이하 \"질권자\")와 설정자 ○○산업은...";
  assert.ok(detectPartyRoles(t).indexOf("질권자") !== -1);
  // 당사 상호가 없으면 빈 배열(= 지위 미상)
  assert.deepStrictEqual(detectPartyRoles("갑은 을에게 대출한다"), []);
});

test("partyRoleAllows: 지위 미상(빈 배열)은 통과 — 모름을 근거로 접지 않음", () => {
  const cp = { party_roles: ["질권자", "담보권자"] };
  assert.strictEqual(partyRoleAllows(cp, []), true, "갑·을만 쓰는 계약서 회귀 방지");
  assert.strictEqual(partyRoleAllows(cp, ["질권자"]), true);
  assert.strictEqual(partyRoleAllows(cp, ["수익자"]), false, "지위가 읽혔고 불일치면 접음");
  assert.strictEqual(partyRoleAllows({}, ["수익자"]), true, "미선언은 전 지위 적용");
});

test("hasAffiliateParty: 계열 법인명만 인정 — 펀드 브랜드명은 제외", () => {
  assert.strictEqual(hasAffiliateParty("집합투자업자 미래에셋자산운용 주식회사"), true);
  assert.strictEqual(hasAffiliateParty("미래에셋증권과 체결한다"), true);
  // 펀드 상품명에 브랜드가 들어간 것은 상대방이 아님(비계열 운용사 오판 방지)
  assert.strictEqual(hasAffiliateParty("미래에셋맵스일반사모부동산투자신탁제3호\n집합투자업자 삼성자산운용"), false);
  // 당사 자신은 계열 상대방이 아님
  assert.strictEqual(hasAffiliateParty("수익자 미래에셋생명보험 주식회사"), false);
});

test("moduleAllowedInStance: stance_exempt_if 사유 성립 시 국면 게이트 통과", () => {
  const MOD = { id: "X-RELATED", requires_stance: ["party"], stance_exempt_if: ["affiliate_party"] };
  assert.strictEqual(moduleAllowedInStance(MOD, "beneficiary", {}), false);
  assert.strictEqual(moduleAllowedInStance(MOD, "beneficiary", { affiliate_party: true }), true);
  assert.strictEqual(moduleAllowedInStance(MOD, "party", {}), true);
});

test("suggestModules: 예외사유로 살아난 모듈은 본문 어휘 없이도 활성", () => {
  // 상대방 상호가 미래에셋자산운용이면 본문에 "계열사"라는 단어가 없어도 계열 거래임
  const MOD = { id: "X-RELATED", requires_stance: ["party"], stance_exempt_if: ["affiliate_party"],
    activation: "confirm", suggest_keywords: ["계열사", "대주주"] };
  const t = "집합투자업자 미래에셋자산운용 주식회사와 신탁업자는 다음과 같이 합의한다.";
  const r = suggestModules(t, [MOD], { stance: "beneficiary", stanceCtx: { affiliate_party: true } });
  assert.ok(r.on.indexOf("X-RELATED") !== -1);
});

test("analyze: 문서 성격·당사 지위 게이트가 결과에 반영", () => {
  const cp = Object.assign({}, CHECK_REWI, { id: "SEC-X", requires_doc_title: ["질권"] });
  const docs = [{ checkpoints: [cp] }];
  const clauses = [{ index: 0, heading: "제1조", body: "수탁자는 위탁자의 사전 동의 없이 재위탁하지 못한다" }];
  const off = analyze(clauses, docs, { modules: ["M-CORE"], docTitle: "신탁계약 변경합의서" });
  assert.strictEqual(off.results[0].coverage, "quiet");
  const on = analyze(clauses, docs, { modules: ["M-CORE"], docTitle: "근질권설정계약서" });
  assert.notStrictEqual(on.results[0].coverage, "quiet");
});

test("detectPartyRoles: 서명란은 같은 줄만 — 남의 지위를 당사 것으로 읽지 않는다", () => {
  const sign = "집합투자업자: 미래에셋자산운용 주식회사\n신탁업자: ○○은행 주식회사\n수익자: 미래에셋생명보험 주식회사";
  assert.deepStrictEqual(detectPartyRoles(sign), ["수익자"]);
});

// ── 담보제공자 관점(11.2차) ──────────────────────────────────────
test("partyRoleAllows: 담보권자용 체크와 담보제공자용 체크가 지위로 갈린다", () => {
  const holder = { party_roles: ["질권자", "담보권자", "채권자"] };       // 담보를 잡는 쪽
  const giver = { party_roles: ["담보제공자", "설정자", "물상보증인"] };  // 담보를 주는 쪽
  assert.strictEqual(partyRoleAllows(holder, ["질권자"]), true);
  assert.strictEqual(partyRoleAllows(giver, ["질권자"]), false);
  assert.strictEqual(partyRoleAllows(giver, ["설정자"]), true);
  assert.strictEqual(partyRoleAllows(holder, ["설정자"]), false);
  // 지위 미상이면 양쪽 다 통과(모름을 근거로 접지 않음)
  assert.strictEqual(partyRoleAllows(holder, []), true);
  assert.strictEqual(partyRoleAllows(giver, []), true);
});

test("detectPartyRoles: 물상보증인도 지위어로 인식", () => {
  const t = "물상보증인 미래에셋생명보험 주식회사는 채무자의 채무를 담보하기 위하여";
  assert.ok(detectPartyRoles(t).indexOf("물상보증인") !== -1);
});

// ── 조항 귀속(11.3차) — 타 조항 참조로 인한 오매칭 차단 ────────────
const { titleFitRatio, computeClauseOwners } = require("../src/matcher.js");

test("titleFitRatio: 표제가 그 체크를 정면으로 지시하는지 (복합어 부분일치)", () => {
  const cl = { index: 0, heading: "제35조(반대수익자의 수익증권매수청구권)", body: "" };
  const own = { id: "A", check: "반대하는 수익자에게 수익증권매수청구권이 보장되어 있는가", label: "반대수익자 매수청구권" };
  const other = { id: "B", check: "신탁계약 변경 시 수익자총회 결의를 거쳤는가", label: "변경 시 수익자총회 결의" };
  assert.ok(titleFitRatio(cl, own) > 0.5, "자기 조항이면 높은 적합도");
  assert.strictEqual(titleFitRatio(cl, other), 0, "다른 체크는 표제 근거 0");
});

test("computeClauseOwners: 표제 강일치 체크가 그 조항의 소유자", () => {
  const clauses = [
    { index: 0, heading: "제34조(수익자총회)", body: "수익자총회는 집합투자업자가 소집한다." },
    { index: 1, heading: "제35조(반대수익자의 수익증권매수청구권)", body: "매수를 청구할 수 있다." },
  ];
  const checks = [
    { id: "TOTAL", check: "수익자총회 결의를 거쳤는가", label: "수익자총회" },
    { id: "BUY", check: "반대수익자의 수익증권매수청구권이 보장되는가", label: "반대수익자 매수청구권" },
  ];
  const owners = computeClauseOwners(clauses, checks);
  assert.strictEqual(owners[1], "BUY");
});

test("analyze: 타 조항 참조 언급만으로는 그 체크가 붙지 않는다", () => {
  // 실사고 재현(2026-08-05): 매수청구권 조항이 요건을 적으며 "수익자총회의 결의에 반대하는
  // 경우"라고 다른 제도를 참조 → 총회 체크가 함께 붙던 오탐.
  const clauses = [
    { index: 0, heading: "제35조(반대수익자의 수익증권매수청구권)",
      body: "수익자는 신탁계약의 변경에 대한 수익자총회의 결의에 반대하는 경우 그 결의일부터 20일 이내에 수익증권의 매수를 청구할 수 있다." },
    { index: 1, heading: "제36조(보수)", body: "보수는 연 0.7퍼센트로 한다." },
  ];
  // check 문구를 조항 문언에 가깝게 둠 — 2건짜리 소형 코퍼스는 IDF가 달라 노출게이트(uniq)가
  // 실제와 다르게 동작하므로, 겹침이 충분히 나오도록 실제 지식 수준의 문장을 쓴다.
  const BUY = { id: "BUY", severity: "필수", norm_type: "강행", basis: "statute",
    check: "수익자총회의 결의에 반대하는 수익자가 결의일부터 20일 이내에 수익증권의 매수를 청구할 수 있도록 보장되어 있는가",
    label: "반대수익자 매수청구권",
    triggers: { keywords: ["매수청구", "매수를 청구", "반대"] }, sources: [] };
  const TOTAL = { id: "TOTAL", severity: "필수", norm_type: "강행", basis: "statute",
    check: "신탁계약의 변경에 대하여 수익자총회의 결의를 거쳤는가", label: "변경 시 수익자총회 결의",
    triggers: { keywords: ["수익자총회", "변경", "결의"] }, sources: [] };
  const r = analyze(clauses, [{ checkpoints: [BUY, TOTAL] }], { modules: [] });
  const buy = r.results.find((x) => x.cpId === "BUY");
  const total = r.results.find((x) => x.cpId === "TOTAL");
  assert.notStrictEqual(buy.coverage, "quiet", "자기 조항엔 정상 부착");
  assert.strictEqual(total.coverage, "quiet", "참조 언급만으로는 부착 안 됨");
  assert.strictEqual(total.best.gate.ownedBy, "BUY", "접힌 사유가 기록됨");
});

test("analyze: 본문 근거가 실질적이면 표제가 달라도 살아남는다(과잉억제 방지)", () => {
  // 한 조항이 여러 체크를 정당하게 충족하는 경우 — 표제어가 다르다고 접으면 안 됨.
  const clauses = [
    { index: 0, heading: "제6조(기술적·관리적 보호조치)",
      body: "수탁자는 개인정보의 안전한 처리를 위하여 접근권한의 제한, 접근통제 장치의 설치, 접속기록의 보관, 암호화 조치, 침입차단시스템 설치 등 기술적·관리적 보호조치를 하여야 한다." },
    { index: 1, heading: "제7조(손해배상)", body: "손해를 배상한다." },
  ];
  const PROT = { id: "PROT", severity: "필수", norm_type: "강행", basis: "statute",
    check: "기술적·관리적 보호조치가 규정되어 있는가", label: "기술적·관리적 보호조치",
    triggers: { keywords: ["보호조치", "안전성 확보"] }, sources: [] };
  const ACCESS = { id: "ACCESS", severity: "필수", norm_type: "강행", basis: "statute",
    check: "접근권한의 제한·접근통제·접속기록 보관·암호화 등 안전성 확보 조치가 포함되어 있는가",
    label: "접근 제한 안전성 조치",
    triggers: { keywords: ["접근권한", "접근통제", "접속기록", "암호화"] }, sources: [] };
  const r = analyze(clauses, [{ checkpoints: [PROT, ACCESS] }], { modules: [] });
  assert.notStrictEqual(r.results.find((x) => x.cpId === "ACCESS").coverage, "quiet",
    "표제는 PROT를 가리키지만 ACCESS도 본문 실질 근거가 있으므로 유지");
});

// ── 사모/공모 자동 판별(11.5차) ──────────────────────────────────
const { detectFundKind, fundScopeAllows } = require("../src/matcher.js");

test("detectFundKind: 계약서 문언으로 자동 판별(검토자 선택 아님)", () => {
  assert.strictEqual(detectFundKind("본 투자신탁은 일반 사모집합투자기구로서 적격투자자를 대상으로 한다"), "private");
  assert.strictEqual(detectFundKind("본 투자신탁은 공모집합투자기구로서 증권신고서를 제출한다"), "public");
  assert.strictEqual(detectFundKind("일반 신탁계약서"), "", "판별 불가면 빈 문자열");
});

test("fundScopeAllows: 사모면 공모 전용 체크 제외 / 판별 불가면 게이트 비활성", () => {
  const pub = { fund_scope: ["public"] };
  const pri = { fund_scope: ["private"] };
  assert.strictEqual(fundScopeAllows(pub, "private"), false, "사모에 공모 전용 체크 금지");
  assert.strictEqual(fundScopeAllows(pub, "public"), true);
  assert.strictEqual(fundScopeAllows(pri, "private"), true);
  assert.strictEqual(fundScopeAllows(pub, ""), true, "판별 불가면 누락검출 우선");
  assert.strictEqual(fundScopeAllows({}, "private"), true, "미선언은 전 펀드 적용");
});

test("hasAffiliateParty: 본문 일반 조항의 계열사 언급은 상대방이 아님", () => {
  // 실사고(2026-08-05): 비계열 계약서인데 계열사 체크가 붙던 문제.
  const body = "업무위탁계약서\n위탁자 ○○보험과 수탁자 ○○데이터는 다음과 같이 체결한다.\n" +
    "제N조 일반 조항 내용이 이어진다.\n".repeat(40) +
    "제50조 미래에셋증권 등 계열회사와의 거래는 별도 승인을 받는다.\n" +
    "제N조 후속 조항 내용이 이어진다.\n".repeat(40) +
    "\n위탁자: ○○보험 주식회사\n수탁자: ○○데이터 주식회사";
  assert.strictEqual(hasAffiliateParty(body), false, "본문 언급만으로는 계열 상대방 아님");
  // 당사자 표기 구간에 있으면 인정
  assert.strictEqual(hasAffiliateParty("신탁계약서\n집합투자업자: 미래에셋자산운용 주식회사"), true);
});

test("scoreClauseCheck: 조 표제 직접 대응이 점수를 유의미하게 올린다", () => {
  const CHECK = { id: "BUY", severity: "필수", norm_type: "강행", basis: "statute",
    check: "반대수익자에게 수익증권매수청구권이 보장되어 있는가", label: "반대수익자 매수청구권",
    triggers: { keywords: ["매수청구"] }, sources: [] };
  const OTHER = { id: "X", severity: "필수", norm_type: "강행", basis: "statute",
    check: "보수 산정방법이 명확한가", label: "보수 산정", triggers: { keywords: ["보수"] }, sources: [] };
  const docs = [{ checkpoints: [CHECK, OTHER] }];
  const model = buildModel(docs, [], "party");
  const entry = model.checks.find((e) => e.cp.id === "BUY");
  const withTitle = { index: 0, heading: "제35조(반대수익자의 수익증권매수청구권)", body: "매수를 청구할 수 있다." };
  const noTitle = { index: 1, heading: "제40조(기타)", body: "매수를 청구할 수 있다." };
  const a = scoreClauseCheck(withTitle, entry, model).score;
  const b = scoreClauseCheck(noTitle, entry, model).score;
  assert.ok(a > b, "표제가 체크를 지시하면 더 높은 점수(" + a.toFixed(1) + " > " + b.toFixed(1) + ")");
});
