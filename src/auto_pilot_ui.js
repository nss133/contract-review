"use strict";
(function(){
  var busy=false,prepared="";
  function e(id){return document.getElementById("ap-"+id);}
  function msg(s){e("message").textContent=s;}
  function guard(fn){return async function(){if(busy||EvalPreparationUI.isBusy()||EvalTrialUI.isBusy())return;busy=true;try{await fn();}catch(err){msg("보류: "+err.message);}finally{busy=false;}};}
  var fields=["check","type","role","actor","action","object","conditions","polarity","basis"];
  function capture(){var d={};fields.forEach(function(k){d[k]=e(k).value.trim();});return d;}
  function current(){var t=EvalTrialUI.current();if(t.id!==prepared)throw Error("현재 평가의 체크·저장 후보를 먼저 불러오세요.");return t;}
  function render(r){
    var labels={failed:"오판 또는 근거 연결 오류 — 확대 불가",unresolved:"독립 정답 미확정 — 검수 필요",candidate_only:"요건 충족 후보 — 운영 승인 아님",held:"자동판정 보류"};
    e("result").innerHTML='<p>'+esc(labels[r.status])+'</p><p>잘못된 이상없음 '+Number(r.false_safe)+'건 · 미확정 정답을 통과시킬 후보 '+Number(r.unresolved_candidate)+'건 · 후보 근거 오연결 '+Number(r.mapping_error)+'건</p>'+
      '<p>시험 시각 '+esc(r.date)+' · 저장 이력이며 현재 유효성은 재시험 시 확인합니다.</p><details><summary>후보가 사용한 본건 문장</summary>'+r.outcome.evidence.map(function(x){return '<p>'+esc(x.document+' / '+x.text)+'</p>';}).join('')+'</details>'+
      '<p>미충족 요건 '+r.outcome.missing.length+'개 · 충돌 문장 '+r.outcome.conflicts.length+'개. 실제 계약 판정과 승인 상태는 변경하지 않았습니다.</p>';
  }
  e("prepare").addEventListener("click",guard(function(){var t=EvalTrialUI.current();EvalTrial.consensus(t);prepared=t.id;
    e("check").innerHTML=t.snapshot.questions.map(function(q){return '<option value="'+esc(q.id)+'">'+esc(q.question)+'</option>';}).join('');
    e("type").innerHTML=CR.types.map(function(d){return '<option value="'+esc(d.meta.type_id)+'">'+esc(d.meta.type_name)+'</option>';}).join('');
    e("role").innerHTML=ROLE_TERMS.map(function(r){return '<option>'+esc(r)+'</option>';}).join('');
    fields.forEach(function(k){if(t.auto_draft&&t.auto_draft[k]!==undefined)e(k).value=t.auto_draft[k];else if(e(k).tagName==='TEXTAREA'||e(k).tagName==='INPUT')e(k).value='';});
    e("confirm").checked=false;e("result").textContent="";if(t.auto_runs&&t.auto_runs.length)render(t.auto_runs[t.auto_runs.length-1]);msg("독립 검수와 연결되었습니다. 후보 입력은 시험용이며 자동 승인되지 않습니다.");
  }));
  e("save").addEventListener("click",guard(async function(){var t=current(),old=t.auto_draft;t.auto_draft=capture();try{await EvalPreparationUI.save();}catch(err){t.auto_draft=old;throw err;}msg("후보 입력 저장됨. 원문 확인은 재시험 때 다시 체크하세요.");}));
  e("run").addEventListener("click",guard(async function(){e("result").textContent="";var t=current(),d=capture();
    var rule={id:"PILOT-"+SafetyDigest.of(d).slice(0,24),revision:"1",check_id:d.check,type_ids:[d.type],party_roles:[d.role],rationale:d.basis,
      obligations:[{id:"requirement1",actors:[d.actor],actions:[d.action],objects:[d.object],conditions:d.conditions.split('\n').map(function(x){return x.trim();}).filter(Boolean),polarity:d.polarity}]};
    var r=AutoPilot.observe(t,EvalPreparationUI.current(),rule,SafetyRuntime.allChecks(),EvalTrialUI.predict("assist"),
      {type:d.type,roles:[d.role],source_quality_confirmed:e("confirm").checked,scope_confirmed:e("confirm").checked},CR.engine_fingerprint);
    var old=t.auto_runs,oldDraft=t.auto_draft;t.auto_runs=(old||[]).concat([r]);t.auto_draft=d;
    try{await EvalPreparationUI.save();}catch(err){t.auto_runs=old;t.auto_draft=oldDraft;throw err;}
    render(r);msg("후보 시험 이력을 내부 저장했습니다. 다계약 독립 시험 전에는 운영 승인을 받을 수 없습니다.");
  }));
  fields.forEach(function(k){e(k).addEventListener("input",function(){e("result").textContent="입력 변경 — 재시험 필요";e("confirm").checked=false;});});
  function policy(){var s=SafetyRuntime.get();e("policy").textContent=(s.enabled?"전역 스위치 켜짐 (규칙별 유효성 추가 확인)":"자동판정 전역 중지 상태")+" · 등록 규칙 "+Object.keys(s.rules).length+"개";
    e("rule").innerHTML=Object.keys(s.rules).map(function(id){var a=s.approvals[id];return '<option value="'+esc(id)+'">'+esc(id+' · '+(a?a.status:'미승인'))+'</option>';}).join('');}
  e("refresh").addEventListener("click",guard(policy));
  e("stop").addEventListener("click",guard(async function(){var id=e("rule").value;if(!id)throw Error("중지할 등록 규칙이 없습니다.");
    var packet=EvalOperationalUI.packet(),next=SafetyWorkbench.incident(SafetyRuntime.get(),id,e("reporter").value,e("incident").value,verdictToday(),SafetyDigest.of(packet.documents)),incident=next.events[next.events.length-1];
    SafetyRuntime.save(next);policy();
    if(!packet.documents[0].text.trim()){msg('규칙 중지·신고 저장 완료. 분석 원문이 없어 재검수 후보는 만들지 않았습니다.');return;}
    try{await EvalPreparationUI.receiveIncident(incident,packet,_cpById(next.rules[id].check_id));msg('규칙 중지 완료. 평가자료 목록에 오판 재검수 후보를 추가했습니다. 정답은 미확정이며 원문·독립 검수가 필요합니다.');}
    catch(err){msg('규칙 중지는 완료되었습니다. 재검수 후보 저장 실패: '+err.message+' 신고 이력은 승인 원장에 남아 있습니다.');}
  }));
  e("stop-all").addEventListener("click",guard(function(){SafetyRuntime.save(SafetyWorkbench.stop(SafetyRuntime.get(),null,e("reporter").value.trim()||"긴급 중지",e("incident").value.trim()||"사용자 긴급 중지",verdictToday()));policy();msg("자동판정 전체를 중지했습니다. 사람 판정은 유지합니다.");}));
  policy();
})();
