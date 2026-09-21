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
 const result=await run(String.raw`(async()=>{
  const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
  const clauses=['비밀정보란 업무 중 알게 된 상대방의 비공개 정보를 말한다.','비밀정보는 목적 외로 사용하거나 제3자에게 누설하여서는 아니 된다.','비밀유지의무는 계약 종료 후 3년간 존속한다.'];
  const text='제1조(기본정보)\n수탁자 상호: 가회사\n체결일: 2026-09-16\n제2조(비밀유지)\n'+clauses.join('\n');
  e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();for(let n=0;n<150&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));
  check(CR.app_version==='1.87.0','version');
  e('template-name').value='입력란 포함 비밀약정';e('template-revision').value='1';e('template-type').value=state.typeId;e('template-text').value=text;e('template-split').click();
  check(e('template-fields').querySelectorAll('input').length===2,'field detection');for(const c of e('template-fields').querySelectorAll('input'))c.checked=true;
  e('template-propose').click();const p=Array.from(e('template-proposals').querySelectorAll('.template-proposal')).find(p=>p.textContent.includes(_cpById('CNS-SECRET').check));
  check(p,'auto proposal '+e('template-status').textContent);p.querySelector('input').checked=true;e('template-accept-proposals').click();
  check(!TemplateLibraryRuntime.get().templates.length,'proposal not active');e('template-approve').checked=true;e('template-save').click();
  check(TemplateLibraryRuntime.get().templates.length===1,'save '+e('template-status').textContent);
  check(verdictStore['CNS-SECRET']?.verdict==='이상없음','base auto '+JSON.stringify(TemplateLibraryRuntime.report()));
  const entry=e('template-list').querySelector('[data-template-entry]');entry.querySelector('[data-field-label="수탁자상호"]').value='나회사';entry.querySelector('[data-field-label="체결일"]').value='2026-10-01';entry.querySelector('[data-template-use]').click();
  check(state.subDocs[0]?.text.includes('수탁자상호: 나회사')&&state.subDocs[0].text.includes('체결일: 2026-10-01'),'filled annex '+e('template-status').textContent);
  check(state.subDocs[0].text.includes('3년간'),'material term preserved');
  const variant=['비밀정보란 상대방이 제공한 비공개 자료를 말한다.',clauses[1],clauses[2]],type=state.typeId;
  const snapshot={meta:{contract_hash:'synthetic-prior',date:'2026-09-16',type_id:type,stance:state.stance,party_roles:[]},verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:variant.map(s=>'“'+s+'”').join(' ')}}};
  loopCorpus=Loop.mergeIntoCorpus(loopCorpus,snapshot,{replaceCurrent:true});saveCorpus();
  e('template-list').querySelector('[data-template-edit]').click();await e('template-find-variants').onclick();
  check(e('template-variants').querySelector('input'),'corpus candidate '+e('template-status').textContent);
  state.subDocs=[];e('contract-text').value='제1조(비밀유지)\n'+variant.join('\n');refreshInputSetup();runAnalysis();
  check(!verdictStore['CNS-SECRET']?.verdict,'candidate not auto approval');
  e('template-variants').querySelector('input').checked=true;e('template-variant-confirm').checked=true;e('template-accept-variants').click();
  check(e('template-bindings').textContent.includes('승인 표현'),'variant staged '+e('template-status').textContent);
  e('template-approve').checked=true;e('template-save').click();
  check(verdictStore['CNS-SECRET']?.auto_proof?.kind==='corpus_variant','approved variant '+JSON.stringify(TemplateLibraryRuntime.report()));
  check(currentVerdictExport().template_matches.some(r=>r.result.variant_source),'provenance export');
  const changed=JSON.parse(JSON.stringify(snapshot));changed.verdicts['CNS-SECRET'].verdict='검토의견';
  loopCorpus=Loop.mergeIntoCorpus(loopCorpus,changed,{replaceCurrent:true});applyAutoVerdicts();renderClauses();
  check(!verdictStore['CNS-SECRET']?.verdict,'source decision revision revokes');
  return {version:CR.app_version,proposal:true,explicitApproval:true,fieldFill:true,materialTerms:true,corpusCandidate:true,variantApproval:true,provenance:true,sourceRevocation:true};
 })()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});
 await run(`document.querySelector('.tab[data-tab="knowledge"]').click();document.getElementById('template-bindings').scrollIntoView();`);await new Promise(r=>setTimeout(r,500));
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await (await import('node:fs/promises')).writeFile('/private/tmp/cr172-template.png',Buffer.from(shot.data,'base64'));
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({...result,external:external.length},null,2));
}catch(e){console.error(JSON.stringify({runtimeErrors:errors}));throw e;}finally{await cdp('Target.closeTarget',{targetId:target.id}).catch(()=>{});ws.close();}
