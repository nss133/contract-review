// 격리 시험 브라우저용: 합성 문서만 사용하고 외부 통신·사용자 저장소에 접근하지 않는다.
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
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};check(CR.app_version==='1.87.0','version');
 async function analyze(text){e('contract-text').value=text;refreshInputSetup();e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));check(!!state.result,'analysis');}
 function enable(mid){if(state.activeModules.includes(mid))return;const el=document.querySelector('#input-screening [data-mid="'+mid+'"]');check(!!el,'module '+mid);el.click();}
 function verify(id,kind){const v=verdictStore[id];check(v?.origin==='auto'&&v?.verdict==='이상없음',id+' verdict '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));if(kind)check(v.auto_proof?.kind===kind,id+' kind '+v.auto_proof?.kind);check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),id+' second column');check(!pendingReviewItems().some(i=>i.id===id),id+' pending');}
 const main='위탁계약서\n위탁자(이하 “갑”이라 한다).\n수탁자(이하 “을”이라 한다).\n제1조(운송)\n배송지는 서울이다.';
 const sub='수탁자(이하 “갑”이라 한다).\n위탁자(이하 “을”이라 한다).\n제1조(인력관리)\n갑은 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시할 의무를 진다.\n업무수행인력이 변경되는 경우에는 갑은 인수인계를 실시하여야 한다.';
 state.subDocs=[{name:'인력관리약정서',text:sub}];await analyze(main);enable('X-EFIN');verify('ITSEC-12');
 state.subDocs[0].text=sub.replace('경우에는','경우에만');runAnalysis();check(!verdictStore['ITSEC-12']?.verdict,'extra condition not revoked');
 state.subDocs[0].text=sub.replace('수탁자(이하 “갑”','위탁자(이하 “갑”');runAnalysis();check(!verdictStore['ITSEC-12']?.verdict,'wrong actor not revoked');
 state.subDocs=[];await analyze(main+'\n별첨 1 인력관리약정서\n'+sub);enable('X-EFIN');verify('ITSEC-12');
 const extract=extractFileStructure;extractFileStructure=async()=>({text:main+'\n별첨 1 인력관리약정서\n'+sub});
 try{const dt=new DataTransfer();dt.items.add(new File(['synthetic'],'구역별표준.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extract;}
 check(TemplateLibraryRuntime.get().templates.some(t=>t.registration.version===15&&t.bindings.some(b=>b.check_id==='ITSEC-12')),'scoped registration');
 applyVerdict('ITSEC-12','검토의견','사용자 직접 의견','','manual');applyAutoVerdicts();check(verdictStore['ITSEC-12'].origin==='manual'&&verdictStore['ITSEC-12'].verdict==='검토의견','human overwritten');
 const unique=Date.now(),secret='용역계약서\n제1조(비밀유지)\n비밀유지 의무(시험 '+unique+')는 「보안관리약정서」 제1조에 따른다.\n제2조(운송)\n배송지는 서울이다.';
 const annex='제1조(기간)\n기간은 3년이다.\n제2조(우선순위)\n본문과 보안관리약정서가 상충하면 보안관리약정서가 우선한다.';
 state.subDocs=[{name:'보안관리약정서.hwpx',text:annex}];await analyze(secret);check(!verdictStore['CNS-SECRET']?.verdict,'title reference alone accepted');
 applyVerdict('CNS-SECRET','이상없음','사용자 검토를 모사한 합성 정답','반영되어 있음','manual');
 const packet=SafetyRuntime.standardPacket();await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[packet]});
 for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(p=>p.id===packet.id);n++)await new Promise(r=>setTimeout(r,30));
 check(TemplateLibraryRuntime.packets().some(p=>p.id===packet.id),'packet loaded');
 await analyze(secret.replace('서울','부산'));verify('CNS-SECRET','clause_reused');
 state.subDocs[0].name='다른약정서.hwpx';runAnalysis();check(!verdictStore['CNS-SECRET']?.verdict,'missing named annex not revoked');
 state.subDocs[0].name='보안관리약정서.hwpx';runAnalysis();verify('CNS-SECRET','clause_reused');
 state.subDocs.push({name:'보안관리약정서.pdf',text:annex});runAnalysis();check(!verdictStore['CNS-SECRET']?.verdict,'ambiguous title not revoked');
 state.subDocs.pop();state.subDocs[0].text=annex.replace('3년','1년');runAnalysis();check(!verdictStore['CNS-SECRET']?.verdict,'period change not revoked');
 state.subDocs[0].text=annex.replace('보안관리약정서가 우선한다','본문이 우선한다');runAnalysis();check(!verdictStore['CNS-SECRET']?.verdict,'priority change not revoked');
 state.subDocs[0].text=annex;runAnalysis();verify('CNS-SECRET','clause_reused');
 return {separate_file_roles:true,inline_annex_roles:true,wording_and_condition_position:true,condition_and_role_revocation:true,registration_without_approval:true,human_preserved:true,named_annex_precedent:true,second_column:true,pending_resolved:true,missing_duplicate_period_priority_revocation:true};
 })()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
