/* v1.89 runtime harness: dedicated CDP contexts, synthetic inputs only. */
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),Loop=require('../src/loop');
export const hash=value=>createHash('sha256').update(value).digest('hex');
export async function emitResult(result){
  const json=JSON.stringify(result,null,2);
  if(process.env.CR_OUTPUT){
    const target=resolve(process.env.CR_OUTPUT),allowed=['v1.89-runtime-benchmark.json','v1.89-performance-acceptance.json'].map(name=>fileURLToPath(new URL('../docs/'+name,import.meta.url)));
    assert(allowed.includes(target),'Output must be one of the two task-owned v1.89 JSON artifacts');
    await writeFile(target,json+'\n','utf8');process.stderr.write(JSON.stringify({artifact_written:target})+'\n');
  }else console.log(json);
}
export function integer(name,fallback,min,max){const n=Number(process.env[name]??fallback);if(!Number.isInteger(n)||n<min||n>max)throw Error(name+' must be '+min+'..'+max);return n;}
export function statistics(values){const a=values.slice().sort((x,y)=>x-y),rank=p=>a[Math.ceil(p*a.length)-1];return {n:a.length,p50_ms:a.length>=10?rank(.5):null,p95_ms:a.length>=10?rank(.95):null,min_ms:a[0]??null,max_ms:a.at(-1)??null,samples_ms:values};}
export function createFixture({repeat=100,structured=false,tagDocuments=300,corpusContracts=100,staleTemplates=0}={}){
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
  let text='합성 개인정보 처리업무 위탁계약서\n위탁자(이하 “갑”이라 한다).\n수탁자(이하 “을”이라 한다).\n' +Array.from({length:repeat},()=>clauses).flat().map(([title,body],i)=>'제'+(i+1)+'조('+title+')\n'+body).join('\n');
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
  const extraction=structured?require('../src/document_structure').fromBlocks('docx',text.split('\n').map((text,paragraph)=>({text,source:{format:'docx',paragraph}}))):null;
  if(extraction)text=extraction.text;
  return {text,knowledge,corpus,extraction,context:{type:'outsourcing',department:'합성부서'},scale:{repeat,unique_clause_bodies:14,authored_clauses:14*repeat,characters:text.length,utf8_bytes:Buffer.byteLength(text),structure_blocks:extraction?.blocks.length||0,tag_documents:tagDocuments,tag_definitions:14,corpus_contracts:corpusContracts,corpus_judgments:corpusContracts*4,stale_templates:staleTemplates,valid_templates:staleTemplates?1:0}};
}

