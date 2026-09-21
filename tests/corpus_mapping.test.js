const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../src/loop'),A=require('../src/history_assist'),P=require('../src/eval_prepare');
const M=require('../src/matcher');
function corpus(origin='manual',reason='반영되어 있음'){
 return L.mergeIntoCorpus(L.emptyCorpus(),{meta:{contract_hash:'hash',date:'2026-09-15',reviewer:'사람'},
  history_reference:{review_id:'R'},verdicts:{C:{verdict:'이상없음',origin,reason,comment:'수탁자는 해지 시 서면 통지하여야 한다.'}}});
}
const cp={id:'C',triggers:{keywords:['해지','통지']}},cl={body:'수탁자는 해지 시 서면 통지하여야 한다.'};
test('코퍼스 사용자 의견을 해당 체크의 실제 매핑 보조로 연결',()=>{
 const k=A.combined(null,null,corpus()),found=A.retrieve(k,cl.body,'');
 assert.equal(found.length,1);assert.ok(A.clauseSupport(found,cp,cl).bonus>0);
 assert.equal(A.clauseSupport(found,{...cp,id:'OTHER'},cl).bonus,0);
 assert.equal(found[0].doc.evidence[0].evidence_kind,'judgment_opinion');
});
test('운영 매칭 엔진에서 코퍼스 근거와 기본 점수의 차이를 보존',()=>{
 const found=A.retrieve(A.combined(null,null,corpus()),cl.body,'');
 const check={...cp,module:'M-CORE',severity:'참고',norm_type:'실무',check:'해지 통지',sources:[]};
 const r=M.analyze([{index:0,heading:'해지 통지',body:cl.body}],[{meta:{type_id:'test'},checkpoints:[check]}],{modules:['M-CORE'],historyRelated:found});
 const best=r.results[0].best;assert.ok(best.historySupport.bonus>0);
 assert.equal(best.score,best.baseScore+best.historySupport.bonus);
 assert.equal(best.historySupport.evidence[0].evidence_kind,'judgment_opinion');
});
test('연결 ID가 있는 기존 태깅과 코퍼스는 별도 중복 사례로 생성하지 않음',()=>{
 const tags={latest:{T:'t'},documents:{t:{source_id:'T',title:'계약',date:'2026-01-01',original:{review_id:'R'},evidence:[],tags:[]}}};
 const k=A.combined(tags,null,corpus());assert.equal(Object.keys(k.latest).length,1);
 assert.equal(k.documents['tag:T'].date,'2026-09-15');assert.equal(tags.documents.t.evidence.length,0);
 assert.equal(A.retrieve(k,cl.body,'',{asOf:'2026-09-14'}).length,0);
});
test('자기 계약·동일 검토 ID·시스템 결과·위험수용·미해결 수입 충돌 제외',()=>{
 assert.equal(Object.keys(A.combined(null,null,corpus(),{excludeContractHash:'hash'}).latest).length,0);
 for(const c of [corpus('auto'),corpus('subdoc'),corpus('manual','수용 가능한 위험')])
  assert.equal(Object.keys(A.combined(null,null,c).latest).length,0);
 const c=corpus();c.judgment_ledger.records.hash.pending={};
 assert.equal(Object.keys(A.combined(null,null,c).latest).length,0);
 const h={latest:{R:'r'},records:{r:{result:{review_text:cl.body}}}};
 assert.equal(Object.keys(A.combined(null,h,corpus(),{excludeContractHash:'hash'}).latest).length,0);
});
test('코퍼스 계열 미상은 격리 시험 검색에서 제외하고 색인은 직렬화하지 않음',()=>{
 const k=A.combined(null,null,corpus());assert.ok(k.search_index);
 assert.equal(JSON.stringify(k).includes('search_index'),false);
 assert.equal(A.retrieve(k,cl.body,'',{strictIsolation:true}).length,0);
 const restored=JSON.parse(JSON.stringify(k));
 assert.deepEqual(A.retrieve(restored,cl.body,''),A.retrieve(k,cl.body,''));
});
test('간편 점검은 현재 체크의 개선 후보만 제시하고 재채점 수를 만들지 않음',()=>{
 const c={meta:{contract_count:29},byCheck:{C:{counts:{'이상없음':8,'검토의견':1},system_verdict_pairs:{'possible_evidence::이상없음':5}},REMOVED:{counts:{'이상없음':4}}}};
 const r=P.corpusReadiness(c,[{id:'C',label:'해지 통지'}]);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].weak_safe,5);
 assert.equal(r.rows[0].status,'과거 보완 의견 확인');assert.equal(r.excluded_checks,1);assert.equal(r.replayed_cases,0);
 assert.equal(P.corpusReadiness(null,[]).rows.length,0);
});
