"use strict";
/* 골드셋 러너 — app.js의 분석 파이프라인(유형감지 → 모듈활성 → analyze)을 그대로 재현해
   케이스별 감지 유형·활성 모듈·consider 목록을 JSON으로 출력한다.
   입력: argv[2] = {common, types, cases} JSON 파일 경로. 출력: stdout에 결과 JSON 배열.
   goldset.py가 지식 YAML을 JSON으로 내려 호출한다(브라우저와 동일 소스 사용이 목적). */
const fs = require("fs");
const { segmentContract, extractDocTitle } = require("../src/segmenter.js");
const { detectType, pickType, suggestModules, analyze, buildModel, subDocCoverage, detectSubdocRefs,
  detectStance, moduleAllowedInStance, detectPartyRoles, hasAffiliateParty } = require("../src/matcher.js");

const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { common, types, cases } = payload;

const results = cases.map(function (c) {
  const text = String(c.text || "");
  const clauses = segmentContract(text);
  // 문서 제목(11.1차) — 유형감지·모듈·체크 게이트의 최상위 신호. app.js와 동일 산출.
  const docTitle = c.doc_title !== undefined ? c.doc_title : extractDocTitle(text);
  // 유형 감지 — app.js btn-analyze와 동일 로직(pickType 공유): 임계 미달이면 미확정(null).
  const ranked = detectType(text, types, docTitle);
  // force_type(선택): 감지 대신 유형을 강제 — recall·부속커버 케이스처럼 유형감지 자체가
  // 쟁점이 아닌 경우 사용.
  const detected = c.force_type || pickType(ranked);
  const doc = types.find(function (t) { return t.meta.type_id === detected; }) || null;
  // 검토 국면(11차) — stance 지정이 있으면 그 값, 없으면 app.js와 동일하게 자동 추정.
  const stance = c.stance || detectStance(text).stance;
  // 당사 지위·계열 상대방(11.1차) — app.js refreshInputSetup과 동일 산출.
  const partyRoles = c.party_roles !== undefined ? c.party_roles : detectPartyRoles(text);
  const stanceCtx = { affiliate_party: hasAffiliateParty(text) };
  // 모듈 활성 — app.js renderScreening과 동일: common(횡단 X-* 풀)+유형 모듈 병합, always_on + 본문 제안.
  // 국면 게이트를 먼저 통과한 모듈만 후보(수범자가 당사가 아닌 규제는 제외).
  const modList = (common.meta.modules || []).concat(doc ? doc.meta.modules || [] : [])
    .filter(function (m) { return moduleAllowedInStance(m, stance, stanceCtx); });
  const suggested = suggestModules(text, modList, { stance: stance, docTitle: docTitle, stanceCtx: stanceCtx });
  // force_active_modules(선택): 본문 제안과 무관하게 모듈을 강제 활성 — 부속서류 커버리지
  // 케이스처럼 "본계약 자체에는 활성 트리거가 없으나 부속서류 첨부로 해당 체크군이 쟁점이 되는"
  // 상황을 재현할 때 사용(사용자 화면에서는 스크리닝 질문에 수동 체크로 대응하는 경로에 해당).
  const forcedModules = c.force_active_modules || [];
  const active = modList
    .filter(function (m) { return m.always_on || suggested.on.indexOf(m.id) !== -1 || forcedModules.indexOf(m.id) !== -1; })
    .map(function (m) { return m.id; });
  const docs = [{ checkpoints: common.checks }, { checkpoints: doc ? doc.checks : [] }];
  // base_text(선택): 변경합의서 케이스 — 원계약을 전제로 부재 판정(11차).
  const baseClauses = c.base_text ? segmentContract(String(c.base_text)) : [];
  const r = analyze(clauses, docs, { modules: active, stance: stance, baseClauses: baseClauses,
    docTitle: docTitle, partyRoles: partyRoles });
  const consider = r.results.filter(function (x) { return x.coverage === "consider"; }).map(function (x) { return x.cpId; });
  const addressed = r.results.filter(function (x) { return x.coverage === "addressed"; }).map(function (x) { return x.cpId; });
  // subdoc_text(선택): 부속서류 커버리지(#3) 재현 — app.js runAnalysis와 동일 경로.
  let subdocCovered = [];
  if (c.subdoc_text) {
    const considerCps = r.checkpoints.filter(function (cp) {
      return r.results.some(function (x) { return x.cpId === cp.id && x.coverage === "consider"; });
    });
    const model = buildModel(docs, active, stance);
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
    stance: stance,
    docTitle: docTitle,
    partyRoles: partyRoles,
    activeModules: active,
    consider: consider,
    addressed: addressed,
    base_covered: r.results.filter(function (x) { return x.coverage === "base_covered"; }).map(function (x) { return x.cpId; }),
    subdoc_covered: subdocCovered,
    ref_covered: refCovered,
  };
});
process.stdout.write(JSON.stringify(results));
