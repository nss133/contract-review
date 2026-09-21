const target = await fetch((process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9223')+'/json/new?about:blank', {method:'PUT'}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0; const pending=new Map(), errors=[], external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
  if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
  if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  await cdp('Runtime.enable');await cdp('Network.enable');
  await cdp('Page.navigate',{url:new URL('../dist/contract-review.html#admin',import.meta.url).href});
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof SafetyRuntime!=='undefined'){clearInterval(t);resolve();}else if(++n>100){clearInterval(t);reject(Error('timeout'));}},50);})`);
  const result=await evaluate(`(async()=>{
    const e=id=>document.getElementById(id), check=(ok,label)=>{if(!ok)throw Error(label);};
    e('contract-text').value='용역계약서\\n제1조(목적) 갑은 을에게 개발 용역을 위탁한다.\\n제2조(해지) 해지 시 30일 전에 서면 통지한다.';
    refreshInputSetup();e('btn-analyze').click();
    for(let i=0;i<100&&(!state.result||e('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,50));
    verdictStore={};groupReviewStore={};saveGroupReviews();saveVerdicts();renderClauses();renderReport();
    // 완료 집계의 모든 대상은 판정 컨트롤 또는 완결성 컨트롤로 접근 가능해야 한다.
    function assertReachable(){
      const items=pendingReviewItems();
      check(document.querySelectorAll('.rpt-pending-goto').length===items.length,'report exact pending list');
      for(const item of items){
        if(item.kind==='group'){check(!!document.getElementById('group-'+item.id),'missing group control '+item.id);continue;}
        const attr=item.kind==='check'?'data-vcp':'data-id';
        const selector=item.kind==='check'?'.vd-btn':'.integrity-decision';
        check(Array.from(document.querySelectorAll(selector)).some(n=>n.getAttribute(attr)===item.id),'missing control '+item.id);
      }
    }
    assertReachable();
    const r=state.result.results.find(r=>!groupForCheck(r.cpId)&&r.cpId!=='CMN-05');check(r,'independent fixture');
    const cp=r.cpId;
    // quiet/base-covered + 저장된 사람 판정 재확인도 숨기지 않는다.
    r.coverage='quiet';r.best=null;r.ruleCoverage='quiet';r.ruleBest=null;
    applyVerdict(cp,'이상없음','유지할 메모','반영되어 있음');
    verdictStore[cp].needs_reconfirmation=true;
    renderClauses();renderReport();assertReachable();
    const link=Array.from(document.querySelectorAll('.rpt-pending-goto')).find(n=>n.getAttribute('data-id')===cp);
    check(link,'reconfirmation report link');link.click();
    check(document.activeElement.getAttribute('data-vcp')===cp,'report link reaches exact control');
    const getButton=()=>Array.from(document.querySelectorAll('#clause-rows .vd-btn, #consider-block .vd-btn')).find(n=>n.getAttribute('data-vcp')===cp&&n.getAttribute('data-vd')==='이상없음');
    check(getButton(),'quiet reconfirmation visible');getButton().click();
    check(verdictStore[cp].verdict==='이상없음'&&!verdictStore[cp].needs_reconfirmation,'same verdict reconfirms');
    check(verdictStore[cp].comment==='유지할 메모','memo retained');
    getButton().click();check(verdictStore[cp].verdict==='이상없음','second click does not cancel');
    applyReason(cp,'수용 가능한 위험');
    const fingerprint=verdictStore[cp].manual_context;check(fingerprint===SafetyRuntime.inputKey(),'reason preserves context');
    applyAutoVerdicts();check(!verdictStore[cp].needs_reconfirmation,'unchanged analysis retains verdict');
    const other=state.result.results.find(x=>x.cpId!==cp).cpId;
    state.reassign[other]=0;
    applyAutoVerdicts();check(!verdictStore[cp].needs_reconfirmation,'unrelated mapping retains human verdict');
    delete state.reassign[other];
    const oldEngine=CR.engine_fingerprint;CR.engine_fingerprint='synthetic-update';
    applyAutoVerdicts();check(!verdictStore[cp].needs_reconfirmation,'engine update retains human verdict');
    CR.engine_fingerprint=oldEngine;
    state.reassign[cp]=0;
    applyAutoVerdicts();check(verdictStore[cp].needs_reconfirmation,'own mapping change requires review');
    delete state.reassign[cp];applyVerdict(cp,'이상없음','유지할 메모','반영되어 있음');
    // 재분석·저장 재로드 이후 잔여 목록과 모든 컨트롤 일치.
    runAnalysis();renderReport();assertReachable();
    verdictStore[cp].manual_context_v2='synthetic-stale-input';
    verdictStore[cp].needs_reconfirmation=true;saveVerdicts();
    check(pendingReviewCount()>0,'explicit reconfirmation fixture');
    check(finishReview()===false,'finish still blocks genuinely pending items');
    for(const item of pendingReviewItems()){
      if(item.kind==='check')applyVerdict(item.id,'이상없음','합성시험 직접 확인','반영되어 있음');
      else if(item.kind==='group'){const u=currentReviewGroups().find(u=>u.id===item.id);
        groupReviewStore=ReviewGroups.decide(u,verdictStore,groupReviewStore,groupContextKey(u),{verdict:'이상없음',comment:'합성시험 통합 확인',date:verdictToday()});saveGroupReviews();}
      else state.findingStore=Findings.decide(state.findingStore,item.id,'no_issue','합성시험');
    }
    renderClauses();renderReport();check(pendingReviewCount()===0,'all reviewed reaches zero');
    loadVerdicts();applyAutoVerdicts();renderClauses();renderReport();check(pendingReviewCount()===0,'reload keeps completion');
    e('report-finish').click();check(e('finish-msg').textContent.includes('저장되었음'),'actual finish succeeds');
    reviewHistory={latest:{'synthetic-history':'rev'},records:{rev:{fingerprint:'rev1',request:{contract_name:'합성 평가 후보',department:'정보보호'},result:{review_text:'과거비밀의견'}}}};
    e('he-refresh').click();check(e('he-candidate').options.length===1,'history candidate import');
    e('he-family').value='synthetic-evaluation-family';e('he-date').value='2026-09-15';
    e('he-generate').click();check(e('he-message').textContent.includes('버전'),'unknown version blocked');
    e('he-version').value='before';e('he-confirm').checked=true;e('he-confirm').dispatchEvent(new Event('change'));
    const blobs=[],oldURL=URL.createObjectURL,oldClick=HTMLAnchorElement.prototype.click;
    URL.createObjectURL=b=>{blobs.push(b);return oldURL(b);};HTMLAnchorElement.prototype.click=function(){};
    e('he-generate').click();check(blobs.length===3,'evaluation artifacts: '+e('he-message').textContent);
    const observation=JSON.parse(await blobs[0].text()),gold=JSON.parse(await blobs[1].text());
    check(gold.labels.length===238&&gold.labels.every(x=>x.truth===''),'all labels blank');
    check(!JSON.stringify(gold).includes('과거비밀의견'),'prior opinion not leaked');
    check(observation.context.retrieval.sources.length===0&&observation.context.history_evaluation,'history search excluded');
    e('contract-text').value+='변경';e('he-generate').click();check(blobs.length===3,'stale document blocks generation');
    URL.createObjectURL=oldURL;HTMLAnchorElement.prototype.click=oldClick;
    return {passed:true,checks:state.result.results.length,pending:pendingReviewCount()};
  })()`);
  if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));
  console.log(JSON.stringify({...result,external:external.length}));
} finally {await cdp('Page.close').catch(()=>{});ws.close();}
