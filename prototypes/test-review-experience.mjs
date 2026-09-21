import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const endpoint=process.env.CR_UX_ENDPOINT||'http://127.0.0.1:9376';
const preview=process.env.CR_UX_PREVIEW||'/private/tmp/cr-ux-prototype.o2h0Vj/preview.html';
const output=process.env.CR_UX_OUTPUT||'/private/tmp/cr-ux-prototype.o2h0Vj';
assert.match(endpoint,/^http:\/\/127\.0\.0\.1:\d+$/);
const browser=await fetch(endpoint+'/json/version').then(r=>r.json());
const ws=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const requests=new Map(),contexts=[],errors=[];
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{requests.delete(id);reject(Error(method+' timed out'));},12000);requests.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Target.attachedToTarget')send('Runtime.enable',{},m.params.sessionId).catch(error=>errors.push(String(error)));if(m.method==='Runtime.executionContextCreated')contexts.push({sessionId:m.sessionId,...m.params.context});if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);const p=requests.get(m.id);if(p){requests.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
const {browserContextId}=await send('Target.createBrowserContext');
const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
let frameContext,frameSession;
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(frameContext?{contextId:frameContext}:{})},frameSession||sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const checks=[];
function check(name,condition){assert(condition,name);checks.push(name);}
const click=s=>evaluate('document.querySelector('+JSON.stringify(s)+').click()');
const text=s=>evaluate('document.querySelector('+JSON.stringify(s)+').textContent');
async function screenshot(name){const m=await send('Page.getLayoutMetrics',{},sessionId);const snap=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:Math.min(m.cssContentSize.width,1600),height:Math.min(m.cssContentSize.height,1800),scale:1}},sessionId);await writeFile(output+'/'+name+'.png',Buffer.from(snap.data,'base64'));}
try{
 await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId);
 await send('Emulation.setDeviceMetricsOverride',{width:1080,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 await send('Page.navigate',{url:pathToFileURL(preview).href},sessionId);
 // The standalone renderer has no host Tweak service. Supply only its binding API
 // in the test iframe, before the unmodified fragment, to exercise those options.
 await evaluate('new Promise(resolve=>{const timer=setInterval(()=>{if(document.querySelector("iframe")){clearInterval(timer);resolve();}},20);})');
 contexts.length=0;
 await evaluate('(()=>{const f=document.querySelector("iframe");f.srcdoc=f.srcdoc.replace("<head>","<head><script>globalThis.__uxTweaks={};globalThis.Tweak=class{constructor(options){this.options=options;}addToggle(obj,key){globalThis.__uxTweaks[key]={obj,key,change:this.options.onChange};}addSelect(obj,key){this.addToggle(obj,key);}};<\\/script>");})()');
 for(let n=0;n<100&&!frameContext;n++){for(const ctx of [...contexts].reverse()){if(!ctx.auxData?.isDefault)continue;try{const r=await send('Runtime.evaluate',{expression:'Boolean(document.getElementById("cr-experience"))',contextId:ctx.id,returnByValue:true},ctx.sessionId);if(r.result?.value){frameContext=ctx.id;frameSession=ctx.sessionId;break;}}catch{}}if(!frameContext)await new Promise(r=>setTimeout(r,50));}
 assert(frameContext,'fragment context found');
 await evaluate('new Promise(resolve=>{let n=0;const timer=setInterval(()=>{if(document.querySelector("#cr-experience svg")||++n>40){clearInterval(timer);resolve();}},50);})');
 check('initial input visible',await evaluate('!document.querySelector("[data-page=input]").hidden'));
 await screenshot('input');
 await click('[data-action="scope"]');await evaluate('document.querySelector("[name=contract-type]").value="일반 용역"');await click('[data-action="scope-done"]');check('scope preview updated',(await text('[data-summary="type"]'))==='일반 용역');
 await click('[data-action="sample"]');check('sample document added',await evaluate('!document.querySelector(".cr-extra-file").hidden'));check('document count includes extra',(await text('.cr-section-heading .cr-small')).includes('3개'));
 await click('[data-action="remove-extra"]');
 await click('[data-action="start"]');
 check('five aligned clause rows',await evaluate('document.querySelectorAll(".cr-review-row").length===5'));
 check('two pending initially',(await text('.cr-remaining')).includes('2개'));
 await screenshot('review');
 await click('[data-action="evidence"][data-item="secret"]');check('one relevant annex excerpt',await evaluate('document.querySelectorAll(".cr-source-detail").length===1'));
 await click('[data-action="opinion"][data-item="damage"]');
 await click('[data-action="save-next"][data-item="damage"]');check('empty note rejected',await evaluate('!document.querySelector("[data-id=damage] .cr-error-text").hidden'));
 await evaluate('(()=>{const t=document.querySelector("[data-note=damage]");t.value="배상 한도는 예상 손해를 고려하여 조정할 것을 제안합니다.";t.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await click('[data-action="save-next"][data-item="damage"]');
 check('opinion completed not pending',(await text('.cr-remaining')).includes('1개'));
 check('opinion remains in third column',(await text('[data-id="damage"] .cr-pending')).includes('의견 작성 완료'));
 await click('[data-action="pass"][data-item="termination"]');check('manual pass moves second column',(await text('[data-id="termination"] .cr-completed')).includes('검토자 확인'));
 check('all required done',(await text('.cr-remaining'))==='필수 검토 완료');
 await click('[data-action="undo"]');check('undo restores pending',(await text('.cr-remaining')).includes('1개'));
 await click('[data-action="pass"][data-item="termination"]');
 await click('[data-action="results"]');await click('[data-action="finish"]');check('completion reachable',(await text('.cr-result-banner')).includes('예시 검토를 마쳤습니다'));
 await click('[data-screen="input"]');await click('[data-action="annex"]');await click('[data-screen="review"]');check('missing annex is pending',(await text('[data-id="secret"] .cr-pending')).includes('참조된 보안관리약정서가 없어'));
 await click('[data-action="undo"]');await click('[data-screen="input"]');check('undo restores annex visibility',await evaluate('!document.querySelector(".cr-annex-file").hidden'));
 await click('[data-screen="review"]');
 check('design alternatives available',await evaluate('Boolean(globalThis.__uxTweaks?.saveFailure)'));
 await evaluate('(()=>{const t=globalThis.__uxTweaks.saveFailure;t.obj[t.key]=true;t.change();})()');
 await click('[data-action="edit"][data-item="price"]');await click('[data-action="pass"][data-item="price"]');
 check('failed save is visible',await evaluate('!document.querySelector(".cr-failure").hidden'));
 await click('[data-action="results"]');await click('[data-action="finish"]');check('failed save blocks final completion',await evaluate('!document.querySelector("[data-page=review]").hidden'));
 await click('[data-action="retry"]');check('retry clears save failure',await evaluate('document.querySelector(".cr-failure").hidden'));
 await evaluate('(()=>{const t=globalThis.__uxTweaks.compact;t.obj[t.key]=true;t.change();})()');
 check('compact alternative applied',await evaluate('document.getElementById("cr-experience").style.getPropertyValue("--cr-pad")==="15px"'));
 for(const width of [1366,1024,736,375,320]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
   check('no overflow '+width,await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'));
   await click('[data-screen="input"]');check('input no overflow '+width,await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'));await click('[data-screen="review"]');
 }
 await evaluate('window.scrollTo(0,0)');
 await screenshot('mobile');
 check('no runtime exceptions',errors.length===0);
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
 await writeFile(output+'/verification.json',JSON.stringify({passed:checks.length,checks,errors},null,2));
}finally{await send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});ws.close();}
