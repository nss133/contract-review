const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../src/clause_semantics'),D=require('../src/decision_evidence'),R=require('../src/requirement_rules'),L=require('../src/template_library'),Register=require('../src/template_register'),P=require('../src/human_precedent');
const cp=id=>({id,check:R.catalog[id].question}),docs=text=>[{name:'본문',text}],scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]};
const fixtures=[['PRIV-03','수탁자는 개인정보 기술적·관리적 보호조치를 실시하여야 한다.',[
 '수탁자는 개인정보 기술적·관리적 보호조치를 이행하여야 한다.','수탁자는 개인정보 기술적·관리적 보호조치를 실시하도록 한다.','개인정보 기술적·관리적 보호조치를 수탁자는 실시하여야 한다.']],
 ['PRIV-19','수탁자는 제공받은 개인신용정보의 식별정보를 암호화하여야 한다.',[
 '수탁자는 제공받은 개인신용정보의 식별정보를 암호화 처리하여야 한다.','수탁자는 제공받은 개인신용정보의 식별정보를 암호화하여야 할 것이다.','제공받은 개인신용정보의 식별정보를 수탁자는 암호화하여야 한다.']],
 ['PRIV-07','수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.',[
 '수탁자는 위탁자의 개인정보 처리 현황 점검에 협력하여야 한다.','위탁자의 개인정보 처리 현황 점검에 수탁자는 협조하여야 한다.']]];
for(const [id,base,variants] of fixtures)test(id+' 정형 동사·종결·어순 변형은 같은 사실·태그로 판정',()=>{
 for(const s of variants){assert.deepEqual(Q.parseAll(s).map(f=>f.facts),Q.parseAll(base).map(f=>f.facts));assert.equal(R.evaluate(cp(id),docs(s)).eligible,true);assert.equal(D.bundle(cp(id),docs(s)).key,D.bundle(cp(id),docs(base)).key);
  for(const bad of [s.replace('수탁자','위탁자'),s.replace(/하여야 한다|하도록 한다|하여야 할 것이다/,'할 수 있다'),s.replace(/하여야 한다|하도록 한다|하여야 할 것이다/,'하도록 노력한다'),s+' 다만, 해당 의무는 적용하지 않는다.'])assert.equal(R.evaluate(cp(id),docs(bad)).eligible,false,bad);
 }
});
test('같은 조·항의 또한·아울러는 해석 가능한 직전 명시 주체만 계승',()=>{
 const first='수탁자는 개인정보 기술적·관리적 보호조치를 취하여야 한다.',second='수탁자는 제공받은 개인신용정보의 식별정보를 암호화하여야 한다.',joined='제1조(보호)\n'+first+'\n또한 제공받은 개인신용정보의 식별정보를 암호화하여야 한다.';
 const out=R.evaluate(cp('PRIV-19'),docs(joined));assert.equal(out.eligible,true);assert.ok(out.evidence.some(e=>e.text===first));assert.ok(out.evidence.every(e=>joined.includes(e.text)));
 assert.equal(D.bundle(cp('PRIV-19'),docs(joined)).key,D.bundle(cp('PRIV-19'),docs('제1조(보호)\n'+first+'\n'+second)).key);
 for(const variant of [joined.replace('\n또한','\n제2조(별개)\n또한'),joined.replace('\n또한','\n② 또한'),joined.replace('또한','별첨 1 약정서\n또한'),joined.replace('취하여야','취할 수 있어야'),joined.replace('또한','따라서')])assert.equal(R.evaluate(cp('PRIV-19'),docs(variant)).eligible,true,'독립적인 암호화 약정은 존재하며 무관한 보호조치 조건은 별도');
});
test('표준 문구와 실제 사람 이력에 표현 확장을 공통 적용',()=>{
 const [id,base,variants]=fixtures[1],t=Register.process('표준','1',base,{type_ids:['outsourcing']},[cp(id)]),lib={format:L.VERSION,templates:[t]},packet={id:'phrases',documents:docs(base),context:scope,checks:[cp(id)],verdicts:{[id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 for(const text of variants){assert.equal(L.evaluate(lib,cp(id),{coverage:'addressed'},{current:true,scope,documents:docs(text)}).eligible,true);assert.equal(P.lookup(cp(id),P.prepare({documents:docs(text),scope,review_packets:[packet]})).eligible,true);}
});
