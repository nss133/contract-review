const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../src/clause_equivalence'),F=require('../src/template_fields'),A=require('../src/template_assist'),L=require('../src/template_library'),H=require('../src/safety_digest'),segment=require('../src/segmenter').segmentContract;
const checks=require('../build/audit_v188_acceptance.cjs').loadChecks(),checkFor=id=>checks.find(c=>c.id===id);
const scope={type_ids:['outsourcing'],roles:[],stance:'party'},cp={...checkFor('CORE-07'),triggers:{keywords:['개인정보','수탁자','재위탁']}};
function lib(text,fields=[],check=cp){let t=L.draft('테스트','1',text,scope);L.bind(t,check,[text]);t.fields=fields;t.active=true;return {format:L.VERSION,templates:[t]};}
function input(text,source_states={}){return {current:true,documents:[{name:'본문',text}],scope:{type:'outsourcing',roles:[],stance:'party'},source_states};}
const pairs=[
 ['사전동의','수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.','수탁자가 업무를 재위탁하려면 위탁자의 서면 동의를 미리 받아야 한다.'],
 ['목적제한','수탁자는 개인정보를 위탁 목적 외로 이용하여서는 아니 된다.','수탁자는 개인정보를 위탁 목적으로만 사용하여야 한다.'],
 ['비밀공개','수탁자는 비밀정보를 제3자에게 공개하여서는 아니 된다.','수탁자는 제3자에게 비밀정보를 공개할 수 없다.'],
 ['점검협조','수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.','위탁자가 개인정보 처리 현황을 점검하는 경우 수탁자는 이에 협조해야 한다.'],
 ['반환','수탁자는 계약 종료 시 비밀정보를 위탁자에게 반환하여야 한다.','계약이 종료되면 수탁자는 위탁자에게 비밀정보를 반환해야 한다.'],
 ['파기','수탁자는 계약 종료일부터 30일 이내에 비밀정보를 파기하여야 한다.','계약 종료 후 30일 이내에 수탁자는 비밀정보를 파기해야 한다.'],
 ['유출통지','수탁자는 개인정보의 유출을 인지한 경우 즉시 위탁자에게 서면으로 통지하여야 한다.','수탁자는 개인정보의 유출을 알게 되면 즉시 위탁자에게 서면으로 알려야 한다.'],
 ['접근제한','수탁자는 개인정보에 대한 접근권한을 업무 수행에 필요한 최소한의 범위로 제한하여야 한다.','수탁자는 업무 수행에 필요한 최소한의 범위에서만 개인정보에 대한 접근권한을 부여해야 한다.']
];
const pairIds={'사전동의':'CORE-07','목적제한':'ALL-PII-03','비밀공개':'CNS-SECRET','점검협조':'PRIV-07','반환':'NDA-12','파기':'NDA-12','유출통지':'PRIV-17','접근제한':'PRIV-06'};
for(const [name,a,b] of pairs){
 const current=checkFor(pairIds[name]),supported=name!=='유출통지';
 test(name+' 구조 동등 표현을 보존하며 현행 질문의 자동지원 범위로 판정',()=>{assert.ok(Q.frame(a));assert.equal(Q.frame(a).key,Q.frame(b).key);assert.equal(L.evaluate(lib(a,[],current),current,{},input(b)).eligible,supported);assert.equal(L.evaluate(lib(b,[],current),current,{},input(a)).eligible,supported);});
 test(name+' 같은 의무를 명시적으로 면제하는 특약은 통과 금지',()=>{
  const bad=b+' 다만, 이 의무는 면제한다.';
  assert.equal(L.evaluate(lib(a,[],current),current,{},input(bad)).eligible,false,bad);
 });
}
test('기간·서면 조건 차이와 단순 유사 키워드는 동등 구조가 아님',()=>{
 for(const [a,b] of [[pairs[5][1],pairs[5][2].replace('30일','90일')],[pairs[6][1],pairs[6][2].replace('서면으로 ','')],[pairs[0][1],'수탁자는 재위탁 후 위탁자에게 서면으로 통지해야 한다.']])assert.notEqual(L.canonical(a),L.canonical(b));
});
test('갑·을 조사 변형에서도 의무 주체를 보존',()=>{
 const a='을은 갑의 사전 서면 동의 없이 재위탁할 수 없다.',b='을이 업무를 재위탁하려면 갑의 서면 동의를 미리 받아야 한다.';
 assert.equal(L.canonical(a),L.canonical(b));assert.notEqual(L.canonical(a),L.canonical(b.replace('을이','갑이')));
});
test('무관한 별도 조항의 다만은 보류하지 않고 같은 근거 바로 뒤의 면제는 차단',()=>{
 const t='제1조(재위탁)\n'+pairs[0][1],check={...cp,triggers:{keywords:['재위탁']}};
 const l=lib(t);l.templates[0].bindings=[];L.bind(l.templates[0],check,[pairs[0][1]]);
 assert.equal(L.evaluate(l,check,{},input(t+'\n제2조(회의일정)\n회의는 월요일에 한다. 다만, 공휴일이면 화요일에 한다.')).eligible,true);
 assert.equal(L.evaluate(l,check,{},input(t+'\n다만, 이 의무는 면제한다.')).eligible,false);
});
test('일괄 판정용 준비 입력은 원문·역할 변경과 분리된 불변 스냅샷',()=>{
 const original=input(pairs[0][1]),prepared=L.prepare(original);original.documents[0].text='다른 내용';original.scope.type='nda';
 assert.equal(L.evaluate(lib(pairs[0][1]),cp,{},prepared).eligible,true);
 assert.equal(L.evaluate(lib(pairs[0][1]),cp,{},original).eligible,false);
});
test('입력란 후보는 이름·주소·체결일 독립 줄만: 금액·기간·통지기한 제외',()=>{
 const text='수탁자 상호: [상호]\n대표자: [대표자]\n주소: [주소]\n체결일: [날짜]\n계약금액: 100원\n계약기간: 3년\n통지기한: 30일';
 assert.equal(F.candidates(text).length,4);assert.equal(F.parse('계약 체결일로부터 30일 이내에 통지해야 한다.'),null);
});
test('독립 입력란은 본건 약정 확인을 막지 않고 기간 충돌·치환 오류는 차단',()=>{
 const current=checkFor('NDA-12'),text='수탁자 상호: 가회사\n체결일: 2026-09-16\n'+pairs[5][1],fields=F.candidates(text),l=lib(text,fields,current);
 const filled=F.fill(text,fields,{수탁자상호:'나회사',체결일:'2026-10-01'});
 assert.equal(L.evaluate(l,current,{},input(filled)).eligible,true);
 assert.equal(L.evaluate(l,current,{},input(filled.replace('30일','90일'))).eligible,true);
 assert.equal(L.evaluate(l,current,{},input(filled+'\n비밀정보의 파기 의무는 적용하지 않는다.')).eligible,false);
 assert.throws(()=>F.fill(text,fields,{수탁자상호:'나회사',체결일:'2026-02-30'}));
});
test('역할 표제·중복 입력란 충돌 및 본문에 재사용된 상호를 자동 치환하지 않음',()=>{
 const text='수탁자 상호: 가회사\n'+pairs[0][1],l=lib(text,F.candidates(text));
 assert.equal(F.key('위탁자 상호: 가회사',l.templates[0].fields,false),null);
 assert.equal(F.candidates(text+'\n수탁자 상호: 나회사').length,0);
 const repeated='수탁자 상호: 가회사\n가회사는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.',f=F.candidates(repeated);
 assert.throws(()=>F.fill(repeated,f,{수탁자상호:'나회사'}));
 assert.equal(F.consistent(repeated,f,input(repeated.replace('상호: 가회사','상호: 나회사')).documents),false);
 assert.equal(L.evaluate(lib(repeated,f),cp,{},input(repeated.replace('상호: 가회사','상호: 나회사'))).eligible,false);
});
test('허용하지 않은 임의 본문 구간을 입력란으로 위장할 수 없음',()=>{
 assert.throws(()=>F.validate(pairs[0][1],[{kind:'party_name',label:'수탁자상호',source:pairs[0][1]}]));
 const l=lib(pairs[0][1]);l.templates[0].fields=[{kind:'execution_date',label:'계약기간',source:'계약기간: 3년'}];assert.throws(()=>L.validate(l));
});
test('연결 초안은 직접 인용·관련어·태그 후보이며 승인 상태를 만들지 않음',()=>{
 const t=L.draft('보안관리','1','제1조(재위탁)\n'+pairs[0][1],scope);
 const rows=A.proposals(t,[cp,{...cp,id:'OUT',review_scope:'execution_only'},{...cp,id:'ABSENT',text_effect:'required_absent'},{id:'X',check:'관할',triggers:{keywords:['관할','법원']}}]);
 assert.equal(rows.length,1);assert.equal(rows[0].approved,false);assert.equal(t.bindings.length,0);assert.ok(rows[0].quotes.every(q=>t.text.includes(q)));
});
function corpus(verdict={origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'“수탁자는 재위탁 전에 위탁자로부터 서면 동의를 받아야 한다.”에 따라 충족'}){
 return {judgment_ledger:{records:{A:{snapshot:{meta:{type_id:'outsourcing',stance:'party',date:'2026-09-16'},verdicts:{[cp.id]:verdict}}}}}};
}
test('코퍼스 인용은 후보로 보존하되 승인 유무가 본건의 명시 약정을 좌우하지 않음',()=>{
 const l=lib(pairs[0][1]),t=l.templates[0],c=corpus(),r=A.variants(t,[cp],c,[]),candidate=r.candidates[0];
 assert.equal(r.candidates.length,1);assert.equal(candidate.needs_original,true);assert.equal(candidate.approved,false);
 assert.equal(L.evaluate(l,cp,{},input(candidate.quotes[0],A.sourceStates(c,[]))).eligible,true);
 assert.throws(()=>A.approveVariant(t,cp,candidate,false));A.approveVariant(t,cp,candidate,true);L.validate(l);
 const result=L.evaluate(l,cp,{},input(candidate.quotes[0],A.sourceStates(c,[])));
 assert.equal(result.eligible,true);assert.equal(result.kind,'equivalent');assert.equal(result.variant_source,undefined);
 assert.equal(L.evaluate(l,cp,{},input(candidate.quotes[0],{})).eligible,true);
 c.judgment_ledger.records.A.snapshot.verdicts[cp.id].verdict='검토의견';assert.equal(L.evaluate(l,cp,{},input(candidate.quotes[0],A.sourceStates(c,[]))).eligible,true);
 assert.equal(L.evaluate(l,cp,{},input('재위탁 관련 검토의견을 참고한다.',A.sourceStates(c,[]))).eligible,false);
});
test('시스템·위험수용·보류·이유 없는 결론·원문 없는 메모는 규칙 후보로 복사하지 않음',()=>{
 const t=lib(pairs[0][1]).templates[0];
 for(const v of [{origin:'auto',verdict:'이상없음',reason:'반영되어 있음'},{origin:'manual',verdict:'이상없음',reason:'수용 가능한 위험'},{origin:'manual',verdict:'검토의견'},{origin:'manual',verdict:'이상없음'}]){
  v.comment='“'+pairs[0][1]+'”';assert.equal(A.variants(t,[cp],corpus(v),[]).candidates.length,0);
 }
 const c=corpus();c.judgment_ledger.records.A.pending={};assert.equal(A.variants(t,[cp],c,[]).candidates.length,0);
 const n=corpus({origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'검토 결과 특별한 문제 없음'});assert.equal(A.variants(t,[cp],n,[]).stats.no_quote,1);
});
test('평가자료의 원문·사람 조항 확인과 질문 버전이 있어야 표현 후보 생성',()=>{
 const text='제1조(재위탁)\n'+pairs[0][1],cl=segment(text)[0],p={id:'p',contract_hash:'h',documents:[{name:'과거계약',text}],context:{type:'outsourcing',roles:[],stance:'party'},checks:[cp],verdicts:{[cp.id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}},mapping_gold:{[cp.id]:H.of([cl.heading,cl.body])}};
 assert.equal(A.variants(lib(pairs[0][1]).templates[0],[cp],{},[p]).candidates.length,1);
 p.mapping_gold={};assert.equal(A.variants(lib(pairs[0][1]).templates[0],[cp],{},[p]).candidates.length,0);
});
test('옛 승인으로 의미 변경을 우회하지 못하며 단순 유형 차이는 본건 확인을 막지 않음',()=>{
 const l=lib(pairs[0][1]),c=corpus(),v=A.variants(l.templates[0],[cp],c,[]).candidates[0];A.approveVariant(l.templates[0],cp,v,true);
 const p=input(v.quotes[0],A.sourceStates(c,[]));p.scope.type='nda';assert.equal(L.evaluate(l,cp,{},p).eligible,true);
 assert.equal(L.evaluate(l,{...cp,meaning_revision:'new-scope',check:'다른 질문'}, {},input(v.quotes[0],A.sourceStates(c,[]))).eligible,false);
});
test('같은 계약의 과거 정답 복사 없이 현재 원문을 재실행하되 독립 평가라고 주장하지 않음',()=>{
 const l=lib(pairs[0][1]),c=corpus(),v=A.variants(l.templates[0],[cp],c,[]).candidates[0];A.approveVariant(l.templates[0],cp,v,true);
 const p={id:'test',contract_hash:'A',checks:[cp],items:[{cpId:cp.id}],context:input('').scope,documents:input(v.quotes[0]).documents,verdicts:{[cp.id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 assert.equal(L.replay(l,p,[cp],A.sourceStates(c,[])).candidates,1);assert.equal(L.replay(l,p,[cp],A.sourceStates(c,[])).independent,false);
 p.documents=input('재위탁에 관하여 추후 협의한다.').documents;assert.equal(L.replay(l,p,[cp],A.sourceStates(c,[])).candidates,0);
});
