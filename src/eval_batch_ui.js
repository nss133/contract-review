"use strict";
(function(){
  var batch=null,busy=false,loadedTrials=[],loadedSources=[],draftTimer=null;
  var names={basic:"기본 (태그 제외)",tags:"태그 보조",contract:"태그 + 계약검토",legal:"태그 + 법률검토",combined:"태그 + 두 자료"};
  function e(id){return document.getElementById("eb-"+id);}
  function store(){return EvalPreparationUI.getStore();}
  function knowledge(){return HistoryAssist.combined(legalOpinionKnowledge,reviewHistory);}
  function msg(s){e("message").textContent=s;}
  function guard(fn){return async function(){if(busy||EvalPreparationUI.isBusy()||EvalTrialUI.isBusy())return;busy=true;e("panel").querySelectorAll('button,input,select').forEach(function(n){n.disabled=true;});try{await fn();}catch(err){msg("보류: "+err.message);}finally{busy=false;e("panel").querySelectorAll('button,input,select').forEach(function(n){n.disabled=false;});}};}
  function option(v,label,selected){return '<option value="'+esc(v)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';}
  function input(cls,value,type){return '<input class="'+cls+'" type="'+(type||'text')+'" value="'+esc(value||'')+'">';}
  function capture(){var settings={owner:e("owner").value,entries:[],metadata:{}};
    e("cases").querySelectorAll('tr[data-trial]').forEach(function(row){settings.entries.push({trial_id:row.dataset.trial,selected:row.querySelector('.select').checked,family:row.querySelector('.family').value,date:row.querySelector('.date').value,split:row.querySelector('.split').value});});
    e("sources").querySelectorAll('tr[data-source]').forEach(function(row){settings.metadata[row.dataset.source]={confirmed:row.querySelector('.select').checked,family:row.querySelector('.family').value,date:row.querySelector('.date').value,source_digest:row.dataset.digest};});return settings;
  }
  async function saveDraft(){var old=store().batch_settings;store().batch_settings=capture();try{await EvalPreparationUI.save();}catch(err){store().batch_settings=old;throw err;}}
  function saved(){var batches=store().batches||{};e("saved").innerHTML=Object.keys(batches).map(function(id){var b=batches[id];return option(id,b.snapshot.owner+' · '+b.snapshot.cases.length+'건 · '+b.created_at.slice(0,10),batch&&batch.id===id);}).join('');}
  function render(record){
    if(!record){e("result").textContent="비교 이력 없음";return;}
    e("result").innerHTML='<p>저장된 비교 이력 · '+esc(record.date)+' · 원문/DB 변경 여부는 재실행 시 확인합니다.</p>'+(record.comparisons||[]).map(function(d){return '<p>'+names[d.next]+' (비교 기준: '+names[d.base]+') · 최상위 연결 개선 '+d.improved.length+'건 / 악화 '+d.regressed.length+'건 / 새 문제 비노출 '+d.new_misses.length+'건</p>';}).join('')+['development','test','adversarial'].map(function(split){return '<h4>'+({development:'개발 자료',test:'분리 시험 자료',adversarial:'반례 자료'}[split])+'</h4><table><tr><th>조건</th><th>계약/묶음</th><th>직접 근거 최상위</th><th>상위 3개</th><th>문제 비노출</th><th>미확정/이견</th></tr>'+record.results.map(function(r){var m=r.splits[split];return '<tr><td>'+names[r.mode]+'</td><td>'+m.cases+'/'+m.families+'</td><td>'+m.top1+'/'+m.mapping_total+'</td><td>'+m.top3+'/'+m.mapping_total+'</td><td>'+m.missed+'/'+m.issues+'</td><td>'+m.unknown+'/'+m.conflicts+'</td></tr>';}).join('')+'</table>';}).join('')+
      '<p>분모 0은 100%가 아닙니다. 문서 수와 독립 계약 묶음 수를 구분합니다. 표본 대표성·실제 계열 관계는 담당자 확인이 필요합니다.</p>'+record.results.map(function(r){return '<details><summary>'+names[r.mode]+' · 계약별 오류·사용 출처</summary>'+r.rows.map(function(row){return '<h4>'+esc(row.title)+'</h4><p>'+esc(row.metrics.errors.map(function(x){return x.id+': '+x.kind;}).join(' / ')||'선정 항목의 측정 오류 없음')+'</p><p>검색 자료 '+row.sources.length+'건</p><ul>'+row.sources.map(function(s){return '<li>'+esc(s.title+' · '+(s.kind==='contract_review'?'계약검토':'법률검토')+' · '+s.date+' · '+s.family)+'</li>';}).join('')+'</ul>';}).join('')+'</details>';}).join('');
  }
  e("refresh").addEventListener("click",guard(function(){var s=store(),settings=s.batch_settings||{entries:[],metadata:{}};
    loadedTrials=Object.values(s.trials||{}).filter(function(t){return t.reviews.length===2;});loadedSources=EvalBatch.documents(knowledge());
    e("owner").value=settings.owner||"";
    e("cases").innerHTML='<table><tr><th>선택</th><th>계약</th><th>계약 묶음</th><th>계약 기준일</th><th>용도</th></tr>'+loadedTrials.map(function(t){var c=s.cases[t.snapshot.case_key],v=(settings.entries||[]).find(function(x){return x.trial_id===t.id;})||{family:c.source.title,split:'development'};return '<tr data-trial="'+esc(t.id)+'"><td><input class="select" type="checkbox"'+(v.selected?' checked':'')+'></td><td>'+esc(c.source.title)+' · '+esc(c.version==='before'?'수정 전':'수정 후')+'</td><td>'+input('family',v.family)+'</td><td>'+input('date',v.date,'date')+'</td><td><select class="split">'+['development','test','adversarial'].map(function(k){return option(k,{development:'개발',test:'분리 시험',adversarial:'반례'}[k],v.split===k);}).join('')+'</select></td></tr>';}).join('')+'</table>';
    e("sources").innerHTML='<table><tr><th>확인·사용</th><th>과거자료</th><th>계약 묶음</th><th>실제 검토일</th></tr>'+loadedSources.map(function(d){var v=(settings.metadata||{})[d.source_id]||{},digest=SafetyDigest.of(d),own=loadedTrials.map(function(t){return s.cases[t.snapshot.case_key];}).find(function(c){return c.source.review_id&&c.source.review_id===d.review_id;});return '<tr data-source="'+esc(d.source_id)+'" data-digest="'+digest+'"><td><input class="select" type="checkbox"'+(v.confirmed&&v.source_digest===digest?' checked':'')+'></td><td>'+esc((d.source_kind==='contract_review'?'계약검토 · ':'법률검토 · ')+(d.title||d.source_id))+(v.confirmed&&v.source_digest!==digest?' · 원천 변경: 재확인':'')+'</td><td>'+input('family',v.family||(own?own.source.title:d.family_id||d.title||''))+'</td><td>'+input('date',v.date||String(d.date||'').slice(0,10),'date')+'</td></tr>';}).join('')+'</table>';
    saved();msg('독립 검수 완료 '+loadedTrials.length+'건. 같은 계약·파생자료의 묶음과 실제 날짜를 확인하세요. 원문이 바뀐 대상은 고정 시 차단합니다.');
  }));
  e("save").addEventListener("click",guard(async function(){await saveDraft();msg('선택·분할 입력 저장됨');}));
  e("panel").addEventListener("change",function(ev){if(!ev.target.closest('#eb-cases,#eb-sources,#eb-owner'))return;e("result").textContent="입력 변경 — 새 평가묶음으로 고정하세요.";batch=null;clearTimeout(draftTimer);draftTimer=setTimeout(function(){if(!busy)guard(saveDraft)();},250);});
  e("freeze").addEventListener("click",guard(async function(){var d=capture(),next=EvalBatch.freeze(store(),d.entries.filter(function(x){return x.selected;}),d.metadata,knowledge(),SafetyRuntime.allChecks(),CR.engine_fingerprint,d.owner);
    var batches=store().batches||(store().batches={}),prior=batches[next.id];batch=prior||next;batches[next.id]=batch;
    try{await saveDraft();}catch(err){if(!prior)delete batches[next.id];batch=null;throw err;}saved();e("result").textContent="고정 완료. 5개 조건 비교를 실행하세요.";msg('평가묶음 고정됨 · 미확인 참고자료 '+batch.snapshot.excluded_unconfirmed+'건 제외.');
  }));
  e("load").addEventListener("click",guard(function(){var id=e("saved").value;batch=(store().batches||{})[id];EvalBatch.valid(batch);render(batch.runs[batch.runs.length-1]);msg('저장된 평가묶음을 열었습니다. 현재 원문·DB 검증은 실행 시 수행합니다.');}));
  function predict(c,mode,related){var docs=[CR.common].concat(CR.types),modules=Array.from(new Set(docs.flatMap(function(d){return (d.meta.modules||[]).map(function(m){return m.id;});}))),old=MatcherConfig.TAG_MATCH_MODE;
    try{MatcherConfig.TAG_MATCH_MODE=mode==='basic'?'off':'assist';var out=analyze(c.trial.snapshot.clauses,docs.map(function(d){return {checkpoints:d.checks};}),{modules:modules,stance:'party',docTitle:c.source.title,partyRoles:[],historyRelated:related});
      return c.trial.snapshot.questions.map(function(q){var r=out.results.find(function(x){return x.cpId===q.id;});return {id:q.id,top1:r&&r.best?r.best.clauseIndex:null,top3:r?(r.ranked||[]).slice(0,3).map(function(x){return x.clauseIndex;}):[],surfaced:!!r&&['addressed','verify','consider','base_covered'].includes(r.coverage),auto_safe:false,history_support:r&&r.best?r.best.historySupport||null:null};});
    }finally{MatcherConfig.TAG_MATCH_MODE=old;}
  }
  e("run").addEventListener("click",guard(async function(){if(!batch)throw Error('평가묶음을 먼저 고정하거나 저장된 평가를 여세요.');
    EvalBatch.fresh(batch,store(),knowledge(),SafetyRuntime.allChecks(),CR.engine_fingerprint);var results=[],done=0,total=batch.snapshot.cases.length*5;e("result").textContent="";
    for(var mode of EvalBatch.MODES){var predictions=[];for(var c of batch.snapshot.cases){var related=EvalBatch.retrieve(batch,c,mode);predictions.push({trial_id:c.trial.id,items:predict(c,mode,related),sources:related.map(function(x){return {id:x.doc.source_id,title:x.doc.title||x.doc.source_id,kind:x.doc.source_kind,family:x.doc.family_id,date:x.doc.date,score:x.score};})});msg('폐쇄망 내부 비교 '+(++done)+'/'+total);await new Promise(function(resolve){setTimeout(resolve,0);});}results.push(EvalBatch.score(batch,mode,predictions));}
    EvalBatch.fresh(batch,store(),knowledge(),SafetyRuntime.allChecks(),CR.engine_fingerprint);var record={date:new Date().toISOString(),seal:batch.seal,engine:CR.engine_fingerprint,results:results,comparisons:results.slice(1).map(function(r,i){return EvalBatch.compare(batch,results[i===0?0:1],r);})};batch.runs.push(record);
    try{await EvalPreparationUI.save();}catch(err){batch.runs.pop();throw err;}render(record);msg('5개 조건 비교 저장됨. 현재 계약 판정·태그 설정·운영 승인은 변경하지 않았습니다.');
  }));
})();