export async function connect(){
  const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9369';
  if(!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(endpoint))throw Error('Dedicated local browser endpoint required');
  const version=await fetch(endpoint+'/json/version').then(r=>{if(!r.ok)throw Error('CDP '+r.status);return r.json();});
  const ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
  let seq=0,closing=false;const waiting=new Map(),entries=new Map(),contexts=[],files=[],dirs=[],releaseHashes=new Map();
  ws.onmessage=event=>{const m=JSON.parse(event.data),e=entries.get(m.sessionId);
    if(e&&m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;e.errors.push({text:d.text,description:d.exception?.description,line:d.lineNumber});}
    if(e&&m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))e.external.push(m.params.request.url);
    if(e&&m.method==='Network.webSocketCreated')e.external.push(m.params.url);
    if(e&&m.method==='Page.loadEventFired'){for(const done of e.loadWaiters.splice(0))done();}
    const p=waiting.get(m.id);if(p){waiting.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(m.error.message)):p.ok(m.result);}
  };
  function send(method,params={},sessionId){return new Promise((ok,no)=>{const id=++seq,timer=setTimeout(()=>{waiting.delete(id);no(Error('CDP timeout '+method));},60000);waiting.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  async function run(e,expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},e.sessionId);if(r.exceptionDetails)throw Error(e.label+': '+JSON.stringify(r.exceptionDetails));return r.result.value;}
  async function ready(e){await run(e,"new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'&&typeof runAnalysis==='function'&&typeof legalOpinionKnowledge!=='undefined'&&legalOpinionKnowledge&&typeof reviewHistory!=='undefined'&&reviewHistory){clearInterval(t);ok();}else if(++n>400){clearInterval(t);no(Error('startup'));}},50);})");}
  function loaded(e){return new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error(e.label+' load timeout')),30000);e.loadWaiters.push(()=>{clearTimeout(timer);ok();});});}
  async function reload(e){const done=loaded(e);await send('Page.reload',{},e.sessionId);await done;await ready(e);}
  async function page(release,label){
    let url,expected,html;
    if(release==='baseline'){
      const update=JSON.parse(await readFile(new URL('../dist/contract-review-v1.88.0.crupdate',import.meta.url),'utf8'));
      assert.equal(update.format,'contract-review-update-v1');assert.equal(update.version,'1.88.0');assert.equal(hash(update.html),update.sha256);
      const dir=await mkdtemp(join(tmpdir(),'cr-v189-benchmark-'));dirs.push(dir);const file=join(dir,'baseline-1.88.0.html');files.push(file);await writeFile(file,update.html,'utf8');
      html=update.html;url=pathToFileURL(file).href;expected={app:'1.88.0',auto:'standard-auto-v13',recognition:'agreement-judgment-v2'};
    }else{
      html=await readFile(new URL('../dist/contract-review.html',import.meta.url),'utf8');url=new URL('../dist/contract-review.html',import.meta.url).href;
      expected={app:(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim(),auto:require('../src/standard_auto').VERSION,recognition:require('../src/agreement_judgment').VERSION};
      assert.match(expected.app,/^1\.89\./,'Build the new v1.89 HTML before current-release testing');
    }
    const digest=hash(html);if(releaseHashes.has(release))assert.equal(digest,releaseHashes.get(release),'HTML changed during measurement: '+release);else releaseHashes.set(release,digest);
    const {browserContextId}=await send('Target.createBrowserContext');contexts.push(browserContextId);
    const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const e={label,release,targetId,sessionId,browserContextId,expected,html_sha256:hash(html),errors:[],external:[],loadWaiters:[]};entries.set(sessionId,e);
    await send('Runtime.enable',{},sessionId);await send('Network.enable',{},sessionId);await send('Page.enable',{},sessionId);
    await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']},sessionId);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
    const load=loaded(e);await send('Page.navigate',{url},sessionId);await load;await ready(e);
    const actual=await run(e,"({app:CR.app_version,auto:StandardAuto.VERSION,recognition:AgreementJudgment.VERSION})");assert.deepEqual(actual,expected);
    await run(e,"StandardAutoArchive.backup().then(x=>{if(x.packets.length)throw Error('Nonempty isolated store');})");
    return e;
  }
  async function install(e,payload){await send('Target.activateTarget',{targetId:e.targetId});return run(e,'('+installRuntime.toString()+')('+JSON.stringify(payload)+')');}
  async function cleanPage(e){assert.deepEqual(e.errors,[],e.label+' runtime errors');assert.deepEqual(e.external,[],e.label+' external requests');await send('Target.disposeBrowserContext',{browserContextId:e.browserContextId});contexts.splice(contexts.indexOf(e.browserContextId),1);}
  async function close(){if(closing)return;closing=true;process.removeListener('SIGINT',interrupted);for(const id of contexts)await send('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});ws.close();for(const p of waiting.values())clearTimeout(p.timer);for(const f of files)await unlink(f).catch(()=>{});for(const d of dirs)await rmdir(d).catch(()=>{});}
  function interrupted(){close().finally(()=>process.exit(130));}process.once('SIGINT',interrupted);
  return {version,send,run,page,ready,reload,install,cleanPage,close};
}

// A serialized page helper; never changes engine functions or bypasses caches.
export function installRuntime(payload){
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  legalOpinionKnowledge=payload.knowledge;loopCorpus=payload.corpus;saveCorpus();historyCombinedCache={legal:null,history:null,value:null};
  document.getElementById('contract-text').value=payload.text;document.getElementById('input-department').value=payload.context.department;
  state.fileName='synthetic-v189-runtime';state.extractedDocument=payload.extraction;
  applyMotionPreference('auto',false);check(reducedMotion(),'Reduced-motion mode required');
  StandardAutoArchive.setEnabled(false);
  if(payload.scale.stale_templates){
    const c=SafetyRuntime.allChecks().find(c=>c.id==='CMN-19'),templates=[];
    for(let i=0;i<=payload.scale.stale_templates;i++){
      const stale=i<payload.scale.stale_templates,text=stale?'제1조(관할)\n관할 법원은 추후 협의한다.':'제1조(관할)\n본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.';
      const t=TemplateLibrary.draft('합성 '+(stale?'과거연결후보 ':'정상표준 ')+i,'1',text,{type_ids:['outsourcing'],roles:[],stance:'party'});
      TemplateLibrary.bind(t,c,[text]);t.active=true;templates.push(t);
    }
    const value=JSON.stringify({format:TemplateLibrary.VERSION,templates});localStorage.setItem('cr-template-library-v1',value);
    window.dispatchEvent(new StorageEvent('storage',{key:'cr-template-library-v1',newValue:value}));
    check(TemplateLibraryRuntime.get().templates.length===payload.scale.stale_templates+1,'Synthetic template load');
  }
  const measure=fn=>{const start=performance.now();fn();void document.body.offsetHeight;return +(performance.now()-start).toFixed(3);};
  const automatic=()=>Object.keys(verdictStore).filter(id=>verdictStore[id].origin==='auto'&&verdictStore[id].verdict==='이상없음').sort();
  globalThis.__v189={payload,initial(){
    check(!state.result,'Expected an unanalyzed page');
    return measure(()=>{state.text=payload.text;state.clauses=segmentContract(state.text);refreshInputSetup();onTypeChanged(payload.context.type);renderScreening();renderTags();document.getElementById('analyze-setup').hidden=false;runAnalysis({landing:true,reveal:false});});
  },measure(mode){return measure(()=>{if(mode==='reanalysis')runAnalysis();else if(mode==='render'){renderClauses();renderReport();}else throw Error('Unknown mode');});},
  snapshot(){
    const docs=safetyDocuments(),ids=automatic(),anchors={},locations={};
    for(const id of ids){const rows=ReviewCore.completionLocations(verdictStore[id],docs);locations[id]=rows.length;
      const r=state.result.results.find(r=>r.cpId===id);anchors[id]=ReviewCore.completionAnchor(r,verdictStore[id],state.clauses,docs);
      check(rows.every(e=>docs[e.document].text.slice(e.start,e.end)===e.text),'Current evidence offsets '+id);
    }
    const controls=Array.from(document.querySelectorAll('.verdict-ctl'));
    return {identity:{app:CR.app_version,auto:StandardAuto.VERSION,recognition:AgreementJudgment.VERSION},text_characters:state.text.length,parsed_clauses:state.clauses.length,structure_blocks:state.extractedDocument?.blocks?.length||0,
      questions:state.result.checkpoints.length,automatic_ids:ids,anchors,locations,automatic_fraction:ids.length/state.result.checkpoints.length,
      max_buttons_per_card:Math.max(0,...controls.map(c=>c.querySelectorAll('.vd-evidence-open').length)),evidence_buttons:document.querySelectorAll('.vd-evidence-open').length,
      max_auto_comment_characters:Math.max(0,...ids.map(id=>(verdictStore[id].comment||'').length)),auto_comment_characters:ids.reduce((n,id)=>n+(verdictStore[id].comment||'').length,0),
      dom_nodes:document.querySelectorAll('*').length,body_html_characters:document.body.innerHTML.length,loaded_tags:Object.keys(legalOpinionKnowledge.latest).length,loaded_corpus:loopCorpus.meta.contract_count,registered_templates:TemplateLibraryRuntime.get().templates.length};
  }};
  return {scale:payload.scale};
}

export async function benchmark(){
  const client=await connect(),repetitions=integer('CR_BENCH_REPETITIONS',10,1,100),warmups=integer('CR_BENCH_WARMUPS',1,0,10),repeat=integer('CR_DOC_REPEAT',100,1,200);
  const names=(process.env.CR_BENCH_CASES||'plain,structured,stale').split(','),only=process.env.CR_ONLY_RELEASE,results=[];
  const releases=only?[only]:['baseline','current'];for(const r of releases)assert(['baseline','current'].includes(r));
  try{
    for(const name of names){assert(['plain','structured','stale'].includes(name));const payload=createFixture({repeat,structured:name==='structured',staleTemplates:name==='stale'?integer('CR_STALE_TEMPLATES',40,1,150):0}),pages=[];
      for(const release of releases){const e=await client.page(release,name+'-'+release);await client.install(e,payload);e.initial=await client.run(e,'__v189.initial()');e.before=await client.run(e,'__v189.snapshot()');e.reanalysis=[];e.render=[];pages.push(e);process.stderr.write(JSON.stringify({progress:e.label,initial_ms:e.initial})+'\n');}
      for(const mode of ['reanalysis','render'])for(let n=-warmups;n<repetitions;n++){
        for(const e of n%2===0?pages:pages.slice().reverse()){await client.send('Target.activateTarget',{targetId:e.targetId});const value=await client.run(e,'__v189.measure('+JSON.stringify(mode)+')');if(n>=0)e[mode].push(value);}
        if(n>=0&&(n+1)%5===0)process.stderr.write(JSON.stringify({progress:name+' '+mode,done:n+1,total:repetitions})+'\n');
      }
      for(const e of pages){const state=await client.run(e,'__v189.snapshot()');assert.deepEqual(state.automatic_ids,e.before.automatic_ids,'Repeated analysis must retain automatic conclusions');assert.deepEqual(state.anchors,e.before.anchors,'Repeated analysis must retain evidence locations');
        assert.equal(state.loaded_tags,300);assert.equal(state.loaded_corpus,100);results.push({case:name,release:e.release,html_sha256:e.html_sha256,fixture_sha256:hash(JSON.stringify(payload)),scale:payload.scale,...state,initial_analysis:{n:1,ms:e.initial},reanalysis:statistics(e.reanalysis),render:statistics(e.render),external_requests:0});await client.cleanPage(e);}
      if(pages.length===2){assert.equal(pages[1].before.questions,pages[0].before.questions,'No changed active-question denominator');assert.deepEqual(pages[1].before.automatic_ids,pages[0].before.automatic_ids,'No lost automatic verdicts compared with v1.88');assert.deepEqual(pages[1].before.anchors,pages[0].before.anchors,'No changed completion placement compared with v1.88');assert.deepEqual(pages[1].before.locations,pages[0].before.locations,'All source evidence retained compared with v1.88');}
    }
    return {artifact:'v1.89-runtime-benchmark',synthetic_only:true,created_at:new Date().toISOString(),environment:{browser:client.version.Browser,node:process.version,platform:platform(),arch:arch(),logical_cpus:cpus().length},repetitions,warmups,results,
      limitations:['14개 조문 문구를 기본100회 반복한 1400조항·약71k자이다. 실제 계약 1400개나 다양한 문구 1400종이 아님.','구조형은 동일 본문에 합성 DOCX 문단블록을 부여한 경우이며 실제 DOCX 추출 속도 시험은 아님.','최초 분석은1회만, 반복10회미만이면 P50/P95를 출력하지 않음. 강제 동기 레이아웃 포함·GPU 페인트 제외.','Archive OFF 성능 비교이며 archive ON+패킷/메모 부하는 별도 test_v189_performance에서 검증함.','실제 폐쇄망 성능 보증이나 개선률 약속이 아니며 현재/이전 질문수와 자동완료수가 같은지 확인함.']};
  }finally{await client.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])benchmark().then(emitResult).catch(e=>{console.error(e.stack);process.exitCode=1;});
