const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../src/template_library'),V=require('../src/verdict'),M=require('../src/matcher');
const cp=require('../build/audit_v188_acceptance.cjs').loadChecks().find(c=>c.id==='CNS-PRIVSUB');
const text='수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.';
const informationScope='본 계약은 개인정보 처리업무의 위탁에 관한 계약이다.';
function setup(quote=text,check=cp){const t=L.draft('일반 보안약정','2026-09',informationScope+'\n'+quote,{type_ids:['outsourcing'],roles:[],stance:'party'});L.bind(t,check,[quote]);t.active=true;return {format:L.VERSION,templates:[t]};}
function input(text){return {current:true,scope:{type:'outsourcing',stance:'party',roles:[]},documents:[{name:'본건 계약',text:informationScope+'\n'+text}]};}
const item={coverage:'consider'};
test('동일 표준문구는 본문·별첨 어디서나 충족하며 문서명은 판정 조건이 아님',()=>{
 const lib=setup();assert.equal(L.evaluate(lib,cp,item,input(text)).eligible,true);
 const p=input('용역 목적');p.documents.push({name:'별첨',text});assert.equal(L.evaluate(lib,cp,item,p).eligible,true);
});
test('사전 서면 동의의 승인된 어순 변형은 동등 취지로 통과',()=>{
 const r=L.evaluate(setup(),cp,item,input('수탁자가 업무를 재위탁하려면 위탁자의 서면 동의를 미리 받아야 한다.'));
 assert.equal(r.eligible,true);assert.equal(r.kind,'equivalent');
});
for(const [label,bad] of [['사후통지','수탁자는 재위탁 후 위탁자에게 통지한다.'],['선택권','수탁자는 위탁자의 동의를 받을 수 있다.'],['주체역전','위탁자는 수탁자의 사전 서면 동의 없이 재위탁할 수 없다.'],['허용','수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 있다.']]){
 test(label+'를 같은 태그라는 이유로 통과시키지 않음',()=>assert.equal(L.evaluate(setup(),cp,item,input(bad)).eligible,false));
}
test('표준문의 다만을 일괄 보류하지 않되 새로운 예외·우선 적용은 보류',()=>{
 const full=text+'\n다만, 법령에 따른 재위탁은 제외한다.';
 assert.equal(L.evaluate(setup(full),cp,item,input(full)).eligible,true);
 assert.equal(L.evaluate(setup(),cp,item,input(text+'\n다만, 계열사에 대한 재위탁은 동의 없이 할 수 있다.')).eligible,false);
 assert.equal(L.evaluate(setup(),cp,item,input(text+'\n본 계약의 다른 조항에도 불구하고 위 의무를 면제한다.')).eligible,false);
});
test('현재 재위탁 질문에 불필요한 표준의 별도 책임 문장까지 강제하지 않음',()=>{
 const other='수탁자는 재위탁 이후에도 책임을 부담한다.';const lib=setup(text+'\n'+other);
 assert.equal(L.evaluate(lib,cp,item,input(text)).eligible,true);
 assert.equal(L.evaluate(lib,cp,item,input(text+'\n'+other)).eligible,true);
});
test('과거 표준의 유형·지위 차이는 단독 게이트가 아니며 실제 비적용·미확인은 차단',()=>{
 const lib=setup();for(const change of [{type:'nda'},{stance:'beneficiary'}]){let p=input(text);Object.assign(p.scope,change);assert.equal(L.evaluate(lib,cp,item,p).eligible,true);}
 lib.templates[0].roles=['수탁자'];assert.equal(L.evaluate(lib,cp,item,input(text)).eligible,true);
 lib.templates[0].roles=[];assert.equal(L.evaluate(lib,cp,{...item,roleGated:true},input(text)).eligible,false);
 assert.equal(L.evaluate(lib,cp,item,{...input(text),current:false}).eligible,false);
});
test('질문 의미 변경·사용 중지는 무효화하되 같은 의미의 표시 변경은 유지',()=>{
 const lib=setup();assert.equal(L.evaluate(lib,{...cp,check:'표시 문구만 변경'},item,input(text)).eligible,true);
 assert.equal(L.evaluate(lib,{...cp,meaning_revision:'new-meaning',check:'새로운 질문'},item,input(text)).eligible,false);
 lib.templates[0].active=false;assert.equal(L.evaluate(lib,cp,item,input(text)).eligible,false);
});
test('비밀유지 존속기간 문구로 무관한 개인정보 재위탁 질문을 충족시키지 않음',()=>{
 const quote='비밀유지의무는 계약 종료 후 3년간 존속한다.';
 assert.equal(L.evaluate(setup(quote),cp,item,input(quote)).eligible,false);
 assert.equal(L.evaluate(setup(quote),cp,item,input(quote.replace('3년','1년'))).eligible,false);
});
test('평가에서 실제 이행 및 변경된 질문을 별도 분모로 분리',()=>{
 const p={checks:[cp],items:[],verdicts:{}};
 assert.equal(L.replay(setup(),p,[{...cp,review_scope:'execution_only'}]).excluded,1);
 assert.equal(L.replay(setup(),p,[{...cp,meaning_revision:'expanded-education',check:'재위탁 관리 교육까지 충분한가'}]).changed,1);
});
test('원문 지문·근거 인용 검증 및 위조 티켓 거부',()=>{
 const lib=setup();lib.templates[0].text+='변조';assert.throws(()=>L.validate(lib));
 assert.equal(L.consume({},cp.id),null);
 const t=L.ticket(setup(),cp,item,input(text));assert.ok(L.consume(t,cp.id));assert.equal(L.consume(t,cp.id),null);
});
test('사용자 판정은 보존하고 가져온 자동판정은 재검증 전 보류',()=>{
 const ticket=()=>L.ticket(setup(),cp,item,input(text));
 const manual={[cp.id]:{verdict:'검토의견',origin:'manual',comment:'수정 필요'}};
 assert.equal(V.applyTemplate(manual,cp.id,'2026-09-16',ticket()),manual);
 const out=V.applyTemplate({},cp.id,'2026-09-16',ticket());assert.equal(out[cp.id].verdict,'이상없음');assert.match(out[cp.id].comment,/일반 보안약정/);
 assert.equal(V.migrateStore(out)[cp.id].verdict,'');
});
test('실제 이행 확인은 매핑·완료의 입력 목록에서 제외하며 기준 등록도 거부',()=>{
 const c={...cp,review_scope:'execution_only'};assert.deepEqual(M.activeCheckpoints({checkpoints:[c]},[],'party'),[]);
 assert.throws(()=>setup(text,c));
});
test('평가에서 수동 검토의견을 잘못 통과시킨 사례 집계, 자동판정은 정답으로 미사용',()=>{
 const p={checks:[cp],items:[{cpId:cp.id,...item}],context:input(text).scope,documents:input(text).documents,verdicts:{[cp.id]:{origin:'manual',verdict:'검토의견'}}};
 assert.equal(L.replay(setup(),p).false_safe,1);p.verdicts[cp.id].origin='auto';assert.equal(L.replay(setup(),p).rows.length,0);
});
