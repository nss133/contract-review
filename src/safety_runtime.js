"use strict";
/* 앱·평가의 공통 내부 정책 어댑터. 원본·규칙·범위가 바뀌면 이전 허용을 재검사한다. */
var SafetyRuntime = (function () {
  var KEY="cr-safety-workbench-v1", store=SafetyWorkbench.empty(), attestation="", loadError="";
  var standardEnabled=true,vatFactEnabled=true,standardStopped={};
  // 설정 없음은 기본 실행. 사용자가 명시적으로 중지한 설정은 업데이트 후에도 보존한다.
  try {var standardSettings=JSON.parse(localStorage.getItem('cr-standard-auto-v1')||'{}');standardEnabled=standardSettings.enabled!==false;vatFactEnabled=standardSettings.vat_fact!==false;standardStopped=standardSettings.stopped||{};}catch(e){loadError='자동판정 설정 파일을 읽지 못해 기본 실행 설정을 사용합니다.';}
  try {
    var raw=JSON.parse(localStorage.getItem(KEY)||"null");
    if(raw){
      if(!SafetyWorkbench.sealed(raw)||raw.format!==store.format)throw Error("승인 원장 무결성 확인 실패");
      Object.keys(raw.rules||{}).forEach(function(id){EvidenceRules.validate(raw.rules[id]);});
      store=raw;
    }
  } catch(e){loadError=e.message;}
  function today(){return verdictToday();}
  var preparedCache=null,decisionCache=new Map(),documentsCache=null,documentsSource=null,documentRevisions=[],manualKeyCache=new Map(),sourceIndexCache=null,sourceGeneration=0,workerReferences=null;
  function cancelReferences(){var r=workerReferences;if(!r)return;var running=!!r.request;r.request=null;r.epoch=(r.epoch||0)+1;
    // Keep the idle worker's prepared source index across contract analyses.
    if(running&&r.loader&&r.loader.cancel)r.loader.cancel();if(r.status==='loading')r.status='unqueried';}
  function installReferences(value,current,loader){cancelReferences();workerReferences={value:value,current:current,loader:loader,
    status:value?.tag_status||'ready',tagRows:value?.tag_rows||{},error:'',epoch:0};preparedCache=null;}
  function referenceState(){var r=workerReferences;
    if(!r)return {status:'unqueried',rows:{},error:''};
    if(!r.current())return {status:'stale',rows:{},error:'입력·자료가 변경되었습니다. 다시 분석한 뒤 참고 후보를 조회하세요.'};
    return {status:r.status,rows:r.status==='ready'?r.tagRows:{},error:r.error};}
  function requestReferences(){var r=workerReferences,view=referenceState();
    if(view.status==='stale'||!r)return Promise.reject(Error('현재 계약을 다시 분석한 뒤 참고 후보를 조회하세요.'));
    if(r.status==='ready')return Promise.resolve(r.tagRows);if(r.request)return r.request;
    if(!r.loader?.load)return Promise.reject(Error('참고 검색 작업을 시작할 수 없습니다. 다시 분석하세요.'));
    r.status='loading';r.error='';var epoch=++r.epoch,work;
    try{work=r.loader.load();}catch(e){work=Promise.reject(e);}
    var request=Promise.resolve(work).then(function(result){
      if(workerReferences!==r||r.epoch!==epoch||!r.current())throw Object.assign(Error('입력·자료가 바뀌어 이전 참고 검색 결과를 버렸습니다. 다시 분석하세요.'),{name:'AbortError'});
      if(!result||!result.tag_rows)throw Error('참고 검색 결과 형식이 올바르지 않습니다.');
      r.tagRows=displayResult(result.tag_rows);r.status='ready';return r.tagRows;
    }).catch(function(error){if(workerReferences===r&&r.epoch===epoch){r.status=error.name==='AbortError'?'stale':'error';r.error=error.message;}throw error;
    }).finally(function(){if(r.request===request)r.request=null;});r.request=request;return request;
  }
  function freezeSnapshot(value){if(value&&typeof value==='object'){Object.keys(value).forEach(function(k){freezeSnapshot(value[k]);});Object.freeze(value);}return value;}
  function documents(){
    var rows=safetyDocuments();
    if(typeof _safetyDocumentSnapshot!=='undefined'&&rows===_safetyDocumentSnapshot&&rows===documentsSource)return documentsCache;
    var revisions=rows.map(function(d){return typeof DocumentStructure!=='undefined'&&DocumentStructure.revisionToken?DocumentStructure.revisionToken(d.extraction):d.extraction;});
    if(!documentsCache||documentsCache.length!==rows.length||rows.some(function(d,i){var old=documentsCache[i];return old.name!==d.name||old.text!==d.text||old.independent!==d.independent||old.registered_reference!==d.registered_reference||old.template_id!==d.template_id||revisions[i]!==documentRevisions[i];})){
      // 원자료는 바꾸지 않고 검증 경계에서 한 번 복제한다. 반복 판정은 불변 스냅샷을 쓴다.
      documentsCache=freezeSnapshot(JSON.parse(JSON.stringify(rows)));documentRevisions=revisions;manualKeyCache.clear();
    }
    documentsSource=rows;
    return documentsCache;
  }
  var corpusFingerprintCache={source:null,value:''};
  function engineFingerprint(){return SafetyDigest.of({code:CR.engine_fingerprint});}
  function corpusFingerprint(){
    var source=loopCorpus&&loopCorpus.judgment_ledger;
    if(corpusFingerprintCache.source!==source){corpusFingerprintCache={source:source,value:SafetyDigest.of(source||{})};}
    return corpusFingerprintCache.value;
  }
  function comparisonContext(){
    var ctx=context();delete ctx.reassign;delete ctx.tag_mode;
    var checks={};allChecks().filter(ReviewCore.activeCheck).forEach(function(cp){checks[cp.id]=SafetyDigest.of(ReviewCore.meaning(cp));});
    return {version:1,documents:SafetyDigest.of(documents()),context:SafetyDigest.of(ctx),
      clauses:SafetyDigest.of(state.clauses||[]),checks:checks};
  }
  function context() {
    return {type:state.typeId,roles:(state.partyRoles||[]).slice(),party:state.partyContext,stance:state.stance,
      modules:state.activeModules,title:state.docTitle,scope_answers:state.scopeAnswers,
      reassign:state.reassign,
      tag_mode:MatcherConfig.TAG_MATCH_MODE,baseText:state.baseText||"",
      analysis_type_ids:[state.typeId].concat(scopeSourceDocs().map(function(d){return d.meta.type_id;})).filter(Boolean)};
  }
  function inputKey() {return SafetyDigest.of({documents:safetyDocuments(),context:context(),
    live:document.getElementById("contract-text").value,engine:engineFingerprint()});}
  // 사람의 본건 판정은 다른 항목의 매칭 이동·참고 DB 갱신으로 무효화하지 않는다.
  // v2는 이전 저장분의 검증을 위해 유지하며, 새 수기 판정은 질문별 v3 의존을 저장한다.
  function manualInputKey(id) {
    var ctx=context();
    ctx.reassign=Object.prototype.hasOwnProperty.call(state.reassign||{},id) ? state.reassign[id] : null;
    delete ctx.tag_mode;
    return SafetyDigest.of({documents:safetyDocuments(),context:ctx,
      live:document.getElementById("contract-text").value,check:_cpById(id)});
  }
  function manualInputKeyV3(id){
    var cp=_cpById(id);if(!cp)return '';
    var ds=documents(),source=ds,live=document.getElementById('contract-text').value,ctx=context(),key=JSON.stringify([cp,ctx]),old=manualKeyCache.get(id);
    if(old&&old.documents===source&&old.live===live&&old.key===key)return old.value;
    if(live!==state.text)ds=ds.map(function(d,i){return i===0?{name:d.name,text:live}:d;});
    var value=SafetyDigest.of(ReviewCore.manualDependency(cp,ds,ctx));manualKeyCache.set(id,{documents:source,live:live,key:key,value:value});return value;
  }
  function bundle() {
    var ctx=context(),confirmed=attestation===inputKey();
    ctx.source_quality_confirmed=confirmed;ctx.scope_confirmed=confirmed;
    return {documents:safetyDocuments(),context:ctx,items:((state.result&&state.result.results)||[]).map(function(r){return {check_id:r.cpId,coverage:r.coverage};})};
  }
  function confirmInputs() {
    if(document.getElementById("contract-text").value!==state.text || !state.result ||
      JSON.stringify(segmentContract(state.text))!==JSON.stringify(state.clauses))throw Error("현재 본문을 먼저 재분석하세요");
    attestation=inputKey();return attestation;
  }
  function save(next) {
    // 저장 실패 시 현재 메모리 승인도 변경하지 않는다.
    var sealed=SafetyWorkbench.seal(next);localStorage.setItem(KEY,JSON.stringify(sealed));store=sealed;
    if(state.result){applyAutoVerdicts();renderClauses();renderReport();}
  }
  function revisionOf(value){return value?.revision||value?.meta?.updated_at||value?.meta?.updated||value?.meta?.version||'';}
  function sourceIndex(knowledge,packets){
    if(typeof AnalysisRuntime!=='undefined'){
      // Never rebuild the imported expression corpus on the UI thread, including
      // source-refresh, archive and inspection paths outside runAnalysis.
      var value=workerReferences&&workerReferences.current()?workerReferences.value:null;
      if(sourceIndexCache&&sourceIndexCache.workerValue===value)return sourceIndexCache;
      sourceIndexCache={workerValue:value,generation:++sourceGeneration,hints:null,rows:value?.rows||{},tagRows:value?.tag_rows||{},compiled:{packets:[],stats:value?.stats||{raw_packets:0,linked_tag_documents:0,hydrated_judgments:0,unbound_judgments:0,reference_only_documents:0,preparing:true}}};return sourceIndexCache;
    }
    // 데이터셋의 출처 연결만 한 번 색인한다. 본문·범위가 바뀔 때마다 과거 패킷의
    // 모든 체크를 비교하는 HumanPrecedent.prepare/collect는 현재 판정에 필요 없다.
    var corpus=loopCorpus,refs=[knowledge,knowledge?.documents,knowledge?.latest,corpus,corpus?.judgment_ledger,
      corpus?.judgment_ledger?.records,corpus?.byCheck,packets],revision=JSON.stringify([revisionOf(knowledge),revisionOf(corpus),revisionOf(packets),packets?.length||0]);
    var hintInput={knowledge:knowledge,corpus:corpus,packets:packets};
    if(sourceIndexCache&&sourceIndexCache.revision===revision&&refs.every(function(value,i){return sourceIndexCache.refs[i]===value;})&&
      (typeof JudgmentHints==='undefined'||!JudgmentHints.isCurrent||JudgmentHints.isCurrent(sourceIndexCache.hints,hintInput)))return sourceIndexCache;
    var hints=typeof JudgmentHints!=='undefined'?JudgmentHints.index(hintInput):null;
    var compiled=JudgmentSources.compile(packets||[],corpus,knowledge),generation=++sourceGeneration;
    sourceIndexCache={refs:refs,revision:revision,generation:generation,compiled:compiled,hints:hints};return sourceIndexCache;
  }
  function judgmentHints(){
    return sourceIndex(currentHistoryKnowledge(),typeof TemplateLibraryRuntime!=='undefined'?TemplateLibraryRuntime.packets():null).hints;
  }
  function displayResult(value){return JSON.parse(JSON.stringify(value));}
  function standardInput(){
    var ds=documents(),knowledge=typeof AnalysisRuntime!=='undefined'?(legalOpinionKnowledge||{tags:{}}):currentHistoryKnowledge(),packets=typeof TemplateLibraryRuntime!=='undefined'?TemplateLibraryRuntime.packets():null;
    var sources=sourceIndex(knowledge,packets);
    var tagRevision=typeof DocumentStructure!=='undefined'&&DocumentStructure.revisionToken?DocumentStructure.revisionToken(knowledge?.tags):knowledge?.tags;
    var scope=context(),confirmed=!!state.result&&!!state.text.trim()&&document.getElementById('contract-text').value===state.text&&
      (state.analyzedText===undefined||state.analyzedText===state.text);
    var key=SafetyDigest.of({scope:scope,confirmed:confirmed,date:today(),hash:verdictHash,checks:(state.result?.checkpoints||[]).map(ReviewCore.meaning)});
    if(preparedCache&&preparedCache.documents===ds&&preparedCache.sources===sources&&preparedCache.tagRevision===tagRevision&&preparedCache.key===key)return preparedCache.value;
    var value=Object.freeze({documents:ds,confirmed:confirmed,corpus:loopCorpus,knowledge:knowledge,review_packets:packets||[],
      judgment_sources:sources.compiled,hints:sources.hints,hint_rows:sources.rows,tag_rows:sources.tagRows,comparison_context:comparisonContext(),scope:scope,date:today(),contract_hash:verdictHash});
    preparedCache={documents:ds,sources:sources,tagRevision:tagRevision,key:key,value:value};decisionCache.clear();return value;
  }
  function evaluateStandard(cp,r,input){
    var key=SafetyDigest.of({cp:cp,item:{cpId:r.cpId,coverage:r.coverage,reassigned:r.reassigned,opinionScope:r.opinionScope,roleGated:r.roleGated,relationshipGated:r.relationshipGated,serviceGated:r.serviceGated,annexEvidence:r.annexEvidence}});
    var old=decisionCache.get(key);if(old&&old.input===input)return old.value;
    var value=StandardAuto.evaluate(cp,r,input);decisionCache.set(key,{input:input,value:value});return value;
  }
  function standardItems(){return ((state.result&&state.result.results)||[]).map(function(r){return Object.assign({},r,{annexEvidence:!!(state.subDocCov||{})[r.cpId]});});}
  function standardPatterns(){return StandardAuto.observe(state.result&&state.result.checkpoints||[],standardItems(),{documents:safetyDocuments(),confirmed:!!state.result&&document.getElementById('contract-text').value===state.text,scope:context()},verdictStore);}
  function standardReport(){var checks=state.result&&state.result.checkpoints||[],items=standardItems();
    var input=standardInput(),report={rows:checks.filter(ReviewCore.activeCheck).map(function(cp){return displayResult(evaluateStandard(cp,items.find(function(i){return i.cpId===cp.id;})||{},input));})};report.enabled=standardEnabled;report.source_connections=Object.assign({},input.judgment_sources.stats);
    report.rows=report.rows.map(function(r){if(r.check_id==='CMN-05'&&vatFactEnabled){var cp=checks.find(function(c){return c.id===r.check_id;});
      r=displayResult(evaluateStandard(cp,items.find(function(i){return i.cpId===r.check_id;})||{},input));}
      if(standardStopped[r.check_id]||(r.check_id==='CMN-05'?!vatFactEnabled:!standardEnabled)){r.eligible=false;r.status='stopped';r.message='사용자가 중지한 항목';}return r;});
    report.counts={};var knowledge=input.tag_rows?null:currentHistoryKnowledge(),refs=referenceState();
    report.tag_search={status:refs.status,error:refs.error};
    report.rows.forEach(function(r){report.counts[r.status]=(report.counts[r.status]||0)+1;r.tag_sources=typeof AnalysisRuntime!=='undefined'?displayResult(refs.rows[r.check_id]||[]):input.tag_rows?input.tag_rows[r.check_id]||[]:DecisionReferences.retrieve(_cpById(r.check_id),input.documents,knowledge);
      if(input.hint_rows)r.hint_sources=input.hint_rows[r.check_id]||[];
      else if(input.hints)r.hint_sources=JudgmentHints.retrieve(_cpById(r.check_id),input.documents,input.hints);});
    report.candidates=report.rows.filter(function(r){return r.eligible;}).length;return report;}
  function standardPacket(){if(!state.result||document.getElementById('contract-text').value!==state.text)return null;
    var p=standardInput(),checks=state.result.checkpoints;
    if(!p.confirmed)return null;
    var gold={},observations=currentMatchingObservations().items;
    Object.keys(observations).forEach(function(id){var o=observations[id],cl=state.clauses[o.human_clause_index];
      if(cl&&['confirmed_match','reassigned'].includes(o.human_evidence_source))gold[id]=SafetyDigest.of([cl.heading,cl.body]);});
    return {id:SafetyDigest.of([p.documents,context()]),version:1,contract_hash:verdictHash,review_id:state.historyRef?.review_id||'',documents:p.documents,context:context(),checks:checks,
      mapping_gold:gold,
      items:state.result.results.map(function(r){return {cpId:r.cpId,coverage:r.coverage,reassigned:r.reassigned,opinionScope:r.opinionScope,roleGated:r.roleGated,relationshipGated:r.relationshipGated};}),
      verdicts:JSON.parse(JSON.stringify(verdictStore)),group_reviews:currentGroupExport(),confirmed:p.confirmed,date:today(),
      before_auto:Object.keys(verdictStore).filter(function(id){return verdictStore[id].origin==='auto'&&verdictStore[id].verdict==='이상없음';})};}
  function setStandard(on){
    if(on&&(!state.result||document.getElementById('contract-text').value!==state.text))throw Error('현재 계약을 먼저 분석하세요.');
    localStorage.setItem('cr-standard-auto-v1',JSON.stringify({enabled:!!on,vat_fact:!!on,stopped:standardStopped}));standardEnabled=!!on;vatFactEnabled=!!on;
    if(state.result){applyAutoVerdicts();renderClauses();renderReport();}
  }
  function standardAllowed(id){return !standardStopped[id]&&(id==='CMN-05'?vatFactEnabled:standardEnabled);}
  function stopStandard(id){var next=Object.assign({},standardStopped);next[id]=true;
    localStorage.setItem('cr-standard-auto-v1',JSON.stringify({enabled:standardEnabled,vat_fact:vatFactEnabled,stopped:next}));standardStopped=next;
    applyAutoVerdicts();renderClauses();renderReport();}
  function* applySteps(verdicts,onlyIds) {
    if(typeof liveInputTimer!=='undefined'&&liveInputTimer!==null){clearTimeout(liveInputTimer);liveInputTimer=null;}
    var result=Verdict.migrateStore(verdicts);
    Object.keys(result).forEach(function(id){var v=result[id];
      if(!ReviewCore.activeCheck(_cpById(id)))return; // retired-question records are historical data, not current tasks
      if(v.origin==="auto"||!v.verdict)return;
      if(v.manual_context_v3){
        if(v.manual_context_v3!==manualInputKeyV3(id))v.needs_reconfirmation=true;
      }else if(v.manual_context_v2) {
        if(v.manual_context_v2!==manualInputKey(id))v.needs_reconfirmation=true;
        else v.manual_context_v3=manualInputKeyV3(id);
      } else if(v.manual_context) {
        if(v.manual_context!==inputKey())v.needs_reconfirmation=true;
        else v.manual_context_v2=manualInputKey(id);
      }
    });
    // 과거 승인 원장은 이력으로 보존한다. 현재 공통 근거 검사를 우회한 통과는 허용하지 않는다.
    if(typeof StandardAuto!=='undefined'){
      var input=standardInput();
      for(var cp of ((state.result&&state.result.checkpoints)||[])){
        if(onlyIds&&!onlyIds.has(cp.id))continue;
        if(!ReviewCore.activeCheck(cp))continue;
        var original=resultFor(cp);if(!original)continue;
        if((cp.id==='CMN-05'?!vatFactEnabled:!standardEnabled)||standardStopped[cp.id]){original.standardEvidence={eligible:false,status:'stopped',message:'사용자 설정으로 자동판정 중지'};continue;}
        var r=Object.assign({},original,{annexEvidence:!!(state.subDocCov||{})[cp.id]});
        var evaluated=evaluateStandard(cp,r,input);
        // 화면/수기 편집이 캐시된 검사 결과와 엔진의 일회성 티켓 근거를 바꾸지 못하게 한다.
        original.standardEvidence=displayResult(evaluated);
        if(input.hint_rows)original.judgmentHints=input.hint_rows[cp.id]||[];
        else if(input.hints)original.judgmentHints=JudgmentHints.retrieve(cp,input.documents,input.hints);
        var t=evaluated.eligible&&(StandardAuto.ticketFromEvaluation?StandardAuto.ticketFromEvaluation(cp,r,input,evaluated):StandardAuto.ticket(cp,r,input));if(t){
          result=Verdict.applyStandard(result,cp.id,today(),t);
          // 소비된 티켓의 proof도 저장 객체와 캐시의 같은 근거 배열을 공유하지 않는다.
          if(result[cp.id]?.origin==='auto'&&result[cp.id].auto_proof)result[cp.id].auto_proof=displayResult(result[cp.id].auto_proof);
        }
        yield cp.id;
      }
    }
    if(typeof TemplateLibraryRuntime!=='undefined')result=TemplateLibraryRuntime.apply(result,onlyIds);
    return result;
  }
  function apply(verdicts){var it=applySteps(verdicts),step;do{step=it.next();}while(!step.done);return step.value;}
  function applyChecks(verdicts,ids){var selected=new Set(ids),slice={};selected.forEach(function(id){if(verdicts[id])slice[id]=verdicts[id];});
    var it=applySteps(slice,selected),step;do{step=it.next();}while(!step.done);
    var result=Object.assign({},verdicts);selected.forEach(function(id){delete result[id];if(step.value[id])result[id]=step.value[id];});return result;}
  async function applyAsync(verdicts,pause){var it=applySteps(verdicts),step;try{while(!(step=it.next()).done)await pause(step.value);return step.value;}finally{it.return();}}
  function describe(cp,r) {
    if(!document.body?.classList.contains('admin-mode'))return [];
    if(!cp)return [];
    var ids=Object.keys(store.rules).filter(function(id){return store.rules[id].check_id===cp.id;});
    if(!ids.length)return [];
    var p=bundle();return ids.map(function(id){
      var rule=store.rules[id],d=SafetyWorkbench.ruleResult(rule,p);
      return {rule_id:id,revision:rule.revision,result:d.result,eligible:d.eligible,
        approval:store.approvals[id]||null,source_confirmed:p.context.source_quality_confirmed};
    });
  }
  function historyOptions(family,asOf,excludeFamilies) {
    return {strictIsolation:true,asOf:asOf,excludeFamilyIds:[family].concat(excludeFamilies||[]),
      excludeSourceIds:state.historyRef&&state.historyRef.review_id?[state.historyRef.review_id]:[],familyMap:store.historyFamilies||{}};
  }
  function sourceTrace(related) {return related.map(function(x){return {source_id:x.doc.source_id,family_id:x.doc.family_id||"",date:String(x.doc.date||"").slice(0,10)};});}
  function replay(p,excludedFamilies) {
    if(p.checks_fingerprint!==checksFingerprint())throw Error("체크 질문·기준이 변경되어 원본 재검수가 필요합니다");
    var ctx=p.context,docs=[CR.common].concat((ctx.analysis_type_ids||[ctx.type]).map(typeDoc).filter(Boolean))
      .map(function(d){return {checkpoints:d.checks};});
    var main=p.documents[0].text,clauses=segmentContract(main);
    var related=ctx.history_evaluation ? [] : HistoryAssist.retrieve(currentHistoryKnowledge(),(ctx.title||"")+" "+main,ctx.department||"",
      historyOptions(p.family_id,p.case_date,excludedFamilies));
    var analyzed=analyze(clauses,docs,{modules:ctx.modules,stance:ctx.stance,baseClauses:segmentContract(ctx.baseText||""),
      docTitle:ctx.title,partyRoles:ctx.roles,partyContext:ctx.party,historyRelated:related});
    var input={runId:p.run_id,contractHash:p.contract_hash,familyId:p.family_id,appVersion:p.app_version,
      documents:p.documents,clauses:clauses,checkpoints:allChecks(),results:analyzed.results,context:JSON.parse(JSON.stringify(ctx))};
    input.context.retrieval={strict:true,sources:sourceTrace(related),excluded_families:[p.family_id].concat(excludedFamilies||[])};
    var out=SafetyEval.build(input);out.engine_fingerprint=engineFingerprint();out.case_date=p.case_date;
    out.checks_fingerprint=checksFingerprint();out.replayed_with=CR.app_version;out.replayed_on=today();
    out.auto_detected=pickType(detectType(main,CR.types,ctx.title||"",""));
    return SafetyWorkbench.seal(out);
  }
  function allChecks(){return [CR.common].concat(CR.types).reduce(function(a,d){return a.concat(d.checks||[]);},[]);}
  function checksFingerprint(){return SafetyDigest.of(allChecks());}
  function invalidate() {
    attestation="";
    if(typeof analysisIsRunning==='function'&&analysisIsRunning()){cancelAnalysis('입력·판정 설정 변경으로 이전 분석을 취소했습니다.');if(analysisIsRunning())return;}
    if(!state.result)return;
    verdictStore=apply(verdictStore);saveVerdicts();renderClauses();renderReport();
  }
  var liveInputTimer=null;
  function inputChanged(){
    if(typeof cancelAnalysis==='function')cancelAnalysis('입력이 변경되어 이전 분석을 취소했습니다.');
    attestation='';if(!state.result)return;
    // 근거가 바뀐 자동 완료는 즉시 회수한다. 입력 중 전체 판정·DOM 작업은 한 번으로 합친다.
    verdictStore=Verdict.migrateStore(verdictStore);
    clearTimeout(liveInputTimer);
    liveInputTimer=setTimeout(function(){liveInputTimer=null;invalidate();},300);
    if(typeof scheduleVerdictNotes==='function')scheduleVerdictNotes();else saveVerdicts();
  }
  document.getElementById("contract-text").addEventListener("input",inputChanged);
  // 만료·자정 변경 및 다른 탭의 전역 중지는 유휴 상태에서도 완료 표시를 회수한다.
  window.addEventListener("storage",function(e){if(e.key===KEY){
    try{var n=JSON.parse(e.newValue);if(!SafetyWorkbench.sealed(n))throw Error("원장 오류");store=n;}
    catch(err){store=SafetyWorkbench.empty();loadError=err.message;}invalidate();
  }});
  var lastDay=today();
  setInterval(function(){var day=today();if(day===lastDay)return;lastDay=day;if(state.result&&Object.keys(verdictStore).some(function(id){return verdictStore[id].origin==="auto"&&verdictStore[id].verdict;})){
    applyAutoVerdicts();renderClauses();renderReport();
  }},30000);
  window.addEventListener('storage',function(e){if(e.key==='cr-standard-auto-v1'){
    try{var s=JSON.parse(e.newValue||'{}');standardEnabled=s.enabled!==false;vatFactEnabled=s.vat_fact!==false;standardStopped=s.stopped||{};}catch(err){standardEnabled=false;vatFactEnabled=false;}
    invalidate();
  }});
  return {get:function(){return JSON.parse(JSON.stringify(store));},save:save,apply:apply,applyChecks:applyChecks,applyAsync:applyAsync,installReferences:installReferences,requestReferences:requestReferences,cancelReferences:cancelReferences,describe:describe,
    standardReport:standardReport,judgmentHints:judgmentHints,standardEnabled:function(){return standardEnabled;},configurationKey:function(){return JSON.stringify([standardEnabled,vatFactEnabled,standardStopped]);},standardAllowed:standardAllowed,setStandard:setStandard,stopStandard:stopStandard,standardPacket:standardPacket,standardPatterns:standardPatterns,templateScope:context,
    bundle:bundle,confirmInputs:confirmInputs,inputKey:inputKey,manualInputKey:manualInputKey,manualInputKeyV3:manualInputKeyV3,engineFingerprint:engineFingerprint,historyOptions:historyOptions,sourceTrace:sourceTrace,comparisonContext:comparisonContext,
    replay:replay,allChecks:allChecks,checksFingerprint:checksFingerprint,loadError:function(){return loadError;}};
})();
