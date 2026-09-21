const {test}=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const Q=require('../src/clause_semantics'),R=require('../src/requirement_rules'),D=require('../src/decision_evidence'),S=require('../src/standard_auto'),P=require('../src/human_precedent'),L=require('../src/template_library'),Register=require('../src/template_register');
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],item={coverage:'addressed'},scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]};
const examples=[
 ['ITSEC-01','수탁자는 외부주문 개발업무에 사용되는 업무장소·전산설비를 내부 업무용과 분리하여 설치·운영하여야 한다.','업무장소·'],
 ['ITSEC-02','수탁자는 금융회사와 이용자 간 암호화정보를 해독하거나 원장 등 중요 데이터를 변경하여서는 아니된다.','원장 등 중요 데이터를 변경'],
 ['ITSEC-03','수탁자는 계좌번호·비밀번호 등 이용자 금융정보를 무단으로 보관하거나 유출하여서는 아니된다.','무단으로 보관하거나 '],
 ['ITSEC-04','수탁자는 접근매체 위·변조, 해킹 및 개인정보유출에 대비한 보안대책을 수립하여야 한다.','해킹 및 '],
 ['ITSEC-05','수탁자는 금융회사와 전자금융보조업자 간 접속에 전용회선을 사용하여야 한다.','전용'],
 ['ITSEC-06','수탁자는 정보처리시스템 장애 등 서비스 중단에 대비한 비상대책을 수립하여야 한다.','서비스 중단에 대비한 '],
 ['ITSEC-07','수탁자는 외부주문의 입찰·계약·수행 및 완료 각 단계별로 금융감독원장이 정하는 보안관리방안을 준수하여야 한다.','입찰·'],
 ['ITSEC-08','수탁자는 중요 전산자료의 백업자료 보존 및 백업설비 확보를 포함한 백업대책을 수립하여야 한다.',' 및 백업설비 확보'],
 ['ITSEC-09','수탁자는 자신의 재무건전성 연 1회 이상 평가 및 상시 모니터링에 필요한 자료 제공에 협조하여야 한다.',' 및 상시 모니터링'],
 ['ITSEC-13','수탁자는 외부주문에 대한 자체 보안성검토 및 정기 보안점검 실시에 협조하여야 한다.','자체 보안성검토 및 ']
];
function evaluate(id,text){return S.evaluate(cp(id),item,{confirmed:true,documents:docs(text)});}
for(const [id,text,removed] of examples){
 test(id+' 신규 전체 요건·자동 등록·구조화 근거',()=>{
  assert.equal(evaluate(id,text).eligible,true,JSON.stringify(evaluate(id,text)));
  assert.equal(R.catalog[id].question,cp(id).check);assert.ok(Q.parse(text));
  assert.ok(evaluate(id,text).evidence.some(e=>text.includes(e.text)));
  const t=Register.process('IT 보안 표준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);
  assert.ok(t.bindings.some(b=>b.check_id===id),id);
  assert.equal(L.evaluate({format:L.VERSION,templates:[t]},cp(id),item,{current:true,scope,documents:docs(text)}).eligible,true);
 });
 test(id+' 필수 요소 누락·반대방향·주체 변경·예시·조건은 통과하지 않음',()=>{
  // 감독수단·사고 예시·운영주기의 특정 문구는 약정 존재의 보편 필수요소가 아니다.
  const alternative=['ITSEC-04','ITSEC-06','ITSEC-07','ITSEC-08','ITSEC-09','ITSEC-13'].includes(id);
  assert.equal(evaluate(id,text.replace(removed,'')).eligible,alternative,'현행 최소요건: '+id);
  const variants=[...(id==='ITSEC-13'?[]:[text.replace('수탁자는','위탁자는')]),text.replace('수탁자는','수탁자는 필요한 경우에만'),text.replace('하여야 한다','할 수 있다').replace('하여서는 아니된다','할 수 있다'),'검토메모 예시: “'+text+'”',text.replace(/\.$/,'고 예시한다.'),text+'\n다만 위 의무는 면제한다.'];
  for(const bad of variants)assert.equal(evaluate(id,bad).eligible,false,bad);
  assert.equal(S.evaluate({...cp(id),meaning_revision:'test-new-meaning',check:'변경된 질문'},item,{confirmed:true,documents:docs(text)}).eligible,false);
 });
}
test('동등 종결·목록 어순·별칭·단순 줄바꿈과 실질 조건 차이',()=>{
 const [id,text]=examples[0];
 for(const variant of [text.replace('업무장소·전산설비','전산설비 및 업무장소'),text.replace('운영하여야 한다','운영할 의무를 부담한다'),text.replace('운영하여야 한다','운영하기로 한다'),text.replace('사용되는 업무장소','사용되는\n업무장소'),'수탁자(이하 “을”이라 한다).\n'+text.replace('수탁자는','을은')]){
  assert.equal(evaluate(id,variant).eligible,true,variant);assert.equal(D.bundle(cp(id),docs(text)).key,D.bundle(cp(id),docs(variant)).key,variant);
 }
 const virtual=examples[4][1].replace('전용회선을','전용회선과 동등한 보안수준의 가상 전용회선을');
 assert.equal(evaluate('ITSEC-05',virtual).eligible,true);assert.equal(evaluate('ITSEC-05',virtual.replace('전용회선과 동등한 보안수준의 ', '')).eligible,false);
 assert.notEqual(Q.key(examples[4][1]),Q.key(virtual));
 const finance=examples[8][1];assert.equal(evaluate('ITSEC-09',finance.replace('1회','2회')).eligible,true);
 assert.equal(evaluate('ITSEC-09',finance.replace('연 1회 이상','2년에 1회')).eligible,true);
 assert.notEqual(Q.key(finance),Q.key(finance.replace('1회','2회')));
 assert.equal(evaluate('ITSEC-09',finance.replace('수탁자는','전자금융보조업자는').replace('상시 모니터링','상시\n모니터링')).eligible,true);
});
test('3개 이상 병렬 의무와 분리 문장을 동등하게 비교하며 미해석 가지는 버리지 않음',()=>{
 const rows=[examples[3],examples[5],examples[7],examples[9]],separate='제1조(보안조치)\n'+rows.map(r=>r[1]).join('\n');
 const compound='제1조(보안조치)\n'+rows.map((r,i)=>r[1].replace(i?'수탁자는 ':'','').replace(i<rows.length-1?'하여야 한다.':'__never__','하고, ')).join('');
 assert.equal(Q.parseAll(compound.split('\n')[1]).length,4);
 assert.equal(Q.parseAll(compound.split('\n')[1].replace('수탁자는','“수탁자”는')).length,4);
 const many=n=>'수탁자는 '+Array.from({length:n},(_,i)=>examples[5][1].replace('수탁자는 ','').replace(i<n-1?'하여야 한다.':'__never__','하여야 하며, ')).join('');
 assert.equal(Q.parseAll(many(6)).length,6);assert.equal(Q.parseAll(many(7)),null);
 for(const [id] of rows){assert.equal(evaluate(id,compound).eligible,true,id);assert.equal(D.bundle(cp(id),docs(compound)).key,D.bundle(cp(id),docs(separate)).key,id);}
 const bad=compound.replace('백업설비 확보','가능한 범위의 백업설비 확보');
 assert.equal(Q.parseAll(bad.split('\n')[1]),null);
 for(const [id] of rows)assert.equal(evaluate(id,bad).eligible,true,id+' 독립적인 백업자료 보존 대책은 그대로 존재');
});
test('확대 요건의 과거 사용자 정답·최신 정정을 표현 변형에도 재사용',()=>{
 const [id,text]=examples[7],changed=text.replace('수립하여야 한다','수립할 의무가 있다');
 const p={id:'past',date:'2026-09-15',documents:docs(text),context:scope,checks:[cp(id)],verdicts:{[id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const input=()=>P.prepare({confirmed:true,documents:docs(changed),scope,review_packets:[p],date:'2026-09-17'});
 assert.equal(S.evaluate(cp(id),item,input()).status,'supported');
 p.verdicts[id]={origin:'manual',verdict:'검토의견',comment:'조건 보완'};
 assert.equal(S.evaluate(cp(id),item,input()).status,'supported');
});
const c=cp('CNS-SECRET');
const annex='별첨 1 보안약정서\n제1조(기간)\n기간은 3년이다.\n제2조(비밀유지)\n비밀유지 의무는 제1조에 따른다.';
test('같은 파일의 본문·별첨 조문 번호 재시작을 구분하고 내부 참조의 대상을 유지',()=>{
 const prefix='제1조(배송)\n배송지는 서울이다.\n제2조(대금)\n대금은 100원이다.\n';
 const a=D.bundle(c,docs(prefix+annex));assert.equal(a.reusable,true,JSON.stringify(a));
 const b=D.bundle(c,docs(prefix.replace('서울','부산')+annex));assert.equal(a.key,b.key);
 const wrong=D.bundle(c,docs(prefix+annex.replace('제1조에','본문 제1조에')));assert.equal(wrong.reusable,true);assert.notEqual(a.key,wrong.key);
 assert.equal(D.bundle(c,docs(prefix+annex+'\n제1조(다른 기간)\n기간은 7년이다.')).reusable,false);
});
test('명시된 별첨을 파일 안팎에서 해결하고 잘못된·중복·비어 있는 별첨을 보류',()=>{
 const main='제1조(비밀유지)\n비밀유지 의무의 존속기간은 별첨 1 제1조에 따른다.';
 const text='제1조(기간)\n기간은 3년이다.';
 const a=D.bundle(c,[...docs(main),{name:'별첨 1 보안약정서.pdf',text}]);assert.equal(a.reusable,true,JSON.stringify(a));
 const b=D.bundle(c,docs(main+'\n별첨 1 보안약정서\n'+text));assert.equal(b.reusable,true,JSON.stringify(b));assert.equal(a.key,b.key);
 for(const extra of [[{name:'별첨 2',text}],[{name:'별첨 1',text:''}],[{name:'별첨 1',text},{name:'별첨 1 복사본',text}]])assert.equal(D.bundle(c,[...docs(main),...extra]).reusable,false);
 assert.notEqual(a.key,D.bundle(c,[...docs(main),{name:'별첨 1',text:text.replace('3년','1년')}]).key);
 const arbitrary=D.bundle(c,[...docs(main.replace('별첨 1 제1조','별첨')),{name:'배송지',text:'서울'}]);assert.equal(arbitrary.reusable,false);
});
test('별첨의 역방향 제한·누락 참조·순환 참조를 빠짐없이 처리',()=>{
 const main='제1조(비밀유지)\n비밀유지 의무는 별첨 1에 따른다.',part='제1조(기간)\n기간은 3년이다.';
 const all=[...docs(main),{name:'별첨 1',text:part}],a=D.bundle(c,all);assert.equal(a.reusable,true);
 assert.notEqual(a.key,D.bundle(c,[...all,{name:'특약',text:'제1조(예외)\n별첨 1의 적용은 제외한다.'}]).key);
 assert.equal(D.bundle(c,[...docs(main),{name:'별첨 1',text:part+'\n제2조(적용)\n별첨 2를 준용한다.'}]).reusable,false);
 const cycle=[...all,{name:'별첨 2',text:'제1조(적용)\n별첨 1을 준용한다.'}];cycle[1]={...cycle[1],text:part+'\n제2조(적용)\n별첨 2를 준용한다.'};
 assert.equal(D.bundle(c,cycle).reusable,true); // 문맥 전체를 보존하는 비교이며 순환 문구의 법적 효력을 승인하는 것은 아님
});
test('외부 규정의 별표는 계약 첨부와 구별하며 등록 표준의 동일 문맥에서만 보존',()=>{
 const text='제1조(비밀유지)\n비밀정보의 보안조치는 시험규정 별표 3에 따른다.';
 assert.equal(D.bundle(c,docs(text)).reusable,false);
 const opts={registered_reference_context:true},a=D.bundle(c,docs(text),opts);
 assert.equal(a.reusable,true);assert.equal(a.preserved_reference_context,true);
 assert.notEqual(a.key,D.bundle(c,docs(text.replace('별표 3','별표 2')),opts).key);
});
test('별도 파일의 본문 역참조는 별첨 자기 조문과 혼동하지 않음',()=>{
 const main='제1조(기간)\n기간은 5년이다.',sub='제1조(기간)\n기간은 3년이다.\n제2조(비밀유지)\n비밀유지 의무는 본문 제1조에 따른다.';
 const a=D.bundle(c,[...docs(main),{name:'별첨 1',text:sub}]);assert.equal(a.reusable,true);assert.ok(a.evidence.some(e=>e.text.includes('5년')));
 const b=D.bundle(c,docs(main+'\n별첨 1 보안약정서\n'+sub));assert.equal(a.key,b.key);
 assert.notEqual(a.key,D.bundle(c,[...docs(main),{name:'별첨 1',text:sub.replace('본문 ','')}]).key);
});
test('직접 판정도 키워드 없는 역참조 특약을 읽되 다른 별첨의 같은 번호는 오인하지 않음',()=>{
 const [id,text]=examples[5],base='제1조(비상대책)\n'+text;
 const restricted=base+'\n제2조(적용범위)\n제1조의 의무는 수탁자가 동의하는 경우에만 적용한다.';
 assert.equal(evaluate(id,restricted).eligible,false);
 assert.equal(evaluate(id,base+'\n제2조(배송)\n배송지는 서울이다.').eligible,true);
 const other=base+'\n별첨 1 운송약정서\n제1조(배송)\n배송지는 서울이다.\n제2조(예외)\n제1조는 적용하지 않는다.';
 assert.equal(evaluate(id,other).eligible,true);
 assert.equal(evaluate(id,other.replace('제1조는 적용','본문 제1조는 적용')).eligible,false);
});
