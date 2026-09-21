const endpoint='http://127.0.0.1:9359';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={}){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>300){clearInterval(t);no(Error('startup'));}},50);})`);}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();
 await run(`localStorage.clear();location.reload();`);await new Promise(r=>setTimeout(r,300));await ready();
 const result=await run(String.raw`(async()=>{
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 const text=['용역계약서','제1조(완전합의)','본 계약은 당사자 간의 완전한 합의를 구성하며 본 계약에 관한 종전의 구두 또는 서면 합의를 대체한다.','제2조(서면변경)','본 계약의 변경은 양 당사자의 서면 합의로만 할 수 있다.','제3조(비밀유지)','상대방의 비밀정보(시험자료 '+Date.now()+')는 계약 수행 목적에 한하여 이용한다.'].join('\n');
 e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,50));
 check(verdictStore['CMN-21']?.verdict==='이상없음','new requirement native path '+JSON.stringify(SafetyRuntime.standardReport()));
 check(!verdictStore['CNS-SECRET']?.verdict,'secret not safe without human source');
 applyVerdict('CNS-SECRET','이상없음','실제 사용자 검토를 모사한 시험 정답','반영되어 있음','manual');
 const packet=SafetyRuntime.standardPacket();check(!!packet.contract_hash,'source contract key');
 await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[packet]});
 for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(p=>p.id===packet.id);n++)await new Promise(r=>setTimeout(r,30));
 check(TemplateLibraryRuntime.packets().some(p=>p.id===packet.id),'packet loaded');
 delete verdictStore['CNS-SECRET'];applyAutoVerdicts();renderClauses();renderReport();
 check(verdictStore['CNS-SECRET']?.auto_proof?.kind==='reused','human precedent reused '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id==='CNS-SECRET')));
 check(!pendingReviewItems().some(i=>i.id==='CNS-SECRET'),'reused verdict removed from pending');
 e('standard-auto-inspect').click();check(e('standard-auto-results').textContent.includes('적정성·유불리'),'question level visible');
 let events=0;const count=()=>events++;window.addEventListener('cr-evaluation-packet-changed',count);
 StandardAutoArchive.setEnabled(true);StandardAutoArchive.schedule();await new Promise(r=>setTimeout(r,2600));
 const saved=(await StandardAutoArchive.backup()).packets.find(p=>p.id===packet.id);
 check(saved.verdicts['CNS-SECRET'].origin==='manual','automatic result overwrote human truth');check(events<4,'archive refresh loop '+events);
 StandardAutoArchive.setEnabled(false);window.removeEventListener('cr-evaluation-packet-changed',count);
 loopCorpus=Loop.emptyCorpus();loopCorpus.judgment_ledger={records:{}};loopCorpus.judgment_ledger.records[packet.contract_hash]={snapshot:{verdicts:{'CNS-SECRET':{origin:'manual',verdict:'검토의견',comment:'원자료 정정'}}}};
 applyAutoVerdicts();check(!verdictStore['CNS-SECRET']?.verdict,'latest source issue failed to revoke');
 loopCorpus=Loop.emptyCorpus();
 e('contract-text').value=text+'\n제8조(연락처)\n배송지는 서울이다.';refreshInputSetup();e('btn-analyze').click();for(let n=0;n<200&&e('btn-analyze').disabled;n++)await new Promise(r=>setTimeout(r,50));
 check(verdictStore['CNS-SECRET']?.auto_proof?.kind==='clause_reused','unrelated article blocked clause reuse '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id==='CNS-SECRET')));
 renderClauses();renderReport();
 check(!!document.querySelector('.cr-reviewed [data-vcp="CNS-SECRET"]'),'automatic verdict not in second column');
 check(!document.querySelector('.cr-opinions [data-vcp="CNS-SECRET"]'),'automatic verdict still in third column');
 check(!document.body.textContent.includes('자동허용 근거 미충족 시 관찰만'),'generic misleading warning remains');
 applyVerdict('CNS-SECRET','이상없음','사용자 확인','반영되어 있음','manual');renderClauses();
 check(document.body.textContent.includes('사용자 판정 완료'),'manual status missing');
 const end14='용역계약서\n제1조(해지)\n당사자 일방이 본 계약상의 의무를 중대하게 위반한 경우 상대방은 14일의 기간을 정하여 서면으로 시정을 요구하고 그 기간 내에 시정하지 아니하면 서면 통지로 본 계약을 해지할 수 있다.';
 e('contract-text').value=end14;refreshInputSetup();e('btn-analyze').click();for(let n=0;n<200&&e('btn-analyze').disabled;n++)await new Promise(r=>setTimeout(r,50));
 check(!verdictStore['CNS-END']?.verdict,'14 days without trusted basis');
 const extractOriginal=extractFileStructure;extractFileStructure=async()=>({text:end14});
 try{const dt=new DataTransfer();dt.items.add(new File(['fixture'],'표준해지14.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extractOriginal;}
 check(verdictStore['CNS-END']?.auto_proof?.version===TemplateLibrary.VERSION,'independent standard binding not applied');
 check(!!document.querySelector('.cr-reviewed [data-vcp="CNS-END"]'),'template not in second column');
 const evaluation=await StandardAutoArchive.run();check(evaluation.families>=1&&evaluation.hold_reasons,'one click evaluation');
 return {native_complete_agreement:true,source_reuse:true,clause_reuse:true,independent_standard:true,one_click_evaluation:true,second_column:true,accurate_status:true,source_correction_revokes:true,human_truth_preserved:true,no_event_loop:events,pending_resolved:true};
 })()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
