"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("../src/formal.js");

function byId(rs, id) { return rs.filter(function (r) { return r.id === id; })[0]; }

// ── 재정의 범위(7차 피드백): 상호(FORM-NAME)·대표자(FORM-REP)·주소(FORM-ADDR)만 점검 ──

test("재정의: 결과는 FORM-NAME·FORM-REP·FORM-ADDR 3항목뿐(구 BLANK·DATE·CORP 폐지)", () => {
  const rs = F.checkFormal("미래에셋생명보험㈜와 ㈜상대는 계약한다");
  assert.deepStrictEqual(rs.map(function (r) { return r.id; }), ["FORM-NAME", "FORM-REP", "FORM-ADDR"]);
});

test("재정의: 빈칸·일자 공란(OOO·밑줄·0000.00.00)은 더 이상 warn 사유 아님", () => {
  const rs = F.checkFormal("을: OOO ___ 기간 0000.00.00 … 20  년  월  일 미래에셋생명보험㈜");
  assert.ok(rs.every(function (r) { return r.status === "pass"; }));
});

// ── FORM-NAME — 기존 로직 계승(별칭 관행·전치형 인정) ──

test("FORM-NAME: '미래에셋생명' 뒤 '보험' 누락 → warn", () => {
  const rs = F.checkFormal("갑 미래에셋생명㈜은 … 2026년 1월 2일 … ㈜상대");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "warn");
});

test("FORM-NAME: 정식 상호 → pass", () => {
  const rs = F.checkFormal("갑 미래에셋생명보험주식회사는 … 2026년 1월 2일 … ㈜상대");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "pass");
});

test("FORM-NAME: 별칭 선언('이하 \"미래에셋생명\"이라 한다') 후 stem 다수 등장 → pass", () => {
  const text = 'OOOOO (이하 "제휴사" 이라 한다)와 미래에셋생명보험 주식회사 (이하 "미래에셋생명"이라 한다)는 상호신뢰를 바탕으로 계약한다. ' +
    '"미래에셋생명"이 "제휴사"를 도와 광고를 한다. "미래에셋생명" 상품의 광고. ' +
    '2026년 1월 2일';
  const rs = F.checkFormal(text);
  assert.strictEqual(byId(rs, "FORM-NAME").status, "pass");
});

test("FORM-NAME: 전치형 법인표기('주식회사 미래에셋생명보험') → pass", () => {
  const rs = F.checkFormal("주식회사 미래에셋생명보험(이하 '갑')과 을은 2026년 1월 2일 계약한다");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "pass");
});

test("FORM-NAME: 정식 상호 전무 + stem만 존재('미래에셋생명㈜') → warn(여전히 오기 검출)", () => {
  const rs = F.checkFormal("갑 미래에셋생명㈜은 …를 한다. 미래에셋생명㈜이 … 2026년 1월 2일");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "warn");
});

// ── FORM-REP — 당사 상호 근방의 대표이사 이름만 정본(김재식·황문규) 대조 ──

test("FORM-REP: 서명 블록 정본 이름(김재식) → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험주식회사\n서울시 마포구 만리재로 24\n대표이사 김재식 (인)");
  const r = byId(rs, "FORM-REP");
  assert.strictEqual(r.status, "pass");
  assert.ok(r.detail.includes("정본 확인"));
});

test("FORM-REP: 자간 공백 관행('대 표 이 사  황 문 규') → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험 주식회사\n대 표 이 사     황 문 규   (인)");
  assert.strictEqual(byId(rs, "FORM-REP").status, "pass");
});

test("FORM-REP: 근사 오기 '김제식' → warn(자모 편집거리 1)", () => {
  const rs = F.checkFormal("미래에셋생명보험㈜\n대표이사 김제식 (인)");
  const r = byId(rs, "FORM-REP");
  assert.strictEqual(r.status, "warn");
  assert.ok(r.detail.includes("김제식"));
});

test("FORM-REP: 근사 오기 '황문귀' → warn", () => {
  const rs = F.checkFormal("주식회사 미래에셋생명보험\n대 표 이 사  황 문 귀  (인)");
  assert.strictEqual(byId(rs, "FORM-REP").status, "warn");
});

test("FORM-REP: 상대방 대표자명(인접 서명 블록·임의 이름) → 오탐 없이 pass", () => {
  const rs = F.checkFormal(
    "미래에셋생명보험주식회사\n대표이사 김재식 (인)\n\n한빛시스템 주식회사\n대표이사 박민수 (인)");
  assert.strictEqual(byId(rs, "FORM-REP").status, "pass");
});

