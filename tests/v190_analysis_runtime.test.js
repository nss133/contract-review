'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bridge=fs.readFileSync(require.resolve('../src/analysis_runtime'),'utf8');
function runtime(fail){const workers=[],timers=new Map();let timer=0,revoked=0;
  class Worker{constructor(){if(fail)throw Error('policy blocked');this.messages=[];this.terminated=false;workers.push(this);}postMessage(m){this.messages.push(structuredClone(m));}terminate(){this.terminated=true;}}
  const ctx={Worker,Blob,performance,URL:{createObjectURL:()=> 'blob:offline',revokeObjectURL:()=>revoked++},document:{getElementById:()=>({textContent:'offline-only worker'})},setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(ctx);vm.runInContext(bridge,ctx);return {api:ctx.AnalysisRuntime,workers,timers,revoked:()=>revoked};
}
test('worker datasets are transferred once; nested in-place edits update the next worker request',async()=>{
  const r=runtime(),sources={legal:{documents:{a:{evidence:[{sentence:'기존 의견'}]}}},corpus:{},packets:[]};
  const resolve=()=>{const w=r.workers[0],m=w.messages.at(-1);w.onmessage({data:{id:m.id,type:'result',result:{ok:true}}});};
  let p=r.api.run({text:'본문'},sources);resolve();await p;
  p=r.api.run({text:'다른 본문'},sources);assert.equal(r.workers.length,1);assert.equal(r.workers[0].messages.at(-1).sources,null);resolve();await p;
  sources.legal.documents.a.evidence[0].sentence='수정 의견';p=r.api.run({text:'본문'},sources);assert.equal(r.workers[0].messages.at(-1).sources.legal.documents.a.evidence[0].sentence,'수정 의견');resolve();await p;
  r.api.cancel();assert.equal(r.revoked(),1);
});
test('cancel terminates the worker and rejects once; a late result cannot finish a replacement job',async()=>{
  const r=runtime(),first=r.api.run({text:'첫 작업'},{},()=>{}),w=r.workers[0],old=w.messages[0];
  r.api.cancel();await assert.rejects(first,{name:'AbortError'});assert(w.terminated);assert.equal(r.timers.size,0);
  const next=r.api.run({text:'새 작업'},{});w.onmessage({data:{id:old.id,type:'result',result:'stale'}});
  const nw=r.workers[1],m=nw.messages[0];nw.onmessage({data:{id:m.id,type:'result',result:'current'}});assert.equal(await next,'current');r.api.cancel();
});
test('worker blocked, crash, malformed message and timeout fail explicitly without synchronous engine fallback',async()=>{
  await assert.rejects(runtime(true).api.run({},{}),/별도 분석 작업/);
  for(const kind of ['crash','message','timeout']){const r=runtime(),p=r.api.run({},{}),w=r.workers[0];
    if(kind==='crash')w.onerror({message:'synthetic failure',preventDefault(){}});else if(kind==='message')w.onmessageerror();else [...r.timers.values()][0]();
    await assert.rejects(p);assert(w.terminated);assert.equal(r.revoked(),1);
  }
});
test('reference worker is independent: cancelling it cannot cancel a core analysis',async()=>{
  const r=runtime(),references=r.api.create(),core=r.api.run({text:'분석'},{}),ref=references.run({referenceOnly:true},{});
  assert.equal(r.workers.length,2);references.cancel();await assert.rejects(ref,{name:'AbortError'});
  assert.equal(r.workers[0].terminated,false);const m=r.workers[0].messages[0];r.workers[0].onmessage({data:{id:m.id,type:'result',result:'core'}});
  assert.equal(await core,'core');r.api.cancel();
});
test('real worker handler preserves engine mapping, separate safety document addresses, and only returns compact reference results',()=>{
  const H=require('../src/history_assist'),J=require('../src/judgment_hints'),Core=require('../src/review_core'),Sources=require('../src/judgment_sources'),DRef=require('../src/decision_references');
  const S=require('../src/segmenter').segmentContract,inventory=require('../knowledge/checklist_inventory_v188.json').checks,row=inventory.find(r=>r.id==='CMN-19');
  const cp={id:row.id,check:row.question,meaning_revision:row.meaning_revision,module:'M-COMMON',triggers:{keywords:['관할','법원']}},court='본 계약의 소송은 서울중앙지방법원을 관할법원으로 한다.',text='제1조(관할)\n'+court;
  const messages=[],ctx={self:{postMessage:m=>messages.push(structuredClone(m))},CR:{engine_fingerprint:'engine',tag_match_mode:'assist'},MatcherConfig:require('../src/matcher_config'),HistoryAssist:H,JudgmentHints:J,ReviewCore:Core,JudgmentSources:Sources,DecisionReferences:DRef,Integrity:{analyze(){throw Error('Removed automatic integrity scan must not run');}},DocumentStructure:require('../src/document_structure'),Formal:require('../src/formal'),segmentContract:S};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../src/analysis_worker'),'utf8'),ctx);
  const sources={legal:{latest:{a:'a'},documents:{a:{source_id:'a',evidence:[{check_id:cp.id,sentence:court}]}}},history:null,corpus:{byCheck:{}},packets:[]};
  const input={text,options:{modules:['M-COMMON'],stance:'party'},docs:[{checkpoints:[cp]}],subDocs:[],safetyDocuments:[{name:'본문',text},{name:'원계약',text:'과거 계약'},{name:'보안 별첨',text:court}]};
  ctx.self.onmessage({data:{id:1,input,sourceVersion:1,sources}});const result=messages.at(-1);assert.equal(result.type,'result',result.error);assert.equal(result.result.fingerprint,'engine');
  assert.deepEqual(messages.filter(m=>m.type==='progress').map(m=>m.step),[0,1,2,3]);
  assert.equal(result.result.integrity.assessment.status,'disabled');assert.deepEqual(result.result.integrity.items,[]);
  assert.equal(result.result.integrity.structure.sections[0].id,'main');
  const knowledge=H.combined(sources.legal,null,sources.corpus,{excludeContractHash:undefined,excludeReviewId:undefined}),hints=J.index({knowledge,corpus:sources.corpus,packets:[]});
  const expected=Core.run(S(text),input.docs,{...input.options,baseClauses:[],judgmentHints:hints,historyRelated:H.retrieve(knowledge,' '+text,'')},[]);
  assert.deepEqual(result.result.core,JSON.parse(JSON.stringify(expected)));
  const refs=result.result.references;assert(!('knowledge' in refs));assert(!('by_check' in refs));assert(refs.rows[cp.id].some(r=>r.current_evidence.document_index===2));
  assert.deepEqual(refs.tag_rows,{});assert.equal(refs.tag_status,'unqueried');
  const originalRun=ctx.ReviewCore;ctx.ReviewCore={run(){throw Error('reference request must not map again');}};
  ctx.self.onmessage({data:{id:20,input:{...input,referenceOnly:true,checks:[cp]},sourceVersion:1}});
  assert.equal(messages.at(-1).type,'result',messages.at(-1).error);
  assert.deepEqual(messages.at(-1).result.tag_rows[cp.id],DRef.retrieve(cp,input.safetyDocuments,knowledge));ctx.ReviewCore=originalRun;
  ctx.self.onmessage({data:{id:2,input:{...input,tagMode:'off'},sourceVersion:1}});assert.equal(messages.at(-1).type,'result');assert.equal(ctx.MatcherConfig.TAG_MATCH_MODE,'off');
  ctx.MatcherConfig.TAG_MATCH_MODE='assist';
  const Standard=require('../src/standard_auto');assert.equal(Standard.ticketFromEvaluation(cp,{}, {documents:input.safetyDocuments,confirmed:true},result.result.core.result.results[0]),null,'untrusted worker mapping cannot mint a verdict ticket');
});
test('lazy reassign choices do not expand all document clauses until requested',()=>{
  const app=fs.readFileSync(require.resolve('../src/app'),'utf8'),ctx={state:{clauses:Array.from({length:1400},(_,i)=>({heading:'제'+i+'조'})),reassign:{X:1399},matchConfirm:{}},_reviewPlacementById:{},_cpById:()=>({id:'X'}),esc:String,REASSIGN_CONTRACT:'__contract__',REASSIGN_CONFIRM:'__confirm__'};
  vm.createContext(ctx);
  vm.runInContext(app.slice(app.indexOf('function reviewPlacementLabel('),app.indexOf('function renderClauses()')),ctx);
  vm.runInContext(app.slice(app.indexOf('function reassignControlHtml('),app.indexOf('function bindReassign(')),ctx);
  const r={cpId:'X',ranked:[]};assert((ctx.reassignControlHtml(r).match(/<option /g)||[]).length<6);assert.equal((ctx.reassignControlHtml(r,true).match(/<option /g)||[]).length,1402);assert.match(ctx.reassignControlHtml(r),/1399" selected/);
});
