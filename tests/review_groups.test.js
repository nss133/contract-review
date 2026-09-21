const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../src/review_groups'),D=require('../src/safety_digest'),Loop=require('../src/loop');
const catalog=require('../knowledge/check_groups.json');G.configure(catalog);
const units=()=>G.units([{cpId:'CMN-11',best:{clauseIndex:1}},{cpId:'CMN-14',best:{clauseIndex:3}}]);
test('30개 그룹/106개 요건은 중복 없이 다른 조항에서도 합침',()=>{
 assert.equal(catalog.groups.length,30);assert.equal(catalog.groups.flatMap(g=>g.members).length,106);
 assert.equal(units().length,1);assert.equal(units()[0].results.length,2);
 assert.notEqual(G.definition('PRIV-08')?.id,'DAMAGE');assert.notEqual(G.definition('SP-PAY-06').id,'DAMAGE');
});
test('통합 판정은 하위 판정을 복제하지 않고 부분 과거판정을 전체로 승격하지 않음',()=>{
 const u=units()[0],store={'CMN-11':{verdict:'이상없음',origin:'manual'}},before=JSON.stringify(store);
 assert.equal(G.status(u,store,{},'ctx').done,false);
 const parent=G.decide(u,store,{},'ctx',{verdict:'이상없음',comment:'전체 범위 확인'});
 assert.equal(G.status(u,store,parent,'ctx').done,true);assert.equal(JSON.stringify(store),before);
 assert.equal(parent.DAMAGE.judgment_scope,'group_only');
 assert.equal(G.status(u,store,parent,'new doc').stale,true);
 const stale=G.pack(parent);stale.records.DAMAGE.needs_reconfirmation=true;
 assert.equal(G.status(u,store,G.normalize(stale),'ctx').stale,true);
 assert.equal(G.status(G.units([{cpId:'CMN-11'}])[0],store,parent,'ctx').stale,true);
});
test('보완·위험수용과 다른 통합 결론은 이유를 요구하며 원판정 보존',()=>{
 const u=units()[0],store={'CMN-11':{verdict:'검토의견',comment:'상한 수정',origin:'manual'}};
 assert.throws(()=>G.decide(u,store,{},'ctx',{verdict:'이상없음'}),/이유/);
 const p=G.decide(u,store,{},'ctx',{verdict:'이상없음',comment:'별첨 예외 조항 확인'});
 assert.equal(store['CMN-11'].verdict,'검토의견');assert.equal(G.status(u,store,p,'ctx').done,true);
 store['CMN-14']={verdict:'검토의견',origin:'manual'};
 assert.equal(G.status(u,store,p,'ctx').stale,true);
});
test('모든 하위 판정이 완료된 경우만 종합, 무관한 자동상태 변화는 수동판정 취소 아님',()=>{
 const u=units()[0],s={'CMN-11':{verdict:'이상없음',origin:'auto'},'CMN-14':{verdict:'이상없음',origin:'auto'}};
 assert.equal(G.status(u,s,{},'ctx').origin,'auto');
 const p=G.decide(u,s,{},'ctx',{verdict:'이상없음'});delete s['CMN-11'];
 assert.equal(G.status(u,s,p,'ctx').done,true);
 s['CMN-14'].needs_reconfirmation=true;assert.equal(G.status(u,s,{},'ctx').done,false);
});
test('저장/코퍼스는 상위판정과 태그를 보존하되 byCheck에 가짜 세부 정답 없음',()=>{
 const u=units()[0],p=G.decide(u,{}, {},'ctx',{verdict:'검토의견',comment:'손해배상 조정'}),packed=G.pack(p);
 assert.deepEqual(G.normalize(JSON.parse(JSON.stringify(packed))),p);
 const corpus=Loop.mergeIntoCorpus(null,{meta:{contract_hash:'g',date:'2026-09-16'},verdicts:{},group_reviews:packed});
 assert.equal(G.history(corpus,'DAMAGE').length,1);
 assert.equal(corpus.byCheck['CMN-11'],undefined);
 assert.equal(corpus.judgment_ledger.records.g.snapshot.group_reviews.records.DAMAGE.judgment_tags.scope,'group_only');
});
test('통합 평가 분모는 별도, 자기정답 주입 없이 모든 요건 후보를 비교',()=>{
 const u=units()[0],p=G.decide(u,{}, {},'ctx',{verdict:'검토의견',comment:'상한 문제'});
 p.DAMAGE.definition_fingerprint=D.of(u.definition);
 const packet={group_reviews:G.pack(p),checks:u.results.map(r=>({id:r.cpId})),items:u.results};
 let e=G.evaluate(packet,[{check_id:'CMN-11',eligible:true},{check_id:'CMN-14',eligible:false}]);
 assert.equal(e.checked,1);assert.equal(e.candidates,0);
 e=G.evaluate(packet,[{check_id:'CMN-11',eligible:true},{check_id:'CMN-14',eligible:true}]);assert.equal(e.false_safe,1);
 packet.checks.pop();assert.equal(G.evaluate(packet,[]).checked,0);
});
