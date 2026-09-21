"use strict";
var EvalOperationalUI=(function(){
  var busy=false;
  function e(id){return document.getElementById('eo-'+id);}
  function s(){return EvalPreparationUI.getStore();}
  function knowledge(){return HistoryAssist.combined(legalOpinionKnowledge,reviewHistory);}
  function msg(v){e('message').textContent=v;}
  function guard(fn){return async function(){if(busy||EvalPreparationUI.isBusy()||EvalTrialUI.isBusy())return;busy=true;try{await fn();}catch(err){msg('보류: '+err.message);}finally{busy=false;}};}
  function list(){e('batch').innerHTML=Object.keys(s().batches||{}).map(function(id){var b=s().batches[id];return '<option value="'+esc(id)+'">'+esc(b.snapshot.owner+' · '+b.snapshot.cases.length+'건 · '+b.created_at.slice(0,10))+'</option>';}).join('');e('dataset').innerHTML=Object.keys(s().operational_sets||{}).map(function(id){var d=s().operational_sets[id];return '<option value="'+esc(id)+'">'+esc(d.owner+' · '+d.cases.length+'건 · '+d.frozen_on)+'</option>';}).join('');}
  function packet(){return {title:state.docTitle,department:document.getElementById('input-department').value,documents:safetyDocuments(),clauses:JSON.parse(JSON.stringify(state.clauses)),context:SafetyRuntime.bundle().context,verdicts:JSON.parse(JSON.stringify(verdictStore)),captured_at:new Date().toISOString()};}
  e('bind').addEventListener('click',guard(async function(){var t=EvalTrialUI.current(),c=EvalPreparationUI.current(),ctx=SafetyRuntime.bundle().context;
    ctx.source_quality_confirmed=e('confirm').checked;ctx.scope_confirmed=e('confirm').checked;
    var next=EvalOperational.bind(t,c,{analyzed:!!state.result&&document.getElementById('contract-text').value===state.text&&SafetyDigest.of(segmentContract(state.text))===SafetyDigest.of(state.clauses),context:ctx,documents:safetyDocuments(),clauses:state.clauses,subDocs:state.subDocs||[]},SafetyRuntime.allChecks(),e('actor').value,CR.engine_fingerprint),old=t.operational;
    t.operational=next;try{await EvalPreparationUI.save();}catch(err){t.operational=old;throw err;}e('confirm').checked=false;msg('실사용 설정 연결 저장됨. 다른 계약도 연결한 뒤 다계약 평가묶음을 재실행하세요.');
  }));
  e('refresh').addEventListener('click',guard(function(){list();e('incident').innerHTML=SafetyRuntime.get().events.filter(function(x){return x.kind==='incident'&&x.id&&x.source_digest&&!(s().incidents||{})[x.id];}).map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.date+' · '+x.rule_id+' · '+x.reason)+'</option>';}).join('');msg('저장된 평가묶음·시험셋과 미편입 신고 목록입니다.');}));
  e('retry').addEventListener('click',guard(async function(){var event=SafetyRuntime.get().events.find(function(x){return x.id===e('incident').value;}),rules=SafetyRuntime.get().rules;if(!event||!event.source_digest)throw Error('원문 지문이 있는 미편입 신고를 선택하세요.');await EvalPreparationUI.receiveIncident(event,packet(),_cpById(rules[event.rule_id].check_id));msg('신고 당시와 같은 원문으로 재검수 후보 편입을 완료했습니다.');}));
  e('build').addEventListener('click',guard(async function(){var b=(s().batches||{})[e('batch').value],engine=SafetyRuntime.engineFingerprint();EvalBatch.fresh(b,s(),knowledge(),SafetyRuntime.allChecks(),CR.engine_fingerprint);var cases=[];
    for(var entry of b.snapshot.cases){var t=s().trials[entry.trial.id],c=s().cases[t.snapshot.case_key],binding=EvalOperational.binding(t,CR.engine_fingerprint),ctx=JSON.parse(JSON.stringify(binding.context));
      if(ctx.tag_mode!==MatcherConfig.TAG_MATCH_MODE)throw Error('연결 당시 태그 설정과 현재 운영 설정이 다릅니다. 다시 연결하세요.');
      var related=EvalBatch.retrieve(b,entry,'combined');ctx.retrieval={strict:true,sources:SafetyRuntime.sourceTrace(related),excluded_families:b.snapshot.cases.filter(function(x){return x.split!=='development';}).map(function(x){return x.family;})};ctx.department=c.source.department;
      var docs=[CR.common].concat(ctx.analysis_type_ids.map(typeDoc).filter(Boolean)).map(function(d){return {checkpoints:d.checks};});
      var output=ReviewCore.run(binding.main_clauses,docs,{modules:ctx.modules,stance:ctx.stance,baseClauses:segmentContract(ctx.baseText||''),docTitle:ctx.title,partyRoles:ctx.roles,partyContext:ctx.party,historyRelated:related},binding.subDocs);
      var checks=SafetyRuntime.allChecks().filter(function(cp){return t.snapshot.questions.some(function(q){return q.id===cp.id;});});
      cases.push(EvalOperational.caseFrom(t,c,entry,{context:ctx,checks:checks,results:output.result.results,subCoverage:output.subCoverage},engine,CR.app_version));msg('실사용 매칭 재실행 '+cases.length+'/'+b.snapshot.cases.length);await new Promise(function(r){setTimeout(r,0);});
    }
    EvalBatch.fresh(b,s(),knowledge(),SafetyRuntime.allChecks(),CR.engine_fingerprint);if(engine!==SafetyRuntime.engineFingerprint())throw Error('재실행 중 운영 환경이 변경되었습니다. 다시 실행하세요.');
    var d=SafetyWorkbench.freeze({format:'cr-safety-dataset-v1',id:'OPSET-'+SafetyDigest.of([b.seal,cases]).slice(0,24),owner:b.snapshot.owner,frozen_on:verdictToday(),cases:cases});var sets=s().operational_sets||(s().operational_sets={}),old=sets[d.id];sets[d.id]=d;
    try{await EvalPreparationUI.save();}catch(err){if(old)sets[d.id]=old;else delete sets[d.id];throw err;}list();e('dataset').value=d.id;msg('승인용 시험셋 저장됨. 개발·시험·반례, 표본 수와 오류 기준을 승인 작업대에서 검증하세요. 아직 승인되지 않았습니다.');
  }));
  e('transfer').addEventListener('click',guard(function(){var d=(s().operational_sets||{})[e('dataset').value];if(!d)throw Error('저장된 승인용 시험셋을 선택하세요.');d.cases.forEach(function(c){var p=c.observation,t=s().trials[p.trial_id];if(!t||p.truth_digest!==EvalTrial.truthDigest(t)||p.engine_fingerprint!==SafetyRuntime.engineFingerprint())throw Error('원문·정답·엔진이 변경되어 시험셋 재실행이 필요합니다.');EvalTrial.fresh(t,s().cases[t.snapshot.case_key]);});SafetyWorkbenchUI.acceptDataset(d);activatePane('goldset');msg('승인 작업대에 전달했습니다. 규칙 평가·승인·활성화는 별도입니다.');}));
  return {packet:packet};
})();
