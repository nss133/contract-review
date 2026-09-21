const {test}=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const Q=require('../src/clause_semantics'),R=require('../src/requirement_rules'),D=require('../src/decision_evidence'),J=require('../src/judgment_sources'),H=require('../src/safety_digest'),P=require('../src/human_precedent'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register');
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],item={coverage:'addressed'};
const scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[],title:'계약'},safe={origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'사용자 확인 시험'};
const inspection='수탁자는 위탁자의 개인정보 관리 현황 점검에 협조한다.';
const alias='위탁자(이하 “갑”이라 한다).\n수탁자(이하 “을”이라 한다).\n';
const secret='제1조(비밀유지)\n비밀정보는 상대방이 제공한 기술상 정보를 말한다.\n비밀정보는 계약 수행 목적으로만 사용하고 제3자에게 공개하지 않는다.\n비밀유지 의무는 계약 종료 후 3년간 존속한다.';
function fixture(){
 const packet={id:'P',contract_hash:'H',review_id:'R',date:'2026-09-14',documents:docs(secret),context:scope,checks:[cp('CNS-SECRET')],verdicts:{}};
 const corpus={judgment_ledger:{records:{H:{snapshot:{meta:{date:'2026-09-15'},history_reference:{review_id:'R'},comparison_context:{documents:H.of(packet.documents),context:J.contextKey(scope),checks:{'CNS-SECRET':H.of(cp('CNS-SECRET'))}},verdicts:{'CNS-SECRET':safe}}}}}};
 const knowledge={documents:{tag:{source_id:'TAG',source_kind:'contract_review',title:'계약검토 태그',original:{review_id:'R'},tags:[{label:'비밀유지'}]}}};
 return {packet,corpus,knowledge,input:{confirmed:true,documents:docs(secret),scope:{...scope,title:'다른 제목'},review_packets:[packet],corpus,knowledge,date:'2026-09-16'}};
}
test('어순·정형 조건 표현을 요소 조합으로 읽는다',()=>{
 for(const [id,text]of [['PRIV-07','위탁자가 개인정보 관리 현황을 점검하는 경우 수탁자는 이에 협조해야 한다.'],['PRIV-03','수탁자는 기술적 및 관리적 보호조치를 개인정보의 안전한 처리를 위하여 실시한다.'],['CORE-07','수탁자는 재위탁하려는 경우 위탁자의 동의를 사전에 받아야 한다.'],['PRIV-06','수탁자는 업무수행에 필요한 최소한의 범위에서만 개인정보에 대한 접근권한을 부여한다.']]){
  const r=S.evaluate(cp(id),item,{confirmed:true,documents:docs(text)});assert.equal(r.eligible,true,JSON.stringify(r));assert.ok(r.evidence.some(e=>docs(text)[0].text.includes(e.text)));
 }
});
test('병렬 의무는 둘 다 해석하되 한쪽의 미해석 조건을 버리지 않는다',()=>{
 const text='수탁자는 제공받은 개인신용정보의 식별정보를 암호화하고 개인정보의 안전한 처리를 위하여 기술적 및 관리적 보호조치를 실시한다.';
 for(const id of ['PRIV-19','PRIV-03'])assert.equal(R.evaluate(cp(id),docs(text)).eligible,true,id);
 const partial=text.replace('실시한다','일부 실시한다');
 assert.equal(R.evaluate(cp('PRIV-19'),docs(partial)).eligible,true,'별도 보호조치 일부 제한이 독립적인 암호화 약정을 없애지 않음');
 assert.equal(R.evaluate(cp('PRIV-03'),docs(partial)).eligible,false,'보호조치 질문에서는 직접 관련된 일부 제한을 읽음');
 for(const modified of [text.replace('암호화하고','선택적으로 암호화하고'),text.replace('개인정보의 안전한 처리를 위하여','그 의무 대신')])assert.equal(R.evaluate(cp('PRIV-19'),docs(modified)).eligible,false,modified);
});
test('별칭은 명시적 정의가 있을 때만 해석하고 충돌을 차단',()=>{
 const text='을은 갑의 개인정보 관리 현황 점검에 협조한다.';
 assert.equal(R.evaluate(cp('PRIV-07'),docs(text)).eligible,true);
 assert.equal(R.evaluate(cp('PRIV-07'),docs(alias+text)).eligible,true);
 assert.equal(R.evaluate(cp('PRIV-07'),docs(alias+'갑이 개인정보 관리 현황을 점검하는 경우 을은 이에 협조해야 한다.')).eligible,true);
 assert.equal(D.bundle(cp('PRIV-07'),docs(inspection)).key,D.bundle(cp('PRIV-07'),docs(alias+text)).key);
 assert.equal(R.evaluate(cp('PRIV-07'),docs(alias+'위탁자(이하 “을”이라 한다).\n'+text)).eligible,false);
 assert.equal(R.evaluate(cp('PRIV-07'),docs(alias+'갑은 을의 개인정보 관리 현황 점검에 협조한다.')).eligible,false);
});
test('같은 조항의 독립된 다만 의무는 분리하되 관련 면제·추가 조건은 유지',()=>{
 const base='제1조(정보보호)\n'+inspection;
 assert.equal(R.evaluate(cp('PRIV-07'),docs(base+'\n다만 수탁자는 제공받은 개인신용정보의 식별정보를 암호화한다.')).eligible,true);
 assert.equal(R.evaluate(cp('PRIV-07'),docs(base+'\n다만 상대방이 요청한 경우에만 협조한다.')).eligible,true,'점검 요청에 따른 협조는 질문을 충족');
 for(const tail of ['다만 수탁자는 점검에 협조할 의무가 없다.','다만 모든 의무는 상호 협의로 면제한다.','다만 수탁자는 개인정보 관리 현황 점검에 선택적으로 협조한다.'])assert.equal(R.evaluate(cp('PRIV-07'),docs(base+'\n'+tail)).eligible,false,tail);
});
test('추가 숫자·부정·주체 변경을 어순 정규화에서 버리지 않는다',()=>{
 assert.equal(R.evaluate(cp('PRIV-07'),docs(inspection.replace('협조한다','월 1회만 협조한다'))).eligible,true,'현행 질문은 무제한 점검권을 필수로 요구하지 않음');
 for(const text of [inspection.replace('협조한다','협조하지 않는다'),inspection.replace('수탁자는 위탁자의','위탁자는 수탁자의'),inspection.replace('협조한다','협조한 것으로 기록한다')])assert.equal(R.evaluate(cp('PRIV-07'),docs(text)).eligible,false,text);
 const a=Q.key('수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.');
 assert.notEqual(a,Q.key('수탁자는 위탁자의 사전 동의 없이 재위탁할 수 없다.'));
});
test('등록 표준도 명시 별칭·조건 어순을 같은 의미로 비교',()=>{
 const t=Register.process('점검표준','1',inspection,{type_ids:['outsourcing'],roles:[],stance:'party'},checks),lib={format:L.VERSION,templates:[t]};
 for(const text of [alias+'을은 갑의 개인정보 관리 현황 점검에 협조한다.','위탁자가 개인정보 관리 현황을 점검하는 경우 수탁자는 이에 협조해야 한다.'])assert.equal(L.evaluate(lib,cp('PRIV-07'),item,{current:true,scope,documents:docs(text)}).eligible,true,text);
});
test('코퍼스 판정과 태그 원본 ID를 원문 지문으로 연결하여 실제 자동판정에 사용',()=>{
 const f=fixture(),i=P.prepare(f.input),r=S.evaluate(cp('CNS-SECRET'),item,i);
 assert.equal(r.status,'supported');assert.deepEqual(r.history,[]);
 assert.equal(i.judgment_sources.stats.hydrated_judgments,1);assert.equal(i.judgment_sources.stats.linked_tag_documents,1);assert.equal(i.judgment_sources.stats.unbound_judgments,0);
 assert.deepEqual(f.packet.verdicts,{}); // 원본 자료를 수정하지 않음
});
test('계약 해시가 다른 수집본도 안정된 검토 ID + 동일 원문·맥락으로 연결',()=>{
 const f=fixture();f.packet.contract_hash='OTHER';assert.equal(S.evaluate(cp('CNS-SECRET'),item,P.prepare(f.input)).eligible,true);
 f.input.exclude_contract_hashes=['H'];assert.equal(P.lookup(cp('CNS-SECRET'),P.prepare(f.input)).eligible,false);
});
test('원문·별첨·질문·맥락 중 하나라도 다르면 제목·태그가 같아도 판정을 복원하지 않음',()=>{
 for(const mutate of [f=>f.packet.documents[0].text+='\n별첨의무는 면제한다.',f=>f.packet.context={...scope,roles:['수탁자']},f=>f.packet.checks=[{...cp('CNS-SECRET'),check:'다른 질문'}],f=>delete f.corpus.judgment_ledger.records.H.snapshot.comparison_context]){
  const f=fixture();mutate(f);assert.equal(P.lookup(cp('CNS-SECRET'),P.prepare(f.input)).eligible,false);
 }
 const f=fixture();f.input.review_packets=[];const r=P.prepare(f.input);assert.equal(r.judgment_sources.stats.reference_only_documents,1);assert.equal(P.lookup(cp('CNS-SECRET'),r).eligible,false);
});
test('최신 수동 수정·위험수용·보류·미래·제외 출처를 반영하고 자동출력 재학습을 차단',()=>{
 for(const verdict of [{origin:'manual',verdict:'검토의견',comment:'보완'}, {...safe,reason:'수용 가능한 위험'}]){
  const f=fixture();f.packet.verdicts={'CNS-SECRET':safe};f.corpus.judgment_ledger.records.H.snapshot.verdicts['CNS-SECRET']=verdict;
  assert.equal(S.evaluate(cp('CNS-SECRET'),item,P.prepare(f.input)).status,'supported');
 }
 for(const mutate of [f=>f.corpus.judgment_ledger.records.H.pending=true,f=>f.corpus.judgment_ledger.records.H.snapshot.meta.date='2026-09-17',f=>f.corpus.judgment_ledger.records.H.snapshot.verdicts['CNS-SECRET']={...safe,origin:'auto'},f=>f.corpus.judgment_ledger.records.H.snapshot.verdicts['CNS-SECRET']={...safe,needs_reconfirmation:true},f=>f.input.exclude_source_ids=['R']]){
  const f=fixture();mutate(f);assert.equal(P.lookup(cp('CNS-SECRET'),P.prepare(f.input)).eligible,false);
 }
});
test('같은 ID에 원문을 공유하는 복수 코퍼스가 있으면 임의로 한 정답을 고르지 않음',()=>{
 const f=fixture();f.packet.contract_hash='OTHER';f.corpus.judgment_ledger.records.SECOND=structuredClone(f.corpus.judgment_ledger.records.H);
 assert.equal(P.lookup(cp('CNS-SECRET'),P.prepare(f.input)).eligible,false);
});
test('병렬 의무와 분리 문장은 표준 및 과거 판단에서 같은 요소 묶음으로 비교',()=>{
 const first='수탁자는 제공받은 개인신용정보의 식별정보를 암호화한다.',second='수탁자는 개인정보의 안전한 처리를 위하여 기술적 및 관리적 보호조치를 실시한다.';
 const combined='제1조(정보보호)\n'+first.replace('한다.','하고 ')+second.replace('수탁자는 ','');
 const split='제1조(정보보호)\n'+first+'\n'+second;
 assert.equal(D.bundle(cp('PRIV-19'),docs(combined)).key,D.bundle(cp('PRIV-19'),docs(split)).key);
 const t=Register.process('병렬 표준','1',combined,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);
 for(const text of [combined,split])assert.equal(L.evaluate({format:L.VERSION,templates:[t]},cp('PRIV-19'),item,{current:true,scope,documents:docs(text)}).eligible,true);
});
test('전조·전항·명시 준용의 대상 원문을 함께 비교하되 중복·누락·외부 규정은 추정하지 않음',()=>{
 const c=cp('CNS-SECRET'),text='제1조(기간)\n유효기간은 3년으로 한다.\n제2조(비밀유지)\n비밀유지 의무의 기간에는 전조를 준용한다.';
 assert.equal(D.bundle(c,docs(text)).reusable,true);
 assert.notEqual(D.bundle(c,docs(text)).key,D.bundle(c,docs(text.replace('3년','1년'))).key);
 const numbered='제1조(비밀유지)\n① 비밀정보는 제3자에게 공개하지 않는다.\n② 전항의 의무는 종료 후 3년간 존속한다.';
 assert.equal(D.bundle(c,docs(numbered)).reusable,true);
 for(const broken of [text.replace('제1조(기간)','제9조(기간)'),text+'\n제1조(기간)\n유효기간은 1년이다.',numbered.replace('①',''),numbered.replace('전항','민법 제1조')]){
  assert.equal(D.bundle(c,docs(broken)).reusable,false,broken);
 }
 assert.equal(D.bundle(c,docs('제1조(비밀유지)\n다른 약정을 준용한다.')).reusable,false);
});
test('관찰 경로는 미리 색인된 과거 정답을 참조하지 않는다',()=>{
 const text='수탁자는 위탁자의 사전 동의 없이 재위탁할 수 없다.',check=cp('CORE-07');
 const packet={id:'P',documents:docs(text),context:scope,checks:[check],verdicts:{[check.id]:safe}};
 const input=P.prepare({confirmed:true,documents:docs(text),scope,review_packets:[packet]});
 const result=S.observe([check],[{...item,cpId:check.id}],input,{[check.id]:safe});
 assert.equal(result[check.id].version,S.VERSION);assert.ok(result[check.id].key);
});
test('가져온 검토 ID는 객체 속성 이름과 같아도 안전하게 색인',()=>{
 const f=fixture();f.packet.review_id='__proto__';f.corpus.judgment_ledger.records.H.snapshot.history_reference.review_id='__proto__';f.knowledge.documents.tag.original.review_id='__proto__';
 assert.equal(J.compile([f.packet],f.corpus,f.knowledge).stats.linked_tag_documents,1);
});
