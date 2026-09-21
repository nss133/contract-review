const endpoint='http://127.0.0.1:9359';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(ok=>ws.onopen=ok);
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});
 await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>300){clearInterval(t);no(Error('startup'));}},50);})`);
 await run(`localStorage.removeItem('cr-template-library-v1');window.dispatchEvent(new StorageEvent('storage',{key:'cr-template-library-v1',newValue:null}));`);
 const result=await run(`(async()=>{
  const e=id=>document.getElementById('template-'+id),check=(v,m)=>{if(!v)throw Error(m);};
  check(CR.app_version==='1.87.0','version');check(!e('advanced').open,'advanced collapsed');
  const original=extractFileStructure;extractFileStructure=async f=>({text:f.name==='bad.pdf'?'�':'수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.'});
  const dt=new DataTransfer();for(const name of ['one.pdf','bad.pdf','two.docx'])dt.items.add(new File(['fixture'],name));e('file').files=dt.files;await e('file').onchange();extractFileStructure=original;
  check(TemplateLibraryRuntime.get().templates.length===2,'multiple files and failure isolation');
  check(TemplateLibraryRuntime.get().templates.every(t=>t.active&&t.bindings.some(b=>b.check_id==='PRIV-07')),'automatic bindings');
  check(!e('approve').checked,'no manual approval');check(e('status').textContent.includes('처리 실패'),'failure visible');
  e('name').value='직접 입력';e('revision').value='1';e('text').value='계약금액은 부가가치세를 포함한다.';e('split').click();e('save').click();
  check(TemplateLibraryRuntime.get().templates.some(t=>t.name==='직접 입력'&&t.bindings.some(b=>b.check_id==='CMN-05')),'paste without approval');
  return {registered:TemplateLibraryRuntime.get().templates.length,status:e('status').textContent};
 })()`);
 const dom=await cdp('DOM.getDocument'),node=await cdp('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#template-file'});
 await cdp('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[new URL('../testdata/standard_contracts/raw/performance-sharing-standard.pdf',import.meta.url).pathname]});
 await run(`new Promise((ok,no)=>{let n=0;const timer=setInterval(()=>{if(TemplateLibraryRuntime.get().templates.some(t=>t.name==='performance-sharing-standard.pdf')){clearInterval(timer);ok();}else if(++n>600){clearInterval(timer);no(Error(document.getElementById('template-status').textContent));}},50);})`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,real_pdf_automatic_registration:true,errors,external}));
}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
