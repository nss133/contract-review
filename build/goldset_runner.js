"use strict";
/* 골드셋 러너 — app.js의 분석 파이프라인(유형감지 → 모듈활성 → analyze)을 그대로 재현해
   케이스별 감지 유형·활성 모듈·consider 목록을 JSON으로 출력한다.
   입력: argv[2] = {common, types, cases} JSON 파일 경로. 출력: stdout에 결과 JSON 배열.
   goldset.py가 지식 YAML을 JSON으로 내려 호출한다(브라우저와 동일 소스 사용이 목적). */
const fs = require("fs");
const { segmentContract } = require("../src/segmenter.js");
const { detectType, pickType, suggestModules, analyze } = require("../src/matcher.js");

const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { common, types, cases } = payload;

const results = cases.map(function (c) {
  const text = String(c.text || "");
  const clauses = segmentContract(text);
  // 유형 감지 — app.js btn-analyze와 동일 로직(pickType 공유): 임계 미달이면 미확정(null).
  const ranked = detectType(text, types);
  const detected = pickType(ranked);
  const doc = types.find(function (t) { return t.meta.type_id === detected; }) || null;
  // 모듈 활성 — app.js renderScreening과 동일: always_on + 본문 제안.
  let active = [];
  if (doc) {
    const suggested = suggestModules(text, doc.meta.modules || []);
    active = (doc.meta.modules || [])
      .filter(function (m) { return m.always_on || suggested.indexOf(m.id) !== -1; })
      .map(function (m) { return m.id; });
  }
  const docs = [{ checkpoints: common.checks }, { checkpoints: doc ? doc.checks : [] }];
  const r = analyze(clauses, docs, active);
  return {
    id: c.id,
    detected: detected,
    activeModules: active,
    consider: r.results.filter(function (x) { return x.coverage === "consider"; }).map(function (x) { return x.cpId; }),
    addressed: r.results.filter(function (x) { return x.coverage === "addressed"; }).map(function (x) { return x.cpId; }),
  };
});
process.stdout.write(JSON.stringify(results));
