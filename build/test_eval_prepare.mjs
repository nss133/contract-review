import fs from 'node:fs/promises';
const target=await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
 if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
 if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});
 await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof EvalPrepare!=='undefined'&&!document.getElementById('ep-prepare').disabled){clearInterval(t);resolve();}else if(++n>200){clearInterval(t);reject(Error('init timeout'));}},50);})`);
 const result=await evaluate(`(async()=>{
  const e=id=>document.getElementById('ep-'+id),check=(x,s)=>{if(!x)throw Error(s);};
  const wait=async()=>{for(let i=0;i<100&&e('prepare').disabled;i++)await new Promise(r=>setTimeout(r,20));check(!e('prepare').disabled,'operation timeout');};
  const edit=(id,v)=>{e(id).value=v;e(id).dispatchEvent(new Event('input'));};
  const click=async(id)=>{e(id).click();await wait();};
  const originalText=state.text,originalVerdicts=JSON.stringify(verdictStore),unique='synthetic-'+Date.now();
  reviewHistory={latest:{[unique]:'r'},records:{r:{fingerprint:unique,request:{contract_name:'합성 유지보수 계약',department:'정보보호'},result:{review_text:'손해배상 상한이 과도하여 수정 필요.'}}}};
  legalOpinionKnowledge={latest:{law:'law'},documents:{law:{source_id:'law',fingerprint:unique,title:'합성 법률검토',evidence:[{source:'신청',sentence:'이상없음인가요?'}],tags:[]}}};
  document.querySelector('[data-tab="evaluation"]').click();check(!document.body.classList.contains('admin-mode'),'not admin');
  await click('prepare');check(e('cases').options.length>=2,'both sources and retained incidents');
  e('cases').value=EvalPreparationUI.getStore().active.find(k=>EvalPreparationUI.getStore().cases[k].source.id==='contract:'+unique);e('cases').dispatchEvent(new Event('change'));await wait();
  check(e('quote').textContent.includes('수정 필요'),'prior judgment visible');
  check(e('truth').value==='','not auto truth');
  edit('mapping','unmapped');edit('truth','issue');edit('reason','과거 의견을 원문으로 대조');edit('evidence','계약서 제1조');edit('reviewer','합성검수자');
  await click('confirm');check(e('message').textContent.includes('본문 파일'),'no source blocks: '+e('message').textContent);
  const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>제1조 손해배상 상한은 1원으로 한다.</w:t></w:r></w:p></w:body></w:document>');
  const dt=new DataTransfer();dt.items.add(new File([await zip.generateAsync({type:'uint8array'})],'synthetic.docx'));e('files').files=dt.files;e('files').dispatchEvent(new Event('change'));await wait();
  e('docs').querySelector('.ep-main').click();await wait();
  e('version').value='before';e('version').dispatchEvent(new Event('change'));await wait();
  e('source-confirmed').checked=true;await click('confirm');check(e('message').textContent.includes('초안 확인 저장'),'confirm draft');
  check(e('items').selectedOptions[0].textContent.includes('초안 확인됨'),'draft status');
  const blobs=[],oldURL=URL.createObjectURL,oldClick=HTMLAnchorElement.prototype.click;
  URL.createObjectURL=b=>{blobs.push(b);return oldURL(b);};HTMLAnchorElement.prototype.click=function(){};await click('backup');
  const backup=JSON.parse(await blobs[0].text()),c=backup.cases[backup.active[0]];check(c.items[0].independent===false,'not independent gold');check(c.documents[0].text.includes('1원'),'document preserved');
  URL.createObjectURL=oldURL;HTMLAnchorElement.prototype.click=oldClick;
  await click('prepare');check(e('items').selectedOptions[0].textContent.includes('초안 확인됨'),'prepare idempotent');
  edit('mapping','CMN-09');e('source-confirmed').checked=true;await click('confirm');
  const te=id=>document.getElementById('et-'+id);
  async function until(fn){for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,20));check(fn(),'trial wait: '+te('message').textContent);}
  te('freeze').click();await until(()=>te('status').textContent.includes('검수 0/2'));
  const modeBefore=MatcherConfig.TAG_MATCH_MODE;
  for(const who of ['독립검수A','독립검수B']){
    te('start').click();await until(()=>!te('blind').hidden);
    check(document.getElementById('ep-root').hidden&&te('management').hidden,'prior answers hidden');
    check(!te('blind').textContent.includes('과도하여 수정 필요'),'no prior quote in blind view');
    te('reviewer').value=who;te('truth').value=who==='독립검수B'?'safe':'issue';te('reason').value='합성 독립 검수';te('evidence').value='본문 1조';
    te('direct').options[0].selected=true;te('independent').checked=true;te('sources').checked=true;
    te('submit').click();await until(()=>te('blind').hidden);
  }
  const er=id=>document.getElementById('er-'+id);er('panel').open=true;er('refresh').click();await until(()=>er('question').options.length===1);await new Promise(r=>setTimeout(r,0));
  er('reviewer').value='제3 검토자';er('truth').value='issue';er('direct').options[0].selected=true;er('evidence').value='본문 제1조';er('reason').value='원문 대조 후 수정 필요';er('confirm').checked=true;
  er('save').click();await until(()=>er('message').textContent.includes('조정 저장됨'));
  check(EvalTrial.consensus(EvalTrialUI.current())[0].resolved===true,'third reviewer resolution connected');
  check(EvalTrialUI.current().reviews[1].labels[0].truth==='safe','original dissent preserved');
  te('score').click();await until(()=>te('result').textContent.includes('태그 제외'));
  check(te('result').textContent.includes('태그 보조'),'two modes compared');
  check(MatcherConfig.TAG_MATCH_MODE===modeBefore,'tag mode restored');
  check(EvalPreparationUI.getStore().trials[te('saved').value].runs.length===1,'run persisted');
  const storedTrial=EvalPreparationUI.getStore().trials[te('saved').value];
  check(storedTrial.reviews.length===2&&storedTrial.runs[0].runs.length===2,'two independent reviews and modes');
  const ap=id=>document.getElementById('ap-'+id),policyBefore=JSON.stringify(SafetyRuntime.get());
  ap('panel').open=true;ap('prepare').click();await until(()=>ap('check').options.length===1);
  ap('type').value='outsourcing';ap('role').value='위탁자';ap('actor').value='수탁자';ap('action').value='통지';ap('object').value='해지';ap('basis').value='합성 단일 요건 관찰';
  ap('save').click();await until(()=>ap('message').textContent.includes('후보 입력 저장됨'));
  ap('confirm').checked=true;ap('run').click();await until(()=>ap('message').textContent.includes('후보 시험 이력'));
  check(storedTrial.auto_runs.length===1&&storedTrial.auto_runs[0].approval_eligible===false,'candidate observation never grants approval');
  check(ap('result').textContent.includes('자동판정 보류'),'missing evidence holds');
  check(JSON.stringify(SafetyRuntime.get())===policyBefore,'candidate test leaves approval policy intact');
  ap('actor').value='변경';ap('actor').dispatchEvent(new Event('input'));check(!ap('confirm').checked&&ap('result').textContent.includes('재시험'),'changed rule invalidates displayed result');
  ap('prepare').click();await until(()=>ap('actor').value==='수탁자');check(ap('result').textContent.includes('자동판정 보류'),'saved candidate reload');
  check(state.text===originalText&&JSON.stringify(verdictStore)===originalVerdicts,'active review untouched');
  return {passed:true,cases:2,documents:1,independent:false};
 })()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await evaluate(`document.getElementById('et-management').scrollIntoView({block:'start'});new Promise(resolve=>setTimeout(resolve,400))`);
 const trialShot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile('/private/tmp/contract-eval-trial.png',Buffer.from(trialShot.data,'base64'));
 await evaluate(`document.getElementById('ap-panel').scrollIntoView({block:'start'});new Promise(resolve=>setTimeout(resolve,300))`);
 const pilotShot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile('/private/tmp/contract-auto-pilot.png',Buffer.from(pilotShot.data,'base64'));
 await cdp('Page.reload');
 const resumed=await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{const e=document.getElementById('ep-items');if(e&&e.options.length){clearInterval(t);resolve(e.options[0].textContent.includes('초안 확인됨'));}else if(++n>200){clearInterval(t);reject(Error('resume timeout'));}},50);})`);
 if(!resumed||errors.length||external.length)throw Error(JSON.stringify({resumed,errors,external}));
 await evaluate(`document.querySelector('[data-tab="evaluation"]').click()`);
 await evaluate(`new Promise(resolve=>setTimeout(resolve,600))`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile('/private/tmp/contract-eval-preparation.png',Buffer.from(shot.data,'base64'));
 console.log(JSON.stringify({...result,resumed,external:external.length}));
}finally{await cdp('Page.close').catch(()=>{});ws.close();}
