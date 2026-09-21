const {test}=require('node:test');const assert=require('node:assert/strict');
const W=require('../src/safety_workbench'),E=require('../src/safety_eval');
const rule={id:'R',check_id:'A',revision:'1',type_ids:['service'],party_roles:['customer'],rationale:'내부 기준',
  obligations:[{id:'notice',actors:['수탁자'],actions:['통지'],objects:['해지'],conditions:['서면'],polarity:'obligation',quantity:{unit:'일',min:30,max:30}}]};
function pair(n,split='test',truth='safe'){
  const text=truth==='safe'?'수탁자는 해지 시 30일 전에 서면 통지하여야 한다.':'수탁자는 통지 없이 해지할 수 있다.';
  const p=W.seal(Object.assign(E.build({runId:'r'+n,contractHash:'h'+n,familyId:'f'+n,appVersion:'1',
    text:text+'\n시험조건 '+String.fromCharCode(65+Math.floor(n/26),65+n%26),clauses:[{index:0,body:text}],checkpoints:[{id:'A'}],results:[{cpId:'A',coverage:'addressed',best:{clauseIndex:0},ranked:[{clauseIndex:0}]}],
    context:{type:'service',roles:['customer'],source_quality_confirmed:true,scope_confirmed:true,retrieval:{strict:true,sources:[]}}}),
    {engine_fingerprint:'engine',case_date:split==='development'?'2026-01-01':'2026-02-01'}));
  const golds=['one','two'].map(reviewer=>{const g=E.goldTemplate(p);g.reviewer=reviewer;g.source_reviewed=true;g.independent=true;
    g.labels[0]=Object.assign(g.labels[0],{truth,note:'원본 검수',evidence:'본문 1',direct_clause_indices:[0]});return g;});
  return {split,observation:p,golds};
}
function dataset(count=60){return W.freeze({format:'cr-safety-dataset-v1',id:'D',owner:'owner',frozen_on:'2026-09-09',
  cases:[pair(1000,'development'),pair(1001,'adversarial','issue'),...Array.from({length:count},(_,i)=>pair(i))]});}
