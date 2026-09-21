"use strict";
var EvalTrialUI=(function(){
  var trial=null,review=null,active="",locked=false;
  function e(id){return document.getElementById("et-"+id);}
  function msg(s){e("message").textContent=s;}
  function c(){return EvalPreparationUI.current();}
  function all(){var s=EvalPreparationUI.getStore();return s.trials||(s.trials={});}
  function guard(fn){return async function(){if(locked||EvalPreparationUI.isBusy())return;locked=true;try{await fn();}catch(err){msg("보류: "+err.message);}finally{locked=false;}};}
  function current(){if(!trial)throw Error("현재 자료를 평가 대상으로 고정하거나 저장된 대상을 선택하세요.");EvalTrial.fresh(trial,c());return trial;}
  function list(){var s=EvalPreparationUI.getStore();e("saved").innerHTML=Object.keys(s.trials||{}).map(function(id){return '<option value="'+esc(id)+'">'+esc(id+' · 검수 '+s.trials[id].reviews.length+'/2')+'</option>';}).join('');if(trial)e("saved").value=trial.id;}
  function status(){e("status").textContent=trial?trial.id+" · 선정 체크 "+trial.snapshot.questions.length+"개 · 검수 "+trial.reviews.length+"/2 · 체크 미대응 쟁점 "+trial.snapshot.unmapped.length+"개 별도 보존":"평가 대상을 먼저 고정하세요.";}
  function stored(){var last=trial&&trial.runs[trial.runs.length-1];e("result").textContent=last?"저장된 부분평가 이력 (현재 원문·규칙의 유효성은 재채점 시 확인)\n"+JSON.stringify(last,null,2):"";}
  function clauses(documents){var out=[];documents.filter(function(d){return d.role==="main";}).concat(documents.filter(function(d){return d.role!=="main";})).forEach(function(d){segmentContract(d.text).forEach(function(cl){out.push(Object.assign({},cl,{index:out.length,document:d.name}));});});return out;}
  function end(){review=null;active="";e("blind").hidden=true;document.getElementById("ep-root").hidden=false;e("management").hidden=false;}
  function show(){var q=trial.snapshot.questions.find(function(x){return x.id===e("question").value;});active=q.id;
    var l=review.labels.find(function(x){return x.id===active;});e("prompt").textContent=q.question+(q.guidance?'\n충족 기준: '+q.guidance.pass+'\n검토 기준: '+q.guidance.opinion+'\n참고 근거: '+JSON.stringify(q.guidance.sources):'');e("truth").value=l.truth;e("reason").value=l.reason;e("evidence").value=l.evidence;
    e("direct").innerHTML=trial.snapshot.clauses.map(function(cl){return '<option value="'+cl.index+'">'+esc(cl.document+' · '+cl.heading+' — '+String(cl.body||'').slice(0,90))+'</option>';}).join('');Array.from(e("direct").options).forEach(function(o){o.selected=l.direct.includes(Number(o.value));});}
  function capture(){if(!review||!active)return;var l=review.labels.find(function(x){return x.id===active;});Object.assign(l,{truth:e("truth").value,reason:e("reason").value,evidence:e("evidence").value,direct:Array.from(e("direct").selectedOptions).map(function(o){return Number(o.value);})});}
  e("freeze").addEventListener("click",guard(async function(){
    trial=EvalTrial.freeze(c(),SafetyRuntime.allChecks(),clauses(c().documents));
    if(all()[trial.id])trial=all()[trial.id];else all()[trial.id]=trial;
    await EvalPreparationUI.save();list();status();e("result").textContent="";msg("선정 쟁점의 평가 대상 고정됨. 독립 검수자는 아래 화면에서 원문과 중립 질문만 확인합니다.");
  }));
  e("load").addEventListener("click",guard(async function(){list();if(e("saved").value){trial=all()[e("saved").value];EvalTrial.valid(trial);status();stored();}msg("저장된 대상 목록을 불러왔습니다. 원문 변경 여부는 검수·채점 시 다시 확인합니다.");}));
  e("saved").addEventListener("change",guard(async function(){trial=all()[e("saved").value];status();stored();}));
  e("start").addEventListener("click",guard(async function(){current();if(trial.reviews.length===2)throw Error("두 검수가 저장되어 있습니다. 비교 채점을 실행하세요.");
    review={trial_id:trial.id,seal:trial.seal,reviewer:"",independent:false,source_reviewed:false,labels:trial.snapshot.questions.map(function(q){return {id:q.id,truth:"",direct:[],reason:"",evidence:""};})};
    if(trial.drafts&&trial.drafts[trial.reviews.length])review=JSON.parse(JSON.stringify(trial.drafts[trial.reviews.length]));
    document.getElementById("ep-root").hidden=true;e("management").hidden=true;e("blind").hidden=false;
    e("reviewer").value=review.reviewer||"";e("independent").checked=false;e("sources").checked=false;
    e("documents").innerHTML=trial.snapshot.documents.map(function(d){return '<details><summary>'+esc(d.name)+'</summary><pre>'+esc(d.text)+'</pre></details>';}).join('');
    e("question").innerHTML=trial.snapshot.questions.map(function(q){return '<option value="'+esc(q.id)+'">'+esc(q.id+' '+q.question)+'</option>';}).join('');show();msg("독립 검수 화면: 과거 의견·초안 답·예측·다른 검수 답은 표시하지 않습니다. 이름 확인은 조직 인증을 대체하지 않습니다.");
  }));
  e("question").addEventListener("change",function(){capture();show();});
  e("next").addEventListener("click",function(){capture();var s=e("question");if(s.selectedIndex<s.options.length-1)s.selectedIndex++;show();});
  e("cancel").addEventListener("click",function(){end();msg("검수 입력 종료. 제출하지 않은 입력은 저장되지 않습니다.");});
  e("draft").addEventListener("click",guard(async function(){current();capture();review.reviewer=e("reviewer").value;trial.drafts=trial.drafts||{};trial.drafts[trial.reviews.length]=JSON.parse(JSON.stringify(review));await EvalPreparationUI.save();msg("검수 입력 중간 저장됨. 다시 열어 이어서 작성할 수 있습니다. 독립성·원본 대조는 제출 때 다시 확인합니다.");}));
  e("submit").addEventListener("click",guard(async function(){current();capture();Object.assign(review,{reviewer:e("reviewer").value,independent:e("independent").checked,source_reviewed:e("sources").checked});
    // 저장 오류 시 메모리의 제출도 되돌려 재시도할 수 있도록 한다.
    var before=JSON.parse(JSON.stringify(trial.reviews));try{EvalTrial.saveReview(trial,review);await EvalPreparationUI.save();}catch(err){trial.reviews=before;throw err;}
    end();list();status();msg("독립 검수 저장됨. 원문이 변경되지 않은 상태에서 두 번째 검수 또는 비교 채점을 진행하세요.");
  }));
  function predict(mode){
    var t=current(),checks=SafetyRuntime.allChecks();if(t.snapshot.checks_digest!==SafetyDigest.of(checks))throw Error("체크 기준이 변경되었습니다. 새 평가 대상과 검수가 필요합니다.");
    var docs=[CR.common].concat(CR.types),modules=Array.from(new Set(docs.flatMap(function(d){return (d.meta.modules||[]).map(function(m){return m.id;});}))),old=MatcherConfig.TAG_MATCH_MODE;
    try{MatcherConfig.TAG_MATCH_MODE=mode;var r=analyze(t.snapshot.clauses,docs.map(function(d){return {checkpoints:d.checks};}),{modules:modules,stance:"party",docTitle:"",historyRelated:[],partyRoles:[]});
      return t.snapshot.questions.map(function(q){var result=r.results.find(function(x){return x.cpId===q.id;});return {id:q.id,coverage:result?result.coverage:"none",top1:result&&result.best?result.best.clauseIndex:null,top3:result?(result.ranked||[]).slice(0,3).map(function(x){return x.clauseIndex;}):[],surfaced:!!result&&["addressed","verify","consider","base_covered"].includes(result.coverage),auto_safe:false};});
    }finally{MatcherConfig.TAG_MATCH_MODE=old;}
  }
  e("score").addEventListener("click",guard(async function(){e("result").textContent="";var t=current();EvalTrial.consensus(t);
    var runs=["off","assist"].map(function(mode){var predictions=predict(mode);return {mode:mode,predictions:predictions,metrics:EvalTrial.score(t,predictions)};});
    var record={date:new Date().toISOString(),engine:CR.engine_fingerprint,trial_seal:t.seal,review_digest:EvalTrial.truthDigest(t),protocol:"all-check-clause-search-v1",runs:runs};t.runs.push(record);await EvalPreparationUI.save();
    e("result").innerHTML='<p>선정 쟁점 부분평가 · 전체 체크 조항검색 시험 (실사용 유형·역할·적용범위 판정은 평가 제외). 과거자료 검색·자동판정은 실행하지 않음.</p><table><thead><tr><th>조건</th><th>정답 합의</th><th>최상위 조항</th><th>상위 3개</th><th>문제 비노출</th></tr></thead><tbody>'+runs.map(function(r){var m=r.metrics;return '<tr><td>'+(r.mode==='off'?'태그 제외':'태그 보조')+'</td><td>'+m.agreed+'/'+m.selected+' (이견 '+m.conflicts+')</td><td>'+m.top1+'/'+m.mapping_total+'</td><td>'+m.top3+'/'+m.mapping_total+'</td><td>'+m.missed+'/'+m.issues+'</td></tr>';}).join('')+'</tbody></table>'+runs.map(function(r){return '<h4>'+(r.mode==='off'?'태그 제외':'태그 보조')+' 오류·확인사항</h4><pre>'+esc(JSON.stringify(r.metrics.errors,null,2))+'</pre>';}).join('')+'<p>분모 0은 정확도 100%가 아닙니다. 미확정·이견을 정답으로 세지 않습니다. 이 결과로 자동판정 승인이 활성화되지 않습니다.</p>';
    msg("비교 결과 저장됨. 기존 계약 판정·태그 모드·자동승인 설정은 변경하지 않았습니다.");
  }));
  return {current:current,predict:predict,isBusy:function(){return locked||!!review;}};
})();
