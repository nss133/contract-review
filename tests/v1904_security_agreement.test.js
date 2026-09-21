'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const J=require('../src/agreement_judgment'),R=require('../src/template_register'),L=require('../src/template_library');
const policies=require('../knowledge/judgment_policies.json').checks;
const cp=id=>{const p=policies.find(p=>p.id===id);return {id,check:p.question,meaning_revision:p.meaning_revision};};
// Synthetic contract language: no private standard document is distributed with the tests.
const ban='수탁자는 신용정보 처리 업무를 제3자에게 재위탁할 수 없다.';
const exception='다만, 다음 각 호의 어느 하나에도 해당하지 않는 경우 수탁자는 위탁자의 사전 서면 승낙을 얻어 재위탁할 수 있다.';
const prohibited='1. 관련 법령에서 해당 업무의 위탁을 금지하고 있는 경우';
const oversight='수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.';
const controlled=['제5조(재위탁 제한)',ban,exception,prohibited,'2. 정보주체에게 중대한 피해를 발생시킬 우려가 있는 경우'].join('\n');
const docs=text=>[{name:'보안관리약정서',text}];
test('PRIV-21: 금지 원칙과 법령상 금지업무 제외·서면승낙 예외를 함께 확인한다',()=>{
 const r=J.evaluate(cp('PRIV-21'),docs(controlled));
 assert.equal(r.eligible,true,JSON.stringify(r.blockers));
 assert.ok(r.elements.some(s=>s.includes('예외')));
 assert.ok(r.evidence.some(e=>e.text===exception));
 assert.ok(r.evidence.some(e=>e.text===prohibited));
 for(const e of r.evidence)assert.equal(controlled.slice(e.start,e.end),e.text);
});
test('표준 등록 및 같은 취지의 본건 문구에 동일한 조건 구조를 활용한다',()=>{
 const checks=[cp('PRIV-07'),cp('PRIV-21')],text=controlled+'\n제10조(관리·감독)\n'+oversight;
 const t=R.process('합성 정보보안약정서','1',text,{type_ids:['outsourcing']},checks);
 assert.deepEqual(t.bindings.map(b=>b.check_id).sort(),['PRIV-07','PRIV-21']);
 for(const check of checks)assert.equal(L.evaluate({templates:[t]},check,{coverage:'quiet'},{current:true,documents:docs(text),scope:{}}).eligible,true);
});
test('제한 조건 목록의 번호·순서와 대표 근거를 구별한다',()=>{
 const text=controlled.replace(prohibited+'\n2. 정보주체에게 중대한 피해를 발생시킬 우려가 있는 경우','① 정보주체에게 중대한 피해를 발생시킬 우려가 있는 경우\n② 관련 법령에서 해당 업무의 위탁을 금지하고 있는 경우');
 const r=J.evaluate(cp('PRIV-21'),docs(text));assert.equal(r.eligible,true);assert.equal(r.evidence[0].text,ban);
});
for(const [name,text] of [
 ['법령상 제외조건 삭제',controlled.replace(prohibited,'1. 업무 효율이 저하되는 경우')],
 ['금지되는 업무에도 허용',controlled.replace('해당하지 않는 경우','해당하는 경우')],
 ['예외 조건을 뒤집음',controlled.replace('금지하고 있는 경우','금지하지 않는 경우')],
 ['사후승낙',controlled.replace('사전 서면 승낙을 얻어','사후 서면 승낙을 얻어')],
 ['구두승낙',controlled.replace('사전 서면 승낙','구두 승낙')],
 ['다른 조의 금지조건 끌어오기',controlled.replace(prohibited,'제6조(다른 제한)\n'+prohibited)],
 ['금지 원칙 없는 예외만',controlled.replace(ban,'신용정보 처리 업무에 관하여 정한다.')],
 ['조건 무효화',controlled+'\n다만, 위 조건은 적용하지 않는다.'],
 ['무제한 재위탁',controlled+'\n수탁자는 자유롭게 재위탁할 수 있다.'],
 ['단순 승낙만으로 무제한 예외',ban+'\n다만, 위탁자의 서면 승낙을 얻어 재위탁할 수 있다.'],
 ['원문이 아닌 예시', '작성예시:\n'+controlled.replace('제5조(재위탁 제한)\n','')]
])test('PRIV-21: '+name+'는 자동 이상없음으로 승격하지 않는다',()=>{
 assert.equal(J.evaluate(cp('PRIV-21'),docs(text)).eligible,false,name);
});
test('예외 조건이 다른 별첨에 있다는 이유만으로 보완하지 않는다',()=>{
 const r=J.evaluate(cp('PRIV-21'),[{name:'본문',text:controlled.replace(prohibited,'')},{name:'무관한 별첨',text:'제5조(다른 거래)\n'+prohibited}]);
 assert.equal(r.eligible,false);
});
test('확인한 재위탁 약정과 검토할 예외를 구별하여 설명한다',()=>{
 const r=J.evaluate(cp('PRIV-21'),docs(ban+'\n다만, 위탁자의 서면 동의를 얻어 재위탁할 수 있다.'));
 assert.equal(r.recognition.stage,'clause_found');assert.equal(r.missing.length,0);
 assert.ok(r.blockers.some(b=>b.reason.includes('예외')));
});
test('기존 자동 등록 자료를 재등록 없이 갱신하고 수동 연결·사용 중지는 보존한다',()=>{
 const checks=[cp('PRIV-07'),cp('PRIV-21')],text=controlled+'\n제10조(관리·감독)\n'+oversight;
 const t=R.process('합성 보안약정서','1',text,{type_ids:['outsourcing']},checks);
 t.registration.version=16;t.bindings=t.bindings.filter(b=>b.check_id!=='PRIV-21');
 t.bindings[0].shared_judgment=false;const manual=JSON.stringify(t.bindings[0]),before=JSON.stringify(t);
 const upgraded=R.upgrade(t,checks);
 assert.equal(JSON.stringify(t),before);assert.equal(upgraded.registration.version,17);
 assert.equal(JSON.stringify(upgraded.bindings.find(b=>b.check_id==='PRIV-07')),manual);
 assert.ok(upgraded.bindings.some(b=>b.check_id==='PRIV-21'));
 t.active=false;assert.equal(R.upgrade(t,checks),t);
 t.active=true;t.registration.mode='manual';assert.equal(R.upgrade(t,checks),t);
});
test('감독기관 제재 이력만으로 위탁자의 점검 약정이 있다고 판정하지 않는다',()=>{
 const text='개인정보 처리위탁 계약서\n제1조(요건)\n수탁자는 감독기관 자료 제출 등 검사와 관련하여 형사처벌을 받은 사실이 있는 경우 재위탁할 수 없다.';
 assert.equal(J.evaluate(cp('PRIV-07'),docs(text)).eligible,false);
});
