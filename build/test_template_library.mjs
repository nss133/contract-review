const endpoint='http://127.0.0.1:9359';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
 if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
 if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={}){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>200){clearInterval(t);no(Error('startup'));}},50);})`);}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();
 await run(`localStorage.clear();location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();
 const dom=await cdp('DOM.getDocument');const fileNode=await cdp('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#template-file'});
 await cdp('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[new URL('../testdata/standard_contracts/raw/performance-sharing-standard.pdf',import.meta.url).pathname]});
 await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(document.getElementById('template-text').value.length>50){clearInterval(t);ok();}else if(++n>600){clearInterval(t);no(Error('PDF intake: '+document.getElementById('template-status').textContent));}},50);})`);
 const result=await run(String.raw`(async()=>{
  const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
  const text='비밀정보란 업무 중 알게 된 상대방의 비공개 정보를 말한다.\n비밀정보는 목적 외로 사용하거나 제3자에게 누설하여서는 아니 된다.\n비밀유지의무는 계약 종료 후 3년간 존속한다.'.replaceAll('\\n','\n');
  e('contract-text').value='용역계약서\n제1조(비밀유지)\n'+text;
  // 위 문자열은 실제 줄바꿈으로 처리한다.
  e('contract-text').value=e('contract-text').value.replaceAll('\\n','\n');
  refreshInputSetup();e('btn-analyze').click();for(let n=0;n<150&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));
  check(CR.app_version==='1.87.0','version');
  // PDF는 새 기본 경로에서 이미 자동 저장됐다. 아래 수동 호환 시험은 별도로 시작한다.
  localStorage.removeItem('cr-template-library-v1');window.dispatchEvent(new StorageEvent('storage',{key:'cr-template-library-v1',newValue:null}));
  e('template-name').value='시험 표준비밀유지';e('template-revision').value='1';e('template-type').value=state.typeId;e('template-stance').value=state.stance;
  e('template-text').value=text;e('template-split').click();
  for(const c of e('template-quotes').querySelectorAll('input'))c.checked=true;
  e('template-quotes').querySelector('input').dispatchEvent(new Event('change'));e('template-check').value='CNS-SECRET';e('template-bind').click();
  check(e('template-bindings').textContent.includes('비밀정보'),'binding');e('template-approve').checked=true;e('template-save').click();
  check(TemplateLibraryRuntime.get().templates.length===1,'saved '+e('template-status').textContent);
  check(verdictStore['CNS-SECRET']?.verdict==='이상없음','auto '+JSON.stringify(TemplateLibraryRuntime.report()));
  check(verdictStore['CNS-SECRET'].auto_proof.version===TemplateLibrary.VERSION,'proof');
  check(!resultFor(_cpById('CNS-SECRET')).autoSafety.requires_review,'subdoc blanket hold removed');
  check(currentVerdictExport().verdicts['CNS-SECRET'].verdict==='이상없음','export');
  saveVerdicts();loadVerdicts();applyAutoVerdicts();check(verdictStore['CNS-SECRET'].verdict==='이상없음','reload proof');
  const proofBefore=JSON.stringify(verdictStore['CNS-SECRET'].auto_proof);e('template-list').querySelector('[data-template-toggle]').click();
  check(!verdictStore['CNS-SECRET'].verdict,'revoke on stop');
  e('template-list').querySelector('[data-template-edit]').click();e('template-approve').checked=true;e('template-save').click();
  check(verdictStore['CNS-SECRET'].verdict==='이상없음','reactivate');
  e('template-list').querySelector('[data-template-use]').click();check(state.subDocs.some(d=>d.template_id),'apply as annex');
  e('contract-text').value+='\n다만, 비밀정보는 자유롭게 공개할 수 있다.';e('contract-text').dispatchEvent(new Event('input'));
  check(!verdictStore['CNS-SECRET']?.verdict,'invalidate on edit');
  refreshInputSetup();runAnalysis();check(!verdictStore['CNS-SECRET']?.verdict,'new conflicting exception not passed');
  for(const cp of SafetyRuntime.allChecks().filter(c=>c.review_scope==='execution_only'))check(!state.result.checkpoints.some(c=>c.id===cp.id),'scope '+cp.id);
  const backup=TemplateLibraryRuntime.get();localStorage.removeItem('cr-template-library-v1');window.dispatchEvent(new StorageEvent('storage',{key:'cr-template-library-v1',newValue:null}));
  check(TemplateLibraryRuntime.get().templates.length===0,'cross tab clear');
  const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(backup)],'restore.json',{type:'application/json'}));e('template-restore').files=transfer.files;await e('template-restore').onchange();
  check(TemplateLibraryRuntime.get().templates.length===1&&TemplateLibraryRuntime.get().templates[0].active,'restore without approval');
  check(!TemplateLibraryRuntime.get().templates[0].bindings.length,'unsupported imported bindings not blindly activated');
  e('template-list').querySelector('[data-template-edit]').click();
  return {pdfIntake:true,registration:true,automatic:true,reload:true,revocation:true,annex:true,conflictBlocked:true,scope:true,backupRestore:true,version:CR.app_version};
 })()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});
 await run(`document.querySelector('.tab[data-tab="knowledge"]').click();document.getElementById('template-library-panel').scrollIntoView();`);
 await new Promise(r=>setTimeout(r,500));
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await (await import('node:fs/promises')).writeFile('/private/tmp/cr171-template.png',Buffer.from(shot.data,'base64'));
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({...result,external:external.length},null,2));
}catch(e){console.error(JSON.stringify({runtimeErrors:errors}));throw e;}finally{await cdp('Target.closeTarget',{targetId:target.id}).catch(()=>{});ws.close();}
