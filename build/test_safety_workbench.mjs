/* 합성 자료만 사용하는 폐쇄망 검수→시험→승인→중지 UI 회귀. */
import fs from 'node:fs/promises';
const target=await fetch((process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9223')+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
  if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html#admin',import.meta.url).href});
 await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof SafetyWorkbenchUI!=='undefined'){clearInterval(t);resolve(true);}else if(++n>100){clearInterval(t);reject(Error('init timeout'));}},50);})`);
 const result=await run(`(async()=>{
  const d=document,e=id=>d.getElementById(id),w=id=>e('wb-'+id),check=(ok,s)=>{if(!ok)throw Error(s);};
  localStorage.removeItem('cr-safety-workbench-v1');
  SafetyRuntime.save(SafetyWorkbench.empty());
  const text='용역계약서\\n제1조(목적) 위탁자는 수탁자에게 개발 용역을 위탁한다.\\n제2조(해지 통지) 수탁자는 해지 시 30일 전에 서면 통지하여야 한다.';
  e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();
  for(let i=0;i<100&&(!state.result||e('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,50));
  state.partyRoles=['위탁자'];runAnalysis();activatePane('goldset');
  e('safety-confirm-inputs').click();
  const cp=_cpById('CMN-09'),match=resultFor(cp);check(match.coverage==='addressed','actual mapping');
  const rule={id:'WB-NOTICE',check_id:cp.id,revision:'1',type_ids:[state.typeId],party_roles:['위탁자'],rationale:'합성시험 전용 기준 (실제 승인 아님)',
    obligations:[{id:'notice',actors:['수탁자'],actions:['통지'],objects:['해지'],conditions:['서면'],polarity:'obligation',quantity:{unit:'일',min:30,max:30}}]};
  w('actor').value='시험 승인자';w('rule').value=JSON.stringify(rule);w('rule-register').click();check(SafetyRuntime.get().rules['WB-NOTICE'],'UI rule registration');
  const goldPair=(n,split,truth)=>{
    const body=(truth==='safe'?text:'용역계약서\\n제1조(해지) 수탁자는 통지 없이 해지할 수 있다.')+'\\n시험조건 '+String.fromCharCode(65+Math.floor(n/26),65+n%26);
    const ctx=Object.assign({},SafetyRuntime.bundle().context,{retrieval:{strict:true,sources:[]},reassign:{}});
    const p=SafetyWorkbench.seal(Object.assign(SafetyEval.build({runId:'wb-run-'+n,contractHash:hashText(body),familyId:'wb-family-'+n,appVersion:CR.app_version,
      text:body,clauses:segmentContract(body),checkpoints:[cp],results:[match],context:ctx}),{engine_fingerprint:SafetyRuntime.engineFingerprint(),checks_fingerprint:SafetyRuntime.checksFingerprint(),case_date:split==='development'?'2026-01-01':'2026-02-01'}));
    const direct=p.clauses.filter(c=>((c.heading||'')+' '+(c.body||'')).includes('통지')).map(c=>c.index);check(direct.length===1,'synthetic notice has one direct clause');
    const golds=['검수자 A','검수자 B'].map(reviewer=>{const g=SafetyEval.goldTemplate(p);g.reviewer=reviewer;g.source_reviewed=true;g.independent=true;Object.assign(g.labels[0],{truth,note:'합성 원본 대조',evidence:truth==='safe'?'본문 제2조':'본문 제1조',direct_clause_indices:direct});return g;});return {split,observation:p,golds};
  };
  const raw={format:'cr-safety-dataset-v1',id:'UI-synthetic',owner:'시험담당',frozen_on:verdictToday(),cases:[goldPair(1000,'development','safe'),goldPair(1001,'adversarial','issue'),...Array.from({length:60},(_,i)=>goldPair(i,'test','safe'))]};
  const upload=(id,obj)=>{const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(obj)],'internal.json'));e(id).files=dt.files;e(id).dispatchEvent(new Event('change'));};
  upload('wb-review-file',raw.cases[2].golds[0]);
  for(let i=0;i<100&&!w('review-check').options.length;i++)await new Promise(r=>setTimeout(r,20));
  check(w('review-docs').textContent.includes('30일')&&!w('review-docs').textContent.includes('candidate'),'blinded review UI');
  const savedClick=HTMLAnchorElement.prototype.click,savedURL=URL.createObjectURL,blobs=[];HTMLAnchorElement.prototype.click=function(){};URL.createObjectURL=b=>{blobs.push(b);return savedURL(b);};
  w('note').value='검수 화면에서 직접 기록';w('review-save').click();check(JSON.parse(await blobs[0].text()).labels[0].note==='검수 화면에서 직접 기록','review save UI');
  upload('wb-case-files',raw);for(let i=0;i<100&&!w('cases').textContent.includes('wb-run-1000');i++)await new Promise(r=>setTimeout(r,20));
  w('replay').click();for(let i=0;i<1000&&w('replay').disabled;i++)await new Promise(r=>setTimeout(r,20));
  check(w('message').textContent.includes('재실행 완료'),'isolated batch replay: '+w('message').textContent);
  w('freeze').click();check(!w('dataset-save').disabled,'frozen dataset UI');w('evaluate').click();check(w('evaluation').textContent.includes('60'),'family count');
  w('basis').value='합성시험 내부 승인 시뮬레이션';w('risk').value='5';w('expires').value='2026-10-01';w('representative').checked=true;
  w('approve').click();check(!SafetyRuntime.get().approvals['WB-NOTICE'],'empty scope blocked');
  w('scopes').options[0].selected=true;
  w('approve').click();check(SafetyRuntime.get().approvals['WB-NOTICE']?.status==='approved','approval UI: '+w('message').textContent);
  check(!SafetyRuntime.get().enabled,'approval not auto enable');w('enable').click();
  check(verdictStore[cp.id]?.verdict==='이상없음'&&verdictStore[cp.id].auto_proof,'approved runtime pass: '+JSON.stringify(SafetyRuntime.describe(cp,match)));
  e('contract-text').value+='\\n다만 통지 의무를 면제한다.';e('contract-text').dispatchEvent(new Event('input'));
  check(verdictStore[cp.id].verdict==='','source edit immediate revoke');
  e('ap-refresh').click();await new Promise(r=>setTimeout(r,0));e('ap-rule').value='WB-NOTICE';e('ap-reporter').value='합성 신고자';e('ap-incident').value='반례 발견 시험';e('ap-stop').click();check(SafetyRuntime.get().approvals['WB-NOTICE'].status==='suspended','incident suspension');
  check(SafetyRuntime.get().events.at(-1).kind==='incident','incident record preserved');
  for(let i=0;i<100&&EvalPreparationUI.isBusy();i++)await new Promise(r=>setTimeout(r,20));
  const incident=SafetyRuntime.get().events.at(-1),incidentCase=Object.values(EvalPreparationUI.getStore().cases).find(c=>c.source.incident_id===incident.id);
  check(incidentCase&&incidentCase.items[0].truth===''&&incidentCase.version==='unknown','incident intake is unreviewed, not automatic gold');
  w('backup').click();const backup=JSON.parse(await blobs.at(-1).text());upload('wb-restore',backup);
  for(let i=0;i<100&&SafetyRuntime.get().approvals['WB-NOTICE'].status!=='restored_pending';i++)await new Promise(r=>setTimeout(r,20));
  check(!SafetyRuntime.get().enabled&&SafetyRuntime.get().approvals['WB-NOTICE'].status==='restored_pending','rollback inactive');
  URL.createObjectURL=savedURL;HTMLAnchorElement.prototype.click=savedClick;
  return {blindedReview:true,datasetFamilies:60,approvalUI:true,actualApprovedPass:true,immediateRevoke:true,incidentStop:true,inactiveRestore:true};
 })()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
 await run(`document.getElementById('safety-workbench').querySelectorAll('details').forEach(d=>d.open=false);document.getElementById('safety-workbench').scrollIntoView();`);
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile('/private/tmp/contract-review-workbench.png',Buffer.from(shot.data,'base64'));
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({...result,externalRequests:external.length},null,2));
}finally{ws.close();}
