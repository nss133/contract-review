import fs from 'node:fs';
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9359';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={}){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>300){clearInterval(t);no(Error('startup'));}},50);})`);}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();
 await run('localStorage.clear();location.reload();');await new Promise(r=>setTimeout(r,300));await ready();
 const dir=new URL('../samples/internal-standards/extracted/',import.meta.url),file=fs.readdirSync(dir).find(f=>f.startsWith('pii-agreements_')&&f.includes('(일반)'));
 await run('window.__standardSource='+JSON.stringify(fs.readFileSync(new URL(file,dir),'utf8')));
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};check(CR.app_version==='1.87.0','version');
 async function analyze(text){e('contract-text').value=text;refreshInputSetup();e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));check(!!state.result,'analysis');}
 function enable(mid){if(state.activeModules.includes(mid))return;
  if(mid==='X-FINOUT'){for(const [factor,value] of [['financial_business_purpose','yes'],['continuous_use','yes'],['simple_backoffice_exclusion','no']]){const el=document.querySelector('#input-screening [data-scope="financial_outsourcing"][data-factor="'+factor+'"]');if(el){el.value=value;el.dispatchEvent(new Event('change'));}else check(state.scopeAssessments.financial_outsourcing?.factors[factor]?.value===value,'scope factor '+factor);}check(state.activeModules.includes(mid),'scope module');return;}
  const el=document.querySelector('#input-screening [data-mid="'+mid+'"]');check(!!el,'module '+mid);el.click();}
 const rows=[
  ['CORE-06','수탁자는 위탁업무를 처리할 때 금융실명법 등 관련 법령을 준수하여야 한다.'],
  ['CORE-10','수탁자는 위탁자의 업무 처리 현황 점검, 자료제출 요구 및 감사에 협조하여야 한다.'],
  ['CORE-13','수탁자는 감독당국의 변경권고 등 조치가 있는 경우 계약 변경 및 시정에 협조하여야 한다.'],
  ['ITCL-01','수탁자는 클라우드 이용업무의 중요도 평가에 필요한 자료 제공에 협조하여야 한다.'],
  ['ITCL-02','수탁자는 클라우드컴퓨팅서비스 제공자의 건전성·안전성 평가에 필요한 자료 제공에 협조하여야 한다.'],
  ['ITSEC-10','수탁자는 자신이 제공하는 서비스의 품질수준 연 1회 이상 평가에 협조하여야 한다.']];
 const native='금융업무 및 클라우드 위탁계약서\n제1조(위탁업무)\n수탁자는 보험금 심사 업무를 매월 계속적으로 수행한다.\n'+rows.map((r,i)=>'제'+(i+2)+'조(검토항목 '+(i+1)+')\n'+r[1]).join('\n');
 await analyze(native);for(const m of ['X-FINOUT','X-CLOUD','X-EFIN'])enable(m);
 for(const [id] of rows){check(verdictStore[id]?.origin==='auto'&&verdictStore[id]?.verdict==='이상없음','native actual '+id+' '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'native second column '+id);}
 e('standard-auto-inspect').click();check(e('standard-auto-results').textContent.includes('평가 주기: 연 1회 이상'),'structured reason display');
 await analyze(native.replace('연 1회 이상','2년에 1회'));for(const m of ['X-FINOUT','X-CLOUD','X-EFIN'])enable(m);check(!verdictStore['ITSEC-10']?.verdict,'quality reduction not revoked');
 const changed='신규 개인정보 처리위탁 계약서\n제99조(운송)\n인도 장소는 부산이다.\n'+window.__standardSource;
 await analyze(changed);enable('X-PII');
 const extract=extractFileStructure;extractFileStructure=async()=>({text:window.__standardSource});
 try{const dt=new DataTransfer();dt.items.add(new File(['fixture'],'부분비교_보안관리약정서.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extract;}
 const completed=['PRIV-03','PRIV-06','PRIV-07','PRIV-08','CMN-19'];
 for(const id of completed){check(verdictStore[id]?.verdict==='이상없음'&&verdictStore[id]?.origin==='auto','scoped auto '+id);check(verdictStore[id].auto_proof.kind==='registered_clauses','not scoped proof '+id);check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'scoped second column '+id);}
 check(verdictStore['PRIV-06'].comment.includes('관련 조항·조건·참조 문맥 일치'),'proof label');
 state.subDocs.push({name:'예외 특약',text:'제100조(예외)\n개인정보 접근 제한 의무는 면제한다.'});runAnalysis();check(!verdictStore['PRIV-06']?.verdict,'scoped exception not revoked');
 state.subDocs=[];runAnalysis();check(verdictStore['PRIV-06']?.verdict==='이상없음','scoped restoration');
 const context=SafetyRuntime.comparisonContext();loopCorpus=Loop.emptyCorpus();loopCorpus.judgment_ledger={records:{test:{snapshot:{comparison_context:context,verdicts:{'PRIV-06':{origin:'manual',verdict:'검토의견',comment:'사용자 정정'}}}}}};
 applyAutoVerdicts();renderClauses();check(!verdictStore['PRIV-06']?.verdict,'latest correction bypass');loopCorpus=Loop.emptyCorpus();applyAutoVerdicts();renderClauses();
 applyVerdict('PRIV-06','검토의견','직접 작성한 의견','','manual');applyAutoVerdicts();check(verdictStore['PRIV-06'].origin==='manual'&&verdictStore['PRIV-06'].verdict==='검토의견','human overwritten');
 return {native:rows.map(r=>r[0]),scoped:completed,second_column:true,frequency_revoke:true,scoped_conflict_revoke:true,latest_correction:true,human_preserved:true};
 })()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,errors,external}));
}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
