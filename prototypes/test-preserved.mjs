import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const endpoint=process.env.CR_UX_ENDPOINT||'http://127.0.0.1:9377';
assert.match(endpoint,/^http:\/\/127\.0\.0\.1:\d+$/);
const output=process.env.CR_UX_OUTPUT||'/private/tmp/cr-ux-preserved.L3pdwF';
const browser=await fetch(endpoint+'/json/version').then(r=>r.json()),ws=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let sequence=0;const pending=new Map(),contexts=[],errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function run(page,expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},page.sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function page(path){const {browserContextId}=await send('Target.createBrowserContext');contexts.push(browserContextId);const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const p={sessionId,browserContextId,targetId};await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false},sessionId);await send('Page.navigate',{url:new URL(path,import.meta.url).href},sessionId);await run(p,'new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=="undefined"&&typeof runAnalysis==="function"){clearInterval(t);ok();}else if(++n>200){clearInterval(t);no(Error("startup"));}},25);})');await run(p,'applyMotionPreference("reduce",false)');return p;}
const checks=[];function check(name,condition){assert(condition,name);checks.push(name);}
const click=(p,s)=>run(p,'document.querySelector('+JSON.stringify(s)+').click()');
const controls=()=>[...document.querySelectorAll('button[id],input[id],select[id],textarea[id]')].filter(e=>!e.id.startsWith('ux-')).map(e=>({id:e.id,tag:e.tagName,type:e.type,text:e.tagName==='TEXTAREA'?'':e.textContent})).sort((a,b)=>a.id.localeCompare(b.id));
const results=()=>({rows:state.result.results.map(r=>({id:r.cpId,coverage:r.coverage,best:r.best?.clauseIndex})),verdicts:Object.entries(verdictStore).map(([id,v])=>({id,verdict:v.verdict,origin:v.origin,comment:v.comment||''})).sort((a,b)=>a.id.localeCompare(b.id)),copy:[...document.querySelectorAll('#clause-rows .ci-q,#clause-rows .decision-guide,#clause-rows .ci-guidance,#clause-rows .ci-basis,#clause-rows .ci-src')].map(e=>e.textContent),full_review_text:document.getElementById('clause-rows').textContent});
async function snapshot(p,name){await run(p,'window.scrollTo(0,0)');const shot=await send('Page.captureScreenshot',{format:'png'},p.sessionId);await writeFile(output+'/'+name+'.png',Buffer.from(shot.data,'base64'));}
try{
 const base=await page('../dist/contract-review.html'),proto=await page('./review-preserved-v2.html');
 const initialBase=await run(base,'('+controls.toString()+')()'),initialProto=await run(proto,'('+controls.toString()+')()');
 assert.deepEqual(initialProto,initialBase);checks.push('all original initial controls, options and labels identical');
 check('whole embedded dataset identical',await run(base,'JSON.stringify(CR)')===await run(proto,'JSON.stringify(CR)'));
 await snapshot(proto,'preserved-input');
 await click(proto,'#ux-example');const sample=await run(proto,'document.getElementById("contract-text").value');
 for(const p of [base,proto])await run(p,'(async()=>{document.getElementById("contract-text").value='+JSON.stringify(sample)+';refreshInputSetup();return await runAnalysis();})()');
 const br=await run(base,'('+results.toString()+')()'),pr=await run(proto,'('+results.toString()+')()');
 assert.deepEqual(pr,br);checks.push('same contract produces identical mappings, verdicts and checklist copy');
 assert.deepEqual(await run(proto,'('+controls.toString()+')()'),await run(base,'('+controls.toString()+')()'));checks.push('all original post-analysis controls and labels identical');
 check('real descriptions present',await run(proto,'document.querySelector("#clause-rows").textContent.includes("자동판정은 약정의 존재")'));
 check('real three columns retained',await run(proto,'[...document.querySelectorAll(".clause-row")].every(e=>e.querySelectorAll(":scope > .cr-cell").length===3)'));
 await snapshot(proto,'preserved-review');
 const before=await run(proto,'JSON.stringify(verdictStore)');
 await click(proto,'#ux-toggle');assert.deepEqual(await run(proto,'('+controls.toString()+')()'),await run(base,'('+controls.toString()+')()'));checks.push('original layout restores original controls');
 check('original panel location restored',await run(proto,'document.getElementById("standard-auto-panel").parentElement.id==="analyze-result"'));
 await click(proto,'#ux-toggle');check('layout switch preserves verdicts',before===await run(proto,'JSON.stringify(verdictStore)'));
 await click(proto,'#ux-auto-tools > summary');
 check('all automatic management tools reachable',await run(proto,'["standard-auto-start","standard-auto-stop","standard-auto-inspect","standard-auto-backup","standard-auto-restore","standard-auto-evaluate"].every(id=>{const e=document.getElementById(id);return Boolean(e.closest("#ux-auto-tools[open]"));})'));
 await click(proto,'#ux-auto-tools > summary');
 for(const tab of ['checklist','evaluation','knowledge','verify','report','input','clauses']){await click(proto,'.tab[data-tab="'+tab+'"]');check('tab reachable '+tab,await run(proto,'document.querySelector(".pane.active").id==="pane-'+tab+'"'));}
 await run(proto,'{const node=document.querySelector("#clause-rows [data-vcp=CNS-DAMAGE]");node.closest("details")?.setAttribute("open","");}');
 await click(proto,'#clause-rows .vd-btn[data-vcp="CNS-DAMAGE"][data-vd="검토의견"]');
 check('real opinion button works',await run(proto,'verdictStore["CNS-DAMAGE"].verdict==="검토의견"'));
 await run(proto,'{const el=document.querySelector("#clause-rows .vd-note[data-vcp=CNS-DAMAGE][data-vfor=검토의견]");el.value="기능 보존 시안 시험 의견";el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}');
 await run(proto,'new Promise(ok=>setTimeout(ok,500))');
 check('manual text stored by actual app',await run(proto,'verdictStore["CNS-DAMAGE"].comment==="기능 보존 시안 시험 의견"'));
 await click(proto,'#ux-toggle');await click(proto,'#ux-toggle');check('manual text survives layout changes',await run(proto,'verdictStore["CNS-DAMAGE"].comment==="기능 보존 시안 시험 의견"'));
 for(const width of [1440,1100,800]){await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false},proto.sessionId);check('review no horizontal overflow '+width,await run(proto,'document.documentElement.scrollWidth<=innerWidth+2'));await click(proto,'.tab[data-tab="input"]');check('input no horizontal overflow '+width,await run(proto,'document.documentElement.scrollWidth<=innerWidth+2'));await click(proto,'.tab[data-tab="clauses"]');}
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false},proto.sessionId);
 await run(proto,'document.querySelector("#clause-rows [data-vcp=CNS-DAMAGE]").closest(".clause-row").scrollIntoView({block:"start"})');
 const detail=await send('Page.captureScreenshot',{format:'png'},proto.sessionId);await writeFile(output+'/preserved-detail.png',Buffer.from(detail.data,'base64'));
 check('no runtime exceptions',errors.length===0);
 const original=await readFile(new URL('../dist/contract-review.html',import.meta.url)),manifest=JSON.parse(await readFile(new URL('./preservation-manifest.json',import.meta.url),'utf8'));
 check('release file unchanged',createHash('sha256').update(original).digest('hex')===manifest.source_sha256);
 const report={passed:checks.length,checks,mapped_checks:pr.rows.length,automatic_verdicts:pr.verdicts.filter(v=>v.origin==='auto').length,original_controls:initialBase.length,rendered_copy_blocks:pr.copy.length,errors};
 await writeFile(new URL('./preserved-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{for(const browserContextId of contexts)await send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});ws.close();}
