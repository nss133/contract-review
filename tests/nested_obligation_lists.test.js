const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../src/clause_semantics'),D=require('../src/decision_evidence'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register'),P=require('../src/human_precedent');
const checks=require('../knowledge/judgment_policies.json').checks.map(p=>({id:p.id,check:p.question})),cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],item={coverage:'addressed'},scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]};
const active=id=>require('../knowledge/judgment_policies.json').checks.find(p=>p.id===id).active!==false;
const currentFixtureSatisfies=id=>active(id)&&id!=='SOL-05'; // Generic supervision is not SOL-05's relevant insurance-sales work.
const cases=require('./fixtures/presence_completion.json'),personnel=cases.find(c=>c.id==='ITSEC-12').clauses;
const root='① 수탁자는 다음 각 호의 사항을 이행하여야 한다.',inner='1. 다음 각 목의 사항을 이행할 것',list='제1조(인력관리)\n'+root+'\n'+inner+'\n가. 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시할 것\n나. 업무수행인력이 변경되는 경우 인수인계를 실시할 것';
const run=(id,text)=>S.evaluate(cp(id),item,{confirmed:true,documents:docs(text)}),bundle=text=>D.bundle(cp('ITSEC-12'),docs(text));
const supported=cases.filter(c=>c.clauses.every(s=>Q.parseAll(s)?.every(p=>['obligation','prohibition','consent_required'].includes(p.facts.modality))));
for(const c of supported)test(c.id+' 항·호·목의 주체·의무를 연결하고 상위 원문 전체를 증거로 보존',()=>{
 const listed='제1조(약정)\n'+c.clauses.map((s,i)=>String.fromCharCode('①'.charCodeAt(0)+i)+' '+s.match(/^(.+?(?:은|는))\s+/)[1]+' 다음 각 호의 사항을 준수하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n가. '+s.replace(/^(.+?)(?:은|는)\s+/,'').replace(/하여야 한다\.$/,'할 것')).join('\n');
 const r=run(c.id,listed);assert.equal(r.eligible,currentFixtureSatisfies(c.id),JSON.stringify(r));if(currentFixtureSatisfies(c.id)){assert.ok(r.evidence.length>0);assert.ok(r.evidence.every(e=>listed.includes(e.text)));}else if(!active(c.id))assert.equal(r.status,'disabled_check');
 assert.equal(D.bundle(cp(c.id),docs(listed)).key,D.bundle(cp(c.id),docs('제1조(약정)\n'+c.clauses.join('\n'))).key);
 assert.equal(run(c.id,listed.replace('각 목의 사항을 이행할 것','각 목의 사항을 이행할 수 있다')).eligible,false);
});
test('목 표기·별칭과 호·목 혼합을 지원',()=>{
 for(const text of [list,list.replace('가.','가)').replace('나.','나)'),list.replace('가.','(가)').replace('나.','(나)'),list.replace('나.','2.'),'수탁자(이하 “을”이라 한다).\n'+list.replace('수탁자는','을은')])assert.equal(run('ITSEC-12',text).eligible,true,text);
 const rows=Q.contexts(docs(list)).rows;assert.deepEqual(rows.filter(r=>r.list_letter).map(r=>r.list_path),[[1,'가'],[1,'나']]);
 assert.deepEqual(rows.find(r=>r.list_letter==='나').list_intros.map(r=>r.text),[root,inner]);
});
test('상위 조건을 하위 의무로 전달하고 동일한 변경 트리거의 경우에만 표현은 허용',()=>{
 const c=cases.find(c=>c.id==='INV-BEN-04'),base='제1조(변경)\n수탁회사는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n가. 신탁계약을 변경하는 경우 변경 내용을 수익자에게 공시하고 통지할 것';
 for(const text of [base,base.replace('수탁회사는 다음','수탁회사는 신탁계약을 변경하는 경우 다음').replace('가. 신탁계약을 변경하는 경우','가.'),base.replace('1. 다음','1. 신탁계약을 변경하는 경우 다음').replace('가. 신탁계약을 변경하는 경우','가.')]){
  assert.equal(run(c.id,text).eligible,true,text);assert.equal(D.bundle(cp(c.id),docs(text)).key,D.bundle(cp(c.id),docs('제1조(변경)\n'+c.clauses[0])).key);
  assert.equal(run(c.id,text.replace('경우','경우에만')).eligible,true);
 }
});
test('금지 도입문은 중첩해도 의무 방향을 바꾸지 않음',()=>{
 const text='수탁자는 다음 각 호의 행위를 하여서는 아니 된다.\n1. 다음 각 목의 행위를 하여서는 아니 된다.\n가. 신용정보 처리 업무를 재위탁';
 assert.equal(run('PRIV-21',text).eligible,true);
 assert.equal(run('PRIV-21',text.replace('1. 다음 각 목의 행위를 하여서는 아니 된다.','1. 다음 각 목의 사항을 이행할 것')).eligible,false);
});
test('읽을 수 있는 필수 약정은 중첩 목록 번호·스타일 및 무관한 협조 항목으로 보류하지 않음',()=>{
 for(const text of [list.replace('나.','다.'),list.replace('나.','가.'),list.replace('나.','(나)'),list.replace('가.','나.'),list.replace('가. 업무','가. 위탁자는 업무'),list.replace('1. 다음','1. 위탁자는 다음'),list+'\n다. 가능한 범위에서 협조',list.replace('나.','② 나.'),list.replace('나.','별첨 1 인수인계약정서\n나.'),list.replace('가.','1.1.'),list.replace('1. 다음 각 목','1. 다음 각 호'),list.replace(inner,'1. 다음 각 목의 사항을 이행할 것\n가. 다음 각 목의 사항을 이행할 것')])assert.equal(run('ITSEC-12',text).eligible,true,text);
});
test('도입문·번호가 없어도 후속 문장에 필수 약정이 직접 남으면 판정',()=>{
 for(const text of [list.replace(inner+'\n',''),list.replace(root+'\n',''),list.replace('가. ','').replace('나. ','')])assert.equal(run('ITSEC-12',text).eligible,true,text);
 assert.equal(S.evaluate(cp('ITSEC-12'),item,{confirmed:true,documents:[{name:'본문',text:root},{name:'첨부',text:list.split('\n').slice(2).join('\n')}]}).eligible,true);
});
test('중첩 목록과 완전문장 표준을 양방향으로 재사용하며 원문만 출력',()=>{
 const plain='제1조(인력관리)\n'+personnel.join('\n');
 for(const [source,target] of [[list,plain],[plain,list],[list,list]]){
  const t=Register.process('중첩 기준','1',source,{type_ids:['outsourcing'],roles:[],stance:'party'},checks),lib={format:L.VERSION,templates:[t]};assert.ok(t.bindings.some(b=>b.check_id==='ITSEC-12'));
  const r=L.evaluate(lib,cp('ITSEC-12'),item,{current:true,scope,documents:docs(target)});assert.equal(r.eligible,true,JSON.stringify(r));assert.ok(r.evidence.every(e=>target.includes(e.text)));
  assert.ok(r.evidence.length>0);
  assert.equal(L.evaluate(lib,cp('ITSEC-12'),item,{current:true,scope,documents:docs(target.replace('경우','경우에만'))}).eligible,true);
 }
});
const repeated=list+'\n② 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n가. 업무수행인력에 대하여 업무 투입 전에 신원보증을 확보할 것';
const reference=(path='제1조 제2항 제1호 가목')=>repeated+'\n제2조(비밀유지)\n비밀유지 의무는 '+path+'에 따른다.',secret=text=>D.bundle(cp('CNS-SECRET'),docs(text));
test('같은 조에 반복되는 1호를 항 번호로 구분하고 목까지 연결',()=>{
 for(const path of ['제1조 제1항 제1호 가목','제1조 제1항 제1호 나목','제1조 제2항 제1호 가목','제1조 제2항 제1호','제1조 제1항','제1조제2항제1호가목'])assert.equal(secret(reference(path)).reusable,true,path);
 assert.equal(secret(reference().replace('제1조(인력관리)\n①','제1조(인력관리) ①')).reusable,true);
 assert.notEqual(secret(reference('제1조 제1항 제1호 가목')).key,secret(reference('제1조 제2항 제1호 가목')).key);
 assert.notEqual(secret(reference('제1조 제1항 제1호 가목')).key,secret(reference('제1조 제1항 제1호 나목')).key);
});
test('없는 항·호·목, 중복 항, 항 없는 중복 호, 범위형 참조를 해결한 것으로 처리하지 않음',()=>{
 for(const path of ['제1조 제3항 제1호 가목','제1조 제1항 제2호 가목','제1조 제2항 제1호 나목','제1조제2항제1호나목','제1조 제1호 가목','제1조 가목','제1조 제1항부터 제2항','제1조 제1항 제1호부터 제2호','제1조 제1항 제1호 가목부터 나목'])assert.equal(secret(reference(path)).reusable,false,path);
 assert.equal(secret(reference().replace('②','①')).reusable,false);
 assert.equal(secret(reference().replace('②','')).reusable,false);
});
test('현재 항 내 호 참조와 타 조 참조를 구별',()=>{
 assert.equal(secret(repeated+'\n비밀유지 의무는 제1호 가목에 따른다.').reusable,true);
 assert.equal(secret(repeated+'\n비밀유지 의무는 제1조 제1호 가목에 따른다.').reusable,false);
});
test('외부 참조의 대상 항 번호 변경을 본문 동일성에 숨기지 않음',()=>{
 const a=reference('제1조 제1항 제1호 가목'),b=a.replace('①','③').replace('②','①').replace('③','②');
 assert.equal(secret(a).reusable,true);assert.equal(secret(b).reusable,true);assert.notEqual(secret(a).key,secret(b).key);
});
test('다른 조에서 항·호·목의 의무를 제한하면 직접 판정도 중단',()=>{
 const restricted=list+'\n제2조(적용)\n제1조 제1항 제1호 나목은 적용하지 않는다.';assert.equal(run('ITSEC-12',restricted).eligible,false);
 assert.notEqual(bundle(list).key,bundle(restricted).key);
});
test('별첨의 동일 번호를 본문 참조로 혼동하지 않음',()=>{
 const text=list+'\n별첨 1 운송약정서\n제1조(운송)\n배송지는 서울이다.\n제2조(적용)\n제1조 제1항 제1호 나목은 적용하지 않는다.';
 assert.equal(run('ITSEC-12',text).eligible,true);assert.equal(run('ITSEC-12',text.replace('제1조 제1항','본문 제1조 제1항')).eligible,false);
});
test('인력관리 참조만으로 비밀유지 약정 충족을 만들지 않고 과거 결론도 복사하지 않음',()=>{
 const source=reference()+'\n제3조(운송)\n배송지는 서울이다.',p={id:'nested-source',date:'2026-09-15',documents:docs(source),context:scope,checks:[cp('CNS-SECRET')],verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const runAt=text=>S.evaluate(cp('CNS-SECRET'),item,P.prepare({confirmed:true,documents:docs(text),scope,date:'2026-09-17',review_packets:[p]}));
 assert.equal(runAt(source.replace('서울','부산')).eligible,false);assert.equal(runAt(source.replace('제2항','제1항')).eligible,false);
 p.verdicts['CNS-SECRET']={origin:'manual',verdict:'검토의견',comment:'정정'};assert.equal(runAt(source.replace('서울','부산')).eligible,false);
});
test('중첩 컨텍스트 캐시는 입력을 바꾸지 않고 목 번호 변경에 갱신',()=>{
 const input=docs(list),before=JSON.stringify(input),a=Q.contexts(input);assert.equal(Q.contexts(input),a);assert.equal(JSON.stringify(input),before);
 input[0].text=list.replace('나.','다.');assert.notEqual(Q.contexts(input),a);assert.equal(bundle(input[0].text).reusable,false);
});
test('다목 번호를 종결문으로 자르지 않고 세 항목의 의무와 원문을 모두 유지',()=>{
 const clauses=cases.find(c=>c.id==='ITDL-07').clauses,text='제1조(라이선스)\n'+root+'\n'+inner+'\n'+clauses.map((s,i)=>'가나다'[i]+'. '+s.replace(/^수탁자는 /,'').replace(/하여야 한다\.$/,'할 것')).join('\n');
 assert.equal(run('ITDL-07',text).eligible,true);assert.equal(Q.contexts(docs(text)).rows.filter(r=>r.list_letter).length,3);
 assert.equal(D.bundle(cp('ITDL-07'),docs(text)).key,D.bundle(cp('ITDL-07'),docs('제1조(라이선스)\n'+clauses.join('\n'))).key);
 assert.equal(run('ITDL-07',text.replace('다.','라.')).eligible,true);
});
test('제목 없이 중첩 목록 앞에 붙은 적용조건도 버리지 않음',()=>{
 const text='수탁자가 동의하는 경우에만 아래 사항을 적용한다.\n'+list.replace('제1조(인력관리)\n','');
 assert.equal(run('ITSEC-12',text).eligible,false);assert.ok(bundle(text).evidence.some(e=>e.text.includes('동의하는 경우에만')));
});
test('주체 표현이 다른 중첩 표준의 관리 약정을 읽고 표준 부재와 본건 직접 판정을 구분',()=>{
 const text=list+'\n제2조(위탁자)\n'+list.split('\n').slice(1).join('\n').replace('수탁자는','위탁자는'),t=L.draft('혼합 중첩 표준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'});
 L.bind(t,cp('ITSEC-12'),list.split('\n').slice(1));t.active=true;
 assert.equal(L.evaluate({format:L.VERSION,templates:[t]},cp('ITSEC-12'),item,{current:true,scope,documents:docs(list)}).eligible,true);
 assert.equal(L.evaluate({format:L.VERSION,templates:[]},cp('ITSEC-12'),item,{current:true,scope,documents:docs(list)}).eligible,false);
 assert.equal(run('ITSEC-12',list).eligible,true);
});
