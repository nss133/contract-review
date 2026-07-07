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

test("패턴 미검출 시 전체를 단일 블록으로 반환한다", () => {
  const clauses = segmentContract("아무 구조 없는 텍스트입니다.\n둘째 줄.");
  assert.strictEqual(clauses.length, 1);
  assert.strictEqual(clauses[0].heading, "(전체)");
  assert.match(clauses[0].body, /둘째 줄/);
});
