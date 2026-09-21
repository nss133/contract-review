// 현재 배포 지식과 실제 앱 UI를 사용한 기본 자동판정·재실행 회귀 시험.
// 반드시 새 격리 컨텍스트를 사용한다. 기존 사용자 탭·localStorage·IndexedDB는 건드리지 않는다.
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9359';
const browser=await fetch(endpoint+'/json/version').then(r=>r.json());
const ws=new WebSocket(browser.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0,sessionId,browserContextId;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.sessionId===sessionId&&m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={},session=sessionId){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>300){clearInterval(t);no(Error('startup'));}},50);})`);}
const damage='당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.';
const ordinaryDisclaimer='수탁자는 손해배상 책임을 지지 않는다.';
const seriousDisclaimer='을은 고의 또는 중과실로 인한 모든 손해에 대해서도 배상책임을 지지 않는다.';
const text=['용역계약서','제1조(계약기간)','계약기간은 2026년 1월 1일부터 2026년 12월 31일까지로 한다.','제2조(부가세)','부가가치세는 별도로 한다.','제3조(관할)','본 계약과 관련하여 발생하는 분쟁에 관한 소송은 서울중앙지방법원을 전속관할 법원으로 한다.','제4조(해지)','당사자 일방이 본 계약상의 의무를 중대하게 위반한 경우 상대방은 30일의 기간을 정하여 서면으로 시정을 요구하고 그 기간 내에 시정하지 아니하면 서면 통지로 본 계약을 해지할 수 있다.','제5조(손해배상)',damage].join('\n');
const ids=['CNS-TERM','CMN-05','CMN-19','CNS-END','CNS-DAMAGE'];
async function analyze(body){await run(`(async()=>{document.getElementById('contract-text').value=${JSON.stringify(body)};refreshInputSetup();document.getElementById('btn-analyze').click();for(let n=0;n<200&&(!state.result||document.getElementById('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));if(!state.result||document.getElementById('btn-analyze').disabled||state.analyzedText!==${JSON.stringify(body)})throw Error('analysis: '+document.getElementById('analysis-progress-text').textContent);})()`);}
async function expectAuto(){await run(`{const ids=${JSON.stringify(ids)};if(!ids.every(id=>verdictStore[id]?.origin==='auto'&&verdictStore[id]?.verdict==='이상없음'))throw Error('auto: '+JSON.stringify({verdicts:verdictStore,report:SafetyRuntime.standardReport()}));if(pendingReviewItems().some(i=>ids.includes(i.id)))throw Error('auto still pending');}`);}
try{
 ({browserContextId}=await cdp('Target.createBrowserContext',{disposeOnDetach:true},null));
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank',browserContextId},null);
 ({sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true},null));
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();
 await analyze(text);await expectAuto();
 // v1.75: 관련 없는 빈칸과 두 문장으로 나뉜 책임 요건, 항목식 기간.
 const flexible=text.replace(damage,'당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 손해를 배상하여야 한다.\n손해배상의 범위는 통상손해로 한다.').replace('계약기간은 2026년 1월 1일부터 2026년 12월 31일까지로 한다.','계약기간: 2026. 1. 1. ~ 2026. 12. 31.')+'\n제9조(연락처)\n담당자: ______';
 await analyze(flexible);await expectAuto();
 // v1.88: 책임 귀속 약정의 존재와 구체적 위험을 구분한다. 일반 면책 표현만으로 실패시키지 않는다.
 await analyze(text.replace(damage,ordinaryDisclaimer));await expectAuto();
 // 앱에 설정된 회사명을 본문에서 갑으로 정의하여, 상대방 을의 고의·중과실 면책을 실제로 검증한다.
 const companyName=await run(`OUR_NAMES[0]`);if(!companyName)throw Error('configured company name missing');
 const parties='갑: '+companyName+'\n을: 합성서비스회사\n',riskText=parties+text.replace(damage,seriousDisclaimer);
 await analyze(riskText);
 await run(`{const r=SafetyRuntime.standardReport().rows.find(r=>r.check_id==='CNS-DAMAGE');if(state.partyContext.ourAliases.length!==1||state.partyContext.ourAliases[0]!=='갑'||!state.partyContext.counterpartyAliases.includes('을'))throw Error('company alias not unambiguously resolved: '+JSON.stringify(state.partyContext));if(r.eligible||r.recognition.stage!=='clause_found'||!r.blockers.some(b=>b.code==='B5')||verdictStore['CNS-DAMAGE']?.verdict)throw Error('serious counterparty exemption: '+JSON.stringify({result:r,verdict:verdictStore['CNS-DAMAGE'],party:state.partyContext}));document.getElementById('standard-auto-inspect').click();if(!document.getElementById('standard-auto-results').textContent.includes('판정 차단 근거'))throw Error('blocking text not displayed');}`);
 await analyze(text);await expectAuto();
 await run(`if(document.getElementById('standard-auto-confirm'))throw Error('approval control remains');runAnalysis();`);await expectAuto();
 await run(`location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();await analyze(text);await expectAuto();
 await analyze(parties+text);await expectAuto();
 await run(`document.getElementById('contract-text').value+=${JSON.stringify('\n'+seriousDisclaimer)};document.getElementById('contract-text').dispatchEvent(new Event('input'));if(verdictStore['CNS-DAMAGE']?.verdict)throw Error('stale verdict');`);
 await analyze(parties+text+'\n'+seriousDisclaimer);
 await run(`if(verdictStore['CNS-DAMAGE']?.verdict||!SafetyRuntime.standardReport().rows.find(r=>r.check_id==='CNS-DAMAGE').blockers.some(b=>b.code==='B5'))throw Error('serious exception passed after reanalysis');`);
 await analyze(text);await expectAuto();
 await run(`applyVerdict('CNS-DAMAGE','검토의견','사람의 수정 의견','','manual');applyAutoVerdicts();if(verdictStore['CNS-DAMAGE'].verdict!=='검토의견')throw Error('manual overwritten');SafetyRuntime.setStandard(false);if(verdictStore['CMN-05']?.verdict)throw Error('stop failed');`);
 await run(`location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();await analyze(text);
 await run(`if(SafetyRuntime.standardEnabled()||verdictStore['CMN-05']?.verdict)throw Error('explicit stop lost');document.getElementById('standard-auto-start').click();if(verdictStore['CMN-05']?.verdict!=='이상없음')throw Error('resume requires approval');if(verdictStore['CNS-DAMAGE']?.verdict!=='검토의견')throw Error('manual lost on reload');`);
 const privacy='수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.';
 // 개인정보 모듈이 명시된 입력을 실제 분석한 뒤 표준서식 자동 등록을 진행한다.
 await analyze('개인정보 처리위탁 계약서\n제1조(개인정보 처리위탁)\n위탁자는 고객 개인정보 처리 업무를 수탁자에게 위탁한다.\n제2조(점검)\n'+privacy);
 await run(`(async()=>{
  if(!state.activeModules.includes('X-PII'))document.querySelector('#input-screening [data-mid="X-PII"]').click();
  for(let n=0;n<200&&document.getElementById('btn-analyze').disabled;n++)await new Promise(r=>setTimeout(r,50));
  if(document.getElementById('btn-analyze').disabled)throw Error('module reanalysis timeout');
  const e=id=>document.getElementById('template-'+id);const original=extractFileStructure;extractFileStructure=async()=>({text:${JSON.stringify(privacy)}});
  const dt=new DataTransfer();dt.items.add(new File(['fixture'],'보안관리약정서.docx'));e('file').files=dt.files;await e('file').onchange();extractFileStructure=original;
  if(verdictStore['PRIV-07']?.verdict!=='이상없음')throw Error('template automatic verdict: '+JSON.stringify({module:state.activeModules,report:TemplateLibraryRuntime.report(),result:state.result.results.find(r=>r.cpId==='PRIV-07')}));
  if(pendingReviewItems().some(i=>i.id==='PRIV-07'))throw Error('template remains pending');
  if(!document.getElementById('standard-auto-summary').textContent.includes('표준서식 1개'))throw Error('template count missing');
  document.getElementById('standard-auto-inspect').click();if(!document.getElementById('standard-auto-results').textContent.includes('표준서식 근거로 이상없음 반영'))throw Error('diagnostic misleading');
 })()`);
 await run(`location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();
 await analyze('개인정보 처리위탁 계약서\n제1조(개인정보 처리위탁)\n위탁자는 고객 개인정보 처리 업무를 수탁자에게 위탁한다.\n제2조(점검)\n'+privacy);
 await run(`(async()=>{if(!state.activeModules.includes('X-PII'))document.querySelector('#input-screening [data-mid="X-PII"]').click();for(let n=0;n<200&&document.getElementById('btn-analyze').disabled;n++)await new Promise(r=>setTimeout(r,50));if(document.getElementById('btn-analyze').disabled||verdictStore['PRIV-07']?.verdict!=='이상없음')throw Error('template reload');})()`);
 // A current-contract archive write must not strand the async result or lose
 // the manual verdict. Exercise real IndexedDB storage and source refresh.
 await run(`(async()=>{
  StandardAutoArchive.setEnabled(true);
  const done=await runAnalysis();if(done.status!=='completed')throw Error('archive-enabled analysis: '+done.error);
  applyVerdict('PRIV-07','검토의견','원문 평가자료 저장 후에도 보존할 수기 의견','','manual');
  await new Promise(r=>setTimeout(r,1000));
  const archive=await StandardAutoArchive.backup();
  if(!archive.packets.some(p=>p.contract_hash===verdictHash&&p.verdicts['PRIV-07']?.comment==='원문 평가자료 저장 후에도 보존할 수기 의견'))throw Error('archive current manual missing');
  const repeat=await runAnalysis();if(repeat.status!=='completed'||verdictStore['PRIV-07']?.origin!=='manual'||verdictStore['PRIV-07']?.comment!=='원문 평가자료 저장 후에도 보존할 수기 의견')throw Error('archive refresh/reanalysis manual lost');
 })()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));
 console.log(JSON.stringify({isolated_context:true,default_auto:ids,ordinary_disclaimer_presence:true,serious_counterparty_exemption_blocked:true,reanalysis:true,reload:true,live_edit_revoke:true,exception_blocked:true,manual_preserved:true,explicit_stop_preserved:true,resume_without_approval:true,template_upload_to_actual_verdict:true,template_reload:true,archive_enabled_reanalysis_and_manual:true,not_pending:true,errors,external}));
}finally{if(browserContextId)await cdp('Target.disposeBrowserContext',{browserContextId},null).catch(()=>{});ws.close();}
