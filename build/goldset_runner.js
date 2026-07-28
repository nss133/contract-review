"use strict";
/* 골드셋 러너 — app.js의 분석 파이프라인(유형감지 → 모듈활성 → analyze)을 그대로 재현해
   케이스별 감지 유형·활성 모듈·consider 목록을 JSON으로 출력한다.
   입력: argv[2] = {common, types, cases} JSON 파일 경로. 출력: stdout에 결과 JSON 배열.
   goldset.py가 지식 YAML을 JSON으로 내려 호출한다(브라우저와 동일 소스 사용이 목적). */
const fs = require("fs");
const { segmentContract } = require("../src/segmenter.js");
const { detectType, pickType, suggestModules, analyze, buildModel, subDocCoverage, detectSubdocRefs } = require("../src/matcher.js");

const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { common, types, cases } = payload;

const results = cases.map(function (c) {
  const text = String(c.text || "");
  const clauses = segmentContract(text);
  // 유형 감지 — app.js btn-analyze와 동일 로직(pickType 공유): 임계 미달이면 미확정(null).
  const ranked = detectType(text, types);
  // force_type(선택): 감지 대신 유형을 강제 — recall·부속커버 케이스처럼 유형감지 자체가
  // 쟁점이 아닌 경우 사용.
  const detected = c.force_type || pickType(ranked);
  const doc = types.find(function (t) { return t.meta.type_id === detected; }) || null;
  // 모듈 활성 — app.js renderScreening과 동일: common(횡단 X-* 풀)+유형 모듈 병합, always_on + 본문 제안.
  const modList = (common.meta.modules || []).concat(doc ? doc.meta.modules || [] : []);
  const suggested = suggestModules(text, modList);
  // force_active_modules(선택): 본문 제안과 무관하게 모듈을 강제 활성 — 부속서류 커버리지
  // 케이스처럼 "본계약 자체에는 활성 트리거가 없으나 부속서류 첨부로 해당 체크군이 쟁점이 되는"
  // 상황을 재현할 때 사용(사용자 화면에서는 스크리닝 질문에 수동 체크로 대응하는 경로에 해당).
  const forcedModules = c.force_active_modules || [];
  const active = modList
    .filter(function (m) { return m.always_on || suggested.on.indexOf(m.id) !== -1 || forcedModules.indexOf(m.id) !== -1; })
    .map(function (m) { return m.id; });
  const docs = [{ checkpoints: common.checks }, { checkpoints: doc ? doc.checks : [] }];
  const r = analyze(clauses, docs, active);
  const consider = r.results.filter(function (x) { return x.coverage === "consider"; }).map(function (x) { return x.cpId; });
  const addressed = r.results.filter(function (x) { return x.coverage === "addressed"; }).map(function (x) { return x.cpId; });
  // subdoc_text(선택): 부속서류 커버리지(#3) 재현 — app.js runAnalysis와 동일 경로.
  let subdocCovered = [];
  if (c.subdoc_text) {
    const considerCps = r.checkpoints.filter(function (cp) {
      return r.results.some(function (x) { return x.cpId === cp.id && x.coverage === "consider"; });
    });
    const model = buildModel(docs, active);
    const cov = subDocCoverage(considerCps,
      [{ name: "subdoc", clauses: segmentContract(String(c.subdoc_text)) }], model);
    subdocCovered = Object.keys(cov);
  }
  // 별첨 참조(#4) 재현 — 기계매칭(subdoc_covered)이 우선.
  const refs = detectSubdocRefs(text, (common.meta || {}).standard_subdocs || []);
  const refCovered = [];
  refs.forEach(function (ref) {
    ref.covers.forEach(function (id) {
      if (consider.indexOf(id) !== -1 && subdocCovered.indexOf(id) === -1 && refCovered.indexOf(id) === -1)
        refCovered.push(id);
    });
  });
  return {
    id: c.id,
    detected: detected,
    activeModules: active,
    consider: consider,
    addressed: addressed,
    subdoc_covered: subdocCovered,
    ref_covered: refCovered,
  };
});
process.stdout.write(JSON.stringify(results));
