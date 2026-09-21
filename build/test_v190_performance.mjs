/* v1.90 acceptance: actual Analyze button, isolated browser stores, synthetic data. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createFixture,installRuntime,hash} from './benchmark_v189_runtime.mjs';
const require=createRequire(import.meta.url);

// Verbatim data construction from the freeze reproduction, not 14 identical
// pieces of evidence repeated across every document. No private corpus is read.
export function createDiverseFixture(){
  const payload=createFixture({repeat:4,tagDocuments:500,corpusContracts:29});
  const seeds=['손해배상 책임 범위를 정하여 발생한 손해를 배상한다','관할 법원은 서울중앙지방법원으로 지정한다','비밀정보는 계약 종료 후에도 외부로 누설하여서는 아니 된다','수탁자는 개인정보를 위탁 목적 외로 이용하여서는 아니 된다','수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다','계약대금은 매월 지급하며 부가가치세는 별도로 한다','계약 위반 시 서면 통지 후 해지할 수 있다'];
  Object.values(payload.knowledge.documents).forEach((d,i)=>{
    d.evidence=Array.from({length:52},(_,j)=>({source:'합성 검토의견',sentence:`${seeds[j%seeds.length]}. 합성 검토번호 ${i}-${j}와 개별 업무범위 ${String.fromCharCode(0xac00+i%11172)}${String.fromCharCode(0xac00+j%11172)}의 관련 조건 및 절차를 약정에 반영하여 정한 것으로 확인함.`,tag_id:'synthetic-topic-'+(j%14),evidence_kind:'review_opinion'}));
    d.tags=Array.from({length:52},(_,j)=>({type:'쟁점',tag_id:'synthetic-topic-'+(j%14),label:seeds[j%seeds.length].split(' ')[0]}));
  });
  assert.equal(payload.text.length,2821);
  return payload;
}
export const fixtureScale=payload=>({...payload.scale,evidence_rows:26000,unique_evidence_sentences:26000,evidence_per_document:52,tag_assignments_per_document:52,unique_tag_definitions:14,corpus_contracts:29});

export async function connect190(){
  const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9372';
  assert.match(endpoint,/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/,'Dedicated localhost CDP only');
  const browser=await fetch(endpoint+'/json/version').then(r=>{assert(r.ok);return r.json();});
  const ws=new WebSocket(browser.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
  let sequence=0,closing=false;const pending=new Map(),sessions=new Map(),contexts=[],files=[],dirs=[],hashes=new Map();
  function send(method,params={},sessionId){return new Promise((ok,no)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(Error('CDP timeout '+method));},90000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  ws.onmessage=async event=>{
    const m=JSON.parse(event.data),e=sessions.get(m.sessionId);
    if(e&&m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;e.errors.push({text:d.text,description:d.exception?.description,line:d.lineNumber});}
    if(e&&m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')e.console_errors.push(m.params.args.map(a=>a.value??a.description));
    if(e&&m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))e.external.push(m.params.request.url);
    if(e&&m.method==='Network.webSocketCreated')e.external.push(m.params.url);
    if(e&&m.method==='Page.loadEventFired')for(const done of e.loads.splice(0))done();
    if(e&&m.method==='Target.attachedToTarget'){
      const {sessionId,targetInfo}=m.params;sessions.set(sessionId,e);const worker={id:targetInfo.targetId,url:targetInfo.url,type:targetInfo.type,cpu_throttle_applied:false,ready:false};e.workers.push(worker);
      try{await send('Network.enable',{},sessionId);await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']},sessionId);await send('Runtime.enable',{},sessionId);
        try{await send('Emulation.setCPUThrottlingRate',{rate:e.cpu},sessionId);worker.cpu_throttle_applied=true;}catch(error){worker.cpu_throttle_error=String(error);}
      }catch(error){e.worker_setup_errors.push(String(error));}finally{await send('Runtime.runIfWaitingForDebugger',{},sessionId).then(()=>{worker.ready=true;}).catch(()=>{});}
    }
    const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(m.error.message)):p.ok(m.result);}
  };
  async function run(e,expression){const out=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},e.sessionId);if(out.exceptionDetails)throw Error(e.label+': '+JSON.stringify(out.exceptionDetails));return out.result.value;}
  async function ready(e){await run(e,"new Promise((ok,no)=>{let count=0;const timer=setInterval(()=>{if(typeof runAnalysis==='function'&&typeof TemplateLibraryRuntime!=='undefined'&&typeof legalOpinionKnowledge!=='undefined'&&legalOpinionKnowledge&&typeof reviewHistory!=='undefined'&&reviewHistory){clearInterval(timer);ok();}else if(++count>400){clearInterval(timer);no(Error('startup timeout'));}},50);})");}
  function loaded(e){return new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error(e.label+' page load timeout')),30000);e.loads.push(()=>{clearTimeout(timer);ok();});});}
  async function reload(e){const done=loaded(e);await send('Page.reload',{},e.sessionId);await done;await ready(e);}
  async function page(release,label,{cpu=4,workerUnavailable=false}={}){
    let html,url,expected;
    if(release==='baseline'||release==='baseline1902'){
      const version=release==='baseline'?'1.89.0':'1.90.2';
      const update=JSON.parse(await readFile(new URL('../dist/contract-review-v'+version+'.crupdate',import.meta.url),'utf8'));assert.equal(update.format,'contract-review-update-v1');assert.equal(update.version,version);assert.equal(hash(update.html),update.sha256);
      const dir=await mkdtemp(join(tmpdir(),'cr-v190-acceptance-'));dirs.push(dir);const file=join(dir,'baseline-'+version+'.html');files.push(file);await writeFile(file,update.html,'utf8');html=update.html;url=pathToFileURL(file).href;
      expected={app:version,auto:'standard-auto-v13',recognition:'agreement-judgment-v2'};
    }else{
      const file=process.env.CR_TEST_HTML?pathToFileURL(resolve(process.env.CR_TEST_HTML)):new URL('../dist/contract-review.html',import.meta.url);if(process.env.CR_TEST_HTML)assert.match(fileURLToPath(file),/^\/private\/tmp\/cr-v190-[^/]+\.html$/,'Only task-owned preliminary HTML');
      html=await readFile(file,'utf8');url=file.href;expected={app:(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim(),auto:require('../src/standard_auto').VERSION,recognition:require('../src/agreement_judgment').VERSION};assert.match(expected.app,/^1\.90\./);
    }
    const digest=hash(html);if(hashes.has(release))assert.equal(digest,hashes.get(release),'HTML changed during suite');else hashes.set(release,digest);
    const {browserContextId}=await send('Target.createBrowserContext');contexts.push(browserContextId);const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const e={release,label,browserContextId,targetId,sessionId,expected,html_source:url,html_sha256:digest,cpu,workerUnavailable,errors:[],console_errors:[],external:[],workers:[],worker_setup_errors:[],loads:[]};sessions.set(sessionId,e);
    await send('Runtime.enable',{},sessionId);await send('Network.enable',{},sessionId);await send('Page.enable',{},sessionId);
    await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']},sessionId);
    await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'worker',exclude:false},{exclude:true}]},sessionId);
    await send('Emulation.setCPUThrottlingRate',{rate:cpu},sessionId);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__v190Platform={messages:[]};const Native=globalThis.Worker;if(typeof Native!=='function')return;globalThis.Worker=new Proxy(Native,{construct(target,args,newTarget){const worker=Reflect.construct(target,args,newTarget),post=worker.postMessage;worker.postMessage=function(...values){const start=performance.now();try{return Reflect.apply(post,this,values);}finally{__v190Platform.messages.push({start,duration:performance.now()-start});}};return worker;}});})()`},sessionId);
    if(workerUnavailable)await send('Page.addScriptToEvaluateOnNewDocument',{source:"globalThis.Worker=class {constructor(){throw new DOMException('Synthetic worker unavailable','SecurityError')}};"},sessionId);
    const done=loaded(e);await send('Page.navigate',{url},sessionId);await done;await ready(e);
    assert.deepEqual(await run(e,'({app:CR.app_version,auto:StandardAuto.VERSION,recognition:AgreementJudgment.VERSION})'),expected);
    await run(e,"StandardAutoArchive.backup().then(x=>{if(x.packets.length)throw Error('Nonempty isolated archive')})");return e;
  }
  async function install(e,payload){await send('Target.activateTarget',{targetId:e.targetId});await run(e,'('+installRuntime.toString()+')('+JSON.stringify(payload)+')');await run(e,"applyMotionPreference('full',false)");}
  async function cleanPage(e){assert.deepEqual(e.errors,[],e.label+' uncaught exceptions');if(!e.workerUnavailable)assert.deepEqual(e.console_errors,[],e.label+' console errors');assert.deepEqual(e.external,[],e.label+' external requests');assert.deepEqual(e.worker_setup_errors,[],e.label+' worker network isolation');await send('Target.disposeBrowserContext',{browserContextId:e.browserContextId});contexts.splice(contexts.indexOf(e.browserContextId),1);}
  async function close(){if(closing)return;closing=true;process.removeListener('SIGINT',interrupt);for(const id of contexts)await send('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});ws.close();for(const p of pending.values())clearTimeout(p.timer);for(const file of files)await unlink(file).catch(()=>{});for(const dir of dirs)await rmdir(dir).catch(()=>{});}
  function interrupt(){close().finally(()=>process.exit(130));}process.once('SIGINT',interrupt);
  function diagnostics(){return [...new Set(sessions.values())].map(e=>({label:e.label,html_sha256:e.html_sha256,errors:e.errors,console_errors:e.console_errors,external:e.external,workers:e.workers,worker_setup_errors:e.worker_setup_errors,last_observation:e.lastObservation||null}));}
  return {browser,send,run,page,ready,reload,install,cleanPage,close,diagnostics};
}

// These functions are serialized into a page. They observe the real button path;
// they do not replace analysis, matching, cache, verdict, or storage functions.
export function beginAnalysis(){
  const button=document.getElementById('btn-analyze'),box=document.getElementById('analysis-progress');
  if(button.disabled)throw Error('Previous analysis still running');
  const record={start:performance.now(),gaps:[],longtasks:[],phases:[],status:null,event:null,post_message_ms:[]};let last=record.start;
  const pulse=setInterval(()=>{const now=performance.now();record.gaps.push(now-last);last=now;},25);
  const observer=new PerformanceObserver(list=>record.longtasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
  const mutation=new MutationObserver(()=>record.phases.push({time:performance.now()-record.start,text:document.getElementById('analysis-progress-text').textContent,status:box.dataset.status||null}));mutation.observe(box,{childList:true,subtree:true,characterData:true,attributes:true});
  let done=false,finished,resolveDone,rejectDone;const completion=new Promise((ok,no)=>{resolveDone=ok;rejectDone=no;});
  function finish(status,event){if(done)return;done=true;record.status=status;record.event=event||null;record.total_ms=performance.now()-record.start;finished=performance.now();setTimeout(()=>{clearInterval(pulse);clearInterval(poll);observer.disconnect();mutation.disconnect();document.removeEventListener('analysis-complete',completed);window.removeEventListener('analysis-complete',completed);record.max_heartbeat_gap_ms=Math.max(0,...record.gaps);record.max_longtask_ms=Math.max(0,...record.longtasks.map(t=>t.duration));record.finished=finished;record.post_message_ms=(globalThis.__v190Platform?.messages||[]).filter(m=>m.start>=record.start&&m.start<=finished).map(m=>m.duration);resolveDone(record);},100);}
  function completed(event){finish(event.detail?.status||'unknown',event.detail);}
  document.addEventListener('analysis-complete',completed);window.addEventListener('analysis-complete',completed);
  const poll=setInterval(()=>{
    if(performance.now()-record.start>60000){clearInterval(poll);clearInterval(pulse);observer.disconnect();mutation.disconnect();rejectDone(Error('Analysis deadline exceeded 60000ms'));return;}
    // Old release has no completion event. Preserve the actual old button path.
    if(!button.disabled&&performance.now()-record.start>30&&!done)finish(box.dataset.status||(state.result?'completed':'unknown'));
  },25);
  globalThis.__v190Analysis={record,completion,finished:()=>done};button.click();return {started:true,disabled:button.disabled};
}
export function captureSnapshot(){
  const docs=safetyDocuments(),result=state.result;if(!result)return {result:null,verdicts:{}};
  const ids=Object.keys(verdictStore).filter(id=>verdictStore[id].origin==='auto'&&verdictStore[id].verdict==='이상없음').sort(),anchors={},locations={},verdicts={};
  for(const id of ids){const v=verdictStore[id],r=result.results.find(r=>r.cpId===id);anchors[id]=ReviewCore.completionAnchor(r,v,state.clauses,docs);locations[id]=ReviewCore.completionLocations(v,docs).map(e=>({document:e.document,start:e.start,end:e.end,text:e.text}));
    if(!locations[id].every(e=>docs[e.document].text.slice(e.start,e.end)===e.text))throw Error('Evidence coordinate mismatch '+id);
    verdicts[id]={verdict:v.verdict,reason:v.reason,origin:v.origin,proof:(v.auto_proof?.evidence||[]).map(e=>({document:e.document,document_index:e.document_index,start:e.start,end:e.end,text:e.text,clause_index:e.clause_index,check_id:e.check_id}))};
  }
  const rank=x=>x?{clauseIndex:x.clauseIndex,score:x.score}:null;
  return {identity:{app:CR.app_version,auto:StandardAuto.VERSION,recognition:AgreementJudgment.VERSION},questions:result.checkpoints.map(c=>c.id).sort(),mapping:result.results.map(r=>({id:r.cpId,coverage:r.coverage,best:rank(r.best),ranked:(r.ranked||[]).map(rank)})).sort((a,b)=>a.id.localeCompare(b.id)),automatic_ids:ids,verdicts,anchors,locations,analyzed_text:state.analyzedText||state.text,
    max_evidence_buttons:Math.max(0,...Array.from(document.querySelectorAll('.verdict-ctl')).map(c=>c.querySelectorAll('.vd-evidence-open').length)),dom_nodes:document.querySelectorAll('*').length};
}
export function savedReviewState(){
  const storage={};Object.keys(localStorage).filter(k=>/verdict|findings|reassign|match.?confirm|loop|corpus/i.test(k)).sort().forEach(k=>{storage[k]=localStorage.getItem(k);});
  return {storage,verdictStore:JSON.stringify(verdictStore),result:state.result?JSON.stringify(state.result):null,analyzedText:state.analyzedText||null};
}
export async function runButton(client,e){try{await client.run(e,'('+beginAnalysis.toString()+')()');e.lastObservation=await client.run(e,'__v190Analysis.completion');return e.lastObservation;}catch(error){e.lastObservation=await client.run(e,'globalThis.__v190Analysis?.record').catch(()=>null);throw error;}}
async function awaitWorker(client,e,previous){
  const start=Date.now();while(Date.now()-start<10000){if(e.workers.slice(previous).some(w=>w.ready)){await new Promise(r=>setTimeout(r,20));return;}const done=await client.run(e,'!!globalThis.__v190Analysis?.finished()');if(done)throw Error('Analysis finished before cancellation reached active worker');await new Promise(r=>setTimeout(r,10));}throw Error('No running analysis worker observed');
}
function sameResult(actual,expected){for(const key of ['questions','mapping','automatic_ids','verdicts','anchors','locations','analyzed_text'])assert.deepEqual(actual[key],expected[key],'Baseline comparison: '+key);}
function responsive(observed,label){assert(observed.max_heartbeat_gap_ms<1000,label+' heartbeat <1000ms');assert(observed.max_longtask_ms<1000,label+' long task <1000ms');assert(observed.gaps.length>=3,label+' heartbeat actually continued');}
export async function performanceSuite(){
  const client=await connect190(),payload=createDiverseFixture(),results=[];
  try{
    const observations={};
    for(const cpu of [4,1])for(const release of ['baseline','current']){
      const e=await client.page(release,'diverse-'+release+'-cpu'+cpu,{cpu});await client.install(e,payload);const timing=await runButton(client,e),snapshot=await client.run(e,'('+captureSnapshot.toString()+')()');
      assert.equal(timing.status,'completed');if(release==='current'){assert(e.workers.length>0,'Actual worker used');responsive(timing,e.label);sameResult(snapshot,observations['baseline-'+cpu].snapshot);}
      if(cpu===1)sameResult(snapshot,observations[release+'-4'].snapshot);
      observations[release+'-'+cpu]={snapshot,timing};results.push({case:e.label,html_source:e.html_source,html_sha256:e.html_sha256,cpu_throttle:cpu,fixture_sha256:hash(JSON.stringify(payload)),scale:fixtureScale(payload),timing,snapshot,workers:e.workers,console_errors:e.console_errors});
      await client.cleanPage(e);process.stderr.write(JSON.stringify({progress:e.label,passed:true,total_ms:timing.total_ms,max_heartbeat:timing.max_heartbeat_gap_ms})+'\n');
    }
    for(const mode of ['cancel','stale-input','cancel-validation']){
      const e=await client.page('current',mode);await client.install(e,payload);await client.run(e,'StandardAutoArchive.setEnabled(true)');
      const before=await client.run(e,'('+savedReviewState.toString()+')()'),archive=await client.run(e,'StandardAutoArchive.backup()'),count=e.workers.length;
      await client.run(e,'('+beginAnalysis.toString()+')()');await awaitWorker(client,e,count);
      let acted;
      if(mode==='cancel-validation')acted=await client.run(e,`new Promise((ok,no)=>{const start=performance.now();let seen=0;const timer=setInterval(()=>{const text=document.getElementById('analysis-progress-text').textContent;if(/현재 약정.*자동판정/.test(text)){if(!seen)seen=performance.now();if(performance.now()-seen>=8){clearInterval(timer);const b=document.getElementById('btn-analysis-cancel');if(b.hidden||b.disabled||!b.getClientRects().length){no(Error('Validation was committed before cancellation'));return;}const time=performance.now();b.click();ok(time);}}else if(__v190Analysis.finished()||performance.now()-start>10000){clearInterval(timer);no(Error('Did not reach cancellable automatic validation'));}},1);})`);
      else acted=await client.run(e,mode==='cancel'?`(()=>{const b=document.getElementById('btn-analysis-cancel');if(!b||b.disabled||b.hidden||!b.getClientRects().length)throw Error('Visible cancel button unavailable');const time=performance.now();b.click();return time;})()`:`(()=>{const input=document.getElementById('contract-text');const time=performance.now();input.value+=${JSON.stringify('\n제57조(새 입력)\n합성 작업 중 수정한 계약이다.')};input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:' 합성 변경'}));return time;})()`);
      const timing=await client.run(e,'__v190Analysis.completion');e.lastObservation=timing;assert.equal(timing.status,'cancelled');assert(timing.finished-acted<1000,'Cancellation completes <1000ms');
      await client.run(e,'new Promise(r=>setTimeout(r,800))');const after=await client.run(e,'('+savedReviewState.toString()+')()');assert.deepEqual(after,before,'No partial result or review save on '+mode);assert.deepEqual(await client.run(e,'StandardAutoArchive.backup()'),archive,'No partial archive packet');
      const ui=await client.run(e,'({disabled:document.getElementById("btn-analyze").disabled,hidden:document.getElementById("analysis-progress").hidden,status:document.getElementById("analysis-progress").dataset.status})');assert.equal(ui.disabled,false);assert.equal(ui.hidden,true);
      results.push({case:mode,html_sha256:e.html_sha256,cancel_latency_ms:timing.finished-acted,timing,partial_saves:false,ui});await client.cleanPage(e);process.stderr.write(JSON.stringify({progress:mode,passed:true})+'\n');
    }
    {
      const e=await client.page('current','worker-unavailable',{workerUnavailable:true});await client.install(e,payload);const before=await client.run(e,'('+savedReviewState.toString()+')()'),timing=await runButton(client,e);
      assert.equal(timing.status,'error');assert(timing.total_ms<10000,'Worker failure promptly finishes');assert.deepEqual(await client.run(e,'('+savedReviewState.toString()+')()'),before,'No failed-worker partial result');
      const ui=await client.run(e,'({disabled:document.getElementById("btn-analyze").disabled,status:document.getElementById("analysis-progress").dataset.status,text:document.getElementById("analysis-progress-text").textContent,spinning:Array.from(document.querySelectorAll("#analysis-progress .spinner,#analysis-progress [class*=spinner]")).some(n=>getComputedStyle(n).display!=="none"&&getComputedStyle(n).visibility!=="hidden")})');
      assert.equal(ui.disabled,false);assert.equal(ui.status,'error');assert.match(ui.text,/시작할 수 없|지원|실패|오류/);assert.equal(ui.spinning,false);results.push({case:e.label,html_sha256:e.html_sha256,timing,ui,console_errors:e.console_errors});await client.cleanPage(e);
    }
    {
      const e=await client.page('current','manual-reload-lazy-controls');await client.install(e,payload);await runButton(client,e);
      const lazy=await client.run(e,`(()=>{const selects=Array.from(document.querySelectorAll('.reassign-sel'));if(!selects.length)throw Error('No assignment dropdown');const ready=selects.filter(s=>s.dataset.optionsReady==='true');if(ready.length)throw Error('Untouched dropdown eagerly populated');const s=selects.find(s=>s.getClientRects().length)||selects[0],before=s.options.length;s.focus();s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));if(s.dataset.optionsReady!=='true'||s.options.length<=before)throw Error('Dropdown did not lazily expand');if(selects.some(other=>other!==s&&other.dataset.optionsReady==='true'))throw Error('Focusing one dropdown populated other cards');return {dropdowns:selects.length,before,after:s.options.length};})()`);
      const typed=await client.run(e,`(()=>{const b=document.querySelector('.clause-row .vd-btn[data-vcp="CMN-19"][data-vd="검토의견"]');if(!b)throw Error('Manual control absent');b.click();const n=document.querySelector('.clause-row .vd-note[data-vcp="CMN-19"][data-vfor="검토의견"]:not([disabled])');if(!n)throw Error('Manual note absent');n.focus();n.value='합성 v1.90 메모: 마지막 입력 보존';n.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:n.value}));return {key:Verdict.verdictKey(verdictHash),text:n.value};})()`);
      await client.reload(e);const record=await client.run(e,'JSON.parse(localStorage.getItem('+JSON.stringify(typed.key)+')||"{}")["CMN-19"]');assert.equal(record.comment,typed.text);assert.equal(record.origin,'manual');
      await client.install(e,payload);await runButton(client,e);const preserved=await client.run(e,'verdictStore["CMN-19"]');assert.equal(preserved.comment,typed.text);assert.equal(preserved.origin,'manual');assert(!preserved.needs_reconfirmation);
      results.push({case:e.label,html_sha256:e.html_sha256,lazy,manual_real_reload_preserved:true,manual_reanalysis_preserved:true});await client.cleanPage(e);
    }
    {
      const annexPayload=createDiverseFixture();annexPayload.text=annexPayload.text.replace(/제\d+조\(관할\)\n[^\n]+/g,'');
      const annex=Array.from({length:12},(_,i)=>'제'+(i+1)+'조(관할)\n본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.').join('\n');
      const e=await client.page('current','annex-evidence-compact');await client.install(e,annexPayload);
      await client.run(e,'state.subDocs=[{name:"합성 별첨 관할약정서",text:'+JSON.stringify(annex)+'}];renderSubDocList()');await runButton(client,e);
      const compact=await client.run(e,`(()=>{
        const v=verdictStore['CMN-19'],b=document.querySelector('#clause-rows .vd-evidence-open[data-vcp="CMN-19"]');
        if(v?.origin!=='auto'||v.verdict!=='이상없음'||!b||!b.closest('.cr-reviewed'))throw Error('Annex automatic card and evidence button required in column two');
        if(v.auto_proof.evidence.length<12)throw Error('All annex proof must remain');
        const row=b.closest('.clause-row'),buttons=row.querySelectorAll('.vd-evidence-open').length,inline=row.querySelectorAll('.cr-src pre').length;
        if(buttons>1||inline>1)throw Error('Annex renders more than one evidence control/quotation');
        b.click();const d=document.getElementById('auto-evidence-dialog'),mark=d.querySelector('mark');if(!d.open||!mark?.textContent)throw Error('Annex original evidence cannot open');
        const locations=ReviewCore.completionLocations(v,safetyDocuments());if(!locations.some(x=>x.text===mark.textContent))throw Error('Annex displayed quotation does not resolve');d.close();
        return {proof_count:v.auto_proof.evidence.length,buttons,inline_quotes:inline,original_popup_verified:true};
      })()`);
      results.push({case:e.label,html_sha256:e.html_sha256,...compact});await client.cleanPage(e);
    }
    return {artifact:'v1.90-performance-acceptance',created_at:new Date().toISOString(),preliminary:!!process.env.CR_TEST_HTML,html_override:process.env.CR_TEST_HTML||null,browser:client.browser.Browser,synthetic_only:true,private_data_used:false,external_requests:0,all_checks_passed:true,results,limitations:['500건 각각 52개의 고유 근거 문장·태그 연결을 만든 부하 시험이다. 실제 파일에 52개 태그 칼럼이 있다고 근거가 반드시 52문장이라는 뜻이 아니다.','본문은 14개 약정을 4회 반복한 2821자 합성 문서이며 실제 계약·원본 코퍼스를 사용하지 않는다.','각 조건 단일 실행으로 총시간·최대 정지시간을 기록한다. 10회 미만의 실행에서 P50/P95를 주장하지 않는다.','CPU4는 CDP 페이지 스로틀링이며 Worker 직접 적용 요청 결과는 workers.cpu_throttle_applied에 별도로 기록한다. 직접 적용이 불가한 경우 페이지 설정의 Worker 상속 정도는 검증하지 않았다.']};
  }catch(error){console.error(JSON.stringify({acceptance_failure:String(error),browser_diagnostics:client.diagnostics(),completed_cases:results.map(r=>r.case)},null,2));throw error;}finally{await client.close();}
}
export async function emit190(result){const json=JSON.stringify(result,null,2);if(process.env.CR_OUTPUT){assert(!process.env.CR_TEST_HTML,'Preliminary HTML must not overwrite final acceptance artifact');const target=resolve(process.env.CR_OUTPUT);assert.equal(target,fileURLToPath(new URL('../docs/v1.90-performance-acceptance.json',import.meta.url)));await writeFile(target,json+'\n','utf8');console.error(JSON.stringify({artifact_written:target}));}else console.log(json);}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])performanceSuite().then(emit190).catch(error=>{console.error(error.stack);process.exitCode=1;});
