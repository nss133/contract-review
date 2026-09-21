'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require.resolve('../src/app'),'utf8'),snap=require('../src/analysis_runtime');
const cp={id:'CMN-19',check:'관할 약정 존재',meaning_revision:'1'};
function harness(){const nodes={},events=[],saves=[],work=[];let rejectWork;
  function node(id){return nodes[id]||(nodes[id]={value:id==='contract-text'?'제1조(관할)\n서울중앙지방법원을 관할법원으로 한다.':id.includes('type')?'service':'',hidden:true,dataset:{},textContent:'',disabled:false,inert:false,classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[]});}
  const oldResult={checkpoints:[],results:[]},manual={A:{verdict:'검토의견',origin:'manual',comment:'최근 수기 의견'}},state={text:node('contract-text').value,result:oldResult,clauses:[],subDocs:[],baseText:'',baseClauses:[],partyRoles:[],partyContext:null,activeModules:[],stance:'party',scopeAnswers:{},scopeModuleOverrides:{},reassign:{},matchConfirm:{}};
  const ctx={state,Findings:require('../src/findings'),performance,setTimeout,clearTimeout,CR:{engine_fingerprint:'test',common:{meta:{standard_subdocs:[]}}},MatcherConfig:{TAG_MATCH_MODE:'assist'},
    document:{getElementById:node,querySelector:()=>null,body:{classList:{add(){},remove(){}}}},window:{scrollY:0,scrollTo(){},dispatchEvent:e=>events.push(e)},
    CustomEvent:function(type,opts){this.type=type;this.detail=opts?.detail;},Event:function(type){this.type=type;},requestAnimationFrame:fn=>fn(),
    legalOpinionKnowledge:{latest:{},documents:{a:{evidence:[{sentence:'원래 의견'}]}}},reviewHistory:null,loopCorpus:{},TemplateLibraryRuntime:{packets:()=>packets},
    AnalysisRuntime:{snapshot:snap.snapshot,same:snap.same,cancel(){if(rejectWork){rejectWork(Object.assign(Error('cancel'),{name:'AbortError'}));rejectWork=null;}},run(input,sources,progress){return new Promise((resolve,reject)=>{rejectWork=reject;work.push({input,sources,progress,resolve,reject});});}},
    refreshInputSetup(){},captureInitialTypeDecision(){},syncTypeSelects(){},renderScreening(){},renderTags(){},flushVerdictNotes(){},updateScopeAssessments(){},applyScopeModuleDecisions(){},analysisDocs:()=>[{checkpoints:[cp]}],
    hashText:()=> 'new',buildSafetyDocuments:()=>[{name:'본문',text:state.text}],snapshotRuleMatches(){},detectSubdocRefs:()=>[],subdocInUse:()=>false,
    verdictStore:manual,verdictHash:'old',_verdictSavedSnapshot:manual,groupReviewStore:{},_verdictEditPins:{},_opinionEditing:false,
    loadVerdicts(){ctx.verdictHash='new';},loadFindings(){},loadReassign(){},loadMatchConfirm(){},applyReassign(){},ReviewCore:{activeCheck:()=>true},_cpById:()=>cp,
    SafetyRuntime:{installReferences(){},manualInputKeyV3:()=>'',async applyAsync(store,pause){await pause();return store;}},
    saveVerdicts(){saves.push(JSON.parse(JSON.stringify(ctx.verdictStore)));},saveFindings(){},applyCompare(){},renderArchiveBanner(){},async renderClausesAsync(){},bindVerdictIO(){},renderChecklist(){},renderSuggestions(){},renderFormalBar(){},renderReport(){},renderSummaryBar(){},pendingReviewCount:()=>1,prepareResultReveal(){},activatePane(){},localLlmEnabled:()=>false};
  const packets=[];vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('var _analysisPresentationSeq'),app.indexOf('function prepareResultReveal')),ctx);vm.runInContext(app.slice(app.indexOf('var _analyzedOnce'),app.indexOf('/* ---------- 선택형 로컬 AI')),ctx);
  const result=()=>({fingerprint:'test',clauses:[{index:0,heading:'제1조(관할)',body:'서울중앙지방법원을 관할법원으로 한다.'}],baseClauses:[],core:{result:{checkpoints:[cp],results:[{cpId:cp.id,coverage:'addressed',best:{clauseIndex:0}}]},subCoverage:{}},formal:[],integrity:{items:[],assessment:{},structure:{}},references:{rows:{},stats:{}}});
  async function started(){for(let i=0;i<50&&!work.length;i++)await new Promise(r=>setTimeout(r,1));assert(work.length,'actual runAnalysis reaches worker');}
  return {ctx,node,events,saves,work,oldResult,manual,result,started};
}
test('actual runAnalysis restores error/cancel UI and never saves cancelled worker output',async()=>{
  for(const action of ['cancel','error','input','source']){const h=harness(),p=h.ctx.runAnalysis();await h.started();assert(h.node('btn-analyze').disabled);
    if(action==='cancel')h.ctx.cancelAnalysis('사용자 취소');
    else if(action==='error')h.work[0].reject(Error('Worker policy blocked'));
    else{if(action==='input')h.node('contract-text').value+=' 다른 계약';else h.ctx.legalOpinionKnowledge.documents.a.evidence[0].sentence='변경된 의견';h.work[0].resolve(h.result());}
    const done=await p;assert.equal(done.status,action==='error'?'error':'cancelled');assert.equal(h.saves.length,0);assert.equal(h.ctx.state.result,h.oldResult);assert.equal(h.ctx.verdictStore,h.manual);
    assert.equal(h.node('btn-analyze').disabled,false);assert.equal(h.node('btn-analysis-cancel').hidden,true);assert.equal(h.node('analysis-progress').dataset.status,done.status);assert.equal(h.events.filter(e=>e.type==='analysis-complete').length,1);
  }
});
test('cancel during main-thread authenticated checking rolls back staged state before any verdict save',async()=>{
  const h=harness();let release,checking=false;h.ctx.SafetyRuntime.applyAsync=()=>new Promise(resolve=>{checking=true;release=resolve;});
  const p=h.ctx.runAnalysis();await h.started();h.work[0].resolve(h.result());for(let i=0;i<50&&!checking;i++)await new Promise(r=>setTimeout(r,1));assert(checking);
  assert.notEqual(h.ctx.state.result,h.oldResult);h.ctx.cancelAnalysis('최종 확인 취소');assert.equal(h.ctx.state.result,h.oldResult);release({fake:{verdict:'이상없음',origin:'auto'}});
  assert.equal((await p).status,'cancelled');assert.equal(h.saves.length,0);assert.equal(h.ctx.verdictStore,h.manual);assert.equal(h.ctx.verdictHash,'old');
});
test('successful commit preserves the latest manual data and retires the cancel button before display awaits',async()=>{
  const h=harness();let rendered=false;h.ctx.renderClausesAsync=async()=>{rendered=true;assert(h.node('btn-analysis-cancel').hidden);assert.equal(h.saves.length,1);assert.equal(h.ctx.cancelAnalysis('너무 늦은 취소'),false);};
  const p=h.ctx.runAnalysis();await h.started();h.ctx.verdictStore.A.comment='작업 중 다른 탭에서 수신한 최신 의견';h.work[0].resolve(h.result());const done=await p;
  assert.equal(done.status,'completed',done.error);assert(rendered);assert.equal(h.saves[0].A.comment,'작업 중 다른 탭에서 수신한 최신 의견');assert.equal(h.node('analysis-progress').hidden,true);assert.equal(h.node('btn-analyze').disabled,false);
});
test('save failure is explicit and never falsely reported as completed or unsaved cancellation',async()=>{
  const h=harness();h.ctx.saveVerdicts=()=>{throw Error('QuotaExceededError');};const p=h.ctx.runAnalysis();await h.started();h.work[0].resolve(h.result());
  const result=await p;assert.equal(result.status,'error');assert.match(result.error,/저장·표시/);assert.match(result.error,/QuotaExceededError/);assert.equal(h.node('btn-analyze').disabled,false);
});
test('reanalysis retires warnings but commits existing reviewer notes and legacy context without a new pending item',async()=>{
  const h=harness();h.ctx.verdictHash='new';
  h.ctx.state.findingStore={manual:{M:{title:'기존 직접 의견',comment:'직접 메모'}},decisions:{F:{decision:'opinion',comment:'별첨 보완 요청'},O:{decision:'no_issue',comment:'원본 확인 완료'}}};
  h.ctx.state.integrityFindings=[{id:'F',title:'기존 확인 제목',detail:'기존 대상',clause_index:0}];
  let savedFindings;h.ctx.saveFindings=()=>{savedFindings=JSON.parse(JSON.stringify(h.ctx.state.findingStore));};
  const p=h.ctx.runAnalysis();await h.started();h.work[0].resolve(h.result());
  assert.equal((await p).status,'completed');
  assert.equal(h.ctx.state.integrityFindings.length,0);assert.equal(h.ctx.state.integrityAssessment,null);
  assert.equal(savedFindings.manual.M.comment,'직접 메모');
  assert.equal(savedFindings.decisions.F.context.title,'기존 확인 제목');assert.equal(savedFindings.decisions.F.comment,'별첨 보완 요청');
  assert.equal(savedFindings.decisions.O.comment,'원본 확인 완료');
});
test('first analysis and staged verification reject changed template/settings/boundaries/subdoc use/packets',async()=>{
  for(const stage of ['worker','verification'])for(const kind of ['template','settings','boundaries','subdoc','packet']){
    const h=harness();let version='v1',settings='enabled',boundary='',release,checking=false;
    h.ctx.TemplateLibraryRuntime.inputVersion=()=>version;h.ctx.SafetyRuntime.configurationKey=()=>settings;
    h.ctx.StructureReview={fingerprint:()=> 'boundary-hash',boundaries:()=>[]};h.ctx.localStorage={getItem:()=>boundary};
    h.ctx.state.subdocUse={security:false};if(stage==='worker')h.ctx.state.result=null;
    if(stage==='verification')h.ctx.SafetyRuntime.applyAsync=()=>new Promise(resolve=>{checking=true;release=resolve;});
    const p=h.ctx.runAnalysis();await h.started();
    if(stage==='verification'){h.work[0].resolve(h.result());for(let i=0;i<50&&!checking;i++)await new Promise(r=>setTimeout(r,1));assert(checking);}
    if(kind==='template')version='v2';if(kind==='settings')settings='disabled';if(kind==='boundaries')boundary='new boundary';if(kind==='subdoc')h.ctx.state.subdocUse.security=true;
    if(kind==='packet')h.ctx.TemplateLibraryRuntime.packets().push({id:'new',verdicts:{}});
    if(stage==='worker')h.work[0].resolve(h.result());else release(h.manual);
    assert.equal((await p).status,'cancelled',stage+' '+kind);assert.equal(h.saves.length,0,stage+' '+kind);
    assert.equal(h.ctx.state.result,stage==='worker'?null:h.oldResult);
  }
});
