// Opens only this prototype's already-running, isolated preview target.
import {writeFile} from 'node:fs/promises';
const endpoint='http://127.0.0.1:9378';
const tabs=await fetch(endpoint+'/json/list').then(r=>r.json());
const target=tabs.find(t=>t.type==='page'&&t.url==='file:///Users/nsss/contract-review/prototypes/review-preserved-v2.html');
if(!target)throw Error('Dedicated prototype target not found');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let id=0;const requests=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=requests.get(m.id);if(p){requests.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function call(method,params={}){return new Promise((ok,no)=>{const n=++id,timer=setTimeout(()=>no(Error('timeout')),30000);requests.set(n,{ok,no,timer});ws.send(JSON.stringify({id:n,method,params}));});}
try{
 const r=await call('Runtime.evaluate',{expression:'(async()=>{if(document.getElementById("contract-text").value.trim())return {status:"existing preview input retained"};document.getElementById("ux-example").click();const result=await runAnalysis();if(result.status!=="completed")throw Error(JSON.stringify(result));const node=document.querySelector("#clause-rows [data-vcp=CNS-DAMAGE]");if(node){const detail=node.closest("details");if(detail)detail.open=true;node.closest(".clause-row").scrollIntoView({block:"start"});}return {status:result.status,checks:state.result.results.length,prototype:document.body.classList.contains("ux-modern")};})()',awaitPromise:true,returnByValue:true});
 if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
 await call('Page.bringToFront');
 // Never persist a screenshot if the user has already entered their own data.
 if(r.result.value?.status==='completed'){const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(new URL('./preserved-preview.png',import.meta.url),Buffer.from(shot.data,'base64'));}
 console.log(JSON.stringify(r.result.value));
}finally{ws.close();}
