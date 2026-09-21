const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../src/clause_semantics'),D=require('../src/decision_evidence'),R=require('../src/requirement_rules'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register'),P=require('../src/human_precedent'),Structure=require('../src/document_structure');
const policies=require('../knowledge/judgment_policies.json').checks,checks=policies.map(p=>({id:p.id,check:p.question})),cp=id=>checks.find(c=>c.id===id);
const active=id=>policies.find(p=>p.id===id).active!==false;
// SOL-05 now asks about the relevant insurance-sales work; the legacy fixture is generic supervision only.
const currentFixtureSatisfies=id=>active(id)&&id!=='SOL-05';
const cases=require('./fixtures/presence_completion.json'),docs=text=>[{name:'본문',text}],scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]},item={coverage:'addressed'};
const textOf=clauses=>'제1조(약정)\n'+clauses.join('\n'),evaluate=(id,documents)=>S.evaluate(cp(id),item,{confirmed:true,documents});
const alias='위탁자(이하 “갑”이라 한다).\n수탁자(이하 “을”이라 한다).\n',reverse='수탁자(이하 “갑”이라 한다).\n위탁자(이하 “을”이라 한다).\n';
const personnel=cases.find(c=>c.id==='ITSEC-12').clauses;
for(const c of cases.filter(c=>c.clauses.some(s=>/하여야 한다|할 수 없다/.test(s)))){
 test(c.id+' 명시적 의무·금지 종결 변형은 같은 요소이며 추가 조건은 유지',()=>{
  const changed=c.clauses.map(s=>s.replace(/하여야 한다/g,'할 의무를 진다').replace(/할 수 없다/g,'하여서는 안 된다'));
  const result=evaluate(c.id,docs(textOf(changed)));assert.equal(result.eligible,currentFixtureSatisfies(c.id),c.id);if(!active(c.id))assert.equal(result.status,'disabled_check');
  assert.equal(D.bundle(cp(c.id),docs(textOf(c.clauses))).key,D.bundle(cp(c.id),docs(textOf(changed))).key);
  assert.equal(evaluate(c.id,docs(textOf(changed.map(s=>s.replace(/(은|는) /,'$1 가능한 경우에만 '))))).eligible,false);
 });
}
const conditionCases=[['ITSEC-12','업무수행인력이 변경되는 경우'],['INV-BEN-04','신탁계약을 변경하는 경우'],['SP-DEL-05','완성물에 하자가 있는 경우'],['SP-DEL-06','완성물에 하자가 있는 경우'],['SP-DEL-07','완성물의 하자로 계약 목적을 달성할 수 없는 경우'],['SH-SHARE-06','소수주주의 동반매도참여권 행사 시'],['SH-SHARE-08','주식양도 시'],['SH-GOV-04','주주의 요청이 있는 경우'],['SH-ANT-01','기업결합 신고가 필요한 경우']];
for(const [id,condition] of conditionCases)test(id+' 명시 조건의 문장 앞 이동·경우에는 표현',()=>{
 const clauses=cases.find(c=>c.id===id).clauses,changed=clauses.map(s=>s.includes(condition)?condition.replace(/경우$/,'경우에는')+', '+s.replace(condition+' ',''):s);
 assert.equal(evaluate(id,docs(textOf(changed))).eligible,active(id),JSON.stringify(evaluate(id,docs(textOf(changed)))));
 assert.equal(D.bundle(cp(id),docs(textOf(clauses))).key,D.bundle(cp(id),docs(textOf(changed))).key);
 assert.equal(evaluate(id,docs(textOf(changed.map(s=>s.replace('경우에는','경우에만'))))).eligible,active(id));
});
test('매년과 연 표현은 횟수를 유지하고 배상 책임 종결도 직접 읽음',()=>{
 const a='수탁자는 자신이 제공하는 서비스의 품질수준 연 2회 이상 평가에 협조하여야 한다.',b=a.replace('연','매년').replace('하여야 한다','하여야만 한다');
 assert.equal(Q.key(a),Q.key(b));assert.equal(evaluate('ITSEC-10',docs(b)).eligible,true);assert.notEqual(Q.key(a),Q.key(b.replace('2회','1회')));
 const c=cases.find(c=>c.id==='SOL-03').clauses[0];assert.equal(Q.key(c),Q.key(c.replace('배상하여야 한다','배상할 책임을 진다')));
 for(const bad of [c.replace('배상하여야 한다','배상하기 위해 노력한다'),c.replace('배상하여야 한다','배상할 책임을 지지 않는다')])assert.equal(evaluate('SOL-03',docs(bad)).eligible,false);
});
test('정의형·축약형과 별칭 불명확을 구별하되 인력관리 약정 존재를 별칭만으로 보류하지 않음',()=>{
 for(const a of ['수탁자(이하 “을”).','“을”은 수탁자를 말한다.','“을”이라 함은 수탁자를 의미한다.','제1조(정의) “을”은 수탁자를 말한다.']){
  const t=a+'\n'+textOf(personnel.map(s=>s.replace('수탁자는','을은')));assert.equal(evaluate('ITSEC-12',docs(t)).eligible,true,t);
 }
 for(const a of ['“을”은 원수탁자를 말한다.','“을”은 주식회사를 말한다.','예시: “을”은 수탁자를 말한다.','“을”은 위탁자 또는 수탁자를 말한다.'])assert.equal(evaluate('ITSEC-12',docs(a+'\n'+textOf(personnel.map(s=>s.replace('수탁자는','을은'))))).eligible,true,a);
});
test('본문·별첨이 갑과 을을 반대로 정의해도 각 구역의 직접 근거를 사용',()=>{
 const main=alias+'제1조(운송)\n배송지는 서울이다.',sub=reverse+textOf(personnel.map(s=>s.replace('수탁자는','갑은')));
 for(const input of [[{name:'본문',text:main},{name:'인력관리약정서.pdf',text:sub}],docs(main+'\n별첨 1 인력관리약정서\n'+sub)]){
  assert.equal(evaluate('ITSEC-12',input).eligible,true,JSON.stringify(evaluate('ITSEC-12',input)));
  assert.equal(D.bundle(cp('ITSEC-12'),input).key,D.bundle(cp('ITSEC-12'),docs(textOf(personnel))).key);
  const ctx=Q.contexts(input);assert.equal(ctx.conflicts.length,0);assert.equal(ctx.scopes.size,2);
 }
 assert.equal(evaluate('ITSEC-12',docs(alias+reverse+textOf(personnel))).eligible,true);
});
test('엄격 비교에서는 미정의 갑·을을 상속하지 않되 직접 인력관리 약정은 읽음',()=>{
 const main=alias+'제1조(운송)\n배송지는 서울이다.',part=textOf(personnel.map(s=>s.replace('수탁자는','을은')));
 assert.equal(evaluate('ITSEC-12',[...docs(main),{name:'별첨 1',text:part}]).eligible,true);
 assert.equal(D.bundle(cp('ITSEC-12'),[...docs(main),{name:'별첨 1',text:part}]).reusable,false);
 const own=alias+part;assert.equal(evaluate('ITSEC-12',[...docs(main),{name:'별첨 1',text:own}]).eligible,true);
 assert.equal(evaluate('ITSEC-12',[...docs(main),{name:'별첨 1',text:own.replace('수탁자(이하 “을”','위탁자(이하 “을”')}]).eligible,true);
});
test('현재 구역별 직접 근거는 등록 표준과 과거 사용자 정정에 독립적으로 판정',()=>{
 const plain=textOf(personnel),bound=docs(alias+'제1조(배송)\n배송지는 부산이다.\n별첨 1 인력관리약정서\n'+reverse+textOf(personnel.map(s=>s.replace('수탁자는','갑은'))));
 const t=Register.process('인력 표준','1',plain,{type_ids:['outsourcing'],roles:[],stance:'party'},checks),lib={format:L.VERSION,templates:[t]};
 assert.equal(L.evaluate(lib,cp('ITSEC-12'),item,{current:true,scope,documents:bound}).eligible,true);
 const inScope=Register.process('구역 기준','1',bound[0].text,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);
 assert.equal(L.evaluate({format:L.VERSION,templates:[inScope]},cp('ITSEC-12'),item,{current:true,scope,documents:docs(plain)}).eligible,true);
 const packet={id:'p',date:'2026-09-15',documents:docs(plain),context:scope,checks:[cp('ITSEC-12')],verdicts:{'ITSEC-12':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const input=()=>P.prepare({confirmed:true,documents:bound,scope,date:'2026-09-17',review_packets:[packet]});
 assert.equal(S.evaluate(cp('ITSEC-12'),item,input()).eligible,true);packet.verdicts['ITSEC-12']={origin:'manual',verdict:'검토의견',comment:'정정'};
 assert.equal(S.evaluate(cp('ITSEC-12'),item,input()).eligible,true);
});
test('구역 캐시는 입력 수정 시 갱신되고 원문과 호출자 자료를 수정하지 않음',()=>{
 const input=docs(alias+textOf(personnel.map(s=>s.replace('수탁자는','을은')))),before=JSON.stringify(input),a=Q.contexts(input);
 assert.equal(Q.contexts(input),a);assert.equal(JSON.stringify(input),before);
 input[0].text=input[0].text.replace('수탁자(이하 “을”','위탁자(이하 “을”');assert.notEqual(Q.contexts(input),a);assert.equal(evaluate('ITSEC-12',input).eligible,true);
});
test('띄어쓰기 없는 비밀유지 약정은 읽고 엄격 비교에서는 상대방 별칭 변경을 보존',()=>{
 const check=cp('CNS-SECRET'),quote='을은갑의비밀정보를공개하여서는아니된다.',a=alias+'제1조(비밀유지)\n'+quote,b=a.replace('위탁자(이하 “갑”','정보수령자(이하 “갑”');
 assert.notEqual(D.bundle(check,docs(a)).key,D.bundle(check,docs(b)).key);
 const t=L.draft('시험 표준','1',a,{type_ids:['outsourcing'],roles:[],stance:'party'});L.bind(t,check,[quote]);t.active=true;
 const run=text=>L.evaluate({format:L.VERSION,templates:[t]},check,item,{current:true,scope,documents:docs(text)});
 assert.equal(run(a).eligible,true);assert.equal(run(b).eligible,true);
 const packet={id:'no-spaces',date:'2026-09-15',documents:docs(a),context:scope,checks:[check],verdicts:{[check.id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 assert.equal(S.evaluate(check,item,P.prepare({confirmed:true,documents:docs(b),scope,date:'2026-09-17',review_packets:[packet]})).eligible,true);
});
const secret=cp('CNS-SECRET'),part='제1조(기간)\n기간은 3년이다.';
test('명시 제목 참조를 파일 이름·문서 첫 제목·동일 파일 별첨 표제로 해결',()=>{
 for(const ref of ['「보안관리약정서」 제1조','별첨 보안관리약정서 제1조','보안관리약정서 제1조','보안관리약정서']){
  const main='제1조(비밀유지)\n비밀유지 의무는 '+ref+'에 따른다.';
  const separated=[...docs(main),{name:'보안 관리 약정서.hwpx',text:part}],titled=[...docs(main),{name:'scan.pdf',text:'보안관리약정서\n'+part}],attached=docs(main+'\n별첨 보안관리약정서\n'+part);
  const a=D.bundle(secret,separated);assert.equal(a.reusable,true,JSON.stringify(a));assert.equal(D.bundle(secret,titled).reusable,true);assert.equal(a.key,D.bundle(secret,attached).key);
  assert.notEqual(a.key,D.bundle(secret,[...docs(main),{name:'보안관리약정서',text:part.replace('3년','1년')}]).key);
 }
});
test('동명·제목 미일치·누락·번호/제목 불일치·참조 순환을 정확히 구별',()=>{
 const main='제1조(비밀유지)\n비밀유지 의무는 「보안관리약정서」 제1조에 따른다.';
 for(const others of [[],[{name:'다른약정서',text:part}],[{name:'보안관리약정서',text:''}],[{name:'보안관리약정서.pdf',text:part},{name:'보안관리약정서.hwp',text:part}],[{name:'보안관리약정서',text:part+'\n제1조(중복)\n기간은 7년이다.'}]])assert.equal(D.bundle(secret,[...docs(main),...others]).reusable,false);
 assert.equal(D.bundle(secret,[...docs(main.replace('「','별첨 1 「')),{name:'별첨 1 다른약정서',text:part},{name:'별첨 2 보안관리약정서',text:part}]).reusable,false);
 const cycle=[...docs(main),{name:'보안관리약정서',text:part+'\n제2조(적용)\n「정보관리약정서」를 준용한다.'},{name:'정보관리약정서',text:'제1조(적용)\n「보안관리약정서」를 준용한다.'}];
 assert.equal(D.bundle(secret,cycle).reusable,true);assert.equal(D.bundle(secret,cycle.slice(0,2)).reusable,false);
 assert.equal(Structure.titleKey('보안관리약정서_2025.pdf'),'');assert.notEqual(Structure.titleKey('2025 보안관리약정서.pdf'),Structure.titleKey('2026 보안관리약정서.pdf'));
});
test('한 문장의 다른 미해결 제목을 숨기지 않고 본 계약서의 자기 조 참조는 구분',()=>{
 const main='제1조(비밀유지)\n비밀유지 기간은 「보안관리약정서」 제1조에 따르고 보관 조건은 추가약정서에 따른다.';
 assert.equal(D.bundle(secret,[...docs(main),{name:'보안관리약정서',text:part}]).reusable,false);
 const self='제1조(기간)\n기간은 3년이다.\n제2조(비밀유지)\n비밀유지 의무는 본 계약서 제1조에 따른다.';
 assert.equal(D.bundle(secret,docs(self)).reusable,true);
 assert.equal(D.bundle(secret,docs(self.replace('제1조에','제3조에'))).reusable,false);
});
test('명명된 별첨이 기간만 정하면 과거 이상없음이나 우선순위만으로 비밀정보 보호를 추정하지 않음',()=>{
 const main='제1조(비밀유지)\n비밀유지 의무는 「보안관리약정서」 제1조에 따른다.\n제2조(운송)\n배송지는 서울이다.';
 const priority='제2조(우선순위)\n본문과 보안관리약정서가 상충하면 보안관리약정서가 우선한다.';
 const original=[...docs(main),{name:'보안관리약정서',text:part+'\n'+priority}];
 const packet={id:'p',date:'2026-09-15',documents:original,context:scope,checks:[secret],verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const changed=JSON.parse(JSON.stringify(original));changed[0].text=main.replace('서울','부산');
 const run=documents=>S.evaluate(secret,item,P.prepare({confirmed:true,documents,scope,date:'2026-09-17',review_packets:[packet]}));
 assert.equal(run(changed).eligible,false);changed[1].text=changed[1].text.replace('보안관리약정서가 우선한다','본문이 우선한다');assert.equal(run(changed).eligible,false);
 assert.notEqual(D.bundle(secret,original).key,D.bundle(secret,[...original,{name:'예외 특약',text:'제1조(예외)\n「보안관리약정서」 제1조는 적용하지 않는다.'}]).key);
});
