const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../src/clause_semantics'),D=require('../src/decision_evidence'),R=require('../src/requirement_rules'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register'),P=require('../src/human_precedent');
const checks=require('../knowledge/judgment_policies.json').checks.map(p=>({id:p.id,check:p.question})),cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],item={coverage:'addressed'},scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]};
const active=id=>require('../knowledge/judgment_policies.json').checks.find(p=>p.id===id).active!==false;
const currentFixtureSatisfies=id=>active(id)&&id!=='SOL-05'; // Generic supervision is not SOL-05's relevant insurance-sales work.
const cases=require('./fixtures/presence_completion.json'),personnel=cases.find(c=>c.id==='ITSEC-12').clauses;
const intro='수탁자는 다음 각 호의 사항을 이행하여야 한다.',list='제1조(인력관리)\n'+intro+'\n1. 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시할 것\n2. 업무수행인력이 변경되는 경우 인수인계를 실시할 것';
const run=(id,text)=>S.evaluate(cp(id),item,{confirmed:true,documents:docs(text)});
const supported=cases.filter(c=>c.clauses.every(s=>Q.parseAll(s)?.every(p=>['obligation','prohibition','consent_required'].includes(p.facts.modality))));
for(const c of supported)test(c.id+' 도입문의 명시 주체·의무를 번호 항목에 연결하고 원문 근거 보존',()=>{
 const listed='제1조(약정)\n'+c.clauses.map(s=>{const subject=s.match(/^(.+?(?:은|는))\s+/)[1],content=s.replace(/^(.+?)(?:은|는)\s+/,'').replace(/하여야 한다\.$/,'할 것');return subject+' 다음 각 호의 사항을 준수하여야 한다.\n1. '+content;}).join('\n');
 const r=run(c.id,listed);assert.equal(r.eligible,currentFixtureSatisfies(c.id),JSON.stringify(r));if(currentFixtureSatisfies(c.id)){assert.ok(r.evidence.length>0);assert.ok(r.evidence.every(e=>listed.includes(e.text)));}else if(!active(c.id))assert.equal(r.status,'disabled_check');
 assert.equal(D.bundle(cp(c.id),docs(listed)).key,D.bundle(cp(c.id),docs('제1조(약정)\n'+c.clauses.join('\n'))).key);
 const bad=listed.replace('준수하여야 한다','준수하도록 노력한다');assert.equal(run(c.id,bad).eligible,false);
});
test('번호 표기·동작 명사·별칭·도입문의 종결형을 제한적으로 지원',()=>{
 for(const text of [list,list.replace('1.','1)').replace('2.','2)'),list.replace('1.','(1)').replace('2.','(2)'),list.replace(/할 것/g,''),list.replace('이행하여야 한다','준수할 의무를 진다'),'수탁자(이하 “을”이라 한다).\n'+list.replace('수탁자는','을은')])assert.equal(run('ITSEC-12',text).eligible,true,text);
 const ban='제1조(보안)\n수탁자는 다음 각 호의 행위를 하여서는 아니 된다.\n1. 신용정보 처리 업무를 재위탁';assert.equal(run('PRIV-21',ban).eligible,true);
 assert.equal(run('PRIV-21',ban.replace('행위를 하여서는 아니 된다','사항을 이행하여야 한다')).eligible,false);
});
test('번호 형식과 무관한 부가 항목은 허용하되 필수 의무의 재량·선택·면제는 보류',()=>{
 const bad=[list.replace('이행하여야 한다','이행할 수 있다'),list.replace('다음 각 호','가능한 경우에만 다음 각 호'),list.replace('사항을','사항 중 하나를'),list.replace('신원조회를','가능한 신원조회를'),list+'\n다만 위 의무는 면제한다.'];
 for(const text of bad)assert.equal(run('ITSEC-12',text).eligible,false,text);
 for(const text of [list.replace('수탁자는','위탁자는'),list.replace('1.','2.'),list.replace('2.','3.'),list.replace('2.','1.'),list.replace('2.','(2)'),list.replace('2.','1.1.'),list.replace('1. 업무','1. 위탁자는 업무'),list+'\n3. 가능한 범위에서 협조'])assert.equal(run('ITSEC-12',text).eligible,true,text);
 assert.equal(D.bundle(cp('ITSEC-12'),docs(list.replace('2.','3.'))).reusable,false);
});
test('조 제목·도입문 위치와 무관하게 본건 자료에 직접 남은 필수 약정을 검색',()=>{
 assert.equal(run('ITSEC-12',list.replace('제1조(인력관리)\n','')).eligible,true);
 const separated=[{name:'본문',text:intro},{name:'인력관리약정서',text:list.split('\n').slice(2).join('\n')}];
 assert.equal(S.evaluate(cp('ITSEC-12'),item,{confirmed:true,documents:separated}).eligible,true);
 assert.equal(run('ITSEC-12',list.replace(intro,intro+'\n별첨 1 인력관리약정서')).eligible,true);
 assert.equal(run('ITSEC-12',list.replace('2.','제2조(인수인계)\n2.')).eligible,true);
});
test('도입문이 같아도 번호 항목의 조건·방법 차이는 과거 근거와 구분',()=>{
 for(const text of [list.replace('경우','경우에만'),list.replace('신원조회','신원보증')])assert.notEqual(D.bundle(cp('ITSEC-12'),docs(list)).key,D.bundle(cp('ITSEC-12'),docs(text)).key);
 assert.equal(run('ITSEC-12',list.replace('경우','경우에만')).eligible,true);
 assert.equal(run('ITSEC-12',list.replace('신원조회를 실시','신원보증을 확보')).eligible,true);
});
test('번호 목록과 완전 문장 사이의 표준 등록·비교를 양방향으로 연결',()=>{
 const plain='제1조(인력관리)\n'+personnel.join('\n');
 for(const [source,target] of [[list,plain],[plain,list],[list,list]]){
  const t=Register.process('인력 기준','1',source,{type_ids:['outsourcing'],roles:[],stance:'party'},checks),lib={format:L.VERSION,templates:[t]};
  assert.ok(t.bindings.some(b=>b.check_id==='ITSEC-12'));
  const r=L.evaluate(lib,cp('ITSEC-12'),item,{current:true,scope,documents:docs(target)});assert.equal(r.eligible,true);
  assert.ok(r.evidence.length>0);assert.ok(r.evidence.every(e=>target.includes(e.text)));
  for(const changed of [target.replace('수탁자는','위탁자는'),target.replace('경우','경우에만')])assert.equal(L.evaluate(lib,cp('ITSEC-12'),item,{current:true,scope,documents:docs(changed)}).eligible,true);
  assert.equal(L.evaluate(lib,cp('ITSEC-12'),item,{current:true,scope,documents:docs(target+'\n다만 인수인계 의무는 면제한다.')}).eligible,false);
 }
});
test('관리방안 질문은 주체 표현이 다른 등록 표준도 현재 실질을 비교하되 없는 표준을 꾸미지 않음',()=>{
 const source=list+'\n제2조(위탁자 인력)\n'+list.split('\n').slice(1).join('\n').replace('수탁자는','위탁자는');
 const t=L.draft('혼합 표준','1',source,{type_ids:['outsourcing'],roles:[],stance:'party'});L.bind(t,cp('ITSEC-12'),list.split('\n').slice(1));t.active=true;
 assert.equal(L.evaluate({format:L.VERSION,templates:[t]},cp('ITSEC-12'),item,{current:true,scope,documents:docs(list)}).eligible,true);
 assert.equal(L.evaluate({format:L.VERSION,templates:[]},cp('ITSEC-12'),item,{current:true,scope,documents:docs(list)}).eligible,false);
 assert.equal(run('ITSEC-12',list).eligible,true);
 const conditional=list+'\n제2조(조건)\n'+list.split('\n').slice(1).join('\n').replace('다음 각 호','동의한 경우에만 다음 각 호');
 const other=L.draft('조건 혼합 표준','1',conditional,{type_ids:['outsourcing'],roles:[],stance:'party'});L.bind(other,cp('ITSEC-12'),list.split('\n').slice(1));other.active=true;
 assert.equal(L.evaluate({format:L.VERSION,templates:[other]},cp('ITSEC-12'),item,{current:true,scope,documents:docs(list)}).eligible,true);
 assert.equal(run('ITSEC-12',list).eligible,true);
});
test('조 제목 없이 목록 앞에서 적용을 제한하는 문장도 도입문과 함께 보존',()=>{
 const text='수탁자가 동의하는 경우에만 아래 사항을 적용한다.\n'+list.replace('제1조(인력관리)\n','');
 assert.equal(run('ITSEC-12',text).eligible,false);
 const b=D.bundle(cp('ITSEC-12'),docs(text));assert.ok(b.evidence.some(e=>e.text.includes('동의하는 경우에만')));
 assert.notEqual(b.key,D.bundle(cp('ITSEC-12'),docs(list.replace('제1조(인력관리)\n',''))).key);
});
test('단일 목록의 호 번호 참조는 본문·별첨 구역을 혼동하지 않음',()=>{
 const text=list+'\n별첨 1 운송약정서\n제1조(장소)\n배송지는 서울이다.\n제2조(적용)\n제1조 제2호는 적용하지 않는다.';
 assert.equal(run('ITSEC-12',text).eligible,true);
 assert.equal(run('ITSEC-12',text.replace('제1조 제2호는','본문 제1조 제2호는')).eligible,false);
});
test('과거 이상없음·정정 의견을 복사하지 않고 본건의 같은 목록 요소를 독립 판정',()=>{
 const p={id:'list-source',date:'2026-09-15',documents:docs(list),context:scope,checks:[cp('ITSEC-12')],verdicts:{'ITSEC-12':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const input=()=>P.prepare({confirmed:true,documents:docs('제1조(인력관리)\n'+personnel.join('\n')),scope,date:'2026-09-17',review_packets:[p]});
 assert.equal(S.evaluate(cp('ITSEC-12'),item,input()).eligible,true);p.verdicts['ITSEC-12']={origin:'manual',verdict:'검토의견',comment:'정정'};assert.equal(S.evaluate(cp('ITSEC-12'),item,input()).eligible,true);
});
test('제N호 참조와 역방향 제한, 없는 호·중복 목록·항호 중첩을 구별',()=>{
 const ref=list+'\n제2조(비밀유지)\n비밀유지 의무는 제1조 제2호에 따른다.',secret=cp('CNS-SECRET');
 assert.equal(D.bundle(secret,docs(ref)).reusable,true);
 assert.equal(D.bundle(secret,docs(ref.replace('제2호','제3호'))).reusable,false);
 assert.equal(D.bundle(secret,docs(ref.replace('제2호','제1항 제2호'))).reusable,false);
 const two=ref.replace('\n제2조', '\n'+intro+'\n1. 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시할 것\n2. 업무수행인력이 변경되는 경우 인수인계를 실시할 것\n제2조');
 assert.equal(D.bundle(secret,docs(two)).reusable,false);
 const restricted=list+'\n제2조(적용)\n제1조 제2호는 적용하지 않는다.';assert.equal(run('ITSEC-12',restricted).eligible,false);
 assert.notEqual(D.bundle(cp('ITSEC-12'),docs(list)).key,D.bundle(cp('ITSEC-12'),docs(restricted)).key);
 assert.notEqual(D.bundle(secret,docs(ref)).key,D.bundle(secret,docs(ref.replace('제2호','제1호'))).key);
});
test('캐시는 원문 번호 수정 시 갱신하며 입력자료·근거는 합성 문장으로 바꾸지 않음',()=>{
 const input=docs(list),before=JSON.stringify(input),a=Q.contexts(input);assert.equal(Q.contexts(input),a);assert.equal(JSON.stringify(input),before);
 assert.ok(D.bundle(cp('ITSEC-12'),input).evidence.every(e=>list.includes(e.text)));
 input[0].text=list.replace('2.','3.');assert.notEqual(Q.contexts(input),a);assert.equal(D.bundle(cp('ITSEC-12'),input).reusable,false);assert.equal(R.evaluate(cp('ITSEC-12'),input).eligible,true);
});
