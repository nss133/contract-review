const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../src/standard_auto');
const E=require('../src/evidence_rules');
const V=require('../src/verdict');
const currentChecks=require('../build/audit_v188_acceptance.cjs').loadChecks();
function cp(id){return currentChecks.find(c=>c.id===id);}
function input(text,extra=[]){return {confirmed:true,documents:[{name:'본문',text}].concat(extra)};}
const item={coverage:'verify'};
const samples={
 'CNS-PRICE':'제1조(대금 지급)\n계약금액은 1000000원으로 한다.\n위탁자는 수탁자의 청구서 수령일로부터 30일 이내에 대금을 수탁자의 지정 계좌로 지급한다.\n양 당사자는 매월 말일에 실제 수행 내역을 상호 확인하여 대금을 정산한다.',
 'CMN-05':'제1조(부가세)\n부가가치세는 별도로 한다.',
 'CNS-TERM':'제1조(계약기간)\n계약기간은 2026년 1월 1일부터 2026년 12월 31일까지로 한다.',
 'CMN-19':'제1조(관할)\n본 계약과 관련하여 발생하는 분쟁에 관한 소송은 서울중앙지방법원을 전속관할 법원으로 한다.'
};
test('4종 정형 패턴의 전체 요건과 실제 자동 티켓',()=>{
 for(const id of Object.keys(samples)){
  const p=input(samples[id]),r=S.evaluate(cp(id),item,p);assert.equal(r.eligible,true,id+':'+r.status);
  const t=S.ticket(cp(id),item,p),v=V.applyStandard({},id,'2026-09-15',t);
  assert.equal(v[id].origin,'auto');assert.equal(v[id].verdict,'이상없음');
  assert.deepEqual(V.applyStandard({},id,'2026-09-15',t),{});
 }
});
test('무관한 별도 조항 단서는 막지 않으며 관련 단서·전역 우선·별첨 충돌은 차단',()=>{
 const p=samples['CNS-TERM'];
 assert.equal(S.evaluate(cp('CNS-TERM'),item,input(p+'\n제2조(대금)\n다만 휴일에는 다음 영업일에 지급한다.')).eligible,true);
 assert.equal(S.evaluate(cp('CNS-TERM'),item,input(p+'\n다만 당사자 합의로 달리 정한다.')).eligible,true);
 for(const tail of ['\n제2조(우선)\n계약기간은 별첨 기간특약의 변경 내용이 우선한다.',
 '\n제2조(계약기간)\n계약기간은 2027년 1월 1일부터 2027년 12월 31일까지로 한다.'])
 assert.equal(S.evaluate(cp('CNS-TERM'),item,input(p+tail)).eligible,false,tail);
 assert.equal(S.evaluate(cp('CNS-TERM'),item,input(p,[{name:'별첨',text:'제1조(계약기간)\n다만 계약기간은 별도로 정한다.'}])).eligible,false);
});
test('역전·잘못된 날짜·요건누락·양태변경·체크변경은 통과하지 않음',()=>{
 for(const s of ['계약기간은 2026년 2월 30일부터 2026년 12월 31일까지로 한다.','계약기간은 2027년 1월 1일부터 2026년 12월 31일까지로 한다.',
 '계약기간은 추후 협의한다.'])assert.equal(S.evaluate(cp('CNS-TERM'),item,input(s)).eligible,false,s);
 assert.equal(S.evaluate(cp('CNS-TERM'),item,input('계약기간은 1년이다.')).eligible,true);
 assert.equal(S.evaluate({...cp('CNS-TERM'),meaning_revision:'new-adequacy',check:'기간이 회사에 유리한가'},item,input(samples['CNS-TERM'])).eligible,false);
 assert.equal(S.evaluate(cp('CNS-PRICE'),item,input(samples['CNS-PRICE'].split('\n').slice(0,2).join('\n'))).eligible,true);
 assert.equal(S.evaluate(cp('CMN-05'),item,input(samples['CMN-05']+'\n부가가치세는 포함한다.')).eligible,false);
});
test('미확인·역할 제한·재매핑·변환 오류·종합판단 금지 체크',()=>{
 const p=input(samples['CNS-TERM']);
 for(const i of [{...item,roleGated:true},{...item,opinionScope:'contract'}])assert.equal(S.evaluate(cp('CNS-TERM'),i,p).eligible,false);
 for(const i of [{coverage:'quiet'},{...item,reassigned:true}])assert.equal(S.evaluate(cp('CNS-TERM'),i,p).eligible,true);
 assert.equal(S.evaluate(cp('CNS-TERM'),item,{...p,confirmed:false}).eligible,false);
 assert.equal(S.evaluate({...cp('CNS-TERM'),review_scope:'execution_only'},item,p).eligible,false);
 assert.equal(S.evaluate(cp('CNS-TERM'),item,input(samples['CNS-TERM'],[{name:'무관한 소개서',text:''}])).eligible,true);
});
test('동일 입력의 과거 결론만으로 미지원 질문의 본건 근거를 만들지 않음',()=>{
 const ctx={version:1,documents:'D',context:'C',checks:{X:'Q'}},p=input('미리 검토한 특수 문구');p.comparison_context=ctx;
 const snapshot={comparison_context:ctx,verdicts:{X:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 p.corpus={judgment_ledger:{records:{A:{snapshot}}}};
 assert.equal(S.evaluate({id:'X'},item,p).status,'no_rule');
 snapshot.verdicts.X.reason='수용 가능한 위험';assert.equal(S.evaluate({id:'X'},item,p).eligible,false);
 snapshot.verdicts.X.reason='반영되어 있음';snapshot.verdicts.X.origin='auto';assert.equal(S.evaluate({id:'X'},item,p).eligible,false);
 snapshot.verdicts.X.origin='manual';p.comparison_context={...ctx,documents:'changed annex'};assert.equal(S.evaluate({id:'X'},item,p).eligible,false);
});
test('기존 사람 판정 보호 및 위조 티켓 거부',()=>{
 const p=input(samples['CNS-TERM']),c=cp('CNS-TERM'),old={};old[c.id]={origin:'manual',verdict:'검토의견'};
 assert.equal(V.applyStandard(old,c.id,'2026-09-15',S.ticket(c,item,p)),old);
 assert.deepEqual(V.applyStandard({},c.id,'2026-09-15',{}),{});
});
test('구역 범위의 무관한 단서를 제외하되 참조·인접 단서는 유지',()=>{
 const rule={obligations:[{actors:['수탁자'],actions:['통지'],objects:['해지'],conditions:['서면']}]};
 const main='제1조(해지)\n수탁자는 해지 시 서면으로 통지하여야 한다.';
 assert.equal(E.blockingQualifiers(rule,[{text:main+'\n제2조(대금)\n다만 휴일이면 다음 영업일에 지급한다.'}]).length,0);
 assert.equal(E.blockingQualifiers(rule,[{text:main+'\n다만 이를 생략할 수 있다.'}]).length,1);
 assert.equal(E.blockingQualifiers(rule,[{text:main+'\n제2조(대금)\n다만 제1조에도 불구하고 이를 생략한다.'}]).length,1);
 assert.equal(E.blockingQualifiers(rule,[{text:main+'\n제2조(대금)\n다만 수탁자는 휴일에 대금을 지급하지 않는다.'}]).length,0);
});
test('평가 재실행은 과거 정답을 판정 입력으로 쓰지 않고 오류를 실제 집계',()=>{
 const id='CNS-TERM',p={id:'A',confirmed:true,documents:input(samples[id]).documents,checks:[cp(id)],items:[{cpId:id,coverage:'verify'}],
 verdicts:{[id]:{origin:'manual',verdict:'검토의견'}}};
 assert.equal(S.replay(p).false_safe,1);
 p.verdicts[id]={origin:'manual',verdict:'이상없음',reason:'반영되어 있음'};
 assert.equal(S.replay(p).released,1);
 p.verdicts[id].reason='수용 가능한 위험';assert.equal(S.replay(p).checked,0);
});
