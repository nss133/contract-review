const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../src/clause_semantics'),D=require('../src/decision_evidence'),R=require('../src/requirement_rules'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register'),P=require('../src/human_precedent');
const cp=id=>({id,check:R.catalog[id].question}),docs=text=>[{name:'본문',text}],scope={type:'outsourcing',roles:['위탁자'],stance:'party'},run=(id,input)=>S.evaluate(cp(id),{coverage:'addressed'},{confirmed:true,documents:typeof input==='string'?docs(input):input});
const screen='수탁자는 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시하여야 한다.',handover='수탁자는 업무수행인력이 변경되는 경우 인수인계를 실시하여야 한다.';
const intro='수탁자는 업무수행인력이 변경되는 경우 다음의 의무를 이행하여야 한다.',child='수탁자는 인수인계를 실시하여야 한다.';
test('조건 도입문과 후속 의무를 결합하고 조건 없는 문장과는 구분',()=>{
 const plain='제1조(인력)\n'+screen+'\n제2조(인수인계)\n'+handover,split='제1조(인력)\n'+screen+'\n제2조(인수인계)\n'+intro+'\n'+child;
 assert.equal(run('ITSEC-12',split).eligible,true);assert.equal(D.bundle(cp('ITSEC-12'),docs(split)).key,D.bundle(cp('ITSEC-12'),docs(plain)).key);
 assert.ok(run('ITSEC-12',split).evidence.some(e=>e.text.includes('인수인계')));assert.ok(run('ITSEC-12',split).evidence.every(e=>split.includes(e.text)));
 for(const changed of [split.replace('변경되는 경우','변경되는 경우에만'),split.replace(child,'위탁자는 인수인계를 실시하여야 한다.'),split.replace(child,'제3조(새 약정)\n'+child),split.replace(child,'별첨 1 새 약정서\n'+child)])assert.equal(run('ITSEC-12',changed).eligible,true,changed);
 for(const bad of [split.replace('다음의 의무를 이행하여야 한다','다음의 의무를 이행할 수 있다'),split+'\n다만, 긴급한 경우 해당 의무를 생략할 수 있다.'])assert.equal(run('ITSEC-12',bad).eligible,false,bad);
});
test('인정된 신용정보 재위탁 예외의 문장 분리와 단일 문장은 같은 조건',()=>{
 const base='수탁자는 신용정보 처리 업무를 재위탁하여서는 아니 된다.',one='수탁자는 금융위원회가 인정한 경우를 제외하고 신용정보 처리 업무를 재위탁하여서는 아니 된다.',two=base+'\n다만, 금융위원회가 인정한 경우에는 그러하지 아니하다.';
 assert.equal(run('PRIV-21',two).eligible,true,JSON.stringify(run('PRIV-21',two)));assert.equal(D.bundle(cp('PRIV-21'),docs(one)).key,D.bundle(cp('PRIV-21'),docs(two)).key);assert.notEqual(D.bundle(cp('PRIV-21'),docs(base)).key,D.bundle(cp('PRIV-21'),docs(two)).key);
 assert.ok(run('PRIV-21',two).evidence.some(e=>e.text.includes('재위탁')));assert.ok(run('PRIV-21',two).evidence.every(e=>two.includes(e.text)));
 assert.equal(run('PRIV-21',two.replace('금융위원회','위탁자')).eligible,false);
 for(const text of [two.replace('경우에는','경우에만'),two.replace('\n다만','\n별첨 1 추가약정서\n다만'),base+'\n수탁자는 개인정보에 대한 접근권한을 제한하여야 한다.\n다만, 금융위원회가 인정한 경우에는 그러하지 아니하다.'])assert.equal(run('PRIV-21',text).eligible,true,text);
});
const protection='수탁자는 개인정보 기술적·관리적 보호조치를 취하여야 한다.',inspection='수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.',restriction='다만, 수탁자의 개인정보처리현황점검 의무는 긴급한 경우에는 적용하지 아니한다.';
test('다른 의무에 한정된 독립 단서는 분리하되 해당 의무를 충족시키지는 않음',()=>{
 const text='제1조(보호)\n'+protection+'\n'+inspection+'\n'+restriction;
 assert.equal(run('PRIV-03',text).eligible,true,JSON.stringify(run('PRIV-03',text)));assert.equal(run('PRIV-07',text).eligible,false);
 const b=D.bundle(cp('PRIV-03'),docs(text));assert.equal(b.independent_exceptions.length,1);assert.equal(b.key,D.bundle(cp('PRIV-03'),docs(text.replace('\n'+restriction,''))).key);
 for(const bad of [text.replace('개인정보처리현황점검 의무는','개인정보기술적·관리적보호조치 의무는'),text.replace(restriction,'다만, 모든 의무는 긴급한 경우에는 적용하지 아니한다.')])assert.equal(run('PRIV-03',bad).eligible,false,bad);
 for(const unrelated of [text.replace(restriction,'다만, 그 의무는 긴급한 경우에는 적용하지 아니한다.'),text.replace(restriction,restriction+' 이 계약의 다른 조항에 우선 적용한다.')])assert.equal(run('PRIV-03',unrelated).eligible,true,unrelated);
});
test('본건 별첨의 명시 조건·단서를 동일 기준으로 판정',()=>{
 const input=[{name:'본문',text:'제1조(목적)\n본 계약은 외주 인력 관리에 관한 사항을 정한다.'},{name:'인력관리약정서',text:'제1조(인력)\n'+screen+'\n제2조(인수인계)\n'+intro+'\n'+child}];assert.equal(run('ITSEC-12',input).eligible,true);
 input[1].text+='\n다만, 수탁자의 인수인계 의무는 긴급한 경우에는 면제된다.';assert.equal(run('ITSEC-12',input).eligible,false);
});
test('다른 별첨에서 번호·제목으로 지목한 예외는 원문 연결 후 재사용하고 변경 시 철회',()=>{
 const main='제1조(보호)\n'+protection+'\n제2조(적용)\n개인정보 보호조치의 적용조건은 「조건약정서」 제1조에 따른다.',annex='제1조(조건)\n천재지변이 발생한 경우에도 보호조치를 이행하여야 한다.',source=[{name:'본문',text:main},{name:'조건약정서',text:annex}],packet={id:'conditions',documents:source,context:scope,checks:[cp('PRIV-03')],verdicts:{'PRIV-03':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const target=JSON.parse(JSON.stringify(source));target[0].text+='\n제3조(배송)\n배송지는 서울이다.';
 const lookup=()=>P.lookup(cp('PRIV-03'),P.prepare({documents:target,scope,review_packets:[packet]}));assert.equal(lookup().eligible,true);target[1].text=annex.replace('경우에도','경우에만');assert.equal(lookup().eligible,false);target.pop();assert.equal(lookup().eligible,false);
});
test('표준에도 조건 결합·분리와 독립 단서 구별 적용',()=>{
 const source=protection+'\n'+inspection,t=Register.process('표준','1',source,{type_ids:['outsourcing']},[cp('PRIV-03'),cp('PRIV-07')]),lib={format:L.VERSION,templates:[t]},input={current:true,scope,documents:docs(source+'\n'+restriction)};
 assert.equal(L.evaluate(lib,cp('PRIV-03'),{coverage:'addressed'},input).eligible,true);assert.equal(L.evaluate(lib,cp('PRIV-07'),{coverage:'addressed'},input).eligible,false);
});
