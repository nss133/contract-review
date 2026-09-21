const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../src/eval_prepare');
const ctx={version:1,documents:'main-and-annex',context:'roles',clauses:'segments',checks:{A:'check-v1'}};
function fixture(){
 const snapshot={comparison_context:ctx,verdicts:{A:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}},
   matching_observations:{items:{A:{human_evidence_source:'confirmed_match',human_clause_index:1}}}};
 return {judgment_ledger:{records:{H:{snapshot}}}};
}
function input(){return {contract_hash:'H',comparison_context:ctx,before:[{cpId:'A',coverage:'verify',best:{clauseIndex:0}}],after:[{cpId:'A',coverage:'addressed',best:{clauseIndex:1}}]};}
test('동일 본문·별첨·맥락의 확정 이력으로 매핑 전후만 비교',()=>{
 const c=fixture(),saved=JSON.stringify(c),r=P.compareCurrent(c,input());
 assert.equal(r.status,'compared');assert.deepEqual(r.mapping,{reviewed:1,before_correct:0,after_correct:1});
 assert.equal(r.rows[0].needs_attention,false);assert.equal(JSON.stringify(c),saved);
});
test('다른 별첨·맥락·구 기록·상충 수입은 비교하지 않음',()=>{
 for(const field of ['documents','context','version']){
  const i=input();i.comparison_context={...ctx,[field]:'different'};
  assert.equal(P.compareCurrent(fixture(),i).status,'source_mismatch');
 }
 assert.equal(P.compareCurrent({},input()).status,'unlinked');
 const c=fixture();delete c.judgment_ledger.records.H.snapshot.comparison_context;
 assert.equal(P.compareCurrent(c,input()).replayed,false);
 c.judgment_ledger.records.H.pending={};assert.equal(P.compareCurrent(c,input()).status,'unlinked');
});
test('체크 변경·시스템 판정·재확인 필요는 정답에서 제외',()=>{
 for(const mutate of [s=>s.verdicts.A.origin='auto',s=>s.verdicts.A.needs_reconfirmation=true]){
  const c=fixture();mutate(c.judgment_ledger.records.H.snapshot);
  assert.equal(P.compareCurrent(c,input()).rows.length,0);
 }
 const i=input();i.comparison_context={...ctx,checks:{A:'changed'}};
 assert.equal(P.compareCurrent(fixture(),i).rows.length,0);
});
test('이상없음만 선택한 기록은 매핑 정답으로 승격하지 않음',()=>{
 const c=fixture();delete c.judgment_ledger.records.H.snapshot.matching_observations;
 assert.equal(P.compareCurrent(c,input()).mapping.reviewed,0);
 const i=input();i.comparison_context={...ctx,clauses:'changed-segmentation'};
 assert.equal(P.compareCurrent(fixture(),i).mapping.reviewed,0);
});
test('과거 문제 사례 미노출과 사람이 고른 근거 불일치를 확인 대상으로 표시',()=>{
 const c=fixture();c.judgment_ledger.records.H.snapshot.verdicts.A.verdict='검토의견';
 const i=input();i.after=[];assert.equal(P.compareCurrent(c,i).rows[0].needs_attention,true);
});
