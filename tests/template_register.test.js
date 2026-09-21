const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../src/template_register'),S=require('../src/standard_auto'),L=require('../src/template_library');
const scope={type_ids:['outsourcing'],roles:[],stance:'party'};
const cp=require('../build/audit_v188_acceptance.cjs').loadChecks().find(c=>c.id==='PRIV-07');
const good='수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.';
function reg(text,checks=[cp]){return R.process('보안관리약정서','1',text,scope,checks);}
test('파일 등록은 승인 없이 활성화·연결한다',()=>{const t=reg(good);assert.equal(t.active,true);assert.equal(t.bindings.length,1);assert.equal(t.registration.mode,'automatic');});
test('불완전 자료도 승인 대기 없이 보존하되 자동 충족은 아님',()=>{const t=reg('수탁자의 개인정보 점검에 관하여 협의한다.');assert.equal(t.active,true);assert.equal(t.bindings.length,0);assert.deepEqual(t.registration.reference_checks,['PRIV-07']);});
test('명시적 면제·주체 역전·실제 의미 변경은 자동 연결 금지',()=>{for(const s of [good+' 다만, 점검 의무를 면제한다.',good.replace('수탁자는 위탁자의','위탁자는 수탁자의')])assert.equal(reg(s).bindings.length,0,s);assert.equal(reg(good,[{...cp,meaning_revision:'expanded-education',check:cp.check+' 교육 포함'}]).bindings.length,0);});
test('자동등록 근거로 동일·동등 본건 판정, 관련 면제는 차단',()=>{const t=reg(good),lib={format:L.VERSION,templates:[t]},input={current:true,scope:{type:'outsourcing',roles:[],stance:'party'},documents:[{name:'본문',text:good}]};assert.equal(L.evaluate(lib,cp,{},input).eligible,true);input.documents[0].text=good+' 다만, 점검은 생략한다.';assert.equal(L.evaluate(lib,cp,{},input).eligible,false);});
test('기존 전체 요건 엔진으로 VAT 자동 연결',()=>{const c={id:'CMN-05',check:S.catalog['CMN-05'].question};assert.equal(reg('계약금액은 부가가치세를 포함한다.',[c]).bindings.length,1);});
test('손상 원문 등록 실패, 실제 이행 확인은 연결 제외',()=>{assert.throws(()=>reg('�'));assert.equal(reg(good,[{...cp,review_scope:'execution_only'}]).bindings.length,0);});
test('서식의 무관한 조항 전문까지 본건에 복제할 필요 없음',()=>{
 const c={id:'CMN-05',check:S.catalog['CMN-05'].question,triggers:{keywords:['부가세']}},vat='계약금액은 부가가치세를 포함한다.';
 const t=reg('제1조(부가세)\n'+vat+'\n제2조(목적)\n위탁자는 홍보 업무를 위탁한다.',[c]);
 assert.deepEqual(t.bindings[0].quotes,[vat]);
 assert.equal(L.evaluate({format:L.VERSION,templates:[t]},c,{}, {current:true,scope:{type:'outsourcing',roles:[],stance:'party'},documents:[{name:'본문',text:vat}]}).eligible,true);
});
test('복수의 정상 보호 의무가 있어도 점검 조항을 자동 연결',()=>{
 const text='제1조(접근권한)\n수탁자는 개인정보에 대한 접근권한을 업무 수행에 필요한 최소한의 범위로 제한하여야 한다.\n제2조(점검)\n'+good;
 assert.deepEqual(reg(text).bindings[0].quotes,[good]);
 assert.equal(reg(text+'\n다만, 모든 보호 의무를 면제한다.').bindings.length,0);
});
test('본문과 붙은 조항 번호 및 동등 표현을 자동 연결',()=>{
 assert.equal(reg('제2조(점검) '+good).bindings.length,1);
 assert.equal(reg('위탁자가 개인정보 처리 현황을 점검하는 경우 수탁자는 이에 협조해야 한다.').bindings.length,1);
});
test('금지 내용의 부재를 묻는 질문은 등록 실패 없이 자동 연결 제외',()=>{
 assert.equal(reg(good,[{...cp,text_effect:'required_absent'}]).bindings.length,0);
});
test('표준 점검 의무와 무관한 개인정보 업무 설명은 보류 사유가 아님',()=>{
 const t=reg(good),lib={format:L.VERSION,templates:[t]},input={current:true,scope:{type:'outsourcing',roles:[],stance:'party'},documents:[{name:'본문',text:'제1조(목적)\n위탁자는 고객 개인정보 처리 업무를 수탁자에게 위탁한다.\n제2조(점검)\n'+good}]};
 assert.equal(L.evaluate(lib,cp,{},input).eligible,true);
 assert.equal(L.evaluate(lib,cp,{}, {...input,documents:[{name:'본문',text:input.documents[0].text+'\n점검은 연 1회로 제한한다.'}]}).eligible,true);
 for(const extra of ['수탁자의 모든 의무를 면제한다.','다만, 이 의무는 생략할 수 있다.']){
  const bad={...input,documents:[{name:'본문',text:input.documents[0].text+'\n'+extra}]};assert.equal(L.evaluate(lib,cp,{},bad).eligible,false,extra);
 }
});
