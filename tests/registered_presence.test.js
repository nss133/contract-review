const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const S=require('../src/standard_auto'),R=require('../src/requirement_rules'),A=require('../src/agreement_evidence'),RP=require('../src/registered_presence'),Register=require('../src/template_register'),L=require('../src/template_library');
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],scope={type:'outsourcing',stance:'party',roles:['위탁자'],party:{companyLabel:'갑'}},item={coverage:'addressed'};
const newCases=[
 ['CNS-DAMAGE','수탁자는 위탁계약에 따른 의무를 위반하여 위탁자에게 발생한 손해를 배상하여야 한다.'],
 ['CORE-14','수탁자는 위탁업무와 관련하여 금융감독원장의 검사 및 자료제출 요구에 성실히 응하여야 한다.'],
 ['CMN-18','수탁자는 제3자의 지식재산권 침해 주장이 제기된 경우 위탁자를 방어하고 면책하여야 한다.'],
 ['CNS-DAMAGE','각 당사자는 비밀정보를 침해하여 상대방에게 발생한 손해를 배상하여야 한다.']
];
const synthetic=['보안관리약정서','제1조(보호조치)','“을”은 고객정보가 분실·도난·유출·변조 또는 훼손되지 아니하도록 다음 각 호의 안전성 확보에 필요한 기술적·관리적 및 물리적 조치를 하여야 한다.','고객정보에 대한 접근 통제 및 접근 권한의 제한 조치','제2조(관련 조건)','구체적인 조치는 해당 감독규정에 따른다.'].join('\n');
function standard(text=synthetic){return Register.process('시험표준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);}
function evaluate(t,id,documents){return L.evaluate({format:L.VERSION,templates:[t]},cp(id),item,{current:true,scope,documents});}
test('개인정보·비밀유지 배상은 통합 손해배상 질문에서 판정하고 제외항목은 제외',()=>{
 for(const [id,text]of newCases){const result=S.evaluate(cp(id),item,{confirmed:true,documents:docs(text)});assert.equal(result.eligible,true,JSON.stringify(result));assert.equal(result.policy.level,'presence');}
 for(const id of ['CRS-03','PRIV-08','NDA-15'])assert.equal(S.evaluate(cp(id),item,{confirmed:true,documents:docs(newCases[0][1])}).eligible,false,id);
});
test('신규 규칙도 질문 전체·방향·주체·미완성 문구를 확인',()=>{
 for(const [id,text]of newCases){
  assert.equal(S.evaluate({...cp(id),meaning_revision:'changed-meaning',check:'변경된 질문'},item,{confirmed:true,documents:docs(text)}).eligible,false);
 }
 assert.equal(R.evaluate(cp('CMN-18'),docs(newCases[2][1].replace('방어하고 ',''))).eligible,false);
 assert.equal(R.evaluate(cp('CORE-14'),docs(newCases[1][1].replace('수탁자는','위탁자는'))).eligible,true);
 assert.equal(R.evaluate(cp('CORE-14'),docs(newCases[1][1]+'\n다만, 위 검사 및 자료제출 요구에는 응하지 않는다.')).eligible,false);
 assert.equal(R.evaluate(cp('CNS-DAMAGE'),docs('갑만 귀책사유와 관계없이 을에게 발생한 모든 손해를 배상하며 을은 어떠한 책임도 부담하지 않는다.')).eligible,false);
});
test('접근제한 질문에 최소범위를 추가로 강제하지 않는다',()=>{
 assert.equal(R.evaluate(cp('PRIV-06'),docs('수탁자는 개인정보에 대한 접근권한을 제한하여야 한다.')).eligible,true);
 assert.equal(R.evaluate(cp('PRIV-06'),docs('수탁자는 개인정보에 대한 접근권한을 제한하지 않는다.')).eligible,false);
});
test('줄바꿈은 문장 안에서만 복구하고 원문 인용을 그대로 유지',()=>{
 const text='제1조(자료제출)\n수탁자는 위탁업무와 관련하여 금융감독원장의 검사 및\n  자료제출 요구에 성실히 응하여야 한다.';
 const r=R.evaluate(cp('CORE-14'),docs(text));assert.equal(r.eligible,true);assert.ok(r.evidence.every(e=>text.includes(e.text)));
 assert.equal(R.evaluate(cp('CORE-14'),docs(text.replace('\n  자료제출','\n제2조(다른 의무)\n자료제출'))).eligible,false);
 const rows=A.units(docs('담당자: ____\n'+newCases[0][1]));assert.equal(rows.length,2);
 assert.equal(S.evaluate(cp('CORE-14'),{coverage:'quiet'},{confirmed:true,documents:docs(newCases[1][1].replace('금융감독원장','금융감독\n원장').replace('검사','검\n사').replace('자료제출','자료\n제출'))}).eligible,true);
});
test('문장 복구는 동일 입력에서 재사용하되 본문·이름·문서 추가 시 갱신',()=>{
 const input=docs(newCases[0][1]),first=A.units(input);assert.equal(A.units(input),first);
 input[0].text+='\n추가 문장';assert.notEqual(A.units(input),first);
 const second=A.units(input);input[0].name='수정 파일';assert.notEqual(A.units(input),second);assert.equal(A.units(input)[0].document,'수정 파일');
 input.push({name:'별첨',text:'제1조(특약)\n본 계약의 모든 의무를 면제한다.'});assert.ok(A.units(input).some(s=>s.document==='별첨'));
});
test('특정 항 위반의 손해배상 문장을 모든 질문의 전역 예외로 취급하지 않는다',()=>{
 const penalty='제1조(배상)\n을은 제1항 또는 제2항의 의무를 위반한 경우 이에 따른 민·형사상 일체의 책임을 부담하며, 갑에게 발생한 모든 손해를 배상하여야 한다.';
 const input=penalty+'\n제2조(점검)\n수탁자는 위탁자의 개인정보 관리 현황 점검에 협조한다.';
 assert.equal(R.evaluate(cp('PRIV-07'),docs(input)).eligible,true);
 assert.equal(R.evaluate(cp('PRIV-07'),docs(input+'\n제3조(특약)\n본 계약의 모든 의무를 면제한다.')).eligible,false);
});
test('표준 전체 경로는 나열식 보호조치·접근통제를 별도 승인 없이 연결',()=>{
 const t=standard();for(const id of ['PRIV-03','PRIV-06']){assert.ok(t.bindings.find(b=>b.check_id===id));assert.equal(evaluate(t,id,docs(synthetic)).eligible,true);}
 assert.equal(t.registration.version,Register.VERSION);
});
test('표준의 해당 질문 내용을 확인하고 무관한 조항 미복제는 허용',()=>{
 const t=standard();
 for(const documents of [docs(synthetic.replace('접근 통제 및 접근 권한의 제한 조치','접근 통제 및 접근 권한 제한을 하지 않는다.')),[...docs(synthetic),{name:'우선특약',text:'본 계약의 모든 의무를 배제한다.'}],[...docs(synthetic),{name:'예외',text:'접근권한 제한 의무는 적용하지 않는다.'}]])assert.equal(evaluate(t,'PRIV-06',documents).eligible,false);
 assert.equal(evaluate(t,'PRIV-06',docs(synthetic.replace('“을”은','“갑”은'))).eligible,true);
 const partyDefinitions='위탁자(이하 “갑”이라 한다).\n수탁자(이하 “을”이라 한다).\n';
 const defined=synthetic.replace('제1조(보호조치)',partyDefinitions+'제1조(보호조치)');
 assert.equal(evaluate(t,'PRIV-06',docs(defined)).eligible,true);
 assert.equal(evaluate(t,'PRIV-06',docs(defined.replace('“을”은','“갑”은'))).eligible,false);
 assert.equal(evaluate(t,'PRIV-06',docs(synthetic.split('\n').slice(0,4).join('\n'))).eligible,true);
 assert.equal(evaluate(t,'PRIV-06',[{name:'본문',text:'제1조(운송)\n인도 장소는 서울이다.'},{name:'약정서',text:synthetic}]).eligible,true);
 assert.equal(evaluate(t,'PRIV-06',[{name:'본문',text:'개인정보 보호에 관한 사항은 별첨 보안관리약정서에 따른다.'},{name:'약정서',text:synthetic}]).eligible,true);
});
test('등록 단계에서도 의무 면제·미입력 의무·변경 질문은 연결하지 않는다',()=>{
 assert.equal(RP.link(cp('PRIV-06'),synthetic+'\n제3조(특약)\n접근 제한 의무를 면제한다.'),null);
 assert.equal(RP.link(cp('PRIV-03'),synthetic+'\n기술적·관리적 보호조치 의무는 적용하지 않는다.'),null);
 assert.equal(RP.link({...cp('PRIV-03'),meaning_revision:'changed-meaning',check:'다른 질문'},synthetic),null);
 assert.equal(RP.link(cp('PRIV-03'),synthetic.replace('기술적·관리적','기술적·____')),null);
});
test('문서 전체 일치는 줄바꿈·띄어쓰기만 달라도 유지하고 숫자·조건은 유지',()=>{
 const t=standard();assert.equal(evaluate(t,'PRIV-06',docs(synthetic.replaceAll('고객정보','고객\n정보'))).eligible,true);
 assert.equal(evaluate(t,'PRIV-06',docs(synthetic.replace('다음 각 호','다음 1개 호'))).eligible,true);
});
test('협의 불성립 후 관할 지정은 순차 절차로 인식하고 중재 선택·추가 예외는 구별',()=>{
 const text='본 계약에서 발생하는 분쟁은 우선 당사자 간 협의로 해결하며, 합의가 이루어지지 않는 경우에는 서울중앙지방법원을 제1심 관할법원으로 한다.';
 assert.equal(S.evaluate(cp('CMN-19'),item,{confirmed:true,documents:docs(text)}).eligible,true);
 assert.equal(S.evaluate(cp('CMN-19'),item,{confirmed:true,documents:docs(text+'\n다만, 당사자는 임의로 다른 법원을 선택할 수 있다.')}).eligible,true);
 assert.equal(S.evaluate(cp('CMN-19'),item,{confirmed:true,documents:docs(text+'\n위 관할 지정은 적용하지 않으며 관할 법원은 추후 정한다.')}).eligible,false);
 assert.equal(S.evaluate(cp('CMN-19'),item,{confirmed:true,documents:docs(text.replace('제1심 관할법원으로 한다','또는 대한상사중재원을 선택할 수 있다'))}).eligible,true);
});
test('기존 실제 보안관리약정서 3종을 등록했을 때 연결·판정하고 변경 별첨은 차단',()=>{
 // 회사 권리 귀속을 묻는 CNS-IP는 실제 자료의 회사=갑 지위를 입력한다.
 // 다른 존재 질문을 위해 갑·을 완전 복원을 보편 요구하는 것은 아니다.
 const dir='samples/internal-standards/extracted',files=fs.readdirSync(dir).filter(f=>f.startsWith('pii-agreements_'));assert.equal(files.length,3);
 for(const file of files){const text=fs.readFileSync(dir+'/'+file,'utf8'),t=standard(text),ids=t.bindings.map(b=>b.check_id);
  assert.ok(ids.includes('PRIV-03')&&ids.includes('PRIV-06')&&ids.includes('CNS-DAMAGE')&&ids.includes('CORE-14')&&ids.includes('CMN-19'),file+': '+ids);
  for(const id of ids){assert.equal(evaluate(t,id,docs(text)).eligible,true,id);assert.equal(evaluate(t,id,[...docs(text),{name:'특약',text:'본 계약의 모든 의무는 면제한다.'}]).eligible,false,id);}
 }
});
