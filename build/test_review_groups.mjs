// Synthetic contract only; caller supplies an isolated browser profile.
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9357';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
 if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
 if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={}){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});
 await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof SafetyRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>200){clearInterval(t);no(Error('startup'));}},50);})`);
 await run(`localStorage.clear();location.reload();`);
 await new Promise(r=>setTimeout(r,300));
 await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof SafetyRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>200){clearInterval(t);no(Error('reload'));}},50);})`);
 const result=await run(String.raw`(async()=>{
  const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
  const text='용역계약서\n제1조(업무범위)\n수탁자는 사무실 시설 관리 용역을 수행한다.\n제2조(대금)\n계약금액은 1,000만원(부가세 포함)이다.\n제3조(손해배상)\n당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.\n제4조(책임상한)\n손해배상 책임의 한도는 계약금액으로 한다.\n제5조(비밀유지)\n비밀정보란 상대방으로부터 제공받은 비공개 업무자료를 말한다.\n제6조(존속기간)\n비밀유지의무는 계약 종료 후 3년간 존속한다.\n제7조(지체상금)\n납품이 지연되면 매일 계약금액의 0.3%를 지체상금으로 지급한다.';
  e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();
  for(let n=0;n<150&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));
  check(state.result,'analysis');check(CR.app_version==='1.69.0','version');
  document.querySelector('.tab[data-tab="clauses"]').click();
  check(verdictStore['CMN-05']?.verdict==='이상없음'&&verdictStore['CMN-05'].origin==='auto','VAT automatically recognized without start button');
  check(e('group-DAMAGE')&&e('group-SECRET'),'damage and confidentiality cards');
  check(!document.querySelector('#clause-rows .vd-btn[data-vcp="CMN-11"]'),'no duplicate individual damage card');
  check(!document.querySelector('#clause-rows .vd-btn[data-vcp="CMN-05"]'),'VAT fact panel only');
  const damage=()=>currentReviewGroups().find(u=>u.id==='DAMAGE');
  applyVerdict('CMN-11','검토의견','배상범위 재검토','','manual');renderClauses();
  e('group-DAMAGE').querySelector('[data-verdict="이상없음"]').click();
  check(!groupReviewStore.DAMAGE&&e('group-DAMAGE').querySelector('.group-message').textContent.includes('이유'),'adverse override requires explanation');
  e('group-DAMAGE').querySelector('.group-note').value='별첨의 책임 예외까지 확인한 통합 결론';
  e('group-DAMAGE').querySelector('[data-verdict="이상없음"]').click();
  check(damage().status.done,'one parent decision completes');
  check(verdictStore['CMN-11'].verdict==='검토의견','old issue preserved');
  check(!pendingReviewItems().some(x=>x.kind==='group'&&x.id==='DAMAGE'),'completion counts parent once');
  const out=currentVerdictExport({contract_hash:verdictHash,date:verdictToday()});
  check(out.group_reviews.records.DAMAGE&&!out.group_reviews.records.DAMAGE.needs_reconfirmation,'export parent with validity');
  check(out.verdicts['CMN-11'].verdict==='검토의견','no child gold rewrite');
  loopCorpus=Loop.mergeIntoCorpus(loopCorpus,out,{replaceCurrent:true});
  check(loopCorpus.judgment_ledger.records[verdictHash].snapshot.group_reviews.records.DAMAGE,'corpus parent retained');
  StandardAutoArchive.setEnabled(true);StandardAutoArchive.schedule();await new Promise(r=>setTimeout(r,900));
  const evaluation=await StandardAutoArchive.run();check(evaluation.group_checked>=1,'separate parent evaluation denominator');
  const backup=await StandardAutoArchive.backup();check(backup.packets.some(p=>p.group_reviews?.records?.DAMAGE),'internal evaluation backup preserves parent');
  runAnalysis();check(damage().status.done,'reanalysis preserves parent');
  loadVerdicts();check(damage().status.done,'local reload preserves parent');
  applyVerdict('CMN-14','검토의견','상한 추가 보완','','manual');renderClauses();
  check(damage().status.stale,'child change requires parent reconfirm');
  e('group-DAMAGE').querySelector('.group-note').value='손해배상 상한 수정 필요';
  e('group-DAMAGE').querySelector('[data-verdict="검토의견"]').click();
  check(document.getElementById('report-body').textContent.includes('손해배상 상한 수정 필요'),'parent opinion in report');
  const oldSub=state.subDocs;state.subDocs=[{name:'추가 별첨',text:'책임한도 변경'}];
  check(damage().status.stale,'annex change invalidates');state.subDocs=oldSub;
  check(damage().status.done,'original context stable');
  const before=pendingReviewItems();
  currentReviewGroups().filter(u=>u.required&&!u.status.done).forEach(u=>{
    groupReviewStore=ReviewGroups.decide(u,verdictStore,groupReviewStore,groupContextKey(u),{verdict:'검토의견',comment:'시험용 검토의견',date:verdictToday()});
  });saveGroupReviews();
  pendingReviewItems().filter(x=>x.kind==='check').forEach(x=>applyVerdict(x.id,'검토의견','시험용 확인','','manual'));
  pendingReviewItems().filter(x=>x.kind==='integrity').forEach(x=>{state.findingStore=Findings.decide(state.findingStore,x.id,'dismissed',{comment:'시험',date:verdictToday()});});saveFindings();
  renderClauses();renderReport();check(pendingReviewCount()===0,'no hidden child completion blocker');
  finishReview();check(pendingReviewCount()===0,'finish after runtime reevaluation');
  e('contract-text').value=text+'\n제8조(부가세)\n부가세 제외';e('contract-text').dispatchEvent(new Event('input',{bubbles:true}));
  check(damage().status.stale,'live text invalidates parent');check(verdictStore['CMN-05']?.verdict!=='이상없음','live edit revokes VAT');
  e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();
  for(let n=0;n<100&&e('btn-analyze').disabled;n++)await new Promise(r=>setTimeout(r,50));
  document.querySelector('.tab[data-tab="clauses"]').click();
  return {version:CR.app_version,groups:currentReviewGroups().length,initialPending:before.length,vatAuto:true,parentOnce:true,childPreserved:true,
    report:true,corpus:true,parentEvaluation:true,internalBackup:true,reanalysis:true,localReload:true,changedChildInvalidation:true,annexInvalidation:true,liveEditInvalidation:true,finish:true};
 })()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await run(`document.getElementById('review-groups').scrollIntoView();`);
 const shot=await cdp('Page.captureScreenshot',{format:'png'});
 await (await import('node:fs/promises')).writeFile('/private/tmp/cr-review-groups.png',Buffer.from(shot.data,'base64'));
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({...result,external:external.length},null,2));
}finally{await cdp('Target.closeTarget',{targetId:target.id}).catch(()=>{});ws.close();}
