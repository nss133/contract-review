const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9358';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
 if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
 if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={}){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof SafetyRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>200){clearInterval(t);no(Error('startup'));}},50);})`);}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();
 await run(`localStorage.clear();location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();
 const result=await run(String.raw`(async()=>{
  const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
  e('contract-text').value='용역계약서\n제1조(대금)\n계약금액은 1,000만원(부가세 포함)이다.\n제2조(손해배상)\n당사자 일방은 자신의 귀책사유로 발생한 손해를 상대방에게 배상한다. 손해배상의 범위는 통상손해로 한다.\n제3조(비밀유지)\n비밀정보란 업무 중 알게 된 상대방의 비공개 정보를 말한다. 비밀정보는 목적 외로 사용하거나 제3자에게 누설하여서는 아니 된다. 비밀유지의무는 계약 종료 후 3년간 존속한다.\n제4조(지체상금)\n납품 지연 시 매일 계약금액의 0.3%를 지체상금으로 지급한다.';
  refreshInputSetup();e('btn-analyze').click();for(let n=0;n<150&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));
  check(['1.70.0','1.71.0','1.72.0','1.73.0','1.74.0','1.75.0','1.76.0','1.77.0','1.78.0','1.79.0','1.80.0','1.81.0','1.82.0','1.83.0','1.84.0','1.85.0','1.87.0'].includes(CR.app_version),'version');document.querySelector('.tab[data-tab="clauses"]').click();
  const all=[CR.common,...CR.types].flatMap(d=>d.checks),ids=all.map(c=>c.id);
  check(ids.length===206,'real catalogue shrink');check(!e('review-groups')&&!document.querySelector('.review-group-card,.group-child'),'no grouping UI');
  for(const r of CR.checklist_revision.replacements)for(const id of r.legacy_ids)check(!ids.includes(id),'retired source '+id);
  for(const id of ['CNS-DAMAGE','CNS-SECRET']){
    const labels=Array.from(document.querySelectorAll('#clause-rows .ci-id')).filter(n=>n.textContent===id);
    check(labels.length===1,'one inline checklist '+id+' '+JSON.stringify({labels:labels.length,result:state.result.results.find(r=>r.cpId===id),check:_cpById(id),other:Array.from(document.querySelectorAll('.ci-id')).filter(n=>n.textContent===id).map(n=>n.closest('[id]')?.id)}));check(labels[0].closest('.clause-row'),'three-column placement '+id);
    check(labels[0].closest('.compare-item').textContent.includes(_cpById(id).check),'actual new question '+id);
  }
  check(verdictStore['CMN-05']?.origin==='auto','VAT remains automatic in clause view');
  verdictStore['CMN-11']={verdict:'검토의견',comment:'과거 배상범위 수정 의견',origin:'manual'};
  groupReviewStore={DAMAGE:{version:'review-groups-v1',group_id:'DAMAGE',verdict:'이상없음',comment:'과거 별도 묶음 판정',origin:'manual',members:['CMN-11'],fingerprint:'legacy'}};
  saveVerdicts();saveGroupReviews();renderClauses();renderReport();
  check(!verdictStore['CNS-DAMAGE']?.verdict,'no automatic migration from old decisions');
  check(document.querySelector('#clause-rows').textContent.includes('과거 배상범위 수정 의견'),'legacy issue visible without child cards');
  const btn=document.querySelector('#clause-rows .vd-btn[data-vcp="CNS-DAMAGE"][data-vd="이상없음"]');check(btn,'inline decision');btn.click();
  check(verdictStore['CNS-DAMAGE']?.verdict==='이상없음','normal single verdict');
  check(verdictStore['CMN-11'].verdict==='검토의견','legacy unchanged');
  applyVerdict('CNS-SECRET','검토의견','비밀정보 공개 예외 보완','','manual');renderClauses();renderReport();
  check(e('report-body').textContent.includes('비밀정보 공개 예외 보완'),'ordinary report path');
  runAnalysis();check(verdictStore['CNS-DAMAGE'].verdict==='이상없음'&&!verdictStore['CNS-DAMAGE'].needs_reconfirmation,'reanalysis stable');
  loadVerdicts();check(verdictStore['CNS-DAMAGE'].verdict==='이상없음','reload stable');
  const out=currentVerdictExport({contract_hash:verdictHash,date:verdictToday()});
  check(out.verdicts['CNS-DAMAGE']&&out.verdicts['CMN-11']&&out.group_reviews.records.DAMAGE,'new and legacy exports');
  loopCorpus=Loop.mergeIntoCorpus(loopCorpus,out,{replaceCurrent:true});check(loopCorpus.byCheck['CNS-DAMAGE'],'new question corpus');
  for(const item of pendingReviewItems()){
    check(item.kind!=='group','no hidden parent gate');
    if(item.kind==='check')applyVerdict(item.id,'검토의견','검증용 검토완료','','manual');
    else state.findingStore=Findings.decide(state.findingStore,item.id,'dismissed',{comment:'검증',date:verdictToday()});
  }saveFindings();renderClauses();renderReport();check(pendingReviewCount()===0,'no retired hidden blockers '+JSON.stringify(pendingReviewItems().map(i=>({item:i,verdict:verdictStore[i.id]}))));finishReview();check(pendingReviewCount()===0,'finish stays complete');
  return {version:CR.app_version,checks:ids.length,newQuestions:12,retiredQuestions:44,inline:true,noNestedChecks:true,legacyPreserved:true,report:true,corpus:true,reanalysis:true,reload:true,finish:true,vatAuto:true};
 })()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});
 await run(`document.querySelector('#clause-rows .vd-btn[data-vcp="CNS-DAMAGE"]')?.closest('.clause-row').scrollIntoView();`);
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await (await import('node:fs/promises')).writeFile('/private/tmp/cr-content-v170.png',Buffer.from(shot.data,'base64'));
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({...result,external:external.length},null,2));
}catch(e){console.error(JSON.stringify({runtimeErrors:errors}));throw e;}finally{await cdp('Target.closeTarget',{targetId:target.id}).catch(()=>{});ws.close();}
