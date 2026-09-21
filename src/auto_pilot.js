"use strict";
var _PilotHash=typeof SafetyDigest!=="undefined"?SafetyDigest:require("./safety_digest");
var _PilotTrial=typeof EvalTrial!=="undefined"?EvalTrial:require("./eval_trial");
var _PilotRules=typeof EvidenceRules!=="undefined"?EvidenceRules:require("./evidence_rules");
var _PilotWB=typeof SafetyWorkbench!=="undefined"?SafetyWorkbench:require("./safety_workbench");
/* 선정 쟁점에서의 개발 관찰. 운영 승인 자료나 독립 시험 성공으로 승격하지 않는다. */
var AutoPilot=(function(){
  function need(ok,s){if(!ok)throw Error(s);}
  function observe(t,c,rule,checks,predictions,ctx,engine){
    _PilotTrial.fresh(t,c);_PilotRules.validate(rule);
    need(t.snapshot.checks_digest===_PilotHash.of(checks),"체크 기준 변경 — 새 검수 필요");
    var cp=checks.find(function(x){return x.id===rule.check_id;});
    need(cp&&cp.auto_verdict!==false,"자동화 금지 체크 또는 알 수 없는 체크입니다.");
    need(ctx&&ctx.source_quality_confirmed===true&&ctx.scope_confirmed===true,"원문 변환·별첨 누락 및 유형·역할을 확인하세요.");
    need(rule.type_ids.includes(ctx.type)&&Array.isArray(ctx.roles)&&ctx.roles.length&&ctx.roles.every(function(r){return rule.party_roles.includes(r);}),"시험 유형·역할이 규칙 범위와 다릅니다.");
    _PilotTrial.score(t,predictions); // 예측 목록과 독립 검수 구조를 먼저 검증
    var gold=_PilotTrial.consensus(t).find(function(g){return g.id===rule.check_id;});
    need(gold,"현재 독립 검수에 없는 체크입니다.");
    var p=predictions.find(function(x){return x.id===rule.check_id;});
    need(["addressed","verify","consider","quiet","missing","base_covered","not_applicable","none"].includes(p.coverage),"현재 엔진의 조항 매핑 결과가 필요합니다.");
    var outcome=_PilotWB.ruleResult(rule,{documents:t.snapshot.documents,context:ctx,items:[{check_id:rule.check_id,coverage:p.coverage}]}),candidate=outcome.eligible;
    var blocked=!gold.agreement||gold.truth==="unknown";
    var wrong=candidate&&gold.agreement&&(gold.truth==="issue"||gold.truth==="not_applicable");
    var mappingWrong=candidate&&gold.agreement&&gold.truth!=="unknown"&&!gold.direct.includes(p.top1);
    return {format:"cr-auto-candidate-observation-v1",date:new Date().toISOString(),trial_id:t.id,trial_seal:t.seal,
      review_digest:_PilotTrial.truthDigest(t),engine:engine,rule:JSON.parse(JSON.stringify(rule)),rule_digest:_PilotHash.of(rule),
      context:JSON.parse(JSON.stringify(ctx)),prediction:JSON.parse(JSON.stringify(p)),truth:gold,
      candidate:candidate,false_safe:!!wrong,unresolved_candidate:!!(candidate&&blocked),mapping_error:!!mappingWrong,
      outcome:outcome.result,approval_eligible:false,scope:"selected_checks_development_only",
      status:wrong||mappingWrong?"failed":blocked?"unresolved":candidate?"candidate_only":"held"};
  }
  return {observe:observe};
})();
if(typeof module!=="undefined")module.exports=AutoPilot;
