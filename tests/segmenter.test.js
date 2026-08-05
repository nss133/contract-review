"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { segmentContract } = require("../src/segmenter.js");

test("제N조 패턴으로 분할한다", () => {
  const text = [
    "업무위탁계약서",
    "제1조 (목적) 이 계약은 업무위탁에 관한 사항을 정한다.",
    "제2조 (정의) 용어의 정의는 다음과 같다.",
    "추가 설명 줄",
    "제2조의2 (적용범위) 본 계약은 전 업무에 적용된다.",
  ].join("\n");
  const clauses = segmentContract(text);
  assert.strictEqual(clauses.length, 4); // (전문) + 제1조 + 제2조 + 제2조의2
  assert.strictEqual(clauses[0].heading, "(전문)");
  assert.match(clauses[1].heading, /제1조/);
  assert.match(clauses[2].body, /추가 설명 줄/);
  assert.match(clauses[3].heading, /제2조의2/);
  assert.strictEqual(clauses[3].index, 3);
});

test("숫자 헤딩(1. )으로도 분할한다", () => {
  const text = "1. 목적\n내용A\n2. 범위\n내용B";
  const clauses = segmentContract(text);
  assert.strictEqual(clauses.length, 2);
  assert.match(clauses[1].body, /내용B/);
});

test("제N조 본문 안의 호 나열은 분할하지 않는다", () => {
  const text = [
    "제1조 (범위) 다음 각 호와 같다.",
    "1. 위탁업무의 범위",
    "2. 수탁자의 의무",
    "제2조 (기간) 계약기간은 1년이다.",
    "1. 갱신 조건",
  ].join("\n");
  const clauses = segmentContract(text);
  assert.strictEqual(clauses.length, 2);
  assert.match(clauses[0].heading, /제1조/);
  assert.match(clauses[0].body, /위탁업무의 범위/);
  assert.match(clauses[0].body, /수탁자의 의무/);
  assert.match(clauses[1].heading, /제2조/);
  assert.match(clauses[1].body, /갱신 조건/);
});

test("패턴 미검출 시 전체를 단일 블록으로 반환한다", () => {
  const clauses = segmentContract("아무 구조 없는 텍스트입니다.\n둘째 줄.");
  assert.strictEqual(clauses.length, 1);
  assert.strictEqual(clauses[0].heading, "(전체)");
  assert.match(clauses[0].body, /둘째 줄/);
});

// ── 문서 제목 추출(11.1차) ───────────────────────────────────────
const { extractDocTitle } = require("../src/segmenter.js");

test("extractDocTitle: 표제 줄을 뽑는다", () => {
  assert.strictEqual(extractDocTitle("근질권설정계약서\n\n갑과 을은...\n제1조(목적)"), "근질권설정계약서");
  assert.strictEqual(extractDocTitle("업무위탁계약서\n제1조"), "업무위탁계약서");
  assert.strictEqual(
    extractDocTitle("미래에셋맵스일반사모부동산투자신탁제3호 신탁계약 변경합의서\n제1조"),
    "미래에셋맵스일반사모부동산투자신탁제3호 신탁계약 변경합의서");
});

test("extractDocTitle: 당사자 소개문·날짜·법인명 줄은 제목이 아님", () => {
  assert.strictEqual(extractDocTitle("갑과 을은 다음과 같이 합의한다\n제1조"), "");
  assert.strictEqual(extractDocTitle("2026. 3. 1.\n주식회사 ○○\n제1조"), "");
  // 앞에 날짜·법인명이 있어도 진짜 제목 줄은 찾아냄
  assert.strictEqual(extractDocTitle("2026. 3. 1.\n비밀유지약정서\n제1조"), "비밀유지약정서");
});

test("extractDocTitle: 제목 없이 바로 조문이면 빈 문자열", () => {
  assert.strictEqual(extractDocTitle("제1조(목적) 바로 시작"), "");
  assert.strictEqual(extractDocTitle(""), "");
});

// ── 제목 인식 실패 케이스 보강(11.4차) ────────────────────────────
test("extractDocTitle: 자간 벌린 제목도 인식", () => {
  // 한글 계약서 표지에 흔한 조판 — 그대로 두면 유형어 매칭이 전부 실패.
  assert.strictEqual(extractDocTitle("신 탁 계 약 서\n제1조(목적)"), "신탁계약서");
  assert.strictEqual(extractDocTitle("업 무 위 탁 계 약 서\n제1조"), "업무위탁계약서");
});

test("extractDocTitle: 유형어 뒤 꼬리표가 붙어도 인식", () => {
  assert.strictEqual(extractDocTitle("업무위탁계약서(개정)\n제1조"), "업무위탁계약서(개정)");
  assert.strictEqual(extractDocTitle("근질권설정계약서 (안)\n제1조"), "근질권설정계약서 (안)");
  assert.strictEqual(extractDocTitle("물품구매계약서 제2안\n제1조"), "물품구매계약서 제2안");
});

test("extractDocTitle: 따옴표·괄호 장식은 벗겨서 반환", () => {
  assert.strictEqual(extractDocTitle('"위수탁계약서"\n제1조'), "위수탁계약서");
  assert.strictEqual(extractDocTitle("「신탁계약서」\n제1조"), "신탁계약서");
});

test("extractDocTitle: 마지막 유형어 기준 판정 — 복합 제목 회귀", () => {
  // "신탁계약 변경합의서"에서 첫 유형어('계약')를 쓰면 꼬리가 '변경합의서'가 되어 탈락하던 버그.
  assert.strictEqual(extractDocTitle("제3호 신탁계약 변경합의서\n제1조"), "제3호 신탁계약 변경합의서");
  assert.strictEqual(extractDocTitle("업무위탁계약 변경합의서\n제1조"), "업무위탁계약 변경합의서");
});
