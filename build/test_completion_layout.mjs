// 별첨 단독 자동완료가 기존 삼단 화면의 ②에 남고 입력칸이 옆 열로 넘치지 않는지 확인.
import fs from 'node:fs';
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9359';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={}){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>300){clearInterval(t);no(Error('startup'));}},50);})`);}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();
 await run('localStorage.clear();location.reload();');await new Promise(r=>setTimeout(r,300));await ready();
 await run(String.raw`(async()=>{const e=id=>document.getElementById(id);if(CR.app_version!=='1.87.0')throw Error('version');
 e('contract-text').value='위탁계약서\n제1조(장소)\n배송지는 서울이다.';
 state.subDocs=[{name:'인력관리약정서',text:'제1조(인력 관리)\n수탁자는 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시하여야 한다.\n수탁자는 업무수행인력이 변경되는 경우 인수인계를 실시하여야 한다.'}];
 refreshInputSetup();e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();
 for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));
 if(!state.activeModules.includes('X-EFIN'))document.querySelector('#input-screening [data-mid="X-EFIN"]').click();
 if(verdictStore['ITSEC-12']?.origin!=='auto')throw Error('automatic verdict');document.querySelector('.tab[data-tab="clauses"]').click();})()`);
 const layouts=[];
 for(const width of [1500,1200,1000,700]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
  await run(`document.querySelector('#clause-rows .cr-reviewed [data-vcp="ITSEC-12"]').closest('.clause-row').scrollIntoView({block:'start'})`);
  await new Promise(r=>setTimeout(r,800));
  const cells=await run(`Array.from(document.querySelector('#clause-rows .source-review-row').children).map(e=>({class:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth}))`);
  if(cells.length!==3||cells.some(c=>c.scrollWidth>c.width+1))throw Error(JSON.stringify({width,cells}));layouts.push({width,cells});
  if(width===1500){const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/private/tmp/cr-v187-completion.png',Buffer.from(shot.data,'base64'));}
 }
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({layouts,errors,external}));
}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
