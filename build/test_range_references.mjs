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
 await run('window.__rangeCases='+fs.readFileSync(new URL('../tests/fixtures/presence_completion.json',import.meta.url),'utf8'));
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};check(CR.app_version==='1.87.0','version');
 async function analyze(text){e('contract-text').value=text;refreshInputSetup();e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));check(!!state.result,'analysis');if(state.typeId!=='outsourcing'){e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));}check(state.typeId==='outsourcing','consistent scope');}
 function verify(id,kind){const v=verdictStore[id];check(v?.origin==='auto'&&v?.verdict==='이상없음',id+' auto '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));if(kind)check(v.auto_proof?.kind===kind,'kind '+v.auto_proof?.kind);check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'second column');check(!pendingReviewItems().some(i=>i.id===id),'pending');}
 const obligations=window.__rangeCases.find(c=>c.id==='ITDL-07').clauses,record=['기록은 전자파일로 작성한다.','기록의 보존기간은 5년으로 한다.','기록의 열람은 서면으로 요청한다.'];
 const paragraphs='제1조(기록관리)\n'+record.map((s,i)=>'①②③'[i]+' '+s).join('\n');
 const articles=record.map((s,i)=>'제'+(i+1)+'조(관리'+(i+1)+')\n'+s).join('\n');
 const items='제1조(라이선스)\n① 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n'+obligations.map((s,i)=>(i+1)+'. '+s.replace(/^수탁자는 /,'')).join('\n');
 const letters='제1조(라이선스)\n① 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n'+obligations.map((s,i)=>'가나다'[i]+'. '+s.replace(/^수탁자는 /,'')).join('\n');
 const cases=[['조',articles,'','제1조','제3조'],['항',paragraphs,'제1조 ','제1항','제3항'],['호',items,'제1조 제1항 ','제1호','제3호'],['목',letters,'제1조 제1항 제1호 ','가목','다목']],actual=[];
 for(const [kind,base,prefix,start,end] of cases){
  const reference=prefix+start+'부터 '+end+'까지',source=base+'\n제9조(비밀유지)\n비밀정보 관리방법(합성시험 '+kind+' '+Date.now()+')은 '+reference+'에 따른다.\n제10조(배송)\n배송지는 서울이다.';
  await analyze(source);check(!verdictStore['CNS-SECRET']?.verdict,'reference without truth');
  applyVerdict('CNS-SECRET','이상없음','사용자 검토를 모사한 합성 정답','반영되어 있음','manual');const packet=SafetyRuntime.standardPacket();await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[packet]});
  for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(p=>p.id===packet.id);n++)await new Promise(r=>setTimeout(r,30));
  const target=source.replace(reference,prefix+start+' 내지 '+end).replace('서울','부산');
  await analyze(target);verify('CNS-SECRET','clause_reused');
  const proof=SafetyRuntime.standardReport().rows.find(r=>r.check_id==='CNS-SECRET');check(proof.evidence.some(e=>e.text.includes('내지')),'current range quote');check(proof.evidence.some(e=>e.text.includes(kind==='조'||kind==='항'?'5년':'라이선스를 준수')),'middle missing');
  await analyze(target.replace(kind==='조'||kind==='항'?'5년':'라이선스를 준수하여야 한다','2년'));check(!verdictStore['CNS-SECRET']?.verdict,'middle change accepted');
  await analyze(target.replace(start+' 내지 '+end,start+' 내지 '+start));check(!verdictStore['CNS-SECRET']?.verdict,'narrow range accepted');
  await analyze(target);verify('CNS-SECRET','clause_reused');
  e('contract-text').value=target.replace(start+' 내지 '+end,end+' 내지 '+start);runAnalysis();check(!verdictStore['CNS-SECRET']?.verdict,'reverse live edit accepted');actual.push(kind);
 }
 const standard=paragraphs+'\n제9조(손해배상)\n당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.\n배상책임의 범위는 제1조 제1항부터 제3항까지에 따른다.';
 const target=standard.replace('제1항부터 제3항까지','제1항 내지 제3항')+'\n제10조(배송)\n배송지는 부산이다.';
 await analyze(target);check(!verdictStore['CNS-DAMAGE']?.verdict,'no standard yet');
 const extract=extractFileStructure;extractFileStructure=async()=>({text:standard});
 try{const dt=new DataTransfer();dt.items.add(new File(['synthetic'],'범위참조표준.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extract;}
 verify('CNS-DAMAGE');check(TemplateLibraryRuntime.get().templates.some(t=>t.name==='범위참조표준.docx'&&t.registration.version===15&&t.bindings.some(b=>b.check_id==='CNS-DAMAGE'&&b.decision_bundle)),'automatic registration');
 await analyze(target.replace('② '+record[1]+'\n',''));check(!verdictStore['CNS-DAMAGE']?.verdict,'missing middle accepted');
 await analyze(target);verify('CNS-DAMAGE');
 const context=SafetyRuntime.comparisonContext();loopCorpus=Loop.emptyCorpus();loopCorpus.judgment_ledger={records:{test:{snapshot:{comparison_context:context,verdicts:{'CNS-DAMAGE':{origin:'manual',verdict:'검토의견',comment:'사용자 정정'}}}}}};
 applyAutoVerdicts();renderClauses();check(!verdictStore['CNS-DAMAGE']?.verdict,'latest correction bypass');loopCorpus=Loop.emptyCorpus();applyAutoVerdicts();renderClauses();verify('CNS-DAMAGE');
 applyVerdict('CNS-DAMAGE','검토의견','직접 작성한 의견','','manual');applyAutoVerdicts();check(verdictStore['CNS-DAMAGE'].origin==='manual','manual overwritten');
 const saved=TemplateLibraryRuntime.get(),prior=saved.templates.find(t=>t.name==='범위참조표준.docx');prior.registration.version=13;prior.bindings=[];localStorage.setItem('cr-template-library-v1',JSON.stringify(saved));
 return {range_levels:actual,source_precedent:true,range_wording_equivalence:true,middle_evidence:true,middle_change_revokes:true,narrow_range_revokes:true,reverse_live_edit_revokes:true,registered_without_approval:true,missing_middle_revokes:true,latest_correction:true,manual_preserved:true,second_column:true,pending_resolved:true};
 })()`);
 await run('location.reload()');await new Promise(r=>setTimeout(r,300));await ready();
 const migration=await run(`(()=>{const t=TemplateLibraryRuntime.get().templates.find(t=>t.name==='범위참조표준.docx');if(t.registration.version!==15||!t.bindings.some(b=>b.check_id==='CNS-DAMAGE'&&b.decision_bundle))throw Error('version 13 migration');return true;})()`);
 if(errors.length||external.length)throw Error(JSON.stringify({result,errors,external}));console.log(JSON.stringify({result,migration,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
