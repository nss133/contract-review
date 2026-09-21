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
 await run('window.__listCases='+fs.readFileSync(new URL('../tests/fixtures/presence_completion.json',import.meta.url),'utf8'));
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};check(CR.app_version==='1.87.0','version');
 const cases=window.__listCases.filter(c=>c.clauses.every(s=>ClauseSemantics.parseAll(s)?.every(p=>['obligation','prohibition','consent_required'].includes(p.facts.modality))));
 const listed=c=>'제1조(약정)\n'+c.clauses.map(s=>s.match(/^(.+?(?:은|는))\s+/)[1]+' 다음 각 호의 사항을 준수하여야 한다.\n1. '+s.replace(/^(.+?)(?:은|는)\s+/,'').replace(/하여야 한다\.$/,'할 것')).join('\n');
 for(const c of cases){const cp=SafetyRuntime.allChecks().find(cp=>cp.id===c.id);check(StandardAuto.evaluate(cp,{coverage:'addressed'},{confirmed:true,documents:[{name:'본문',text:listed(c)}]}).eligible,'packaged '+c.id);}
 async function analyze(text,type='outsourcing'){e('contract-text').value=text;refreshInputSetup();e('input-type').value=type;e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));check(!!state.result,'analysis');}
 function enable(mid){if(state.activeModules.includes(mid))return;const el=document.querySelector('#input-screening [data-mid="'+mid+'"]');check(!!el,'module '+mid);el.click();}
 function verify(id,kind){const v=verdictStore[id];check(v?.origin==='auto'&&v?.verdict==='이상없음',id+' actual '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));if(kind)check(v.auto_proof?.kind===kind,id+' kind '+v.auto_proof?.kind);check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),id+' second column');check(!pendingReviewItems().some(i=>i.id===id),id+' pending');}
 const actual=[];for(const [id,type] of [['ITSEC-12','outsourcing'],['ITDL-07','outsourcing'],['PRIV-13','outsourcing'],['FIN-SEC-02','finance'],['SH-ANT-01','shareholders']]){
  const c=cases.find(c=>c.id===id);await analyze(listed(c),type);enable(SafetyRuntime.allChecks().find(cp=>cp.id===id).module);verify(id);actual.push(id);
 }
 const intro='수탁자는 다음 각 호의 사항을 이행하여야 한다.',list='제1조(인력관리)\n'+intro+'\n1. 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시할 것\n2. 업무수행인력이 변경되는 경우 인수인계를 실시할 것';
 state.subDocs=[{name:'인력관리약정서',text:list}];await analyze('용역계약서\n제1조(운송)\n배송지는 서울이다.');enable('X-EFIN');verify('ITSEC-12');
 const report=SafetyRuntime.standardReport().rows.find(r=>r.check_id==='ITSEC-12');check(report.evidence.some(e=>e.text===intro),'intro not in proof');
 for(const bad of [list.replace('2.','3.'),list.replace('2.','1.'),list.replace('경우','경우에만'),list.replace('수탁자는','위탁자는'),list.replace('이행하여야 한다','이행할 수 있다')]){state.subDocs[0].text=bad;runAnalysis();check(!verdictStore['ITSEC-12']?.verdict,'bad list still completed');}
 state.subDocs[0].text=list;runAnalysis();verify('ITSEC-12');
 const extract=extractFileStructure;extractFileStructure=async()=>({text:list});
 try{const dt=new DataTransfer();dt.items.add(new File(['synthetic'],'번호목록표준.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extract;}
 check(TemplateLibraryRuntime.get().templates.some(t=>t.registration.version===15&&t.bindings.some(b=>b.check_id==='ITSEC-12')),'automatic registration');
 state.subDocs=[];await analyze('제1조(인력관리)\n'+cases.find(c=>c.id==='ITSEC-12').clauses.join('\n'));enable('X-EFIN');verify('ITSEC-12');
 applyVerdict('ITSEC-12','검토의견','사람이 작성한 의견','','manual');applyAutoVerdicts();check(verdictStore['ITSEC-12'].origin==='manual','manual overwritten');
 const secret=list+'\n제2조(비밀유지)\n비밀유지 의무(시험 '+Date.now()+')는 제1조 제2호에 따른다.\n제3조(운송)\n배송지는 서울이다.';
 await analyze(secret);check(!verdictStore['CNS-SECRET']?.verdict,'reference without truth');
 applyVerdict('CNS-SECRET','이상없음','사용자 검토를 모사한 합성 정답','반영되어 있음','manual');const packet=SafetyRuntime.standardPacket();await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[packet]});
 for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(p=>p.id===packet.id);n++)await new Promise(r=>setTimeout(r,30));
 await analyze(secret.replace('서울','부산'));verify('CNS-SECRET','clause_reused');
 await analyze(secret.replace('서울','부산').replace('제2호','제1호'));check(!verdictStore['CNS-SECRET']?.verdict,'changed item reference not revoked');
 await analyze(secret.replace('서울','부산').replace('제2호','제3호'));check(!verdictStore['CNS-SECRET']?.verdict,'missing item reference not revoked');
 const saved=TemplateLibraryRuntime.get(),prior=saved.templates.find(t=>t.name==='번호목록표준.docx');check(!!prior,'migration source');prior.registration.version=11;prior.bindings=[];localStorage.setItem('cr-template-library-v1',JSON.stringify(saved));
 return {packaged_questions:cases.length,actual_questions:actual,list_annex_completed:true,source_intro_preserved:true,number_condition_role_modality_revocation:true,registered_without_approval:true,standard_to_sentence:true,human_preserved:true,item_reference_precedent:true,changed_reference_revocation:true,second_column:true,pending_resolved:true};
 })()`);
 await run('location.reload()');await new Promise(r=>setTimeout(r,300));await ready();
 const migration=await run(`(()=>{const t=TemplateLibraryRuntime.get().templates.find(t=>t.name==='번호목록표준.docx');if(t.registration.version!==15||!t.bindings.some(b=>b.check_id==='ITSEC-12'))throw Error('version 11 migration');return true;})()`);
 if(errors.length||external.length)throw Error(JSON.stringify({result,errors,external}));console.log(JSON.stringify({result,migration,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
