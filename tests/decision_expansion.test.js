const {test}=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const D=require('../src/decision_evidence'),S=require('../src/standard_auto'),P=require('../src/human_precedent'),R=require('../src/requirement_rules');
const L=require('../src/template_library'),Register=require('../src/template_register'),Eval=require('../src/decision_evaluation'),Refs=require('../src/decision_references'),V=require('../src/verdict');
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],item={coverage:'addressed'},scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[],title:'기존 계약'};
const damage='당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.';
const secret='제1조(비밀유지)\n비밀정보는 상대방으로부터 제공받은 기술상 정보를 말한다.\n각 당사자는 비밀정보를 계약 수행 목적으로만 사용해야 한다.\n각 당사자는 상대방의 비밀정보를 제3자에게 공개해서는 안 된다.\n이미 공개된 정보는 비밀정보에서 제외한다.\n비밀유지 의무는 계약 종료 후 3년간 존속한다.';
function source(text=secret){return {id:'old',contract_hash:'OLD',documents:docs(text),context:scope,checks:[cp('CNS-SECRET')],verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'사용자 실제 판단을 모사한 시험'}},date:'2026-09-15'};}
function input(p,text=secret){return {confirmed:true,documents:docs(text),scope:{...scope,title:'새 계약'},review_packets:[p],date:'2026-09-17'};}
test('배상·면책 모두 책임 배분 존재로 읽고 구체적 편중 위험은 별도 시험',()=>{
 for(const ending of ['배상하여야 한다.','배상할 책임이 있다.','배상할 책임을 진다.','배상책임을 부담한다.'])assert.equal(S.evaluate(cp('CNS-DAMAGE'),item,{confirmed:true,documents:docs(damage.replace('배상하여야 한다.',ending))}).eligible,true,ending);
 assert.equal(S.evaluate(cp('CNS-DAMAGE'),item,{confirmed:true,documents:docs(damage.replace('배상하여야 한다','배상할 책임이 없다'))}).eligible,true);
});
test('사전 동의 질문에 없는 서면 조건은 추가로 강제하지 않으며 태그가 실제 요건 근거에 포함됨',()=>{
 for(const text of ['수탁자는 위탁자의 사전 동의 없이 재위탁할 수 없다.','수탁자는 업무를 재위탁하려면 위탁자의 동의를 미리 받아야 한다.']){
 const r=S.evaluate(cp('CORE-07'),item,{confirmed:true,documents:docs(text)});assert.equal(r.eligible,true,JSON.stringify(r));assert.ok(r.tag_evidence.some(e=>e.tags.some(t=>t.type==='content'&&t.check_id==='CORE-07')));
 }
});
test('태그가 동일하게 등장해도 허용·사후 통지·주체 뒤집기·인용은 통과하지 않음',()=>{
 for(const text of ['수탁자는 위탁자의 사전 동의 없이 재위탁할 수 있다.','수탁자는 재위탁 후 위탁자에게 사후 통지해야 한다.','위탁자는 수탁자의 사전 동의 없이 재위탁할 수 없다.','수탁자는 “위탁자의 사전 동의 없이 재위탁할 수 없다”는 조항을 삭제한다.'])assert.equal(S.evaluate(cp('CORE-07'),item,{confirmed:true,documents:docs(text)}).eligible,false,text);
});
test('같은 문장의 주체·대상·보호조치를 태그와 결합해 표현 변화 인식',()=>{
 for(const [id,text]of [['PRIV-03','수탁자는 개인정보의 안전한 처리를 위하여 기술적 및 관리적 보호조치를 실시한다.'],['PRIV-07','수탁자는 위탁자의 개인정보 관리 현황에 대한 점검에 협조한다.'],['PRIV-19','수탁자는 제공받은 개인신용정보의 식별정보를 암호화한다.']])assert.equal(R.evaluate(cp(id),docs(text)).eligible,true,text);
 for(const text of ['수탁자는 개인정보의 기술적 및 관리적 보호조치를 일부 실시한다.','수탁자는 위탁자가 개인정보의 기술적 및 관리적 보호조치를 실시해야 한다는 사실을 확인해야 한다.','수탁자는 개인정보의 기술적 및 관리적 보호조치를 취할 의무가 없으며 자료를 제출해야 한다.'])assert.equal(R.evaluate(cp('PRIV-03'),docs(text)).eligible,false,text);
 assert.equal(R.evaluate(cp('PRIV-07'),docs('수탁자는 위탁자의 개인정보 관리 현황 점검에 협조한 자료를 삭제해야 한다.')).eligible,false);
 assert.equal(R.evaluate(cp('PRIV-19'),docs('수탁자는 제공받은 개인신용정보의 식별정보를 암호화한 것으로 기록해야 한다.')).eligible,false);
});
test('제목·다른 조항·독립 별첨이 달라도 현재 약정을 직접 판정',()=>{
 const p=source();p.documents[0].text+='\n제2조(대금)\n대금은 100원이다.';
 const i=input(p,secret+'\n제2조(대금)\n대금은 200원이다.');i.documents.push({name:'연락처',text:'제1조(배송지)\n배송지는 서울이다.'});
 const r=S.evaluate(cp('CNS-SECRET'),item,P.prepare(i));assert.equal(r.status,'supported');assert.ok(r.evidence.some(e=>e.text.includes('비밀정보')));
});
test('기간·주체·별첨의 관련 예외가 바뀌면 원문 이력 재사용 불가',()=>{
 for(const mutate of [i=>i.documents[0].text=i.documents[0].text.replace('3년','1년'),i=>i.scope.roles=['수탁자'],i=>i.documents.push({name:'특약',text:'비밀유지 의무는 면제한다.'})]){const i=input(source());mutate(i);assert.equal(P.lookup(cp('CNS-SECRET'),i).eligible,false);}
});
test('조항 재사용도 최신 사용자 정정·보류·제외 출처를 따름',()=>{
 const p=source(),i=input(p);i.corpus={judgment_ledger:{records:{OLD:{snapshot:{verdicts:{'CNS-SECRET':{origin:'manual',verdict:'검토의견',comment:'기간 보완'}}}}}}};assert.equal(S.evaluate(cp('CNS-SECRET'),item,i).status,'supported');
 i.corpus.judgment_ledger.records.OLD.pending=true;assert.equal(P.lookup(cp('CNS-SECRET'),i).eligible,false);
 delete i.corpus;i.exclude_source_ids=['old'];assert.equal(P.lookup(cp('CNS-SECRET'),i).eligible,false);
});
test('명시 참조를 따라 관련 조항을 포함하고 대상이 없으면 재사용하지 않음',()=>{
 const c=cp('CNS-SECRET'),text=secret+'\n제2조(예외)\n제1조에 따른 의무의 기간은 1년이다.';
 assert.notEqual(D.bundle(c,docs(secret)).key,D.bundle(c,docs(text)).key);
 const b=D.bundle(c,docs(secret+'\n제1조(비밀유지)\n제99조에 따른다.'));assert.equal(b.reusable,false);
});
test('해지 약정은 30일 정형식 대신 현재 내용으로 직접·표준 동일 판정',()=>{
 const text='제1조(해지)\n당사자 일방이 본 계약상의 의무를 중대하게 위반한 경우 상대방은 14일의 기간을 정하여 서면으로 시정을 요구하고 그 기간 내에 시정하지 아니하면 서면 통지로 본 계약을 해지할 수 있다.';
 assert.equal(S.evaluate(cp('CNS-END'),item,{confirmed:true,documents:docs(text)}).eligible,true);
 const t=Register.process('해지 표준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);assert.ok(t.bindings.find(b=>b.check_id==='CNS-END')?.shared_judgment);
 const lib={format:L.VERSION,templates:[t]},i={current:true,scope,documents:docs(text+'\n제2조(지급)\n대금은 300원이다.')};assert.equal(L.evaluate(lib,cp('CNS-END'),item,i).eligible,true);
 i.documents=docs(text.replace('14일','3일'));assert.equal(L.evaluate(lib,cp('CNS-END'),item,i).eligible,true);
});
test('비밀 범위·사용/공개 제한을 확인하고 미기재 존속기간을 강제하지 않음',()=>{
 const t=Register.process('비밀유지 표준','1',secret,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);assert.ok(t.bindings.find(b=>b.check_id==='CNS-SECRET')?.shared_judgment);
 const partial=Register.process('불완전 표준','1',secret.split('\n').slice(0,-1).join('\n'),{type_ids:['outsourcing'],roles:[],stance:'party'},checks);assert.equal(partial.bindings.some(b=>b.check_id==='CNS-SECRET'),true);
});
test('태깅자료·법률검토 의견을 질문별 검색하되 점수만으로 정답 승격하지 않음',()=>{
 const k={documents:{a:{source_id:'A',title:'비밀유지 검토',source_kind:'legal_review',tags:[{label:'비밀정보'}],evidence:[{sentence:'비밀정보의 계약 목적 외 사용 금지 검토'}]}}};
 const result=Refs.retrieve(cp('CNS-SECRET'),docs(secret),k);assert.equal(result[0].source_id,'A');assert.equal(result[0].reference_only,true);assert.ok(result[0].tag_hits.length);
});
test('자동 계열 비교는 동일 출처·복사본과 미래 자료를 평가 검색에서 제외',()=>{
 const a=source(),b={...source(),id:'copy',contract_hash:'COPY',documents:docs(secret.replace('3년','5년'))},c={...source(),id:'other',contract_hash:'OTHER',date:'2026-09-10',documents:docs('제품 인도 장소와 인수 절차를 정한다.')};
 const p=[a,b,c],g=Eval.families(p);assert.equal(g[0],g[1]);assert.notEqual(g[0],g[2]);assert.deepEqual(Eval.sources(p,g,0).map(x=>x.id),['other']);
});
test('자동판정 완료는 수동 편집 핀과 무관하게 ②로 이동',()=>{assert.equal(V.reviewColumn({origin:'auto',verdict:'이상없음'},true),'done');assert.equal(V.reviewColumn({origin:'manual',verdict:'이상없음'},true),'needs');});
test('사용자 코퍼스 의견에도 주체·행위·조건 태그를 생성하되 의견을 자동 정답으로 승격하지 않음',()=>{
 const t=require('../src/loop').judgmentTags({origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.'});
 assert.ok(t.facets.actors.includes('trustee'));assert.ok(t.facets.actions.includes('subcontract'));assert.ok(t.facets.modalities.includes('prior_written_consent'));assert.equal(t.auto_approval,false);
});
