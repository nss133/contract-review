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
 await run('window.__presenceCases='+fs.readFileSync(new URL('../tests/fixtures/presence_completion.json',import.meta.url),'utf8'));
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};check(CR.app_version==='1.87.0','version');
 const cases=window.__presenceCases,checks=SafetyRuntime.allChecks(),cp=id=>checks.find(c=>c.id===id),textOf=cs=>'제1조(약정)\n'+cs.join('\n');
 // 배포본의 30개 문법 및 각 누락 요건을 먼저 검사한다.
 for(const c of cases){check(StandardAuto.evaluate(cp(c.id),{coverage:'addressed'},{confirmed:true,documents:[{name:'본문',text:textOf(c.clauses)}]}).eligible,'packaged rule '+c.id);
  for(let i=0;i<c.clauses.length;i++)check(!StandardAuto.evaluate(cp(c.id),{coverage:'addressed'},{confirmed:true,documents:[{name:'본문',text:textOf(c.clauses.filter((_,j)=>i!==j))}]}).eligible,'missing '+c.id+' '+i);}
 async function analyze(text,type){e('contract-text').value=text;refreshInputSetup();e('input-type').value=type;e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));check(!!state.result,'analysis');}
 function enable(mid){if(state.activeModules.includes(mid))return;const el=document.querySelector('#input-screening [data-mid="'+mid+'"]');check(!!el,'module '+mid);el.click();}
 function verify(ids){for(const id of ids){check(verdictStore[id]?.origin==='auto'&&verdictStore[id]?.verdict==='이상없음','actual '+id+' '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'column '+id);}}
 const groups=[
  {type:'outsourcing',ids:['ITCL-05','ITCL-06','ITSEC-11','ITSEC-12','ITSEC-14','ITSEC-15','ITDL-07','ITDL-08','PRIV-13','PRIV-20','PRIV-21']},
  {type:'channel',ids:['SOL-03','SOL-05']},
  {type:'alliance',preamble:'정보수령자는 개인정보를 제공받는 자이다.',ids:['ALL-PII-03','ALL-REINS-01']},
  {type:'finance',title:'동산질권 및 지명채권 질권설정 채권양도담보 계약서',ids:['FIN-SEC-01','FIN-SEC-02','FIN-SEC-05']},
  {type:'investment',ids:['INV-MAN-01','INV-BEN-04','INV-BEN-07','INV-MAN-03']},
  {type:'procurement',ids:['SP-DEL-04','SP-DEL-05','SP-DEL-06','SP-DEL-07']},
  {type:'shareholders',ids:['SH-SHARE-06','SH-SHARE-08','SH-GOV-04','SH-ANT-01']}
 ];
 const actual=[];
 for(const group of groups){check(Array.from(e('input-type').options).some(o=>o.value===group.type),'unknown type '+group.type);
  const text=(group.title||'업무 계약서')+'\n'+(group.preamble||'')+'\n'+group.ids.map((id,i)=>'제'+(i+1)+'조(약정 '+(i+1)+')\n'+cases.find(c=>c.id===id).clauses.join('\n')).join('\n');
  await analyze(text,group.type);for(const id of group.ids)enable(cp(id).module);verify(group.ids);actual.push(...group.ids);
 }
 const personnel=cases.find(c=>c.id==='ITSEC-12');state.subDocs=[{name:'인력관리약정서',text:textOf(personnel.clauses)}];
 await analyze('위탁계약서\n제1조(장소)\n배송지는 서울이다.','outsourcing');enable('X-EFIN');verify([personnel.id]);
 check(!!document.querySelector('#clause-rows .cr-reviewed [data-vcp="'+personnel.id+'"]'),'annex-only column');
 check(!e('clause-rows').textContent.includes('자동판정 근거 없음'),'annex evidence lost');
 state.subDocs=[];runAnalysis();check(!verdictStore[personnel.id]?.verdict,'annex removal not revoked');
 const license=cases.find(c=>c.id==='ITDL-07');await analyze(textOf(license.clauses),'outsourcing');enable('X-IP');verify([license.id]);
 const extract=extractFileStructure;extractFileStructure=async()=>({text:textOf(license.clauses)});
 try{const dt=new DataTransfer();dt.items.add(new File(['synthetic'],'라이선스표준.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extract;}
 check(TemplateLibraryRuntime.get().templates.some(t=>t.registration.version===15&&t.bindings.some(b=>b.check_id===license.id)),'registration');
 await analyze(textOf(license.clauses.slice(0,2)),'outsourcing');enable('X-IP');check(!verdictStore[license.id]?.verdict,'missing component not revoked');
 e('standard-auto-inspect').click();check(e('standard-auto-results').textContent.includes('라이선스 위반 손해배상'),'missing element explanation');
 await analyze(textOf(license.clauses),'outsourcing');enable('X-IP');verify([license.id]);
 applyVerdict(license.id,'검토의견','사용자 직접 보완 의견','','manual');applyAutoVerdicts();check(verdictStore[license.id].origin==='manual'&&verdictStore[license.id].verdict==='검토의견','human overwritten');
 return {packaged_questions:cases.length,actual_questions:actual,second_column:true,annex_only_second_column:true,annex_removal_revokes:true,multi_requirement_revocation:true,missing_explained:true,registration_without_approval:true,human_preserved:true};
 })()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
