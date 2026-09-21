const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../src/standard_auto'),R=require('../src/review_replay'),D=require('../src/safety_digest');
const termination='당사자 일방이 본 계약상의 의무를 중대하게 위반한 경우 상대방은 30일의 기간을 정하여 서면으로 시정을 요구하고 그 기간 내에 시정하지 아니하면 서면 통지로 본 계약을 해지할 수 있다.';
const damages='당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.';
const definition='“비밀정보”란 본 계약의 수행 과정에서 상대방으로부터 제공받은 기술상 또는 경영상의 정보로서 비밀로 표시된 정보를 말한다.\n비밀정보는 계약 목적 외에 사용하거나 제3자에게 공개할 수 없다.';
const checks=require('../build/audit_v188_acceptance.cjs').loadChecks();
function cp(id){const current=({'CMN-08':'CNS-END','CMN-09':'CNS-END','CMN-11':'CNS-DAMAGE','CMN-15':'CNS-SECRET','CMN-04':'CNS-PRICE','CMN-06':'CNS-TERM'})[id]||id;return checks.find(c=>c.id===current);}
function input(text,annex){return {confirmed:true,documents:[{name:'본문',text}].concat(annex||[])};}
const item={coverage:'verify'};
test('해지 균형·최고·서면 통지와 상호 귀책 배상의 좁은 패턴',()=>{
 assert.equal(S.evaluate(cp('CMN-08'),item,input(termination)).eligible,true);
 assert.equal(S.evaluate(cp('CMN-09'),item,input(termination)).eligible,true);
 assert.equal(S.evaluate(cp('CMN-11'),item,input(damages)).eligible,true);
 const combined='제1조(해지)\n'+termination+'\n제2조(손해배상)\n'+damages;
 assert.equal(S.evaluate(cp('CMN-08'),item,input(combined)).eligible,true);
 assert.equal(S.evaluate(cp('CMN-11'),item,input(combined)).eligible,true);
});
test('조문 괄호 없는 제목·번호 없는 제목과 명시적 동의어 변형',()=>{
 assert.equal(S.evaluate(cp('CMN-08'),item,input('제1조 해지\n'+termination.replace('당사자 일방이','갑과 을 중 일방이').replace('시정을 요구하고','시정을 최고하고')+'\n제2조 대금\n다만 휴일이면 다음 영업일에 지급한다.')).eligible,true);
 assert.equal(S.evaluate(cp('CMN-11'),item,input('손해배상\n'+damages.replace('당사자 일방은','각 당사자는').replace('통상손해','통상의 손해').replace('배상하여야 한다.','배상할 책임을 진다.'))).eligible,true);
});
test('해지기간·책임범위 변형은 존재로 인정하며 명시적 편중만 보류',()=>{
 for(const s of [termination.replace('당사자 일방','수탁자'),termination.replace('중대하게',''),termination.replace('30일','1일'),termination.replace('서면 통지','구두 통지')])
  assert.equal(S.evaluate(cp('CMN-08'),item,input(s)).eligible,true,s);
 for(const s of [damages.replace('당사자 일방','위탁자'),damages.replace('통상손해','모든 손해'),damages.replace('배상하여야 한다','배상할 수 있다'),damages+' 다만 배상액은 계약금액을 한도로 한다.'])
  assert.equal(S.evaluate(cp('CMN-11'),item,input(s)).eligible,true,s);
 assert.equal(S.evaluate(cp('CMN-08'),item,input('을만 아무런 사유 없이 즉시 해지할 수 있고 갑은 계약을 해지할 수 없다.')).eligible,false);
 assert.equal(S.evaluate(cp('CMN-11'),item,input('을은 고의 또는 중과실로 갑에게 발생시킨 손해에 대해서도 일체의 책임을 지지 않는다.')).eligible,false);
});
test('별첨 내용으로 정의 요건 충족하되 파일명·참조만으로는 불가',()=>{
 const p=input('용역계약서\n제1조(목적)\n개발 용역을 수행한다.',[{name:'보안관리약정서',text:'보안관리약정서\n제1조(비밀정보)\n'+definition}]);
 assert.equal(S.evaluate(cp('CMN-15'),{coverage:'quiet',annexEvidence:true},p).eligible,true);
 assert.equal(S.evaluate(cp('CMN-15'),{coverage:'quiet'},p).eligible,true);
 assert.equal(S.evaluate(cp('CMN-15'),{coverage:'quiet',annexEvidence:true,serviceGated:true},p).eligible,false);
 p.documents[1].text='보안관리약정서를 체결할 예정이다.';assert.equal(S.evaluate(cp('CMN-15'),item,p).eligible,false);
});
test('분리된 본문·별첨의 지급 요건 결합과 상충 변경',()=>{
 const p=input('제1조(지급)\n발주 건별 계약단가에 따라 대금을 정산한다.\n위탁자는 수탁자의 청구서 수령일로부터 30일 이내에 대금을 수탁자의 지정 계좌로 지급한다.',
 [{name:'정산약정서',text:'제1조(정산)\n양 당사자는 매월 말일에 실제 수행 내역을 상호 확인하여 대금을 정산한다.'}]);
 assert.equal(S.evaluate(cp('CMN-04'),item,p).eligible,true);
 p.documents[1].text+='\n을은 갑의 동의 없이 계약금액을 일방적으로 증액할 수 있다.';assert.equal(S.evaluate(cp('CMN-04'),item,p).eligible,false);
});
test('다른 계약의 결론과 무관하게 현재 책임 약정을 독립 판정',()=>{
 const c=cp('CMN-11'),p=input(damages);p.scope={type:'service',roles:['customer'],stance:'party'};p.date='2026-09-16';p.contract_hash='new';
 const v={origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'상호 귀책 책임 확인'};
 const patterns=S.observe([c],[{...item,cpId:c.id}],p,{[c.id]:v});assert.ok(patterns[c.id]);
 const snapshot={meta:{date:'2026-09-15'},verdicts:{[c.id]:v},standard_patterns:patterns};
 p.corpus={judgment_ledger:{records:{old:{snapshot}}}};
 assert.equal(S.evaluate(c,item,p).references.length,0);assert.equal(S.evaluate(c,item,p).eligible,true);
 v.origin='auto';assert.equal(S.evaluate(c,item,p).references.length,0);v.origin='manual';
 v.reason='수용 가능한 위험';assert.equal(S.evaluate(c,item,p).status,'supported');v.reason='반영되어 있음';
 snapshot.meta.date='2027-01-01';assert.equal(S.evaluate(c,item,p).references.length,0);
});
test('전체 재매핑은 저장된 후보를 무시하고 본문·별첨을 다시 분석',()=>{
 const c=cp('CMN-15'),main='제1조(목적)\n개발 용역을 수행한다.',annex='제1조(비밀정보)\n'+definition;
 const knowledge={common:{checks:[c]},types:[{meta:{type_id:'service'},checks:[]}]};
 const packet={context:{type:'service',modules:[],roles:[],stance:'party'},documents:[{name:'본문',text:main},{name:'별첨',text:annex}],checks:[c],
 items:[{cpId:c.id,coverage:'not_applicable'}],confirmed:true,verdicts:{}};
 const before=JSON.stringify(packet),r=R.run(packet,knowledge,[]);
 assert.equal(r.mapping_replayed,true);assert.equal(r.annex_search_replayed,true);assert.ok(r.subCoverage[c.id]);
 assert.equal(r.packet.items[0].annexEvidence,true);assert.notEqual(r.packet.items[0].coverage,'not_applicable');assert.equal(JSON.stringify(packet),before);
});
test('현행 체크 변경·원계약 역할 불일치·삭제 유형을 분리',()=>{
 const c=cp('CMN-06'),k={common:{checks:[c]},types:[{meta:{type_id:'service'},checks:[]}]};
 const p={context:{type:'service',modules:[],roles:[],stance:'party'},documents:[{name:'본문',text:'계약기간은 체결일로부터 1년으로 한다.'}],checks:[{...c,check:'구 체크'}],items:[]};
 assert.equal(R.run(p,k).excluded_checks,1);
 p.context.baseText='다른 원계약';assert.throws(()=>R.run(p,k),/원계약/);delete p.context.baseText;
 p.context.type='removed';assert.throws(()=>R.run(p,k),/유형/);
});
