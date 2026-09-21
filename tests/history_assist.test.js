"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Assist = require("../src/history_assist.js");
const Matcher = require("../src/matcher.js");
const Verdict = require("../src/verdict.js");
const related = [{ score: 0.5, doc: { source_id: "CASE-1", title: "용역계약서",
  evidence: [{ sentence: "수탁자는 재위탁 시 사전 동의를 받는다." }] } }];
test('원본 검토의견도 검색·쟁점 보조에 사용하되 출처와 의견 성격을 보존',()=>{
 const h={latest:{A:'a'},records:{a:{request:{contract_name:'운영'},result:{review_text:'수탁자는 백업 복구를 하여야 한다. 이 조항을 보완할 필요가 있다.'}}}};
 const k=Assist.combined(null,h),r=Assist.retrieve(k,'백업 복구를 하여야 한다','');assert.equal(r.length,1);
 const s=Assist.clauseSupport(r,{triggers:{keywords:['백업','복구']}},{body:'수탁자는 백업 복구를 하여야 한다.'});assert.ok(s.bonus>0);assert.equal(s.evidence[0].evidence_kind,'review_opinion');
 assert.equal(Assist.clauseSupport(r,{triggers:{keywords:['백업','복구']}},{body:'관련 내용 없음'}).bonus,0);
});

test("이력 DB만 적재해도 계약 원본기재·태그 후보를 검색하고 근거 없는 조항 가산은 하지 않는다",()=>{
  const history={latest:{A:'a'},records:{a:{review_id:'A',request:{contract_name:'서버 운영 용역',context:'백업 복구',department:'정보보호'},
    result:{review_text:'이상없음',created_at:'2026-01-01'},tags:[{label:'정보보호',type:'imported_tag'}]}}};
  const combined=Assist.combined(null,history),out=Assist.retrieve(combined,'서버 운영 백업 복구','다른부서');
  assert.equal(out.length,1);assert.equal(out[0].doc.source_kind,'contract_review');
  assert.equal(Assist.clauseSupport(out,{triggers:{keywords:['백업','복구']}},{body:'백업 복구를 하여야 한다.'}).bonus,0);
  assert.equal(Assist.retrieve(combined,'서버 운영','',{excludeSourceIds:['A']}).length,0);
  assert.equal(Assist.retrieve(combined,'서버 운영','',{strictIsolation:true}).length,0);
});
test("같은 계약 이력과 연결된 태깅자료는 중복 투표하지 않는다",()=>{
  const k={latest:{T:'t'},documents:{t:{source_id:'T',title:'서버 운영 용역',original:{review_id:'A'},tags:[],evidence:[{sentence:'직접 근거'}]}}};
  const h={latest:{A:'a'},records:{a:{request:{contract_name:'서버 운영 용역'},result:{}}}};
  const out=Assist.combined(k,h);assert.equal(Object.keys(out.latest).length,1);
  assert.equal(out.documents['tag:T'].source_kind,'contract_review');
  assert.equal(out.documents['tag:T'].evidence.length,1);
  assert.equal(k.documents.t.source_kind,undefined);
});

test("다른 과거 문장의 단어를 합쳐 가산하지 않으며 의무주체 반전은 차단한다", () => {
  const check={triggers:{keywords:['해지','통지']}};
  const clause={body:'수탁자는 해지를 통지하여야 한다.'};
  assert.equal(Assist.clauseSupport([{doc:{source_id:'X',evidence:[{sentence:'해지한다.'},{sentence:'통지한다.'}]}}],check,clause).bonus,0);
  const out=Assist.clauseSupport([{doc:{source_id:'X',evidence:[{sentence:'위탁자는 해지를 통지하여야 한다.'}]}}],check,clause);
  assert.equal(out.bonus,0);assert.ok(out.conflicts.length);
});
test("시험 검색은 본건·동일 계열·미상 계열·미래 자료를 제외한다", () => {
  const documents={a:{source_id:'A',family_id:'F',date:'2026-01-01',title:'서버 운영 용역'},
    b:{source_id:'B',family_id:'G',date:'2027-01-01',title:'서버 운영 용역'},
    c:{source_id:'C',title:'서버 운영 용역'}};
  const k={documents,latest:{a:'a',b:'b',c:'c'}};
  assert.equal(Assist.retrieve(k,'서버 운영 용역','',{strictIsolation:true,asOf:'2026-09-09',excludeFamilyIds:['F']}).length,0);
});

