/* Local, isolated CDP runtime comparison. Synthetic data only; no user's store.
 * Run after building dist/contract-review.html. Does not assert a speedup.
 */
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),Loop=require('../src/loop');
const hash=value=>createHash('sha256').update(value).digest('hex');
function integer(name,fallback,min,max){const n=Number(process.env[name]??fallback);if(!Number.isInteger(n)||n<min||n>max)throw Error(name+' must be '+min+'..'+max);return n;}
const repetitions=integer('CR_BENCH_REPETITIONS',12,10,100),warmups=2;
const tagDocuments=integer('CR_BENCH_TAG_DOCUMENTS',300,1,5000),corpusContracts=integer('CR_BENCH_CORPUS_CONTRACTS',100,1,1000);
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9359';
if(!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(endpoint))throw Error('Only an explicitly local test-browser endpoint is allowed');
const update=JSON.parse(await readFile(new URL('../dist/contract-review-v1.87.0.crupdate',import.meta.url),'utf8'));
if(update.format!=='contract-review-update-v1'||update.version!=='1.87.0'||typeof update.html!=='string'||hash(update.html)!==update.sha256)throw Error('Previous release identity/hash mismatch');
const currentVersion=(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim();
const currentHTML=await readFile(new URL('../dist/contract-review.html',import.meta.url),'utf8');
const expectedCurrent={app:currentVersion,auto:require('../src/standard_auto').VERSION,recognition:require('../src/agreement_judgment').VERSION};

function fixture(){
  const clauses=[
    ['목적','본 계약은 고객 개인정보 처리업무를 위탁하는 계약이다.'],
    ['대금','대금은 발주 건별 계약단가에 따라 정산한다. 계약대금 1000000원(부가세 별도).'],
    ['기간','계약기간 2026년 5월 11일 ~ 2026년 10월 30일.'],
    ['해지','을이 계약을 위반하면 갑은 계약을 해지할 수 있다.'],
    ['손해배상','을은 귀책사유로 갑에게 발생한 손해를 배상한다.'],
    ['재위탁','수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.'],
    ['보호조치','수탁자는 개인정보 보호를 위하여 기술적·관리적 보호조치를 취하여야 한다.'],
    ['접근권한','수탁자는 개인정보에 대한 접근권한을 업무 수행에 필요한 최소한의 범위로 제한하여야 한다.'],
    ['점검','수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.'],
    ['목적 제한','수탁자는 개인정보를 위탁 목적 외로 이용하여서는 아니 된다.'],
    ['비밀유지','비밀정보란 상대방이 제공하는 기술상 또는 경영상의 정보를 말한다. 비밀정보는 계약 수행 목적 범위에서만 사용한다.'],
    ['계약 변경','본 계약의 변경은 당사자의 서면 합의에 따른다.'],
    ['지위 양도','각 당사자는 상대방의 사전 서면 동의 없이 계약상 지위를 제3자에게 양도할 수 없다.'],
    ['관할','본 계약의 분쟁에 관한 소송은 갑의 본사 소재지를 관할하는 법원을 관할법원으로 한다.']
  ];
  const text='합성 개인정보 처리업무 위탁계약서\n위탁자(이하 “갑”이라 한다).\n수탁자(이하 “을”이라 한다).\n'+clauses.map(([title,body],i)=>'제'+(i+1)+'조('+title+')\n'+body).join('\n');
  const knowledge=require('../src/legal_opinion_knowledge').emptyKnowledge();
  knowledge.meta.created_at=knowledge.meta.updated_at='2026-09-18T00:00:00Z';
  clauses.forEach(([label],i)=>{const id='synthetic-topic-'+i;knowledge.tags[id]={id,type:'쟁점',label,aliases:[label+' 약정'],document_count:tagDocuments};});
  for(let i=0;i<tagDocuments;i++){
    const id='synthetic-tag-document-'+i,revision=id+'-r1',n=i%clauses.length;
    knowledge.latest[id]=revision;
    knowledge.documents[revision]={source_id:id,title:'합성 위탁계약 검토 '+i,request_title:'합성 개인정보 처리업무 위탁계약',department:'합성부서',date:'2026-09-10',family_id:'synthetic-tag-family-'+i,
      tags:[{tag_id:'synthetic-topic-'+n,type:'쟁점',label:clauses[n][0],sources:['합성 검토자료']}],
      evidence:[{source:'합성 태깅 검토자료',sentence:clauses[n][1],tag_id:'synthetic-topic-'+n,evidence_kind:'review_opinion'}],
      original:i%2?{}:{review_id:'synthetic-review-'+i}};
  }
  Object.assign(knowledge.meta,{document_count:tagDocuments,revision_count:tagDocuments,tag_count:clauses.length,evidence_count:tagDocuments});
  knowledge.stats=require('../src/legal_opinion_knowledge').deriveStats(knowledge);
  let corpus=Loop.emptyCorpus();
  const opinions={'CMN-19':clauses[13][1],'CNS-DAMAGE':clauses[4][1],'CORE-07':clauses[5][1],'PRIV-07':clauses[8][1]};
  for(let i=0;i<corpusContracts;i++){
    const verdicts={};Object.entries(opinions).forEach(([id,comment])=>{verdicts[id]={origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment};});
    corpus=Loop.mergeIntoCorpus(corpus,{meta:{contract_hash:'synthetic-corpus-'+i,date:'2026-09-10',title:'합성 누적계약 '+i,type_id:'outsourcing',stance:'party',family_id:'synthetic-family-'+i},verdicts});
  }
  return {text,knowledge,corpus,context:{type:'outsourcing',department:'합성부서'}};
}
const input=fixture(),inputJSON=JSON.stringify(input),fixtureHash=hash(inputJSON);
const scale={contract_characters:input.text.length,contract_utf8_bytes:Buffer.byteLength(input.text),authored_clauses:14,
  tag_documents:tagDocuments,legal_tag_documents:Math.floor(tagDocuments/2),contract_tag_documents:Math.ceil(tagDocuments/2),tag_definitions:14,
  corpus_contracts:corpusContracts,corpus_judgments:corpusContracts*4,corpus_original_documents:0,registered_standards:0,input_json_bytes:Buffer.byteLength(inputJSON)};

const version=await fetch(endpoint+'/json/version').then(r=>{if(!r.ok)throw Error('Test browser endpoint '+r.status);return r.json();});
const ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let sequence=0;const pending=new Map(),sessions=new Map(),contexts=[];
ws.onmessage=event=>{const message=JSON.parse(event.data),entry=sessions.get(message.sessionId);
  if(entry&&message.method==='Runtime.exceptionThrown'){const e=message.params.exceptionDetails;entry.errors.push({text:e.text,description:e.exception?.description,line:e.lineNumber,column:e.columnNumber});}
  if(entry&&message.method==='Network.requestWillBeSent'&&/^https?:/.test(message.params.request.url))entry.external.push(message.params.request.url);
  if(entry&&message.method==='Network.webSocketCreated')entry.external.push(message.params.url);
  const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}
};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function run(entry,expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},entry.sessionId);if(result.exceptionDetails)throw Error(entry.name+': '+JSON.stringify(result.exceptionDetails));return result.result.value;}
function stats(values){const sorted=values.slice().sort((a,b)=>a-b),pick=p=>sorted[Math.ceil(p*sorted.length)-1];return {n:values.length,p50_ms:pick(.5),p95_ms:pick(.95),min_ms:sorted[0],max_ms:sorted.at(-1),samples_ms:values};}

