const {test}=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const Q=require('../src/clause_semantics'),R=require('../src/requirement_rules'),D=require('../src/decision_evidence'),S=require('../src/standard_auto'),P=require('../src/human_precedent'),L=require('../src/template_library'),Register=require('../src/template_register'),Profiles=require('../src/presence_profiles');
const cases=require('./fixtures/presence_completion.json');
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],item={coverage:'addressed'},scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]};
const textOf=clauses=>'제1조(약정)\n'+clauses.join('\n');
const active=id=>cp(id)?.active!==false&&cp(id)?.review_scope!=='execution_only';
function evaluate(id,clauses){return S.evaluate(cp(id),item,{confirmed:true,documents:docs((id==='SOL-05'?'보험모집 업무위탁계약\n':'')+textOf(clauses))});}
for(const c of cases.filter(c=>!active(c.id)))test(c.id+' 구 양성 문구가 있어도 제외·통합 ID는 부활하지 않음',()=>assert.equal(evaluate(c.id,c.clauses).eligible,false));
for(const c of cases.filter(c=>active(c.id))){
 test(c.id+' 현재 질문·전체 요건 충족·표준 자동연결',()=>{
  const r=evaluate(c.id,c.clauses);assert.equal(r.eligible,true,JSON.stringify(r));assert.equal(R.catalog[c.id].question,cp(c.id).check);
  assert.ok(r.elements.length>0,'현재 질문의 확인 요소를 제공');
  for(const clause of c.clauses)assert.ok(Q.parseAll(clause),clause);
  const current=(c.id==='SOL-05'?'보험모집 업무위탁계약\n':'')+textOf(c.clauses),t=Register.process('합성 기준','1',current,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);
  assert.ok(t.bindings.some(b=>b.check_id===c.id));assert.equal(L.evaluate({format:L.VERSION,templates:[t]},cp(c.id),item,{current:true,scope,documents:docs(current)}).eligible,true);
 });
 test(c.id+' 구성요건 누락·주체 변경·임의 조건·반대 방향·특약은 보류',()=>{
  for(let i=0;i<c.clauses.length;i++){
   const alternative=c.id==='ITDL-07'&&i>0||c.id==='SOL-05'||c.id==='FIN-SEC-02'&&i===0||c.id==='SH-GOV-04';
   assert.equal(evaluate(c.id,c.clauses.filter((_,j)=>j!==i)).eligible,alternative,'현행 필수·대체 요소 누락 '+i);
   for(const [changed,expected] of [[c.clauses[i].replace(/(?:은|는) /,'는 필요한 경우에만 '),c.id==='SP-DEL-05'],['검토메모 예시: “'+c.clauses[i]+'”',alternative]]){
    const a=c.clauses.slice();a[i]=changed;assert.equal(evaluate(c.id,a).eligible,expected,changed);
   }
  }
  assert.equal(evaluate(c.id,[...c.clauses,'다만 위 의무는 면제한다.']).eligible,false);
  assert.equal(evaluate(c.id,[...c.clauses,'제2조(특약)','제1조의 내용은 적용하지 않는다.']).eligible,false);
  assert.equal(S.evaluate({...cp(c.id),meaning_revision:'test-new-meaning',check:'개정된 질문'},item,{confirmed:true,documents:docs(textOf(c.clauses))}).eligible,false);
  assert.equal(S.evaluate(cp(c.id),{...item,roleGated:true},{confirmed:true,documents:docs(textOf(c.clauses))}).eligible,false);
 });
 test(c.id+' 과거 정답·정정으로 존재 확인을 대체하지 않고 현재 원문을 재판정',()=>{
  const text=(c.id==='SOL-05'?'보험모집 업무위탁계약\n':'')+textOf(c.clauses),p={id:'old',date:'2026-09-15',documents:docs(text),context:scope,checks:[cp(c.id)],verdicts:{[c.id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
  const input=()=>P.prepare({confirmed:true,documents:docs(text+'\n제2조(배송)\n배송지는 서울이다.'),scope,review_packets:[p],date:'2026-09-17'});
  assert.equal(S.evaluate(cp(c.id),item,input()).status,'supported');
  p.verdicts[c.id]={origin:'manual',verdict:'검토의견',comment:'정정'};assert.equal(S.evaluate(cp(c.id),item,input()).status,'supported');
 });
}
test('복수 요건은 같은 조의 병렬·분리 문장과 다른 조에 나뉜 명시적 의무에서도 충족',()=>{
 for(const id of ['ITDL-07','ITSEC-12','INV-MAN-03','SH-SHARE-08']){
  const c=cases.find(c=>c.id===id),compound=c.clauses.map((s,i)=>s.replace(i?/^[^ ]+(?:은|는) /:/^__none__/,'').replace(i<c.clauses.length-1?'하여야 한다.':'__none__','하고, ')).join('');
  const r=evaluate(id,[compound]);assert.equal(r.eligible,true,id+':'+JSON.stringify(r));
  assert.equal(D.bundle(cp(id),docs(textOf(c.clauses))).key,D.bundle(cp(id),docs(textOf([compound]))).key);
  const split=c.clauses.map((s,i)=>'제'+(i+1)+'조(요건 '+i+')\n'+s).join('\n');assert.equal(R.evaluate(cp(id),docs(split)).eligible,true);
 }
});
test('직접 규칙의 질문 집합은 현재 존재 질문 전체를 포함하되 분류만으로 승인하지 않음',()=>{
 const policies=require('../knowledge/judgment_policies.json').checks.filter(c=>c.active&&c.level==='presence');
 assert.equal(policies.length,62);assert.equal(cases.length,30);
 for(const p of policies){assert.equal((R.catalog[p.id]||S.catalog[p.id]).question,p.question);assert.equal(S.evaluate(cp(p.id),item,{confirmed:true,documents:docs('제1조(목적)\n서비스를 제공한다.')}).eligible,false,p.id);}
});
test('태그 일치가 필수 구성요건 누락을 대신하지 않음',()=>{
 const c=cases.find(c=>c.id==='ITDL-07');const source=c.clauses.slice(0,2).concat(['라이선스 위반 손해배상 책임은 추후 논의한다.']);
 assert.equal(evaluate(c.id,source).eligible,false);
 const r=R.evaluate(cp('PRIV-13'),docs(textOf(cases.find(c=>c.id==='PRIV-13').clauses.slice(0,1))));assert.equal(r.missing.length,1);assert.match(r.missing[0],/감독/);
});
test('정보수령자 관계 정의만으로는 목적 외 이용 금지를 충족하지 않음',()=>{
 const definition='정보수령자는 개인정보를 제공받는 자이다.',clauses=cases.find(c=>c.id==='ALL-PII-03').clauses;
 assert.equal(evaluate('ALL-PII-03',[definition]).eligible,false);
 assert.equal(evaluate('ALL-PII-03',[definition,...clauses]).eligible,true);
 assert.equal(evaluate('ALL-PII-03',[definition,...clauses,'정보수령자는 자체 목적의 이용은 제한받지 않는다.']).eligible,false);
 assert.equal(evaluate('ALL-PII-03',[definition.replace('자이다','자로서 자체 목적에 이용할 수 있다'),...clauses]).eligible,false);
});
test('같은 질문을 충족해도 신원조회·보증 및 금융위원회 예외 유무는 같은 선례로 바꾸지 않음',()=>{
 const c=cases.find(c=>c.id==='ITSEC-12'),other=[c.clauses[0].replace('신원조회를 실시','신원보증을 확보'),c.clauses[1]];
 assert.equal(evaluate(c.id,other).eligible,true);assert.notEqual(D.bundle(cp(c.id),docs(textOf(c.clauses))).key,D.bundle(cp(c.id),docs(textOf(other))).key);
 const base=cases.find(c=>c.id==='PRIV-21').clauses[0],except=base.replace('수탁자는 ','수탁자는 금융위원회가 인정한 경우를 제외하고 ');
 assert.equal(evaluate('PRIV-21',[except]).eligible,true);assert.notEqual(Q.key(base),Q.key(except));
 assert.equal(evaluate('PRIV-21',[except.replace('금융위원회','위탁자')]).eligible,false);
});
test('신규 주체의 명시적 별칭만 사용하며 이름의 일부를 주체 정의로 잘못 읽지 않음',()=>{
 for(const id of ['INV-MAN-01','SH-SHARE-08']){const c=cases.find(c=>c.id===id),actor=c.clauses[0].match(/^(.+?)(?:은|는) /)[1];
  const input=actor+'(이하 “갑”이라 한다).\n'+textOf(c.clauses.map(s=>s.replace(actor,'“갑”')));
  assert.equal(R.evaluate(cp(id),docs(input)).eligible,true,input);
  assert.equal(D.bundle(cp(id),docs(input)).key,D.bundle(cp(id),docs(textOf(c.clauses))).key);
 }
 assert.equal(Q.aliases(docs('원수탁자(이하 “을”이라 한다).')).map.을,undefined);
 assert.equal(Q.aliases(docs('주식회사(이하 “갑”이라 한다).')).map.갑,undefined);
});
test('신규 중요 조건·요건의 축소는 자동판정되지 않음',()=>{
 const changes={
  'ITCL-05':['3개월','4개월'],'ITCL-06':['발생하기 전에','발생한 후에'],'ITSEC-11':['사전 동의','사후 동의'],
  'ITSEC-14':['따라서만','관계없이'],'ITSEC-15':['위탁회사 전산실 내','재수탁업자 전산실 내'],
  'SOL-03':['자신의','위탁자의'],'ALL-PII-03':['초과하여','범위에서'],'FIN-SEC-01':['질권자에게','제3자에게'],
  'INV-BEN-04':['수익자에게','회사에게'],'INV-BEN-07':['전체 투자자','일부 투자자'],
  'SP-DEL-04':['발주자의 귀책사유','수급인의 귀책사유'],'SP-DEL-05':['상당한 기간을 정하여','임의로'],
  'SP-DEL-06':['또는 보수와 함께',''],'SP-DEL-07':['달성할 수 없는','달성할 수 있는'],
  'SH-SHARE-06':['동일한 조건','불리한 조건']};
 for(const [id,[a,b]] of Object.entries(changes)){const c=cases.find(c=>c.id===id);assert.equal(evaluate(id,c.clauses.map(s=>s.replace(a,b))).eligible,['ITCL-05','SP-DEL-05'].includes(id),id);}
});
test('모든 신규 주체의 단순 줄바꿈 복구는 원문을 남기고 새 주체·항 번호는 합치지 않음',()=>{
 for(const c of cases.filter(c=>active(c.id))){const broken=c.clauses.map(s=>s.replace(/ (?=[^ ]+하여야 한다\.$)/,'\n'));
  assert.equal(evaluate(c.id,broken).eligible,true,c.id);
 }
 const A=require('../src/agreement_evidence');
 assert.equal(A.units(docs('제1조(운용)\n① 투자일임업자는 선량한 관리자의 주의로 일임재산을\n운용하여야 한다.')).length,2);
 assert.equal(A.units(docs('제1조(운용)\n투자일임업자는 일임재산을\n회사는 선량한 관리자의 주의로 운용하여야 한다.')).length,3);
 assert.equal(A.units(docs('제1조(운용)\n투자일임업자는 일임재산을\n② 고유재산과 분리하여 보관하여야 한다.')).length,3);
});
test('정형 이력의 패턴 지문은 조건·수치·방법을 구별하고 동일 조건 정정만 차단',()=>{
 const id='ITSEC-12',c=cases.find(c=>c.id===id),oldInput={confirmed:true,scope,date:'2026-09-15',documents:docs(textOf(c.clauses))},verdicts={[id]:{origin:'manual',verdict:'검토의견',comment:'신원조회 기준 보완'}};
 const patterns=S.observe([cp(id)],[{...item,cpId:id}],oldInput,verdicts),corpus={judgment_ledger:{records:{old:{snapshot:{meta:{date:'2026-09-15'},verdicts,standard_patterns:patterns}}}}};
 const same=S.evaluate(cp(id),item,{...oldInput,date:'2026-09-17',corpus});assert.equal(same.status,'supported');
 const other=S.evaluate(cp(id),item,{...oldInput,date:'2026-09-17',corpus,documents:docs(textOf(c.clauses.map(s=>s.replace('신원조회를 실시','신원보증을 확보'))))});assert.equal(other.eligible,true);
 const m=cases.find(c=>c.id==='ITSEC-14').clauses[0],n=m.replace('위탁회사와','위탁회사 또는 ');
 assert.equal(evaluate('ITSEC-14',[n]).eligible,true);assert.notEqual(Q.key(m),Q.key(n));
 const example='수탁자는 자신이 제공하는 서비스의 품질수준 연 1회 이상 평가에 협조하여야 한다.';
 const a=S.evaluate(cp('ITSEC-10'),item,{confirmed:true,documents:docs(example)}),b=S.evaluate(cp('ITSEC-10'),item,{confirmed:true,documents:docs(example.replace('1회','2회'))});
 assert.notEqual(a.pattern_key,b.pattern_key);
});