test("부서만 같아서는 과거 사례를 검색하지 않는다", () => {
  const knowledge = { latest: { a: "a" }, documents: { a: {
    title: "사무실 임대차 계약서", department: "정보보호", tags: [] } } };
  assert.deepEqual(Assist.retrieve(knowledge, "보안 용역 개발", "정보보호"), []);
  assert.equal(Assist.retrieve(knowledge, "사무실 임대차 계약서", "영업").length, 1);
});
test("명확한 본건 제목 및 무근거 유형을 과거 자료가 뒤집지 않는다", () => {
  const types = [ { meta: { type_id: "lease", detect_keywords: ["임대차"] } },
    { meta: { type_id: "service", detect_keywords: ["용역"] } } ];
  const base = Matcher.detectType("용역", types, "임대차계약서", "");
  assert.equal(Assist.rankTypes(base, related, types, Matcher.detectType)[0].typeId, "lease");
  const zero = [{ typeId: "service", score: 0, hits: [] }];
  assert.equal(Assist.rankTypes(zero, related, types, Matcher.detectType)[0].score, 0);
});
test("본건 직접 후보 유형에만 제한된 이력 보너스가 부여된다", () => {
  const ranked = [{ typeId: "service", score: 3, hits: ["용역"] }];
  const out = Assist.rankTypes(ranked, related, [], () => [{ typeId: "service", titleHit: true }]);
  assert.equal(out[0].score, 3.5);
  assert.equal(ranked[0].score, 3);
});
test("조항 보강은 본건과 과거 근거의 공통어 복수를 요구한다", () => {
  const check = { triggers: { keywords: ["재위탁", "사전 동의"] } };
  assert.equal(Assist.clauseSupport(related, check, { body: "재위탁 사후 통지" }).bonus, 0);
  const support = Assist.clauseSupport(related, check, { body: "재위탁 사전 동의" });
  assert.ok(support.bonus > 0);
  assert.deepEqual(support.sources, ["CASE-1"]);
});
test("과거 보너스로 본건 문장 검증 없는 이상없음을 만들지 않는다", () => {
  const result = { coverage: "addressed", best: { historySupport: { bonus: 3 } } };
  assert.equal(Verdict.canAutoPass({ severity: "참고" }, result), false);
  result.autoClear = { ok: true };
  assert.equal(Verdict.canAutoPass({ severity: "권장" }, result), false, "문장 신호가 있어도 관찰 모드에서는 보류");
  assert.equal(Verdict.canAutoPass({ severity: "필수" }, result), false);
  assert.equal(Verdict.canAutoPass({ severity: "권장", auto_verdict: false }, result), false);
});

test("실제 매칭 엔진이 과거 출처와 기본 점수를 보존한다", () => {
  const check = { id: "TEST", module: "M-CORE", severity: "참고", norm_type: "실무",
    check: "재위탁 사전 동의", triggers: { keywords: ["재위탁", "사전 동의"] }, sources: [] };
  const clauses = [{ index: 0, heading: "재위탁 사전 동의", body: "수탁자는 재위탁 시 사전 동의를 받는다." }];
  const docs = [{ meta: { type_id: "test" }, checkpoints: [check] }];
  const output = Matcher.analyze(clauses, docs, { modules: ["M-CORE"], historyRelated: related });
  const best = output.results[0].best;
  assert.ok(best.historySupport.bonus > 0);
  assert.equal(best.score, best.baseScore + best.historySupport.bonus);
  assert.deepEqual(best.historySupport.sources, ["CASE-1"]);
});
