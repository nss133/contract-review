const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/eval_batch'),T=require('../src/eval_trial'),H=require('../src/safety_digest');
function fixture(){
 const checks=[{id:'A',check:'백업 복구 확인'}],store={cases:{},trials:{}},entries=[];
 for(const [n,split,day] of [[1,'development','2026-01-01'],[2,'test','2026-02-01']]){
  const c={key:'k'+n,source:{id:'contract:'+n,review_id:String(n),kind:'contract',title:'서버 백업 복구 '+(n===1?'가':'나'),department:'정보보호'},version:'before',documents:[{role:'main',name:'본문',text:'서버 백업 복구 '+(n===1?'가':'나')}],items:[{id:'i',check_id:'A',reviewer:'준비자',status:'reviewed_draft'}]};
  c.items[0].context_digest=H.of([c.version,c.documents]);const t=T.freeze(c,checks,[{index:0,body:c.documents[0].text}]);
  for(const reviewer of ['가','나'])T.saveReview(t,{trial_id:t.id,seal:t.seal,reviewer,independent:true,source_reviewed:true,labels:[{id:'A',truth:'issue',direct:[0],reason:'검수',evidence:'본문'}]});
  store.cases[c.key]=c;store.trials[t.id]=t;entries.push({trial_id:t.id,family:'묶음'+n,date:day,split});
 }
 const knowledge={latest:{},documents:{}},metadata={};
 for(const [id,kind,family,date,rid] of [['contract','contract_review','과거 계약','2025-12-01','old'],['legal','legal_review','과거 자문','2025-12-02',''],['self','contract_review','묶음2','2026-01-10','2'],['future','legal_review','미래','2027-01-01',''],['same-day','legal_review','당일','2026-02-01',''],['unknown','legal_review','','','']]){
  knowledge.latest[id]=id;knowledge.documents[id]={source_id:id,source_kind:kind,review_id:rid,title:'서버 백업 복구',tags:[],evidence:[],family_id:family,date};
  if(id!=='unknown')metadata[id]={family,date,confirmed:true,source_digest:H.of(knowledge.documents[id])};
 }
 return {store,entries,knowledge,metadata,checks};
}
function freeze(f){return B.freeze(f.store,f.entries,f.metadata,f.knowledge,f.checks,'engine','담당자');}
test('여러 계약을 원문·검수·출처 버전과 고정하고 미확인 참고자료 제외',()=>{const f=fixture(),b=freeze(f);assert.equal(b.snapshot.cases.length,2);assert.equal(b.snapshot.excluded_unconfirmed,1);assert.equal(b.snapshot.approval_eligible,false);B.fresh(b,f.store,f.knowledge,f.checks,'engine');});
test('계약검토/법률검토를 분리하고 시험 계열·미래·당일·자기 원천 제외',()=>{const b=freeze(fixture()),c=b.snapshot.cases[1];assert.deepEqual(B.retrieve(b,c,'contract').map(x=>x.doc.source_id),['contract']);assert.deepEqual(B.retrieve(b,c,'legal').map(x=>x.doc.source_id),['legal']);assert.equal(B.retrieve(b,c,'combined').length,2);assert.equal(B.retrieve(b,c,'tags').length,0);});
test('동일 원천 파생자료는 다른 묶음으로 분리해 누수시킬 수 없다',()=>{const f=fixture();f.metadata.self.family='분리된 것처럼';assert.throws(()=>freeze(f));});
test('같은 묶음의 분할 교차·개발 미래·잘못된 날짜·중복 대상 차단',()=>{for(const mutate of [f=>f.entries[1].family='묶음1',f=>f.entries[0].date='2026-03-01',f=>f.entries[0].date='2026-02-01',f=>f.entries[0].date='2026-02-30',f=>f.entries[1]=f.entries[0]]){const f=fixture();mutate(f);assert.throws(()=>freeze(f));}});
test('숫자만 다른 본문을 별도 계열로 중복 계수할 수 없다',()=>{const f=fixture();const ts=Object.values(f.store.trials);for(let i=0;i<2;i++){const old=ts[i],c=f.store.cases[old.snapshot.case_key];c.documents[0].text='같은 계약 '+i;c.items[0].context_digest=H.of([c.version,c.documents]);const t=T.freeze(c,f.checks,old.snapshot.clauses);old.reviews.forEach(r=>T.saveReview(t,{...r,trial_id:t.id,seal:t.seal}));f.store.trials[t.id]=t;f.entries[i].trial_id=t.id;}assert.throws(()=>freeze(f));});
test('DB 내용·체크·엔진·검수·원문 변경은 재고정 요구',()=>{for(const mutate of [f=>f.knowledge.documents.contract.title+='수정',f=>f.checks[0].check+='수정',f=>Object.values(f.store.trials)[0].reviews.pop(),f=>f.store.cases.k1.documents[0].text+='수정']){const f=fixture(),b=freeze(f);mutate(f);assert.throws(()=>B.fresh(b,f.store,f.knowledge,f.checks,'engine'));}const f=fixture(),b=freeze(f);assert.throws(()=>B.fresh(b,f.store,f.knowledge,f.checks,'new'));});
test('분할별 분모·계열 수와 쌍대 개선/악화/새 누락을 따로 기록',()=>{const b=freeze(fixture());const predictions=b.snapshot.cases.map(c=>({trial_id:c.trial.id,items:[{id:'A',top1:0,top3:[0],surfaced:true,auto_safe:false}]}));const base=B.score(b,'tags',predictions);assert.equal(base.splits.test.families,1);assert.equal(base.splits.adversarial.mapping_total,0);predictions[1].items[0].top1=null;predictions[1].items[0].surfaced=false;const next=B.score(b,'legal',predictions),d=B.compare(b,base,next);assert.equal(d.regressed.length,1);assert.equal(d.new_misses.length,1);assert.equal(d.improved.length,0);});
test('스냅샷 변조·예측 대상 혼동 차단',()=>{const b=freeze(fixture());assert.throws(()=>B.score(b,'bad',[]));b.snapshot.owner='변조';assert.throws(()=>B.valid(b));});
test('이견 조정 후 이전 다계약 평가묶음은 재고정해야 한다',()=>{const f=fixture(),t=Object.values(f.store.trials)[0];t.reviews[1].labels[0].truth='safe';const b=freeze(f);T.resolve(t,{id:'A',reviewer:'제3자',truth:'issue',direct:[0],reason:'대조',evidence:'본문',source_reviewed:true});assert.throws(()=>B.fresh(b,f.store,f.knowledge,f.checks,'engine'));});
test('같은 source ID의 새 원천에 과거 날짜 확인을 승계하지 않는다',()=>{const f=fixture();f.knowledge.documents.contract.evidence.push({sentence:'후일 수정된 의견'});assert.throws(()=>freeze(f));});