test("FORM-REP: 당사 상호와 먼 위치(근접 윈도 밖)의 근사 이름은 대조 대상 아님", () => {
  const filler = "제1조 계약의 목적. ".repeat(30); // 200자 윈도 초과 이격
  const rs = F.checkFormal("미래에셋생명보험㈜와 을은 계약한다.\n" + filler + "\n한빛시스템㈜ 대표이사 김제식 (인)");
  assert.strictEqual(byId(rs, "FORM-REP").status, "pass");
});

test("FORM-REP: 이름 부재('대표이사      (인)')·자리표시('0 0 0')는 정상 → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험주식회사\n대표이사      (인)\n미래에셋생명보험주식회사\n대 표 이 사   0 0 0  (인)");
  const r = byId(rs, "FORM-REP");
  assert.strictEqual(r.status, "pass");
  assert.ok(r.detail.includes("미기재"));
});

test("FORM-REP: 직함 연결('대표이사 부회장 하만덕' 5음절+)은 후보 제외 → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험주식회사\n대표이사 부회장 하 만 덕 (인)");
  assert.strictEqual(byId(rs, "FORM-REP").status, "pass");
});

// ── FORM-ADDR — 당사 상호 근방 주소를 정본(서울시 마포구 만리재로 24)과 대조 ──
//    구주소(국제금융로 56)는 오기가 아니라 "구주소 사용" 경고로 별도 검출

test("FORM-ADDR: 정본 주소(만리재로 24) → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험주식회사\n서울시 마포구 만리재로 24\n대표이사 김재식 (인)");
  const r = byId(rs, "FORM-ADDR");
  assert.strictEqual(r.status, "pass");
  assert.ok(r.detail.includes("만리재로 24"));
});

test("FORM-ADDR: 표기 변형('서울특별시'·괄호 부기) 허용 → pass", () => {
  const a = F.checkFormal("미래에셋생명보험㈜\n서울특별시 마포구 만리재로 24");
  assert.strictEqual(byId(a, "FORM-ADDR").status, "pass");
  const b = F.checkFormal("미래에셋생명보험㈜\n서울시 마포구 만리재로 24 (본사)");
  assert.strictEqual(byId(b, "FORM-ADDR").status, "pass");
});

test("FORM-ADDR: 구주소(국제금융로 56 — 표준서식 서명란 표본) → 갱신 필요 경고", () => {
  // 픽스처: samples/internal-standards 보안관리약정서(202501) 서명란 표기
  const rs = F.checkFormal("미래에셋생명보험주식회사\n서울특별시 영등포구 국제금융로 56 (여의도동, 미래에셋증권빌딩)\n대표이사 김재식 (인)");
  const r = byId(rs, "FORM-ADDR");
  assert.strictEqual(r.status, "warn");
  assert.ok(r.detail.includes("구주소"));
  assert.ok(r.detail.includes("만리재로 24"));
});

test("FORM-ADDR: 번지 오기('만리재로 42'·'만리재로 24-1') → warn(정본 병기)", () => {
  const a = F.checkFormal("미래에셋생명보험주식회사\n서울시 마포구 만리재로 42");
  const ra = byId(a, "FORM-ADDR");
  assert.strictEqual(ra.status, "warn");
  assert.ok(ra.detail.includes("만리재로 24"));
  const b = F.checkFormal("미래에셋생명보험㈜\n서울시 마포구 만리재로 24-1");
  assert.strictEqual(byId(b, "FORM-ADDR").status, "warn");
});

test("FORM-ADDR: 도로명 오기('만리채로 24') → warn", () => {
  const rs = F.checkFormal("미래에셋생명보험㈜\n서울시 마포구 만리채로 24");
  assert.strictEqual(byId(rs, "FORM-ADDR").status, "warn");
});

test("FORM-ADDR: 주소 부재는 정상 → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험㈜와 ㈜상대는 다음과 같이 계약을 체결한다.");
  const r = byId(rs, "FORM-ADDR");
  assert.strictEqual(r.status, "pass");
  assert.ok(r.detail.includes("미기재"));
});

test("FORM-ADDR: 상대방 주소(마포구 아닌 타지역, 당사 블록 인접)는 후보 아님 → pass", () => {
  const rs = F.checkFormal(
    "미래에셋생명보험주식회사\n서울시 마포구 만리재로 24\n대표이사 김재식 (인)\n\n한빛시스템 주식회사\n서울시 강남구 테헤란로 12\n대표이사 박민수 (인)");
  assert.strictEqual(byId(rs, "FORM-ADDR").status, "pass");
});

test("FORM-ADDR: 당사 상호와 먼 위치(근접 윈도 밖)의 타 주소는 대조 대상 아님", () => {
  const filler = "제1조 계약의 목적. ".repeat(30);
  const rs = F.checkFormal("미래에셋생명보험㈜와 을은 계약한다.\n" + filler + "\n을: 서울특별시 영등포구 의사당대로 3");
  assert.strictEqual(byId(rs, "FORM-ADDR").status, "pass");
});
