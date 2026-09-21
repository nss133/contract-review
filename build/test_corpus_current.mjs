// 임시 앱 빌드 + 독립 Chrome 프로필에서 실행. 사용자 자료를 사용하지 않는다.
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9223';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
 if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await cdp('Runtime.enable');
 await cdp('Page.navigate',{url:process.env.CR_TEST_APP||new URL('../dist/contract-review.html#admin',import.meta.url).href});
 await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof EvalPreparationUI!=='undefined'){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(Error('app startup timeout'));}},100);})`);
 const result=await run(String.raw`(async()=>{
  const e=id=>document.getElementById(id),check=(ok,s)=>{if(!ok)throw Error(s);};
  e('contract-text').value='용역계약서\n제1조(계약기간) 계약기간은 2026년 1월 1일부터 2026년 12월 31일까지로 한다.\n제2조(해지) 수탁자는 해지 시 30일 전에 서면 통지하여야 한다.';
  refreshInputSetup();e('btn-analyze').click();
  for(let i=0;i<100&&(!state.result||e('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,50));
  check(!!state.result,'analysis');
  const r=state.result.results.find(r=>r.best);check(!!r,'candidate');
  applyVerdict(r.cpId,'이상없음','실제 문구 확인','반영되어 있음','manual');
  state.matchConfirm[r.cpId]=true;ingestCurrentToCorpus();
  check(!!verdictStore[r.cpId].judgment_tags,'saved tags');
  const record=loopCorpus.judgment_ledger.records[verdictHash];check(!!record.snapshot.comparison_context,'comparison identity');
  const saved=JSON.stringify(verdictStore),hash=SafetyRuntime.engineFingerprint();
  e('ep-corpus-scan').click();check(e('ep-corpus-summary').textContent.includes('누적 계약 1건'),'corpus scan');
  e('ep-corpus-compare').click();
  for(let i=0;i<100&&e('ep-corpus-compare').disabled;i++)await new Promise(r=>setTimeout(r,50));
  check(e('ep-compare-summary').textContent.includes('비교 가능한 사람 판정 1개'),'comparison: '+e('ep-compare-summary').textContent);
  check(JSON.stringify(verdictStore)===saved,'comparison must not mutate verdicts');
  state.subDocs.push({name:'새 별첨',text:'다만 통지를 생략한다.'});
  e('ep-corpus-compare').click();await new Promise(r=>setTimeout(r,20));
  check(e('ep-compare-summary').textContent.includes('동일한 본문'),'annex mismatch');state.subDocs.pop();
  loopCorpus=Loop.mergeIntoCorpus(loopCorpus,{meta:{contract_hash:'other',date:'2026-09-15'},verdicts:{X:{origin:'manual',verdict:'검토의견',comment:'보완'}}});
  check(hash!==SafetyRuntime.engineFingerprint(),'corpus change invalidates approval engine');
  check(!e('ep-advanced').open,'advanced evaluation collapsed');
  const legacy={meta:{contract_hash:verdictHash,date:'2026-09-15'},verdicts:{[r.cpId]:{origin:'legacy',verdict:'이상없음'}}};
  loopCorpus=Loop.mergeIntoCorpus(Loop.emptyCorpus(),legacy);saveCorpus();
  e('ep-legacy-reviewer').value='합성 검토자';e('ep-legacy-confirm').checked=false;e('ep-legacy-bind').click();
  check(!loopCorpus.judgment_ledger.records[verdictHash].snapshot.comparison_context,'unchecked binding blocked');
  e('ep-legacy-confirm').checked=true;e('ep-legacy-bind').click();
  check(!!loopCorpus.judgment_ledger.records[verdictHash].snapshot.source_binding,'legacy binding saved');
  e('ep-corpus-compare').click();
  for(let i=0;i<100&&e('ep-corpus-compare').disabled;i++)await new Promise(r=>setTimeout(r,50));
  check(e('ep-compare-summary').textContent.includes('비교 가능한 사람 판정 1개'),'bound legacy compare');
  return {startup:true,tagSave:true,corpusScan:true,liveComparison:true,noVerdictMutation:true,annexMismatch:true,approvalFingerprint:true,advancedCollapsed:true,legacyBinding:true};
 })()`);
 await run(`document.querySelector('.tab[data-tab="evaluation"]').click();window.scrollTo(0,0);`);
 await new Promise(resolve=>setTimeout(resolve,600));
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const shot=await cdp('Page.captureScreenshot',{format:'png'});
 await (await import('node:fs/promises')).writeFile('/private/tmp/contract-review-corpus-release.png',Buffer.from(shot.data,'base64'));
 if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify(result,null,2));
}finally{await cdp('Target.closeTarget',{targetId:target.id}).catch(()=>{});ws.close();}
