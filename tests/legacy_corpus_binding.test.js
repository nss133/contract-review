const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../src/loop'),P=require('../src/eval_prepare');
const A=require('../src/history_assist');
const context={version:1,documents:'main-and-annex',context:'roles',clauses:'segments',checks:{A:'v1'}};
function corpus(){return L.mergeIntoCorpus(L.emptyCorpus(),{meta:{contract_hash:'H',date:'2026-09-15'},
 verdicts:{A:{verdict:'이상없음',origin:'legacy'}},matching_observations:{items:{A:{human_evidence_source:'confirmed_match',human_clause_index:1,rule_clause_index:1}}}});}
const input={contract_hash:'H',comparison_context:context,reviewer:'검토자',source_confirmed:true,note:'당시 동일 본문·별첨 확인',date:'2026-09-15'};
test('확인된 구 개별 판정은 원본을 보존하고 문서 연결 이력을 추가',()=>{
 const c=corpus(),raw=JSON.stringify(c),bound=L.bindJudgmentSource(c,input),r=bound.judgment_ledger.records.H;
 assert.equal(JSON.stringify(c),raw);assert.equal(r.revisions.length,1);
 assert.equal(r.revisions[0].comparison_context,undefined);
 assert.equal(r.snapshot.verdicts.A.origin,'legacy');assert.equal(r.snapshot.source_binding.mapping_confirmed,false);
 assert.deepEqual(bound.byCheck,c.byCheck);
 const compared=P.compareCurrent(bound,{contract_hash:'H',comparison_context:context});
 assert.equal(compared.rows.length,1);assert.equal(compared.mapping.reviewed,0);
});
test('확인·확인자·자료·개별 판정 누락과 상충 기록은 연결 차단',()=>{
 for(const bad of [{source_confirmed:false},{reviewer:''},{note:''},{comparison_context:null},{contract_hash:'UNKNOWN'}])
  assert.throws(()=>L.bindJudgmentSource(corpus(),{...input,...bad}));
 const c=corpus();c.judgment_ledger.records.H.pending={};assert.throws(()=>L.bindJudgmentSource(c,input));
 assert.throws(()=>L.bindJudgmentSource({meta:{hashes:['H']},byCheck:{}},input));
});
test('이미 원문이 연결된 판정을 다른 버전으로 재연결하지 않음',()=>{
 const bound=L.bindJudgmentSource(corpus(),input);
 assert.throws(()=>L.bindJudgmentSource(bound,{...input,comparison_context:{...context,documents:'changed'}}));
});
test('구 연결 확인으로 시스템 판정을 사람 정답으로 승격하지 않음',()=>{
 const c=corpus();c.judgment_ledger.records.H.snapshot.verdicts.A.origin='auto';
 const bound=L.bindJudgmentSource(c,input);
 assert.equal(P.compareCurrent(bound,{contract_hash:'H',comparison_context:context}).rows.length,0);
});
test('연결 확인된 구 사람 의견은 검색에 사용하되 확인 시점 이전 시험에는 노출하지 않음',()=>{
 const c=corpus(),v=c.judgment_ledger.records.H.snapshot.verdicts.A;
 v.comment='수탁자는 해지를 서면 통지하여야 한다.';
 c.judgment_ledger.records.H.tags.A=L.judgmentTags(v);
 assert.equal(Object.keys(A.combined(null,null,c).latest).length,0);
 const bound=L.bindJudgmentSource(c,{...input,date:'2026-09-16'}),k=A.combined(null,null,bound);
 assert.equal(A.retrieve(k,v.comment,'').length,1);
 assert.equal(A.retrieve(k,v.comment,'',{asOf:'2026-09-15'}).length,0);
});
