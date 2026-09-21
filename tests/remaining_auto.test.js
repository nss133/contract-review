const {test}=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const S=require('../src/standard_auto'),P=require('../src/human_precedent'),R=require('../src/requirement_rules'),J=require('../src/judgment_policy');
const checks=JSON.parse(execFileSync('python3',['-c',`import json,yaml,pathlib
p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))`],{encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:['X-PII'],title:'시험'};
const secret=cp('CNS-SECRET'),docs=[{name:'본문',text:'비밀정보란 상대방이 제공하는 기술상 또는 경영상의 정보를 말한다.\n비밀정보는 계약 수행 목적 범위에서만 사용한다.'}];
function packet(v={origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}){return {id:'P1',contract_hash:'OLD',context:scope,documents:structuredClone(docs),checks:[secret],verdicts:{[secret.id]:v},date:'2026-09-15'};}
function input(p=packet()){return {confirmed:true,documents:structuredClone(docs),scope:structuredClone(scope),review_packets:[p],date:'2026-09-16'};}
test('206개 현재 질문에 누락·질문 불일치 없는 판단 수준 지정',()=>{
 const rows=require('../knowledge/judgment_policies.json').checks;assert.equal(rows.length,206);assert.equal(new Set(rows.map(r=>r.id)).size,206);
 for(const c of checks)assert.notEqual(J.get(c).level,'unclassified',c.id);
 assert.equal(J.get({...secret,check:'표시 문구 변경'}).level,'presence');
 assert.equal(J.get({...secret,check:'의미 변경',meaning_revision:'new-meaning'}).level,'unclassified');assert.equal(J.get(cp('CMN-05')).level,'presence');assert.equal(J.get(secret).level,'presence');
});
test('현재 존재형 질문은 사용자 과거 충족 결론을 복사하지 않고 본건 독립판정',()=>{
 const r=S.evaluate(secret,{coverage:'quiet'},P.prepare(input()));assert.equal(r.status,'supported');assert.equal(r.eligible,true);assert.deepEqual(r.history,[]);
});
test('책임 방향·수치·별첨·회사 역할·질문 변경은 과거 정답 복사 금지',()=>{
 const mutations=[i=>i.documents[0].text+=' 다만, 개인정보는 제외한다.',i=>i.documents.push({name:'별첨',text:'기간은 30일이다.'}),i=>i.scope.roles=['수탁자'],i=>i.scope.stance='beneficiary',i=>i.review_packets[0].checks=[{...secret,check:'옛 질문'}]];
 for(const mutate of mutations){const i=input();mutate(i);assert.equal(P.lookup(secret,i).eligible,false);}
});
test('시스템 판정·위험수용·미래·자기 평가자료는 재사용 근거 아님',()=>{
 for(const v of [{origin:'auto',verdict:'이상없음',reason:'반영되어 있음'},{origin:'manual',verdict:'이상없음',reason:'수용 가능한 위험'},{origin:'manual',verdict:'이상없음',reason:'반영되어 있음',needs_reconfirmation:true}])assert.equal(P.lookup(secret,input(packet(v))).eligible,false);
 const i=input();i.review_packets[0].date='2027-01-01';assert.equal(P.lookup(secret,i).eligible,false);
 const j=input();j.exclude_contract_hashes=['OLD'];assert.equal(P.lookup(secret,j).eligible,false);
});
test('이력 충돌은 검색 단계에서 보존하되 현재 약정의 독립 확인을 일괄 보류하지 않음',()=>{
 const i=input();i.review_packets.push({...packet({origin:'manual',verdict:'검토의견',comment:'예외 보완'}),id:'P2'});assert.equal(S.evaluate(secret,{coverage:'addressed'},i).status,'supported');
 const j=input();j.corpus={judgment_ledger:{records:{}}};j.corpus.judgment_ledger.records.OLD={snapshot:{verdicts:{[secret.id]:{origin:'manual',verdict:'검토의견'}}}};assert.equal(P.lookup(secret,j).conflict,true);
 j.corpus.judgment_ledger.records.OLD.pending=true;assert.equal(P.lookup(secret,j).eligible,false);
});
test('표시 공백 차이는 재사용하고 최신 자동 결과는 사용자 정답을 덮지 않음',()=>{
 const i=input();i.documents[0].text=i.documents[0].text.replaceAll(' ','  ');assert.equal(P.lookup(secret,i).eligible,true);
 i.corpus={judgment_ledger:{records:{OLD:{snapshot:{verdicts:{[secret.id]:{origin:'auto',verdict:'이상없음'}}}}}}};assert.equal(P.lookup(secret,i).eligible,true);
});
const examples={
 'CORE-07':'수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.',
 'PRIV-06':'수탁자는 개인정보에 대한 접근권한을 업무 수행에 필요한 최소한의 범위로 제한하여야 한다.',
 'PRIV-07':'수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.',
 'PRIV-03':'수탁자는 개인정보 보호를 위하여 기술적·관리적 보호조치를 취하여야 한다.',
 'PRIV-19':'수탁자는 제공받은 개인신용정보의 식별정보를 암호화하여야 한다.',
 'CMN-20':'각 당사자는 상대방의 사전 서면 동의 없이 계약상 지위 및 권리·의무를 제3자에게 양도·이전하거나 담보로 제공할 수 없다.',
 'CMN-21':'본 계약은 당사자 간의 완전한 합의를 구성하며 본 계약에 관한 종전의 구두 또는 서면 합의를 대체한다.\n본 계약의 변경은 양 당사자의 서면 합의로만 할 수 있다.'
};
for(const [id,text]of Object.entries(examples))test(id+' 전체 질문 요건 충족은 표준서식 등록 없이 직접 자동판정',()=>{
 const p={confirmed:true,documents:[{name:'본문',text}]};const r=S.evaluate(cp(id),{coverage:'addressed'},p);assert.equal(r.eligible,true,JSON.stringify(r));
 p.documents[0].text+='\n다만, 위 의무는 면제한다.';assert.equal(S.evaluate(cp(id),{coverage:'addressed'},p).eligible,false);
});
test('완전합의만으로 서면변경까지 충족 처리하지 않음',()=>{assert.equal(R.evaluate(cp('CMN-21'),[{name:'본문',text:examples['CMN-21'].split('\n')[0]}]).eligible,false);});
test('동일 패턴의 과거 보완 이력만으로 현재 명시된 약정을 보류하지 않음',()=>{
 const c=cp('CORE-07'),i={confirmed:true,documents:[{name:'본문',text:examples['CORE-07']}],scope,date:'2026-09-16',contract_hash:'NEW'};
 const v={origin:'manual',verdict:'검토의견',comment:'동의 방식 보완'};
 const patterns=S.observe([c],[{cpId:c.id,coverage:'addressed'}],i,{[c.id]:v});assert.ok(patterns[c.id].key);
 i.corpus={judgment_ledger:{records:{OLD:{snapshot:{meta:{date:'2026-09-15'},verdicts:{[c.id]:v},standard_patterns:patterns}}}}};
 assert.equal(S.evaluate(c,{coverage:'addressed'},i).status,'supported');
});
