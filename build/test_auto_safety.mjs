/* 격리 Chrome 9223. 합성 계약만 사용하며 외부 요청을 검사한다. */
import fs from 'node:fs/promises';
const target = await fetch('http://127.0.0.1:9223/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map(), errors = [], external = [];
ws.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
  if (msg.method === 'Network.requestWillBeSent' && /^https?:/.test(msg.params.request.url)) external.push(msg.params.request.url);
  if (pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result);
  }
};
function cdp(method, params = {}) { return new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
}); }
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Page.navigate', { url: new URL('../dist/contract-review.html#admin', import.meta.url).href });
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof SafetyEvalUI!=='undefined'){clearInterval(t);resolve(true);}else if(++n>100){clearInterval(t);reject(Error('init timeout'));}},50);})`);
  const result = await evaluate(`(async()=>{
    const d=document, e=id=>d.getElementById(id);
    function check(ok,label){if(!ok)throw Error(label);}
    const text='용역계약서\\n제1조(목적) 갑은 을에게 개발 용역을 위탁한다.\\n제2조(해지) 해지 시 30일 전에 서면 통지한다.\\n다만 상대방은 통지 없이 즉시 해지할 수 있다.';
    e('contract-text').value=text; refreshInputSetup();
    const key=Verdict.verdictKey(hashText(text));
    localStorage.setItem(key,JSON.stringify({
      'CMN-09':{verdict:'이상없음',origin:'auto',comment:'원래 자동 메모',date:'2026-09-01'},
      'CMN-01':{verdict:'이상없음',origin:'manual',comment:'직접 확인',date:'2026-09-01'},
      'PRIV-01':{verdict:'이상없음',origin:'subdoc',comment:'표준약정',date:'2026-09-01'}
    }));
    e('btn-analyze').click();
    for(let i=0;i<100&&(!state.result||e('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,50));
    check(verdictStore['CMN-09'].verdict===''&&verdictStore['CMN-09'].safety_hold.previous.comment==='원래 자동 메모','old auto preserved/held');
    check(verdictStore['PRIV-01'].verdict==='','old subdoc held');
    check(verdictStore['CMN-01'].verdict==='이상없음','manual retained');
    check(!Object.values(verdictStore).some(x=>x.origin==='auto'&&x.verdict==='이상없음'),'no auto completion');
    check(JSON.parse(localStorage.getItem(key))['CMN-09'].safety_hold,'migration persisted');
    const r=state.result.results.find(x=>x.cpId==='CMN-09');
    check(r.autoSafety.signals.length>0,'exception in actual analysis');
    check(_requiresDecision(r)&&pendingReviewCount()>0,'held item blocks completion');
    check(verdictControlHtml('CMN-09',true).includes('원래 자동 메모'),'held history visible');
    const original=JSON.stringify(r.autoClear);
    state.reassign['CMN-09']=0;applyReassign();check(r.autoClear===null&&r.perspective===null,'stale evidence cleared');
    delete state.reassign['CMN-09'];applyReassign();check(JSON.stringify(r.autoClear)===original,'original evidence restored');
    state.compare={carryById:{'CMN-10':{verdict:'이상없음',comment:'전년'}},carry:[]};
    acceptCarry('CMN-10');check(verdictStore['CMN-10'].verdict==='','carry held');state.compare=null;
    const blobs=[],savedClick=HTMLAnchorElement.prototype.click,savedURL=URL.createObjectURL;
    HTMLAnchorElement.prototype.click=function(){}; URL.createObjectURL=b=>{blobs.push(b);return savedURL(b);};
    activatePane('goldset');
    e('safety-snapshot').click();check(e('safety-message').textContent.includes('계열 ID'),'family required');
    e('safety-family').value='synthetic-family';e('safety-snapshot').click();
    check(!e('safety-gold').disabled,'snapshot created');
    e('safety-gold').click();e('safety-observation').click();
    check(blobs.length===2,'separate downloads');
    const gold=JSON.parse(await blobs[0].text()),pred=JSON.parse(await blobs[1].text());
    check(pred.items.length===238&&gold.labels.length===238,'all active checks including hidden');
    check(!JSON.stringify(gold).includes('candidate'),'blinded labels');
    gold.reviewer='독립 검수자';gold.source_reviewed=true;gold.independent=true;
    gold.labels.forEach(l=>{l.truth='unknown';l.note='합성시험';l.evidence='본문 확인';});
    const candidate=pred.items.find(x=>x.candidate);check(candidate,'legacy candidate available');
    gold.labels.find(l=>l.check_id===candidate.check_id).truth='issue';
    function upload(id,obj){const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(obj)],'internal.json'));e(id).files=dt.files;e(id).dispatchEvent(new Event('change'));}
    upload('safety-pred-file',pred);upload('safety-gold-file',gold);
    for(let i=0;i<100&&e('safety-score').disabled;i++)await new Promise(r=>setTimeout(r,20));
    e('safety-score').click();check(e('safety-metrics').textContent.includes('안전성 입증 아님'),'internal metrics');
    check(SafetyEval.score(pred,gold).shadow.false_clear>=1,'false clear measured');
    gold.run_id='wrong';upload('safety-gold-file',gold);
    for(let i=0;i<100&&e('safety-score').disabled;i++)await new Promise(r=>setTimeout(r,20));
    e('safety-score').click();check(e('safety-message').textContent.includes('채점 보류')&&!e('safety-metrics').textContent,'mismatch clears stale metrics');
    e('contract-text').value+='\\n변경';e('safety-gold').click();check(e('safety-gold').disabled&&blobs.length===2,'stale snapshot blocked');
    URL.createObjectURL=savedURL;HTMLAnchorElement.prototype.click=savedClick;
    gold.run_id=pred.run_id;upload('safety-gold-file',gold);
    for(let i=0;i<100&&e('safety-score').disabled;i++)await new Promise(r=>setTimeout(r,20));
    e('safety-score').click();
    return {migration:true,manualPreserved:true,subdocAndCarryHeld:true,exceptionSignal:true,reassignment:true,blindedFiles:2,allChecks:240,internalMetrics:true,staleBlocked:true};
  })()`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.getElementById('safety-family').scrollIntoView();`);
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('/private/tmp/contract-review-safety.png', Buffer.from(shot.data, 'base64'));
  if (errors.length || external.length) throw Error(JSON.stringify({ errors, external }));
  console.log(JSON.stringify({ ...result, externalRequests: external.length }, null, 2));
} finally { ws.close(); }
