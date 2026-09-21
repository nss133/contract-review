// Isolated CDP contexts, synthetic data only. Never attaches to a user's page.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9380';
const output=process.env.CR_UI_OUTPUT||'/private/tmp/cr-v1905.KX1vFn';
const baseline=process.env.CR_UI_BASELINE||output+'/baseline.html';
const browser=await fetch(endpoint+'/json/version').then(r=>r.json()),ws=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let sequence=0;const pending=new Map(),contexts=[],errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method));},60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function run(p,expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},p.sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function page(url){const {browserContextId}=await send('Target.createBrowserContext');contexts.push(browserContextId);const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const p={sessionId};for(const domain of ['Runtime','Page','Network'])await send(domain+'.enable',{},sessionId);await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false},sessionId);await send('Page.navigate',{url},sessionId);await run(p,'new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=="undefined"&&typeof runAnalysis==="function"){clearInterval(t);ok();}else if(++n>200){clearInterval(t);no(Error("startup"));}},25);})');await run(p,'applyMotionPreference("reduce",false)');return p;}
const checks=[];function check(name,condition){assert(condition,name);checks.push(name);}
const click=(p,s)=>run(p,'document.querySelector('+JSON.stringify(s)+').click()');
const controls=()=>[...document.querySelectorAll('button[id],input[id],select[id],textarea[id]')].map(e=>({id:e.id,tag:e.tagName,type:e.type,text:e.tagName==='TEXTAREA'?'':e.textContent})).sort((a,b)=>a.id.localeCompare(b.id));
const results=()=>({rows:state.result.results.map(r=>({id:r.cpId,coverage:r.coverage,best:r.best?.clauseIndex})),verdicts:Object.entries(verdictStore).map(([id,v])=>({id,verdict:v.verdict,origin:v.origin,comment:v.comment||''})).sort((a,b)=>a.id.localeCompare(b.id)),text:document.getElementById('clause-rows').textContent});
async function snapshot(p,name){await run(p,'window.scrollTo(0,0);new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)))');const shot=await send('Page.captureScreenshot',{format:'png'},p.sessionId);await writeFile(output+'/'+name+'.png',Buffer.from(shot.data,'base64'));}
const sample=['UI 검증용 유지보수 용역계약서 (합성 자료)','위탁자 갑 주식회사와 수탁자 을 주식회사는 다음과 같이 계약한다.','제1조(목적)\n본 계약은 전산시스템의 유지보수 업무 위탁에 필요한 사항을 정한다.','제2조(업무범위)\n수탁자는 시스템 점검, 장애 대응 및 유지보수 업무를 수행한다.','제3조(계약기간)\n계약기간은 2026년 10월 1일부터 2027년 9월 30일까지로 한다.','제4조(대금)\n월 계약대금은 금 오백만원(5,000,000원)이며 부가가치세는 별도로 한다. 회사는 청구서를 받은 날부터 30일 이내 지급한다.','제5조(손해배상)\n당사자는 귀책사유로 상대방에게 발생한 손해를 배상한다. 다만 손해배상액은 최근 3개월간 지급한 계약대금을 한도로 한다.','제6조(비밀유지)\n비밀정보는 업무상 취득한 기술정보, 영업정보 및 고객정보를 포함한다. 당사자는 비밀정보를 제3자에게 공개하거나 업무 목적 외로 이용할 수 없다. 비밀유지 의무는 계약 종료 후 3년간 존속한다.','제7조(해지)\n상대방이 계약을 위반한 경우 서면으로 시정을 요구하고 14일 이내에 시정되지 않으면 계약을 해지할 수 있다.','제8조(종료 후 조치)\n계약 종료 시 수탁자는 회사의 자료를 반환하거나 폐기하고 업무 인계에 협조한다.','제9조(권리의 양도)\n당사자는 상대방의 사전 서면 동의 없이 본 계약의 권리와 의무를 제3자에게 양도할 수 없다.','제10조(변경)\n본 계약의 변경은 당사자 간 서면 합의에 의한다.','제11조(관할)\n본 계약에 관한 분쟁은 대한민국 법을 준거법으로 하며 서울중앙지방법원을 제1심 전속적 합의관할 법원으로 한다.'].join('\n\n');
try{
 const base=await page('file://'+baseline),app=await page(new URL('../dist/contract-review.html',import.meta.url).href);
 assert.deepEqual(await run(app,'('+controls.toString()+')()'),await run(base,'('+controls.toString()+')()'));checks.push('all original initial controls and labels retained');
 check('input uses full-width original block layout',await run(app,'(()=>{const t=document.getElementById("contract-text").getBoundingClientRect(),a=document.getElementById("analyze-input").getBoundingClientRect(),s=document.getElementById("input-setup").getBoundingClientRect();return t.width>=a.width-4&&s.top>t.bottom;})()'));
 check('no prototype controls shipped',await run(app,'!document.getElementById("ux-example")&&!document.getElementById("ux-preview-bar")'));
 await snapshot(app,'input');
 for(const p of [base,app])await run(p,'(async()=>{document.getElementById("contract-text").value='+JSON.stringify(sample)+';refreshInputSetup();return await runAnalysis();})()');
 assert.deepEqual(await run(app,'('+results.toString()+')()'),await run(base,'('+results.toString()+')()'));checks.push('mapping, automatic verdicts and complete checklist copy unchanged');
 assert.deepEqual(await run(app,'('+controls.toString()+')()'),await run(base,'('+controls.toString()+')()'));checks.push('all original post-analysis controls retained');
 check('three-column review retained',await run(app,'[...document.querySelectorAll(".clause-row")].every(e=>e.querySelectorAll(":scope > .cr-cell").length===3)'));
 await snapshot(app,'review');
 await click(app,'#auto-tools > summary');check('automatic management reachable',await run(app,'!!document.getElementById("standard-auto-start").closest("details[open]")'));await click(app,'#auto-tools > summary');
 for(const tab of ['checklist','evaluation','knowledge','verify','report','input','clauses']){await click(app,'.tab[data-tab="'+tab+'"]');check('tab '+tab,await run(app,'document.querySelector(".pane.active").id==="pane-'+tab+'"'));}
 await click(app,'#clause-rows .vd-btn[data-vcp="CNS-DAMAGE"][data-vd="검토의견"]');
 await run(app,'{const e=document.querySelector(".vd-note[data-vcp=CNS-DAMAGE][data-vfor=검토의견]");e.value="합성 시험 의견: 배상한도 조정 필요";e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}');
 await run(app,'new Promise(ok=>setTimeout(ok,500))');await click(app,'.tab[data-tab="report"]');
 check('report promotes written opinions',await run(app,'document.querySelector(".report-main #rpt-sec-results").textContent.includes("합성 시험 의견: 배상한도 조정 필요")'));
 check('pending count uses completion gate',await run(app,'pendingReviewCount()>0&&document.querySelector(".report-state strong").textContent==="추가 판단 "+pendingReviewCount()+"건"'));
 check('all pending items accessible',await run(app,'document.querySelectorAll(".report-next .rpt-pending-goto").length===pendingReviewCount()'));
 check('chart includes valid automatic judgments and matches pending gate',await run(app,'(()=>{const active={};state.result.results.forEach(r=>{if(verdictStore[r.cpId])active[r.cpId]=verdictStore[r.cpId]});const d=ReportLayout.distribution(pendingReviewItems().map(i=>i.id),active);return d.automatic>0&&d.pending===pendingReviewCount()&&d.automatic+d.reviewer+d.pending===d.total&&document.querySelector(".coverage-category.automatic dd").textContent===d.automatic+"건"&&document.querySelector(".coverage-bar").getAttribute("aria-label").includes("미판정·재확인 "+d.pending+"건");})()'));
 check('official primary brand colors applied',await run(app,'getComputedStyle(document.querySelector(".report-overview")).backgroundColor==="rgb(4, 59, 114)"&&getComputedStyle(document.getElementById("report-finish")).backgroundColor==="rgb(245, 130, 32)"'));
 check('static gradients on report and primary action',await run(app,'[".report-overview","#report-finish"].every(s=>getComputedStyle(document.querySelector(s)).backgroundImage.includes("linear-gradient"))'));
 check('large navigation and pending title surfaces are neutral',await run(app,'getComputedStyle(document.querySelector(".library-nav")).backgroundColor==="rgb(237, 241, 246)"&&getComputedStyle(document.querySelector(".report-side-title")).backgroundColor==="rgb(255, 255, 255)"'));
 check('decorative surfaces have no animation or backdrop blur',await run(app,'[".report-overview",".report-state",".report-dashboard","#report-finish"].every(s=>{const c=getComputedStyle(document.querySelector(s));return c.animationName==="none"&&c.backdropFilter==="none"&&c.filter==="none"})'));
 check('dashboard is explicitly not a legal safety score',await run(app,'document.querySelector(".coverage-note").textContent.includes("안전도·적정성 점수가 아닙니다")'));
 check('finish cannot save while pending',await run(app,'finishReview()===false&&pendingReviewCount()>0'));
 await click(app,'.rpt-pending-goto');check('pending link navigates to review',await run(app,'document.querySelector(".pane.active").id==="pane-clauses"'));await click(app,'.tab[data-tab="report"]');
 await click(app,'#opinion-edit');await run(app,'document.getElementById("opinion-textarea").value="직접 수정한 종합의견 <내용 보존>"');await click(app,'#opinion-save');
 check('edited comprehensive opinion persists',await run(app,'opinionStoreLoad().text==="직접 수정한 종합의견 <내용 보존>"&&document.querySelector(".ro-text").textContent.includes("<내용 보존>")'));
 check('report content and selected navigation agree',await run(app,'document.querySelector(".tab.active").dataset.tab==="report"&&document.querySelector(".pane.active").id==="pane-report"'));
 await snapshot(app,'report-pending');
 for(const width of [1440,1100,800]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false},app.sessionId);
  for(const tab of ['input','clauses','report']){await click(app,'.tab[data-tab="'+tab+'"]');check('no horizontal overflow '+tab+' '+width,await run(app,'document.documentElement.scrollWidth<=innerWidth+2'));}
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false},app.sessionId);
 await run(app,'pendingReviewItems().forEach(i=>applyVerdict(i.id,"이상없음","합성 시험 판단","","manual"));renderClauses();renderReport();');
 check('ready means can finish, not already saved',await run(app,'pendingReviewCount()===0&&document.querySelector(".report-state strong").textContent==="검토 마치기 가능"&&!document.querySelector(".report-state").textContent.includes("저장 완료")'));
 check('chart updates when pending judgments are resolved',await run(app,'document.querySelector(".coverage-category.pending dd").textContent==="0건"&&!document.querySelector(".coverage-count").textContent.includes("%")'));
 await click(app,'#report-finish');check('actual finish saves',await run(app,'document.getElementById("finish-msg").textContent.includes("저장")&&document.querySelector(".report-state strong").textContent==="검토 저장됨"'));
 check('manual opinion survives finish',await run(app,'verdictStore["CNS-DAMAGE"].comment==="합성 시험 의견: 배상한도 조정 필요"&&opinionStoreLoad().text==="직접 수정한 종합의견 <내용 보존>"'));
 check('review status border colors retain their meaning',await run(app,'(()=>{const done=document.querySelector(".clause-row.row-vd-done"),comment=document.querySelector(".clause-row.row-vd-comment");if(!done||!comment)return false;return getComputedStyle(done).borderLeftColor!==getComputedStyle(comment).borderLeftColor;})()'));
 await snapshot(app,'report-ready');
 await send('Emulation.setEmulatedMedia',{media:'print'},app.sessionId);await run(app,'window.dispatchEvent(new Event("beforeprint"));new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)))');
 check('print keeps opinion and hides administration',await run(app,'getComputedStyle(document.querySelector(".library-nav")).display==="none"&&getComputedStyle(document.querySelector("#report-body .admin-fold")).display==="none"&&document.querySelector(".ro-text").textContent.includes("직접 수정한")'));
 check('print retains graph and textual counts',await run(app,'getComputedStyle(document.querySelector(".report-dashboard")).display!=="none"&&getComputedStyle(document.querySelector(".coverage-bar")).display!=="none"&&document.querySelectorAll(".coverage-category dd").length===3'));
 const printPalette=await run(app,'({background:getComputedStyle(document.querySelector(".report-overview")).backgroundImage,text:getComputedStyle(document.querySelector(".report-contract-name")).color})');
 assert.deepEqual(printPalette,{background:'none',text:'rgb(4, 59, 114)'},'print removes decorative gradients and keeps dark text');checks.push('print removes decorative gradients and keeps dark text');
 await run(app,'window.dispatchEvent(new Event("afterprint"))');await send('Emulation.setEmulatedMedia',{media:''},app.sessionId);
 await run(app,'{const root=document.createElement("div");root.innerHTML="<div class=report-summary><h3>종합 리포트</h3></div>";ReportLayout.apply(root,{name:"<img src=x onerror=alert(1)>",pending:0,clauseCount:0});if(root.querySelector("img"))throw Error("unsafe report title");}');checks.push('contract title safely rendered as text');
 check('no runtime exceptions',errors.length===0);check('offline, no external requests',external.length===0);
 const report={version:await run(app,'CR.app_version'),passed:checks.length,checks,errors,external};
 await writeFile(output+'/ui-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{for(const browserContextId of contexts)await send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});ws.close();}
