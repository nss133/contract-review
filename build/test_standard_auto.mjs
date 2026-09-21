// 합성 원문만 사용. 별도 임시 Chrome 프로필을 호출자가 준비한다.
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9351';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
 if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');
 await cdp('Page.navigate',{url:new URL('../dist/contract-review.html#admin',import.meta.url).href});
 await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof StandardAutoArchive!=='undefined'){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(Error('startup timeout'));}},100);})`);
 await run(`localStorage.clear();location.reload();`);
 await new Promise(r=>setTimeout(r,400));
 await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof StandardAutoArchive!=='undefined'){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(Error('reload timeout'));}},100);})`);
 const result=await run(String.raw`(async()=>{
  const e=id=>document.getElementById(id),check=(ok,s)=>{if(!ok)throw Error(s);};
  localStorage.removeItem('cr-standard-auto-v1');SafetyRuntime.setStandard(false);
  const text='용역계약서\n제1조(계약기간)\n계약기간은 2026년 1월 1일부터 2026년 12월 31일까지로 한다.\n제2조(부가세)\n부가가치세는 별도로 한다.\n제3조(대금 지급)\n위탁자는 수탁자의 청구서 수령일로부터 30일 이내에 대금을 수탁자의 지정 계좌로 지급한다.\n양 당사자는 매월 말일에 실제 수행 내역을 상호 확인하여 대금을 정산한다.\n제4조(관할)\n본 계약과 관련하여 발생하는 분쟁에 관한 소송은 서울중앙지방법원을 전속관할 법원으로 한다.\n제5조(운송)\n다만 휴일에는 다음 영업일에 운송한다.';
  const expanded=text+'\n제6조(해지)\n당사자 일방이 본 계약상의 의무를 중대하게 위반한 경우 상대방은 30일의 기간을 정하여 서면으로 시정을 요구하고 그 기간 내에 시정하지 아니하면 서면 통지로 본 계약을 해지할 수 있다.\n제7조(손해배상)\n당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.';
  e('contract-text').value=expanded;refreshInputSetup();e('btn-analyze').click();
  for(let i=0;i<100&&(!state.result||e('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,50));
  check(!!state.result,'analysis');
  state.subDocs=[{name:'보안관리약정서',text:'보안관리약정서\n제1조(비밀정보)\n“비밀정보”란 본 계약의 수행 과정에서 상대방으로부터 제공받은 기술상 또는 경영상의 정보로서 비밀로 표시된 정보를 말한다.'}];runAnalysis();
  e('standard-auto-confirm').checked=true;e('standard-auto-start').click();
  const ids=['CMN-04','CMN-05','CMN-06','CMN-08','CMN-09','CMN-11','CMN-15','CMN-19'];
  const observed=Object.fromEntries(ids.map(id=>[id,{verdict:verdictStore[id],report:SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)}]));
  check(ids.every(id=>verdictStore[id]&&verdictStore[id].verdict==='이상없음'),'native auto: '+JSON.stringify(observed));
  check(ids.every(id=>Verdict.reviewColumn(verdictStore[id])==='done'),'done grouping');
  loopCorpus=Loop.mergeIntoCorpus(loopCorpus,{meta:{contract_hash:'unrelated',date:'2026-09-15'},verdicts:{X:{origin:'manual',verdict:'검토의견'}}});
  applyAutoVerdicts();check(ids.every(id=>verdictStore[id].verdict==='이상없음'),'unrelated corpus invalidation');
  applyVerdict('CMN-06','검토의견','종료일 수정 필요','','manual');
  applyAutoVerdicts();check(verdictStore['CMN-06'].verdict==='검토의견','manual preserved');
  StandardAutoArchive.setEnabled(true);StandardAutoArchive.schedule();await new Promise(r=>setTimeout(r,850));
  const evaluation=await StandardAutoArchive.run();check(evaluation.false_safe>=1,'historical conflict should be counted');
  check(e('standard-auto-eval-status').textContent.includes('조항 분할·매핑·별첨 검색을 재실행'),'full matching replay');
  const backup=await StandardAutoArchive.backup();check(backup.packets.length>=1,'evaluation backup');
  check(await StandardAutoArchive.restore(backup)===0,'duplicate restore preserves current');
  applyVerdict('CMN-06','','','','manual');applyAutoVerdicts();check(!verdictStore['CMN-06']||!verdictStore['CMN-06'].verdict,'conflict pattern stopped');
  e('standard-auto-stop').click();check(!verdictStore['CMN-05'].verdict,'stop revokes native');
  e('standard-auto-confirm').checked=true;e('standard-auto-start').click();check(verdictStore['CMN-05'].verdict==='이상없음','resume other rules');
  e('contract-text').value=text+'\n제6조(부가세) 부가가치세는 포함한다.';e('contract-text').dispatchEvent(new Event('input',{bubbles:true}));
  check(!verdictStore['CMN-05'].verdict,'live edit revokes');
  return {startup:true,realAutoChecks:ids,doneGrouping:true,unrelatedCorpusStable:true,manualPreserved:true,
    archivedEvaluation:evaluation,conflictStopped:true,stopResume:true,liveEditRevoked:true};
 })()`);
 await run(`document.querySelector('.tab[data-tab="clauses"]')?.click();document.getElementById('standard-auto-panel').scrollIntoView();window.scrollBy(0,-90);`);
 await new Promise(r=>setTimeout(r,600));
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const shot=await cdp('Page.captureScreenshot',{format:'png'});
 await (await import('node:fs/promises')).writeFile('/private/tmp/contract-review-standard-release.png',Buffer.from(shot.data,'base64'));
 if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify(result,null,2));
}finally{await cdp('Target.closeTarget',{targetId:target.id}).catch(()=>{});ws.close();}
