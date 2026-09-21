/* 합성 자료만 사용: 다계약 선택·분할·5조건·출처 격리·저장·재개 */
import fs from 'node:fs/promises';
const target=await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});
 await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof EvalBatch!=='undefined'&&!EvalPreparationUI.isBusy()){clearInterval(t);resolve();}else if(++n>200){clearInterval(t);reject(Error('init timeout'));}},50);})`);
 const result=await run(`(async()=>{
  const e=id=>document.getElementById('eb-'+id),check=(v,s)=>{if(!v)throw Error(s);};
  async function wait(){for(let i=0;i<1000&&e('run').disabled;i++)await new Promise(r=>setTimeout(r,20));check(!e('run').disabled,'operation timeout');}
  async function click(id){e(id).click();await wait();}
  let before;const unique='batch-'+Date.now(),s=EvalPreparationUI.getStore(),ids=[];
  s.trials=s.trials||{};
  for(const n of [1,2]){
    const key=SafetyDigest.of(unique+n),text='제1조(해지)\\n수탁자는 해지 시 30일 전에 서면 통지하여야 한다.\\n제2조(업무)\\n유지보수 서버 백업 '+(n===1?'가나다':'라마바');
    const c={key,source:{id:'contract:'+unique+n,review_id:unique+n,kind:'contract',title:'합성 유지보수 서버 백업 '+n,department:'정보보호',tags:[],references:[],conflicts:[]},version:'before',documents:[{name:'본문'+n,text,role:'main'}],items:[{id:'i',quote:'수정 필요',check_id:'CMN-09',reviewer:'준비',status:'reviewed_draft'}]};
    c.items[0].context_digest=SafetyDigest.of([c.version,c.documents]);s.cases[key]=c;
    const clauses=segmentContract(text).map(x=>({...x,document:'본문'+n})),t=EvalTrial.freeze(c,SafetyRuntime.allChecks(),clauses),direct=clauses.filter(x=>(x.heading+' '+x.body).includes('통지')).map(x=>x.index);
    for(const reviewer of ['검수 A','검수 B'])EvalTrial.saveReview(t,{trial_id:t.id,seal:t.seal,reviewer,independent:true,source_reviewed:true,labels:[{id:'CMN-09',truth:'issue',direct,reason:'합성 판단',evidence:'본문 제1조'}]});s.trials[t.id]=t;ids.push(t.id);
    const editor=document.getElementById('contract-text');editor.value=text;refreshInputSetup();document.getElementById('btn-analyze').click();
    for(let i=0;i<200&&(!state.result||document.getElementById('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,20));
    document.getElementById('checklist-type').value='outsourcing';state.partyRoles=['위탁자'];runAnalysis();
    const ctx=SafetyRuntime.bundle().context;ctx.source_quality_confirmed=true;ctx.scope_confirmed=true;
    t.operational=EvalOperational.bind(t,c,{analyzed:true,documents:safetyDocuments(),clauses:state.clauses,context:ctx,subDocs:state.subDocs||[]},SafetyRuntime.allChecks(),'합성 연결자',CR.engine_fingerprint);
  }
  reviewHistory={latest:{old:'old'},records:{old:{request:{contract_name:'유지보수 서버 백업',department:'정보보호'},result:{created_at:'2025-01-01',review_text:'수탁자는 해지 시 서면 통지하여야 한다.'}}}};
  legalOpinionKnowledge={latest:{legal:'legal',self:'self',unknown:'unknown'},documents:{
    legal:{source_id:'legal',title:'유지보수 서버 백업',date:'2025-01-02',tags:[],evidence:[{sentence:'수탁자는 해지 시 서면 통지하여야 한다.'}]},
    self:{source_id:'self',title:'유지보수 서버 백업',date:'2025-01-03',tags:[],original:{review_id:unique+2},evidence:[{sentence:'수탁자는 해지 시 서면 통지하여야 한다.'}]},
    unknown:{source_id:'unknown',title:'유지보수 서버 백업',tags:[],evidence:[]}}};
  s.active=ids.map(id=>s.trials[id].snapshot.case_key);await EvalPreparationUI.save();EvalPreparationUI.refresh();document.querySelector('[data-tab="evaluation"]').click();
  const ep=document.getElementById('ep-cases');ep.value=s.trials[ids[1]].snapshot.case_key;ep.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,20));
  document.getElementById('et-load').click();await new Promise(r=>setTimeout(r,20));const ts=document.getElementById('et-saved');ts.value=ids[1];ts.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,20));
  const eo=id=>document.getElementById('eo-'+id);eo('actor').value='연결 확인자';eo('confirm').checked=true;eo('bind').click();await new Promise(r=>setTimeout(r,100));check(eo('message').textContent.includes('연결 저장됨'),'actual binding UI: '+eo('message').textContent);
  before=JSON.stringify({text:state.text,verdicts:verdictStore,policy:SafetyRuntime.get(),mode:MatcherConfig.TAG_MATCH_MODE});
  e('panel').open=true;await click('refresh');e('owner').value='합성 평가 담당자';
  e('cases').querySelectorAll('tr[data-trial]').forEach(row=>{const n=ids.indexOf(row.dataset.trial);row.querySelector('.select').checked=n>=0;if(n>=0){row.querySelector('.family').value='합성 묶음 '+n;row.querySelector('.date').value=n===0?'2026-01-01':'2026-02-01';row.querySelector('.split').value=n===0?'development':'test';}});
  e('sources').querySelectorAll('tr[data-source]').forEach(row=>{const id=row.dataset.source;row.querySelector('.select').checked=id!=='unknown';row.querySelector('.family').value=id==='self'?'합성 묶음 1':'과거 '+id;row.querySelector('.date').value='2025-01-01';});
  await click('save');await click('freeze');check(e('message').textContent.includes('고정됨'),'freeze: '+e('message').textContent);const batchId=e('saved').value;
  await click('run');check(e('message').textContent.includes('5개 조건 비교 저장됨'),'run: '+e('message').textContent);
  const b=s.batches[batchId],r=b.runs[0];check(r.results.length===5&&r.comparisons.length===4,'five conditions and paired changes');
  const cr=r.results.find(x=>x.mode==='contract').rows[1],lr=r.results.find(x=>x.mode==='legal').rows[1],all=r.results.find(x=>x.mode==='combined').rows[1];
  check(cr.sources.length===1&&cr.sources[0].kind==='contract_review','contract sources isolated');check(lr.sources.length===1&&lr.sources[0].kind==='legal_review','legal sources isolated');check(all.sources.length===2&&!all.sources.some(x=>x.id==='self'),'self lineage excluded');
  check(b.snapshot.excluded_unconfirmed===1,'unconfirmed source excluded');
  check(JSON.stringify({text:state.text,verdicts:verdictStore,policy:SafetyRuntime.get(),mode:MatcherConfig.TAG_MATCH_MODE})===before,'live review policy and tag mode unchanged');
  const oldTitle=legalOpinionKnowledge.documents.legal.title;legalOpinionKnowledge.documents.legal.title+='수정';await click('run');check(e('message').textContent.includes('새 평가묶음'),'changed corpus blocks stale scoring');legalOpinionKnowledge.documents.legal.title=oldTitle;
  e('saved').value=batchId;await click('load');check(e('result').textContent.includes('법률검토'),'stored readable results');
  eo('refresh').click();await new Promise(r=>setTimeout(r,20));eo('batch').value=batchId;eo('build').click();
  for(let i=0;i<1000&&!eo('message').textContent.includes('시험셋 저장됨');i++){if(eo('message').textContent.startsWith('보류:'))throw Error(eo('message').textContent);await new Promise(r=>setTimeout(r,20));}
  check(eo('message').textContent.includes('시험셋 저장됨'),'operational dataset save');const dataset=s.operational_sets[eo('dataset').value];check(dataset.cases.length===2&&dataset.cases[0].golds[0].labels[0].truth==='issue','truth preserved in approval format');
  eo('transfer').click();await new Promise(r=>setTimeout(r,30));check(document.getElementById('wb-cases').textContent.includes('OP-'),'fileless workbench transfer');
  check(JSON.stringify({text:state.text,verdicts:verdictStore,policy:SafetyRuntime.get(),mode:MatcherConfig.TAG_MATCH_MODE})===before,'operational replay leaves live verdicts intact');
  return {batchId,fiveConditions:true,selfExcluded:true,unchangedLiveReview:true,operationalTransfer:true};
 })()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await run(`document.getElementById('eb-result').scrollIntoView({block:'start'});new Promise(r=>setTimeout(r,300))`);
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile('/private/tmp/contract-eval-batch.png',Buffer.from(shot.data,'base64'));
 await cdp('Page.reload');await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof EvalBatch!=='undefined'&&!EvalPreparationUI.isBusy()){clearInterval(t);resolve();}else if(++n>200){clearInterval(t);reject(Error('reload timeout'));}},50);})`);
 const resumed=await run(`!!EvalPreparationUI.getStore().batches[${JSON.stringify(result.batchId)}]?.runs.length`);
 if(!resumed||errors.length||external.length)throw Error(JSON.stringify({resumed,errors,external}));console.log(JSON.stringify({...result,resumed,externalRequests:external.length}));
}finally{await cdp('Page.close').catch(()=>{});ws.close();}