const opts={approver:'owner',basis:'승인문서 1',representative:true,risk_limit:.05,expires:'2026-10-01'};
test('실제 별첨의 모든 요건이 충족되면 약한 본문 매핑만으로 보류하지 않음',()=>{
 const base=pair(1).observation;
 const p=JSON.parse(JSON.stringify(base));p.documents=[{name:'본문',text:'계약의 목적은 업무 수행이다.'},...p.documents];
 for(const coverage of ['verify','consider','base_covered']){
  p.items[0].coverage=coverage;assert.equal(W.ruleResult(rule,p).eligible,true);
 }
 for(const coverage of ['quiet','not_applicable','not_selected']){
  p.items[0].coverage=coverage;assert.equal(W.ruleResult(rule,p).eligible,false);
 }
 p.items[0].coverage='verify';p.documents.push({name:'특약',text:'다만 수탁자는 해지 통지를 하지 않는다.'});
 assert.equal(W.ruleResult(rule,p).eligible,false);
 p.documents.pop();p.context.reassign={A:0};assert.equal(W.ruleResult(rule,p).eligible,false);
});
test('승인 범위는 검증된 조합 중 명시 선택하며 빈 범위·외부 범위는 차단',()=>{
 const s=W.register(W.empty(),rule,'author','2026-09-09'),d=dataset(),key=W.scopeKey(d.cases[2].observation.context);
 for(const scope_keys of [[],['outside'],[key,key]])assert.throws(()=>W.approve(s,'R',d,{...opts,scope_keys},'engine','2026-09-09'));
 assert.deepEqual(W.approve(s,'R',d,{...opts,scope_keys:[key]},'engine','2026-09-09').approvals.R.scope_keys,[key]);
});
test('오판 신고 즉시 티켓 차단 및 동일 시험셋 재승인 차단, 복구 후 비활성',()=>{
 const d=dataset();let s=W.enable(W.approve(W.register(W.empty(),rule,'author','2026-09-09'),'R',d,opts,'engine','2026-09-09'),'owner','활성','2026-09-09');
 s=W.incident(s,'R','reviewer','원문 오판 의심','2026-09-09');assert.equal(s.approvals.R.status,'suspended');
 assert.equal(W.ticket(s,rule,{id:'A'},pair(3).observation,'engine','2026-09-09'),null);
 assert.throws(()=>W.approve(s,'R',d,opts,'engine','2026-09-09'));
 assert.equal(W.restore(s,'owner','복구','2026-09-09').enabled,false);
 assert.throws(()=>W.incident(s,'R','','사유','2026-09-09'));
});
test('문제 비노출 또는 안전 정답 근거 오연결은 승인 차단',()=>{
 for(const mutate of [d=>d.cases[1].observation.items[0].surfaced=false,d=>d.cases[2].observation.items[0].top1=null]){
 const d=JSON.parse(JSON.stringify(dataset()));mutate(d);d.cases.forEach(c=>c.observation=W.seal(c.observation));
 assert.throws(()=>W.approve(W.register(W.empty(),rule,'author','2026-09-09'),'R',W.freeze(d),opts,'engine','2026-09-09'));
 }
});
test('오판 체크의 규칙 이름 변경으로 반례 편입을 우회할 수 없고 원문도 대조한다',()=>{
 const H=require('../src/safety_digest'),d=dataset(),source=H.of(d.cases[1].observation.documents);
 let s=W.incident(W.register(W.empty(),rule,'작성','2026-09-09'),'R','신고','오판','2026-09-09',source);const event=s.events.at(-1),renamed={...rule,id:'RENAMED'};
 s=W.register(s,renamed,'작성','2026-09-09');assert.throws(()=>W.approve(s,'RENAMED',d,opts,'engine','2026-09-09'),/오판 신고/);
 const next=JSON.parse(JSON.stringify(d));next.id='new';next.cases[1].observation.incident_ids=[event.id];next.cases[1].observation=W.seal(next.cases[1].observation);
 assert.equal(W.approve(s,'RENAMED',W.freeze(next),opts,'engine','2026-09-09').approvals.RENAMED.status,'approved');
 s.events.at(-2).source_digest='wrong';assert.throws(()=>W.approve(s,'RENAMED',W.freeze(next),opts,'engine','2026-09-09'),/오판 신고/);
});
test('두 사람 이견은 미해결 상태로 유지하고 제3자 조정 이력을 요구한다',()=>{
  const c=pair(1);c.golds[1].labels[0].truth='issue';
  assert.equal(W.consensus(c.observation,c.golds).A.agreement,'conflict');
  assert.throws(()=>W.consensus(c.observation,c.golds,{A:{reviewer:'one'}}));
  const r={truth:'safe',direct_clause_indices:[0],reviewer:'third',note:'재대조',evidence:'본문',date:'2026-09-09'};
  assert.equal(W.consensus(c.observation,c.golds,{A:r}).A.agreement,'resolved');
});
test('같은 계열·중복 본문·미래 검색 자료·지문 변경을 차단한다',()=>{
  const d=dataset(2),bad=JSON.parse(JSON.stringify(d));
  bad.cases[2].observation.family_id=bad.cases[0].observation.family_id;
  bad.cases[2].observation=W.seal(bad.cases[2].observation);
  assert.throws(()=>W.freeze(bad));
  d.id='edited';assert.throws(()=>W.evaluate(d,rule,'engine'));
  const c=pair(4);c.observation.context.retrieval.sources=[{family_id:'foreign',date:'2027-01-01'}];c.observation=W.seal(c.observation);
  assert.throws(()=>W.freeze({format:'cr-safety-dataset-v1',id:'D',owner:'o',frozen_on:'2026-09-09',cases:[c]}));
});
test('소표본은 승인 불가, 승인·명시 활성화·본건 조건을 모두 만족해야 1회 티켓 발급',()=>{
  let s=W.register(W.empty(),rule,'author','2026-09-09');
  assert.throws(()=>W.approve(s,'R',dataset(2),opts,'engine','2026-09-09'));
  s=W.approve(s,'R',dataset(),opts,'engine','2026-09-09');
  const p=pair(3).observation,cp={id:'A'};
  assert.equal(W.ticket(s,rule,cp,p,'engine','2026-09-09'),null);
  s=W.enable(s,'owner','운영 승인','2026-09-09');
  const t=W.ticket(s,rule,cp,p,'engine','2026-09-09');assert.ok(t);
  assert.equal(W.consume(JSON.parse(JSON.stringify(t)),'A'),null);
  assert.equal(W.consume({check_id:'A',rule_id:'R'},'A'),null);
  assert.ok(W.consume(t,'A'));assert.equal(W.consume(t,'A'),null);
  assert.equal(W.ticket(s,rule,cp,p,'changed','2026-09-09'),null);
  assert.equal(W.ticket(s,rule,cp,p,'engine','2026-10-02'),null);
  assert.equal(W.ticket(s,rule,{id:'A',auto_verdict:false},p,'engine','2026-09-09'),null);
  p.context.source_quality_confirmed=false;assert.equal(W.ticket(s,rule,cp,p,'engine','2026-09-09'),null);
  assert.equal(W.restore(s,'owner','복구','2026-09-09').approvals.R.status,'restored_pending');
  assert.equal(W.stop(s,'R','owner','오판 발견','2026-09-09').approvals.R.status,'suspended');
});
test('검수 원문 변경과 숫자만 다른 시험 계열을 허용하지 않는다',()=>{
  const c=pair(4);c.golds[0].documents[0].text+='변조';
  assert.throws(()=>W.consensus(c.observation,c.golds));
  const a=pair(5),b=pair(6);
  a.observation.documents[0].text='공통 본문 계약 100';
  b.observation.documents[0].text='공통 본문 계약 200';
  [a,b].forEach(x=>{x.observation=W.seal(x.observation);x.golds.forEach(g=>g.documents=JSON.parse(JSON.stringify(x.observation.documents)));});
  assert.throws(()=>W.freeze({format:'cr-safety-dataset-v1',id:'D',owner:'o',frozen_on:'2026-09-09',cases:[a,b]}));
});
test('불명확한 정답을 가진 충족 후보는 승인되지 않는다',()=>{
  const d=dataset(),raw=JSON.parse(JSON.stringify(d));raw.cases[2].golds.forEach(g=>g.labels[0].truth='unknown');
  const s=W.register(W.empty(),rule,'author','2026-09-09');
  assert.throws(()=>W.approve(s,'R',W.freeze(raw),opts,'engine','2026-09-09'));
});
test('승인 경로에서 미사용 독립 정의문만 보류 해소하고 사용된 정의·단서는 차단',()=>{
  let s=W.register(W.empty(),rule,'author','2026-09-09');
  s=W.enable(W.approve(s,'R',dataset(),opts,'engine','2026-09-09'),'owner','운영 승인','2026-09-09');
  for(const [extra,allowed] of [
    ['\n“물품”이란 납품되는 장비를 말한다.',true],
    ['\n“물품”이란 납품되는 장비를 말한다.\n물품에는 별도 절차를 적용한다.',false],
    ['\n다만 긴급한 경우 이를 생략한다.',false]]) {
    const p=JSON.parse(JSON.stringify(pair(3).observation));p.documents[0].text+=extra;
    assert.equal(!!W.ticket(s,rule,{id:'A'},W.seal(p),'engine','2026-09-09'),allowed);
  }
});
