// Synthetic security standard -> automatic binding -> real three-column UI.
// A disposable browser context isolates all user storage. No private fixture is embedded.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Register=require('../src/template_register');
const policies=require('../knowledge/judgment_policies.json').checks;
const ids=['PRIV-07','PRIV-21'],checks=ids.map(id=>{const p=policies.find(p=>p.id===id);return {id,check:p.question,meaning_revision:p.meaning_revision};});
const standard=['개인신용정보 보안관리약정서','제5조(재위탁 제한)','수탁자는 신용정보 처리 업무를 제3자에게 재위탁할 수 없다.','다만, 다음 각 호의 어느 하나에도 해당하지 않는 경우 수탁자는 위탁자의 사전 서면 승낙을 얻어 재위탁할 수 있다.','1. 관련 법령에서 해당 업무의 위탁을 금지하고 있는 경우','2. 정보주체에게 중대한 피해를 발생시킬 우려가 있는 경우','제10조(관리·감독)','수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.'].join('\n');
const body=['신용정보 처리 위탁계약서','제1조(업무)','위탁자는 고객 개인신용정보 처리 업무를 수탁자에게 위탁한다.','제2조(보안약정)','개인(신용)정보 보안관리약정서를 별첨한다.'].join('\n');
const old=Register.process('개인신용정보 보안관리약정서(일반)','2025.01',standard,{type_ids:['outsourcing'],roles:[]},checks);
old.registration.version=16;old.bindings=old.bindings.filter(b=>b.check_id!=='PRIV-21');
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9374';
const browser=await fetch(endpoint+'/json/version').then(r=>r.json()),ws=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0,sessionId,browserContextId;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.sessionId===sessionId&&m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={},session=sessionId){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){for(let n=0;n<100;n++){if(await run(`typeof TemplateLibraryRuntime!=='undefined'`))return;await new Promise(r=>setTimeout(r,50));}throw Error('startup');}
async function analyze(text){return run(`(async()=>{document.getElementById('contract-text').value=${JSON.stringify(text)};refreshInputSetup();document.getElementById('input-type').value='outsourcing';document.getElementById('input-type').dispatchEvent(new Event('change'));const result=await runAnalysis();if(result.status!=='completed')throw Error('analysis: '+JSON.stringify(result));return {modules:state.activeModules,verdicts:${JSON.stringify(ids)}.map(id=>({id,v:verdictStore[id],row:state.result.results.find(r=>r.cpId===id)}))};})()`);}
async function expectAuto(){return run(`(()=>{const ids=${JSON.stringify(ids)};for(const id of ids){if(verdictStore[id]?.verdict!=='이상없음'||verdictStore[id]?.origin!=='auto')throw Error('not auto: '+id+' '+JSON.stringify({v:verdictStore[id],s:SafetyRuntime.standardReport(),t:TemplateLibraryRuntime.report()}));if(pendingReviewItems().some(i=>i.id===id))throw Error('still pending: '+id);const cards=document.querySelectorAll('#clause-rows .vd-btn[data-vd="이상없음"][data-vcp="'+id+'"], #consider-block .vd-btn[data-vd="이상없음"][data-vcp="'+id+'"]');if(cards.length!==1||!cards[0].closest('.cr-reviewed'))throw Error('not unique column2: '+id+' '+cards.length);}if(document.querySelector('#action-queue-block')?.textContent.trim()||document.getElementById('clause-rows').textContent.includes('본문·부속서류 근거의 검토항목'))throw Error('separate section retained');return ids.map(id=>({id,origin:verdictStore[id].origin,proof:verdictStore[id].auto_proof?.evidence?.[0]?.document}));})()`);}
try{
 ({browserContextId}=await cdp('Target.createBrowserContext',{disposeOnDetach:true},null));
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank',browserContextId},null);
 ({sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true},null));
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();
 await run(`localStorage.setItem('cr-template-library-v1',${JSON.stringify(JSON.stringify({format:'template-library-v1',templates:[old]}))});location.reload();`);
 await new Promise(r=>setTimeout(r,300));await ready();
 await run(`{const t=TemplateLibraryRuntime.get().templates[0];if(t.registration.version!==17||!t.bindings.some(b=>b.check_id==='PRIV-21'))throw Error('existing standard not upgraded');}`);
 await analyze(body);const auto=await expectAuto();
 await run(`document.querySelector('.tab[data-tab="clauses"]').click();`);
 const layouts=[];
 for(const width of [1440,1000,700]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  const cells=await run(`Array.from(document.querySelector('#clause-rows [data-vcp="PRIV-07"]').closest('.clause-row').children).map(e=>({class:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth}))`);
  if(cells.length!==3||cells.some(c=>c.scrollWidth>c.width+2))throw Error('layout overflow '+JSON.stringify({width,cells}));layouts.push({width,cells});
 }
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await run(`document.querySelector('#clause-rows [data-vcp="PRIV-21"]').closest('.clause-row').scrollIntoView({block:'center'});`);
 await run(`Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))`);
 const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.CR_TEST_SCREENSHOT||'/private/tmp/cr-standard-fix.DAODoO/standard-review.png',Buffer.from(shot.data,'base64'));
 await run(`location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();await analyze(body);await expectAuto();
 await run(`applyVerdict('PRIV-07','검토의견','보존할 수기 의견','','manual');state.subDocs=[{name:'개인(신용)정보 보안관리약정서.docx',text:${JSON.stringify(standard+'\n제11조(특약)\n수탁자는 자유롭게 재위탁할 수 있다.')}}];`);
 await analyze(body);
 await run(`{if(verdictStore['PRIV-07']?.origin!=='manual'||verdictStore['PRIV-07'].comment!=='보존할 수기 의견')throw Error('manual lost');if(verdictStore['PRIV-21']?.verdict)throw Error('modified actual annex hidden by registered standard');const pending=pendingReviewItems().find(i=>i.id==='PRIV-21');if(!pending)throw Error('exception not pending');const card=document.querySelector('#clause-rows [data-vcp="PRIV-21"], #consider-block [data-vcp="PRIV-21"]');if(!card?.closest('.cr-opinions'))throw Error('exception not in column3');if(!card.closest('.check-item, .consider-item, .rv-item, .clause-row')?.textContent.includes('예외'))throw Error('exception reason missing');}`);
 await run(`state.subDocs=[];`);await analyze(body.replace('개인(신용)정보 보안관리약정서를 별첨한다.','보안관리는 별도로 협의한다.'));
 await run(`if(verdictStore['PRIV-21']?.verdict)throw Error('standard used without incorporation');`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));
 console.log(JSON.stringify({version:await run('CR.app_version'),auto,old_registration_upgraded:true,reload:true,manual_preserved:true,changed_annex_blocked:true,unlinked_not_auto:true,layouts,errors,external}));
}finally{if(browserContextId)await cdp('Target.disposeBrowserContext',{browserContextId},null).catch(()=>{});ws.close();}