// This function is serialized into each isolated page; it only calls real app
// entry points. File conversion and data import are intentionally not timed.
function installFixture(payload,profileInitial){
  if(!legalOpinionKnowledge||!reviewHistory)throw Error('Application stores not initialized');
  legalOpinionKnowledge=payload.knowledge;loopCorpus=payload.corpus;saveCorpus();
  historyCombinedCache={legal:null,history:null,value:null};
  document.getElementById('contract-text').value=payload.text;
  document.getElementById('input-department').value=payload.context.department;
  state.fileName='synthetic-runtime-benchmark';
  applyMotionPreference('auto',false);
  if(!reducedMotion())throw Error('Animation reduction must be enabled for both releases');
  StandardAutoArchive.setEnabled(false); // Same setting; exclude asynchronous evaluation archival.
  if(!SafetyRuntime.standardEnabled())throw Error('Automatic verdict is disabled in a fresh context');
  const identity={app:CR.app_version,auto:StandardAuto.VERSION,recognition:typeof AgreementJudgment==='undefined'?null:AgreementJudgment.VERSION};
  const all=SafetyRuntime.allChecks();
  const firstProfile={},restore=[];
  if(profileInitial){
    const targets=[['StandardAuto',StandardAuto,['evaluate']],
      ['JudgmentHints',typeof JudgmentHints==='undefined'?null:JudgmentHints,['index','retrieve']],
      ['JudgmentSources',typeof JudgmentSources==='undefined'?null:JudgmentSources,['compile']],
      ['HumanPrecedent',typeof HumanPrecedent==='undefined'?null:HumanPrecedent,['prepare','collect']]];
    for(const [label,target,names] of targets)for(const name of names){
      if(!target||typeof target[name]!=='function')continue;
      const original=target[name],key=label+'.'+name;firstProfile[key]={calls:0,inclusive_ms:0};
      target[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{firstProfile[key].calls++;firstProfile[key].inclusive_ms+=performance.now()-start;}};
      restore.push(()=>{target[name]=original;});
    }
  }
  globalThis.__runtimeBenchmark={initial(){
    if(state.result)throw Error('First analysis is not cold');
    const start=performance.now();
    state.text=payload.text;state.clauses=segmentContract(state.text);refreshInputSetup();
    // A reviewer-selected type is identical in both versions; classification is
    // still executed and timed, but a differing auto recommendation cannot alter it.
    onTypeChanged(payload.context.type);renderScreening();renderTags();
    document.getElementById('analyze-setup').hidden=false;
    runAnalysis({landing:true,reveal:false});
    void document.body.offsetHeight;
    const elapsed=performance.now()-start;
    restore.forEach(fn=>fn());
    Object.values(firstProfile).forEach(row=>{row.inclusive_ms=+row.inclusive_ms.toFixed(3);});
    if(!state.result||state.typeId!==payload.context.type)throw Error('Initial analysis failed or type differs');
    return +elapsed.toFixed(3);
  },measure(mode){
    const start=performance.now();
    if(mode==='reanalysis')runAnalysis();
    else if(mode==='render'){renderClauses();renderReport();}
    else throw Error('Unknown benchmark mode');
    void document.body.offsetHeight;
    return +(performance.now()-start).toFixed(3);
  },state(){return {identity,initial_profile:profileInitial?firstProfile:null,catalog_rows:all.length,active_catalog_questions:all.filter(c=>c.active!==false&&c.review_scope!=='execution_only').length,
    selected_type:state.typeId,active_modules:state.activeModules,parsed_clauses:state.clauses.length,
    analysis_questions:(state.result?.checkpoints||[]).length,mapped_rows:(state.result?.results||[]).length,
    automatic_verdicts:Object.values(verdictStore).filter(v=>v.origin==='auto'&&v.verdict==='이상없음').length,
    loaded_tag_documents:Object.keys(legalOpinionKnowledge.latest).length,loaded_corpus_contracts:loopCorpus.meta.contract_count,
    loaded_corpus_judgments:Object.values(loopCorpus.judgment_ledger?.records||{}).reduce((n,r)=>n+Object.keys(r.snapshot?.verdicts||{}).length,0),
    registered_standards:TemplateLibraryRuntime.get().templates.length,archival_enabled:StandardAutoArchive.enabled()};}};
  return identity;
}

