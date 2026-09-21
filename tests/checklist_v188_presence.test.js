'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const inventory=require('../knowledge/checklist_inventory_v188.json');
const Agreement=require('../src/agreement_judgment');
// 승인 기준표의 합성 예시를 엔진과 직접 대조한다. 회사 표준/코퍼스 원문을 새로 내장하지 않는다.
// 이 시험은 약정 확인 단계이며 적용 모듈 선택·수기 이관·완료 상태는 별도 통합 시험 대상이다.
for(const r of inventory.checks.filter(r=>r.active&&r.level==='presence')){
 const cp={id:r.id,check:r.question,meaning_revision:r.meaning_revision};
 const options={scope:{party:{companyLabel:'갑'},stance:'party'}};
 test('v1.88 기준 양성: '+r.id+' — '+r.question,()=>{
  assert.ok(Agreement.profiles[r.id],r.id+' 프로파일 없음');
  const result=Agreement.evaluate(cp,[{name:'본건 계약서',text:r.examples.positive}],options);
  assert.equal(result.eligible,true,JSON.stringify({id:r.id,text:r.examples.positive,status:result.status,missing:result.missing,blockers:result.blockers}));
  assert.ok(result.evidence.length>0,r.id+' 본건 근거 없음');
 });
 test('v1.88 기준 반례: '+r.id,()=>{
  const result=Agreement.evaluate(cp,[{name:'본건 계약서',text:r.examples.negative}],options);
  assert.equal(result.eligible,false,JSON.stringify({id:r.id,text:r.examples.negative,status:result.status,evidence:result.evidence}));
 });
 test('v1.88 표현변형: '+r.id+' — 행바꿈·소제목·무관한 단서',()=>{
  const variants=[r.examples.positive.replace(/ /,'\n'),
   '제1조(약정 사항)\n'+r.examples.positive+'\n제2조(회의 일정)\n회의는 월요일에 한다. 다만, 공휴일이면 화요일에 한다.'];
  for(const text of variants){
   const docs=[{name:'본건 계약서',text}],result=Agreement.evaluate(cp,docs,options);
   assert.equal(result.eligible,true,JSON.stringify({id:r.id,text,missing:result.missing,blockers:result.blockers}));
   assert.ok(result.evidence.length>0);
   assert.ok(result.evidence.every(e=>docs[e.document_index].text.slice(e.start,e.end)===e.text),'합성 문장 대신 원문 위치 보존');
  }
 });
}
test('v1.88 재분류 질문에 이웃 쟁점의 잘못된 프로파일을 연결하지 않는다',()=>{
 const wrongTopic={
  'CNS-PRIVNOTICE':'수탁자는 개인정보 유출 사고를 회사에 통지한다.',
  'ITDL-02':'회사는 산출물의 인수검사와 검수를 실시한다.',
  'SH-GOV-03':'투자자는 이사 후보자를 추천할 수 있다.',
  'SH-GOV-05':'주요 경영사항은 투자자의 사전 동의를 받는다.',
  'SH-FIN-06':'회사는 투자자에게 재무제표를 제공한다.'
 };
 for(const [id,text] of Object.entries(wrongTopic)){
  const result=Agreement.evaluate({id},[{name:'본건 계약서',text}],{});
  assert.equal(result.eligible,false,id+' 이웃 쟁점 오연결: '+text);
 }
});
test('v1.88 존재형 전수에서 조 제목만으로 약정 충족을 만들지 않는다',()=>{
 for(const r of inventory.checks.filter(r=>r.active&&r.level==='presence')){
  const terms=Agreement.profiles[r.id]?.terms||[];
  const result=Agreement.evaluate({id:r.id},[{name:'본건 계약서',text:'제1조('+terms.slice(0,3).join('·')+')'}],{});
  assert.equal(result.eligible,false,r.id+' 제목만 통과');
 }
});
