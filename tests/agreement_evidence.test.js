const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../src/standard_auto'),A=require('../src/agreement_evidence');
const checks=require('../build/audit_v188_acceptance.cjs').loadChecks(),c=id=>checks.find(x=>x.id===id);
const damage='당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.';
const fragmented='당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 손해를 배상하여야 한다.\n손해배상의 범위는 통상손해로 한다.';
function auto(id,text,extra=[]){return S.evaluate(c(id),{coverage:'addressed'},{confirmed:true,documents:[{name:'본문',text},...extra]});}
test('책임 부담과 면제 모두 약정 존재로 인식하며 고의·중과실 면책은 차단',()=>{
 for(const text of [damage,'수탁자는 손해배상 책임을 지지 않는다.'])assert.equal(auto('CNS-DAMAGE',text).recognition.stage,'clause_found');
 const r=auto('CNS-DAMAGE','수탁자는 손해배상 책임을 지지 않는다.');assert.equal(r.eligible,true);assert.equal(r.recognition.stage,'clause_found');
 assert.equal(auto('CNS-DAMAGE','을은 고의 또는 중과실로 갑에게 발생시킨 손해에 대해서도 일체의 책임을 지지 않는다.').eligible,false);
});
test('낮은 매핑 등급에서도 관련 조항이 있으면 본문 요건을 판정하되 적용범위 게이트 보존',()=>{
 const input={confirmed:true,documents:[{name:'본문',text:damage}]};
 assert.equal(S.evaluate(c('CNS-DAMAGE'),{coverage:'quiet'},input).eligible,true);
 assert.equal(S.evaluate(c('CNS-DAMAGE'),{coverage:'quiet',roleGated:true},input).eligible,false);
 input.documents[0].text='수탁자는 손해배상 책임을 지지 않는다.';
 const r=S.evaluate(c('CNS-DAMAGE'),{coverage:'quiet'},input);assert.notEqual(r.status,'uncertain_mapping');assert.equal(r.eligible,true);
});
test('무관한 연락처 빈칸·타 조항을 전체 판정 중지 사유로 사용하지 않음',()=>{
 assert.equal(auto('CNS-DAMAGE','제1조(연락처)\n담당자: ______\n제2조(손해배상)\n'+damage).eligible,true);
 assert.equal(auto('CNS-DAMAGE','담당자: ______\n'+damage).eligible,true);
 assert.equal(auto('CMN-05','부가가치세는 포함한다.\n담당자: ______').eligible,true);
});
test('관련 근거 빈칸은 계속 차단하고 해당 원문을 표시',()=>{
 const r=auto('CNS-DAMAGE',damage+'\n손해배상 한도: ______');assert.equal(r.eligible,false);assert.ok(r.blockers.some(b=>b.text.includes('한도')));
});
test('동일 구역의 두 문장에 나뉜 귀책책임·통상손해 요건을 결합',()=>{
 assert.equal(auto('CNS-DAMAGE',fragmented).eligible,true);
 assert.equal(auto('CNS-DAMAGE',fragmented.split('\n')[0]).eligible,true);
 assert.equal(auto('CNS-DAMAGE',fragmented.replace('통상손해','모든 손해')).eligible,true);
 assert.equal(auto('CNS-DAMAGE',fragmented.replace('배상하여야 한다','배상할 수 있다')).eligible,true);
});
test('책임 조항만으로 질문을 충족하면 다른 조항에 분리된 범위 문구도 인정',()=>{
 const [first,second]=fragmented.split('\n');
 assert.equal(auto('CNS-DAMAGE',first,[{name:'별첨',text:second}]).eligible,true);
 assert.equal(auto('CNS-DAMAGE','제1조(손해배상)\n'+first+'\n제2조(별도 책임)\n'+second).eligible,true);
});
test('관련 단서와 다른 조항의 전역 면제는 계속 검사',()=>{
 assert.equal(auto('CNS-DAMAGE',damage+'\n다만, 불가항력으로 인한 책임은 면제한다.').eligible,true);
 assert.equal(auto('CNS-DAMAGE',damage+'\n제9조(특약)\n본 계약의 모든 의무를 배제한다.').eligible,false);
 assert.equal(auto('CMN-05','부가가치세는 포함한다.\n다만, 이는 추후 변경할 수 있다.').eligible,true);
 assert.equal(auto('CMN-05','부가가치세는 포함한다.\n위 포함 조건은 적용하지 않으며 부가가치세 처리 방식은 추후 정한다.').eligible,false);
 assert.equal(auto('CORE-10','갑은 점검과 시정을 요구할 수 있으며 을은 이에 응한다.\n또한 이 의무를 면한다.').eligible,false);
 assert.equal(auto('CNS-DAMAGE',damage+'\n제9조(연락처)\n�').eligible,true);
});
test('항목식 기간과 갱신은 인식하되 잘못된 날짜·역전은 통과하지 않음',()=>{
 assert.equal(auto('CNS-TERM','계약기간: 2026. 1. 1. ~ 2026. 12. 31.').eligible,true);
 for(const text of ['계약기간: 2026. 12. 31. ~ 2026. 1. 1.','계약기간: 2026. 2. 30. ~ 2026. 12. 31.'])assert.equal(auto('CNS-TERM',text).eligible,false);
 assert.equal(auto('CNS-TERM','계약기간: 2026. 1. 1. ~ 2026. 12. 31.\n별도 통보가 없으면 자동 갱신된다.').eligible,true);
});
