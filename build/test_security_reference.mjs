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
 function enable(){if(!state.activeModules.includes('X-EFIN')){const el=document.querySelector('#input-screening [data-mid="X-EFIN"]');check(!!el,'module');el.click();}}
 const rows=[
 ['ITSEC-01','수탁자는 외부주문 개발업무에 사용되는 업무장소·전산설비를 내부 업무용과 분리하여 설치·운영하여야 한다.'],
 ['ITSEC-02','수탁자는 금융회사와 이용자 간 암호화정보를 해독하거나 원장 등 중요 데이터를 변경하여서는 아니된다.'],
 ['ITSEC-03','수탁자는 계좌번호·비밀번호 등 이용자 금융정보를 무단으로 보관하거나 유출하여서는 아니된다.'],
 ['ITSEC-04','수탁자는 접근매체 위·변조, 해킹 및 개인정보유출에 대비한 보안대책을 수립하여야 한다.'],
 ['ITSEC-05','수탁자는 금융회사와 전자금융보조업자 간 접속에 전용회선을 사용하여야 한다.'],
 ['ITSEC-06','수탁자는 정보처리시스템 장애 등 서비스 중단에 대비한 비상대책을 수립하여야 한다.'],
 ['ITSEC-07','수탁자는 외부주문의 입찰·계약·수행 및 완료 각 단계별로 금융감독원장이 정하는 보안관리방안을 준수하여야 한다.'],
 ['ITSEC-08','수탁자는 중요 전산자료의 백업자료 보존 및 백업설비 확보를 포함한 백업대책을 수립하여야 한다.'],
 ['ITSEC-09','수탁자는 자신의 재무건전성 연 1회 이상 평가 및 상시 모니터링에 필요한 자료 제공에 협조하여야 한다.'],
 ['ITSEC-13','수탁자는 외부주문에 대한 자체 보안성검토 및 정기 보안점검 실시에 협조하여야 한다.']];
 const text='정보시스템 개발위탁 계약서\n'+rows.map((r,i)=>'제'+(i+1)+'조(보안요건 '+(i+1)+')\n'+r[1]).join('\n');
 const start=performance.now();await analyze(text);enable();const elapsed=performance.now()-start;
 for(const [id] of rows){check(verdictStore[id]?.origin==='auto'&&verdictStore[id]?.verdict==='이상없음','native '+id+' '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'second column '+id);}
 e('standard-auto-inspect').click();check(e('standard-auto-results').textContent.includes('백업자료보존·백업설비확보'),'requirement explanation');
 const extract=extractFileStructure;extractFileStructure=async()=>({text});
 try{const dt=new DataTransfer();dt.items.add(new File(['synthetic'],'IT보안표준.docx'));e('template-file').files=dt.files;await e('template-file').onchange();}finally{extractFileStructure=extract;}
 const registered=TemplateLibraryRuntime.get().templates.find(t=>t.name==='IT보안표준.docx');check(registered.registration.version===15,'new registration');for(const [id] of rows)check(registered.bindings.some(b=>b.check_id===id),'binding '+id);
 await analyze(text.replace('연 1회 이상','2년에 1회'));enable();check(!verdictStore['ITSEC-09']?.verdict,'weaker frequency not revoked');
 await analyze(text+'\n제11조(특약)\n제8조의 의무는 수탁자가 동의하는 경우에만 적용한다.');enable();check(!verdictStore['ITSEC-08']?.verdict,'number-only restriction not revoked');
 const compound='정보시스템 개발위탁 계약서\n제1조(보안조치)\n'+[rows[3],rows[5],rows[7],rows[9]].map((r,i)=>r[1].replace(i?'수탁자는 ':'','').replace(i<3?'하여야 한다.':'__never__','하고, ')).join('');
 await analyze(compound);enable();for(const id of ['ITSEC-04','ITSEC-06','ITSEC-08','ITSEC-13'])check(verdictStore[id]?.origin==='auto','compound '+id);
 // 참조 비교는 사용자 정답이 있는 원문을 기준으로 검증한다. 비밀유지 기간을 내장 정답으로 만들지 않는다.
 const source='용역계약서\n제1조(배송)\n배송지는 서울이다.\n제2조(비밀유지)\n비밀유지 의무의 존속기간은 별첨 1 제1조에 따른다.\n비밀유지 약정의 시험 식별자는 '+Date.now()+'이다.\n별첨 1 보안약정서\n제1조(기간)\n기간은 3년이다.';
 await analyze(source);check(!verdictStore['CNS-SECRET']?.verdict,'no unsupported native conclusion');
 applyVerdict('CNS-SECRET','이상없음','사용자 검토를 모사한 시험','반영되어 있음','manual');const packet=SafetyRuntime.standardPacket();
 await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[packet]});
 for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(p=>p.id===packet.id);n++)await new Promise(r=>setTimeout(r,30));
 await analyze(source.replace('서울','부산'));
 check(verdictStore['CNS-SECRET']?.auto_proof?.kind==='clause_reused','annex actual reuse '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id==='CNS-SECRET')));
 check(!!document.querySelector('.cr-reviewed [data-vcp="CNS-SECRET"]'),'annex second column');
 await analyze(source.replace('3년','1년'));check(!verdictStore['CNS-SECRET']?.verdict,'changed annex not revoked');
 await analyze(source.replace('서울','부산'));check(verdictStore['CNS-SECRET']?.origin==='auto','restore');
 loopCorpus=Loop.emptyCorpus();loopCorpus.judgment_ledger={records:{}};loopCorpus.judgment_ledger.records[packet.contract_hash]={snapshot:{verdicts:{'CNS-SECRET':{origin:'manual',verdict:'검토의견',comment:'원판정 정정'}}}};
 applyAutoVerdicts();check(!verdictStore['CNS-SECRET']?.verdict,'source correction');
 applyVerdict('CNS-SECRET','이상없음','직접 확인','반영되어 있음','manual');applyAutoVerdicts();check(verdictStore['CNS-SECRET']?.origin==='manual','human overwritten');
 return {native_questions:rows.length,all_second_column:true,registered_without_approval:true,compound_obligations:4,annex_precedent:true,changed_annex_revokes:true,source_correction:true,human_preserved:true,synthetic_analysis_ms:Math.round(elapsed)};
 })()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