let temporaryDirectory,previousFile;
try{
  temporaryDirectory=await mkdtemp(join(tmpdir(),'cr-v188-benchmark-'));
  previousFile=join(temporaryDirectory,'previous-release-1.87.0.html');await writeFile(previousFile,update.html,'utf8');
  const releases=[{name:'previous',url:pathToFileURL(previousFile).href,expected:{app:'1.87.0',auto:'standard-auto-v12',recognition:null},html_sha256:update.sha256},
    {name:'current',url:new URL('../dist/contract-review.html',import.meta.url).href,expected:expectedCurrent,html_sha256:hash(currentHTML)}];
  for(const release of releases){
    const {browserContextId}=await send('Target.createBrowserContext');contexts.push(browserContextId);
    const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    Object.assign(release,{targetId,sessionId,errors:[],external:[],reanalysis:[],render:[]});sessions.set(sessionId,release);
    await send('Runtime.enable',{},sessionId);await send('Network.enable',{},sessionId);
    await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']},sessionId);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
    await send('Page.navigate',{url:release.url},sessionId);
    await run(release,"new Promise((ok,no)=>{let n=0;const timer=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'&&typeof runAnalysis==='function'&&typeof legalOpinionKnowledge!=='undefined'&&legalOpinionKnowledge&&typeof reviewHistory!=='undefined'&&reviewHistory){clearInterval(timer);ok();}else if(++n>400){clearInterval(timer);no(Error('Application startup timeout'));}},50);})");
    await run(release,'StandardAutoArchive.backup().then(x=>{if(x.packets.length)throw Error("Fresh isolated context is not empty");})');
    const actual=await run(release,'('+installFixture.toString()+')('+inputJSON+','+(process.env.CR_BENCH_PROFILE_INITIAL==='1')+')');
    if(JSON.stringify(actual)!==JSON.stringify(release.expected))throw Error(release.name+' identity mismatch: '+JSON.stringify({expected:release.expected,actual}));
    await send('Target.activateTarget',{targetId});
    release.initial_ms=await run(release,'__runtimeBenchmark.initial()');
    process.stderr.write(JSON.stringify({progress:release.name+' initial',version:actual.app,elapsed_ms:release.initial_ms})+'\n');
  }
  for(const mode of ['reanalysis','render'])for(let round=-warmups;round<repetitions;round++){
    // Counterbalance order; never time two renderers concurrently.
    const ordered=round%2===0?releases:releases.slice().reverse();
    for(const release of ordered){await send('Target.activateTarget',{targetId:release.targetId});const value=await run(release,'__runtimeBenchmark.measure('+JSON.stringify(mode)+')');if(round>=0)release[mode].push(value);}
    if(round>=0&&(round+1)%5===0)process.stderr.write(JSON.stringify({progress:mode,completed:round+1,total:repetitions})+'\n');
  }
  const results=[];
  for(const release of releases){
    const state=await run(release,'__runtimeBenchmark.state()');
    if(state.loaded_tag_documents!==tagDocuments||state.loaded_corpus_contracts!==corpusContracts||state.loaded_corpus_judgments!==corpusContracts*4||state.registered_standards!==0||state.archival_enabled)throw Error(release.name+' fixture counts/settings changed: '+JSON.stringify(state));
    if(release.errors.length||release.external.length)throw Error(release.name+' runtime/network error: '+JSON.stringify({errors:release.errors,external:release.external}));
    results.push({release:release.name,html_sha256:release.html_sha256,...state,initial_analysis:{n:1,elapsed_ms:release.initial_ms},reanalysis:stats(release.reanalysis),render:stats(release.render),external_requests:0});
  }
  console.log(JSON.stringify({artifact:'v1.88-isolated-runtime-benchmark',created_at:new Date().toISOString(),synthetic_only:true,fixture_sha256:fixtureHash,scale,
    environment:{browser:version.Browser,node:process.version,platform:platform(),architecture:arch(),logical_cpus:cpus().length},
    method:{initial:'one fresh-context analysis: segmentation + input/type setup + runAnalysis + synchronous layout; no P50/P95',reanalysis:'real runAnalysis + synchronous layout',render:'real renderClauses + renderReport + synchronous layout',warmups_per_mode:warmups,repetitions,percentile:'nearest rank',animation:'reduced in both versions',archival:'disabled in both versions',measurement_order:'initial previous/current, subsequent rounds alternate previous/current order',excluded:['file conversion','data import','browser startup','asynchronous evaluation archival','GPU paint completion']},
    comparison:{active_catalog_delta:results[1].active_catalog_questions-results[0].active_catalog_questions,analysis_question_delta:results[1].analysis_questions-results[0].analysis_questions,automatic_verdict_delta:results[1].automatic_verdicts-results[0].automatic_verdicts},results,
    limitations:['합성 자료 1종·동일 장비의 관측값이며 폐쇄망 실자료 성능/정확도가 아님.','질문 통합·제외와 자동 완료 건수로 렌더할 항목 수가 달라지므로 동일 작업량의 엔진 미세벤치마크가 아님.','초기 분석은 각 버전 1회뿐이며 OS/JIT/캐시·열상태·다른 프로세스 영향이 있음. 반복 구간은 캐시가 유지된 재분석/렌더임.','개선률이나 처리시간을 약속하지 않으며 수치가 느려져도 기대값을 조정해 숨기지 않음.']},null,2));
}catch(error){console.error(JSON.stringify({error:error.message,pages:Array.from(sessions.values()).map(s=>({release:s.name,errors:s.errors,external:s.external}))},null,2));throw error;
}finally{
  for(const browserContextId of contexts)await send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});
  ws.close();for(const p of pending.values())clearTimeout(p.timer);
  if(previousFile)await unlink(previousFile).catch(()=>{});
  if(temporaryDirectory)await rmdir(temporaryDirectory).catch(()=>{});
}
