// 격리된 시험 브라우저에서만 실행한다. 사용자 원문이나 외부 네트워크를 사용하지 않는다.
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
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 check(CR.app_version==='1.87.0','version');
 async function analyze(text){e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));check(!!state.result,'analysis');}
 const text=['개인정보 처리위탁 계약서','제1조(개인정보 처리위탁)','위탁자는 고객 개인정보 처리 업무를 수탁자에게 위탁한다.','제2조(당사자)','위탁자(이하 “갑”이라 한다).','수탁자(이하 “을”이라 한다).','제3조(점검)','갑이 개인정보 관리 현황을 점검하는 경우 을은 이에 협조해야 한다.','제4조(보호조치)','을은 제공받은 개인신용정보의 식별정보를 암호화하고 개인정보의 안전한 처리를 위하여 기술적 및 관리적 보호조치를 실시한다.'].join('\n');
 await analyze(text);
 if(!state.activeModules.includes('X-PII'))document.querySelector('#input-screening [data-mid="X-PII"]').click();
 for(const id of ['PRIV-07','PRIV-03','PRIV-19']){
  check(verdictStore[id]?.origin==='auto'&&verdictStore[id]?.verdict==='이상없음','semantic actual verdict '+id+' '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));
  check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'second column '+id);
 }
 await analyze(text.replace('을은 이에 협조해야 한다.','을은 이에 협조할 의무가 없다.'));
 check(!verdictStore['PRIV-07']?.verdict,'changed obligation remained safe');
 const unique=Date.now(),secret='용역계약서\n제1조(비밀유지)\n비밀정보(시험 '+unique+')는 계약 수행 목적에 한하여 이용한다.';
 await analyze(secret);check(!verdictStore['CNS-SECRET']?.verdict,'unexpected initial secret truth');
 const packet=SafetyRuntime.standardPacket();packet.review_id='R-'+unique;packet.verdicts={};
 const cp=packet.checks.find(c=>c.id==='CNS-SECRET'),comparison=SafetyRuntime.comparisonContext();
 loopCorpus=Loop.emptyCorpus();loopCorpus.judgment_ledger={records:{[packet.contract_hash]:{snapshot:{meta:{date:verdictToday()},history_reference:{review_id:packet.review_id},comparison_context:comparison,verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'사용자 정답을 모사한 시험'}}}}}};
 await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[packet]});
 for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(p=>p.id===packet.id);n++)await new Promise(r=>setTimeout(r,30));
 await analyze(secret+'\n제9조(연락처)\n배송지는 서울이다.');
 const v=verdictStore['CNS-SECRET'];check(v?.auto_proof?.kind==='clause_reused','bound corpus not reused '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id==='CNS-SECRET')));
 check(v.auto_proof.history.some(h=>h.judgment_source?.kind==='bound_corpus'),'bound source provenance');
 e('standard-auto-inspect').click();check(e('standard-auto-summary').textContent.includes('누적 판정 복원 1항목'),'connection diagnostics');
 const evaluation=await StandardAutoArchive.run();check(evaluation.source_connections.hydrated_judgments===1&&evaluation.checked>=1,'hydrated evaluation labels');
 loopCorpus=JSON.parse(JSON.stringify(loopCorpus));loopCorpus.judgment_ledger.records[packet.contract_hash].snapshot.verdicts['CNS-SECRET']={origin:'manual',verdict:'검토의견',comment:'최신 정정 시험'};
 applyAutoVerdicts();renderClauses();renderReport();check(!verdictStore['CNS-SECRET']?.verdict,'latest correction not revoked');
 return {semantic_native:true,explicit_aliases:true,parallel_obligations:true,second_column:true,corpus_hydration:true,evaluation_hydration:true,diagnostics:true,latest_correction_revokes:true};
 })()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
