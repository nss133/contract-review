const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const Q=require('../src/clause_semantics'),R=require('../src/requirement_rules'),D=require('../src/decision_evidence'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register'),P=require('../src/human_precedent');
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],scope={type:'outsourcing',stance:'party',roles:['위탁자'],modules:[]},item={coverage:'addressed'};
const examples=[
 ['CORE-06','수탁자는 위탁업무를 처리할 때 금융실명법 등 관련 법령을 준수하여야 한다.'],
 ['CORE-10','수탁자는 위탁자의 업무 처리 현황 점검, 자료제출 요구 및 감사에 협조하여야 한다.'],
 ['CORE-10','수탁자는 감독당국의 변경권고 등 조치가 있는 경우 계약 변경 및 시정에 협조하여야 한다.'],
 ['ITCL-01','클라우드서비스제공자는 클라우드 이용업무의 중요도 평가에 필요한 자료 제공에 협조하여야 한다.'],
 ['ITCL-02','수탁자는 클라우드컴퓨팅서비스 제공자의 건전성·안전성 평가에 필요한 자료 제공에 협조하여야 한다.'],
 ['ITSEC-10','수탁자는 자신이 제공하는 서비스의 품질수준 연 1회 이상 평가에 협조하여야 한다.']
];
function template(text){return Register.process('등록 기준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);}
function evaluate(t,id,documents){return L.evaluate({format:L.VERSION,templates:[t]},cp(id),item,{current:true,scope,documents});}
for(const [id,text] of examples){
 test(id+' 직접 요건·구조화 근거·표준 자동 연결',()=>{
  const r=S.evaluate(cp(id),item,{confirmed:true,documents:docs(text)});assert.equal(r.eligible,true,JSON.stringify(r));assert.equal(r.policy.level,'presence');assert.ok(r.evidence.some(e=>text.includes(e.text)));
  const t=template(text);assert.ok(t.bindings.some(b=>b.check_id===id));assert.equal(evaluate(t,id,docs(text)).eligible,true);
  assert.equal(S.evaluate(cp(id),{coverage:'quiet'},{confirmed:true,documents:docs(text)}).eligible,true);
 });
 test(id+' 같은 태그의 부정·임의 조건·주체 반전·인용은 자동통과하지 않음',()=>{
  const negatives=[text.replace('하여야 한다','하지 않는다'),text.replace('하여야 한다','할 수 있다'),text.replace('하여야 한다','하기 위하여 노력한다'),text.replace('하여야 한다','하여야 한다고 예시한다'),'“'+text+'”',...(id==='CORE-06'?[]:[text.replace(/^(?:수탁자|클라우드서비스제공자)는/,'위탁자는')]),text.replace('하여야 한다','선택적으로 하여야 한다')];
  for(const value of negatives)assert.equal(S.evaluate(cp(id),item,{confirmed:true,documents:docs(value)}).eligible,false,value);
  assert.equal(S.evaluate({...cp(id),meaning_revision:'test-new-meaning',check:'바뀐 질문'},item,{confirmed:true,documents:docs(text)}).eligible,false);
  assert.equal(S.evaluate(cp(id),{...item,roleGated:true},{confirmed:true,documents:docs(text)}).eligible,false);
 });
}
test('감독·평가 협조 질문에 특정 반복주기와 모든 감독수단을 강제하지 않음',()=>{
 for(const [id,text] of [
  ['CORE-10',examples[1][1].replace(' 및 감사','')],['CORE-10',examples[2][1].replace(' 및 시정','')],
  ['ITCL-02',examples[4][1].replace('건전성·','')],['ITSEC-10',examples[5][1].replace('연 1회 이상','필요 시')],
  ['ITSEC-10',examples[5][1].replace('연 1회 이상','2년에 1회')]])assert.equal(R.evaluate(cp(id),docs(text)).eligible,true,text);
 assert.equal(R.evaluate(cp('ITSEC-10'),docs(examples[5][1].replace('1회','2회'))).eligible,true);
 assert.notEqual(Q.key(examples[5][1]),Q.key(examples[5][1].replace('1회','2회')));
 const right='위탁자는 수탁자의 업무 처리 현황을 점검하고 관련 자료의 제출을 요구하며 감사를 실시할 수 있다.';
 assert.equal(R.evaluate(cp('CORE-10'),docs(right)).eligible,true);
 assert.notEqual(Q.key(right),Q.key(examples[1][1]));
});
test('신규 요건도 별칭·정형 어순·단순 줄바꿈을 확인하고 최신 사람 보완 의견이 우선',()=>{
 const id='ITSEC-10',base=examples[5][1],alias='수탁자(이하 “을”이라 한다).\n';
 const text=alias+'을은 연 1회 이상 실시하는 자신이 제공하는 서비스의 품질수준 평가에 협조해야 한다.';
 assert.equal(R.evaluate(cp(id),docs(text)).eligible,true);assert.equal(D.bundle(cp(id),docs(base)).key,D.bundle(cp(id),docs(text)).key);
 assert.equal(R.evaluate(cp('ITCL-01'),docs(examples[3][1].replace('필요한 자료','필요한\n자료'))).eligible,true);
 const packet={id:'source',date:'2026-09-15',documents:docs(base),context:scope,checks:[cp(id)],verdicts:{[id]:{origin:'manual',verdict:'검토의견',comment:'반례'}}};
 const input=P.prepare({confirmed:true,documents:docs(text),scope,date:'2026-09-17',review_packets:[packet]});
 assert.equal(S.evaluate(cp(id),item,input).status,'supported');
});
test('계약 제목을 약정 조건으로 오인하지 않되 면제 제목·본문 속 문구는 무시하지 않음',()=>{
 const [id,text]=examples[3],normal='클라우드 이용 위탁계약서\n제1조(중요도 평가)\n'+text,t=template(normal);
 assert.equal(R.evaluate(cp(id),docs(normal)).eligible,true);assert.equal(evaluate(t,id,docs(normal)).eligible,true);
 assert.equal(R.evaluate(cp(id),docs(normal.replace('클라우드 이용 위탁계약서','클라우드 평가 의무 면제 계약서'))).eligible,true);
 assert.equal(R.evaluate(cp(id),docs(normal+'\n클라우드 평가 제외 약정서')).eligible,true);
 assert.equal(evaluate(t,id,docs(normal.replace('필요한 자료','필요한\n자료'))).eligible,true);
});
const source=['보안관리약정서','제1조(보호조치)','수탁자는 고객정보가 분실·도난·유출·변조 또는 훼손되지 아니하도록 다음 각 호의 안전성 확보에 필요한 기술적·관리적 및 물리적 조치를 하여야 한다.','고객정보에 대한 접근 통제 및 접근 권한의 제한 조치','제2조(운송)','인도 장소는 서울이다.'].join('\n');
test('표준 전문 대신 관련 조 전체가 있으면 다른 제목·무관 조항 변경·별첨 배치를 허용',()=>{
 const t=template(source),partial=source.split('\n').slice(1,4).join('\n');
 for(const input of [docs(source.replace('서울','부산')),docs('신규 업무 계약서\n'+partial),[{name:'본문',text:'제99조(운송)\n인도 장소는 부산이다.'},{name:'보호 특약',text:partial}]]){
  const r=evaluate(t,'PRIV-06',input);assert.equal(r.eligible,true,JSON.stringify(r));assert.ok(['exact','equivalent'].includes(r.kind));assert.ok(r.source_evidence.length);
 }
 assert.equal(evaluate(t,'PRIV-06',docs(partial.replace('제한 조치','확대 조치'))).eligible,true,'접근 통제 약정은 독립적으로 남아 있음');
 for(const text of [partial.replace('수탁자는','위탁자는'),partial.split('\n').slice(0,2).join('\n'),partial+'\n다만 접근 제한은 선택 사항이다.'])assert.equal(evaluate(t,'PRIV-06',docs(text)).eligible,false,text);
});
test('부분 표준 비교에서 다른 문서의 우선·예외·역참조 및 당사자 정의 변경을 놓치지 않음',()=>{
 const t=template(source),changed=source.replace('서울','부산');
 for(const extra of ['본 계약의 모든 의무를 면제한다.','본문 제1조의 조치는 적용하지 않는다.','개인정보 접근 제한 의무는 제외한다.','제100조(특약)\n본문 제1조의 의무는 면제한다.','수탁자란 위탁자를 의미한다.'])assert.equal(evaluate(t,'PRIV-06',[...docs(changed),{name:'추가 특약',text:extra}]).eligible,false,extra);
 const raw=source.replace('수탁자는','을은');
 const a='수탁자(이하 “을”이라 한다).\n',b='위탁자(이하 “을”이라 한다).\n';
 assert.notEqual(D.bundle(cp('PRIV-06'),docs(a+raw)).key,D.bundle(cp('PRIV-06'),docs(b+raw)).key);
 assert.notEqual(D.bundle(cp('PRIV-06'),docs('A회사(이하 “을”이라 한다).\n'+raw)).key,D.bundle(cp('PRIV-06'),docs('B회사(이하 “을”이라 한다).\n'+raw)).key);
});
test('번호가 명시된 항 참조는 유일한 대상 조 전체를 보존하고 누락·중복·재번호를 차단',()=>{
 const c=cp('CNS-SECRET'),text='제1조(비밀유지)\n① 비밀정보를 누설하여서는 안 된다.\n② 제1항의 의무는 계약 종료 후 3년간 존속한다.';
 assert.equal(D.bundle(c,docs(text)).reusable,true);
 for(const bad of [text.replace('①',''),text.replace('①','②'),text.replace('제1항','제3항'),text.replace('제1항','제1항부터 제3항')])assert.equal(D.bundle(c,docs(bad)).reusable,false,bad);
 const cross='제1조(기간)\n① 유효기간은 3년이다.\n제2조(비밀유지)\n비밀유지 의무는 제1조 제1항에 따른다.';
 assert.equal(D.bundle(c,docs(cross)).reusable,true);
 assert.equal(D.bundle(c,docs(cross.replace('①','②'))).reusable,false);
});
test('번호가 추출되지 않은 표준은 참조를 추정하지 않고 동일 조 전체 문맥을 보존',()=>{
 const local=source.replace('제2조(운송)','제2조(배상)\n을은 제1항 또는 제2항의 의무를 위반한 경우 이에 따른 민·형사상 일체의 책임을 부담하며, 갑에게 발생한 모든 손해를 배상하여야 한다.\n제3조(운송)');
 // 앞선 항의 본문이 없는 참조는 등록된 이름만으로 부분 비교를 허용하지 않음.
 assert.equal(evaluate(template(local),'PRIV-08',docs(local.replace('서울','부산'))).eligible,false);
});
test('같은 조항 집합이라도 전조·명시 참조가 가리키는 내용이 바뀌면 다른 근거',()=>{
 for(const ref of ['전조','제2조']){
  const a='제1조(비밀정보 기간)\n비밀정보의 보유기간은 3년이다.\n제2조(비밀유지 기간)\n비밀유지 기간은 1년이다.\n제3조(비밀유지 의무)\n비밀유지 의무는 '+ref+'를 준용한다.';
  const b=a.replace('비밀정보의 보유기간은 3년이다.','비밀유지 기간은 1년이다.').replace(/(제2조[^\n]+\n)비밀유지 기간은 1년이다./,'$1비밀정보의 보유기간은 3년이다.');
  assert.equal(D.bundle(cp('CNS-SECRET'),docs(a)).reusable,true);assert.equal(D.bundle(cp('CNS-SECRET'),docs(b)).reusable,true);
  assert.notEqual(D.bundle(cp('CNS-SECRET'),docs(a)).key,D.bundle(cp('CNS-SECRET'),docs(b)).key);
 }
});
test('외부 조문 번호는 임의 복원하지 않되 독립된 본건 보호조치를 전역 보류하지 않음',()=>{
 const withLaw=source.replace('고객정보에 대한 접근 통제 및 접근 권한의 제한 조치','고객정보에 대한 접근 통제 및 접근 권한의 제한 조치\n관련 조치는 시험법 제9조 제1항에 따른다.'),t=template(withLaw);
 assert.equal(D.bundle(cp('PRIV-06'),docs(withLaw)).reusable,false);
 assert.equal(evaluate(t,'PRIV-06',docs(withLaw.replace('서울','부산'))).eligible,true);
 assert.equal(evaluate(t,'PRIV-06',docs(withLaw.replace('서울','부산').replace('제9조','제8조'))).eligible,true);
 assert.equal(evaluate(t,'PRIV-06',docs(withLaw.replace('서울','부산').replace('시험법 제9조 제1항','제99조'))).eligible,true);
});
test('실제 표준 3종: 새 본문의 무관 조항을 추가해도 관련 근거를 재사용하고 변경 근거는 거부',()=>{
 const dir='samples/internal-standards/extracted';
 for(const f of fs.readdirSync(dir).filter(f=>f.startsWith('pii-agreements_'))){
  const text=fs.readFileSync(dir+'/'+f,'utf8'),t=template(text),changed='신규 위탁 계약서\n제99조(운송)\n인도 장소는 부산이다.\n'+text;
  for(const id of ['PRIV-03','PRIV-06','CMN-19']){const r=evaluate(t,id,docs(changed));assert.equal(r.eligible,true,f+':'+id+':'+r.reason);assert.ok(['exact','equivalent'].includes(r.kind));}
  assert.equal(evaluate(t,'PRIV-06',docs(changed+'\n제100조(보호조치 예외)\n접근 제한 조치는 적용하지 않는다.')).eligible,false);
 }
});
