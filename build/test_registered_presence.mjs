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
 await run(`localStorage.clear();location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();
 const dir=new URL('../samples/internal-standards/extracted/',import.meta.url),filename=fs.readdirSync(dir).find(f=>f.startsWith('pii-agreements_')&&f.includes('(일반)'));
 const text=fs.readFileSync(new URL(filename,dir),'utf8');await run('window.__registeredFixture='+JSON.stringify(text));
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};check(CR.app_version==='1.87.0','version');
 async function analyze(text){e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));check(!!state.result,'analysis');}
 const native='개인정보 처리위탁 계약서\n제1조(업무)\n위탁자는 개인정보 처리 업무를 수탁자에게 위탁한다.\n제2조(책임)\n수탁자는 위탁계약에 따른 의무를 위반하여 위탁자에게 발생한 손해를 배상하여야 한다.';
 await analyze(native);if(!state.activeModules.includes('X-PII'))document.querySelector('#input-screening [data-mid="X-PII"]').click();
 check(verdictStore['PRIV-08']?.verdict==='이상없음'&&verdictStore['PRIV-08']?.origin==='auto','new native actual verdict');
 await analyze(window.__registeredFixture);if(!state.activeModules.includes('X-PII'))document.querySelector('#input-screening [data-mid="X-PII"]').click();
 const before=['PRIV-03','PRIV-06','PRIV-07','PRIV-08','CORE-14','CMN-19'].filter(id=>verdictStore[id]?.verdict==='이상없음');
 const extraction=extractFileStructure;extractFileStructure=async()=>({text:window.__registeredFixture});
 try{const dt=new DataTransfer();dt.items.add(new File(['fixture'],'보안관리약정서.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extraction;}
 const template=TemplateLibraryRuntime.get().templates.find(t=>t.name==='보안관리약정서.docx');check(!!template,'registration '+e('template-status').textContent);const bindings=template.bindings.map(b=>b.check_id);
 check(bindings.length===6,'real standard bindings '+bindings.join(','));
 const completed=bindings.filter(id=>verdictStore[id]?.verdict==='이상없음'&&verdictStore[id]?.origin==='auto');
 for(const id of ['PRIV-03','PRIV-06','PRIV-07','PRIV-08','CMN-19']){
  check(completed.includes(id),'actual registered verdict '+id+' '+JSON.stringify(TemplateLibraryRuntime.report().map(r=>({id:r.check_id,reason:r.result.reason}))));
  check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'second column '+id);
 }
 state.subDocs.push({name:'우선 특약',text:'본 계약의 모든 의무를 면제한다.'});runAnalysis();
 check(!verdictStore['PRIV-06']?.verdict,'annex override not revoked');
 state.subDocs=[];runAnalysis();check(verdictStore['PRIV-06']?.verdict==='이상없음','restoration');
 const context=SafetyRuntime.comparisonContext();loopCorpus=Loop.emptyCorpus();loopCorpus.judgment_ledger={records:{test:{snapshot:{comparison_context:context,verdicts:{'PRIV-06':{origin:'manual',verdict:'검토의견',comment:'정정 시험'}}}}}};
 applyAutoVerdicts();renderClauses();check(!verdictStore['PRIV-06']?.verdict,'registered source bypassed latest human conflict');
 loopCorpus=Loop.emptyCorpus();applyAutoVerdicts();renderClauses();
 // 구버전 자동 등록에서 연결이 없었던 자료를 재승인 없이 갱신.
 const saved=TemplateLibraryRuntime.get();saved.templates.forEach(t=>{t.registration.version=6;t.bindings=[];});localStorage.setItem('cr-template-library-v1',JSON.stringify(saved));
 window.__registeredResult={before,completed,bindings,new_native:true,second_column:true,annex_revoke:true,latest_correction_revokes:true};
 return window.__registeredResult;
 })()`);
 await run('location.reload()');await new Promise(r=>setTimeout(r,300));await ready();
 const migration=await run(`(()=>{const t=TemplateLibraryRuntime.get().templates.find(t=>t.name==='보안관리약정서.docx');if(t.registration.version!==15||t.bindings.length!==6)throw Error('automatic migration');return true;})()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,migration,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
