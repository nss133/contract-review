"use strict";
/* 파일 등록은 승인 절차가 아니다. 자동 연결은 전체 질문을 인식한 규칙에 한정한다. */
var TemplateRegister=(function(){
  var L=typeof TemplateLibrary!=='undefined'?TemplateLibrary:require('./template_library');
  var S=typeof StandardAuto!=='undefined'?StandardAuto:require('./standard_auto');
  var Q=typeof ClauseEquivalence!=='undefined'?ClauseEquivalence:require('./clause_equivalence');
  var F=typeof TemplateFields!=='undefined'?TemplateFields:require('./template_fields');
  var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules');
  var D=typeof DecisionEvidence!=='undefined'?DecisionEvidence:require('./decision_evidence');
  var RP=typeof RegisteredPresence!=='undefined'?RegisteredPresence:require('./registered_presence');
  var rules={
    'PRIV-06':{question:'위탁 문서에 개인정보에 대한 접근 제한 등 안전성 확보 조치에 관한 사항이 포함되어 있는가',topic:'least_access',values:['수탁자','개인정보','업무수행','최소범위'],terms:/개인정보|접근|안전성/,match_terms:['접근','권한','안전성']},
    'PRIV-07':{question:'위탁 문서에 개인정보 관리 현황 점검 등 감독에 관한 사항이 포함되어 있는가',topic:'inspection',values:['수탁자','위탁자','개인정보처리현황점검','협조의무'],terms:/개인정보|점검|감독/,match_terms:['점검','감독','관리 현황','관리현황']}
  };
  function process(name,revision,text,scope,checks,extraction){
    var t=L.draft(name,revision,text,scope,extraction),references=[],documents=[{name:'등록 표준',text:text,extraction:t.extraction}];
    t.fields=F.candidates(text);t.active=true;
    checks.forEach(function(cp){
      if(cp.active===false||cp.review_scope==='execution_only'||cp.text_effect==='required_absent'||['aggregate_only','anomaly_only'].includes(cp.surface_policy))return;
      var r=S.evaluate(cp,{coverage:'addressed'},{confirmed:true,documents:documents,source_standard:true});
      var quotes=Array.from(new Set((r.evidence||[]).map(function(e){
        if(text.includes(e.text))return e.text;
        return Number.isInteger(e.start)&&Number.isInteger(e.end)?text.slice(e.start,e.end):'';
      }).filter(Boolean)));
      if(r.eligible&&quotes.length&&quotes.every(function(q){return text.includes(q);})){
        var b=L.bind(t,cp,quotes);b.shared_judgment=true;b.judgment_version=r.version;
      }else if(((cp.triggers||{}).keywords||[]).some(function(w){return text.includes(w);}))references.push(cp.id);
    });
    t.registration={mode:'automatic',version:17,reference_checks:references};
    return L.validate({format:L.VERSION,templates:[t]}).templates[0];
  }
  function upgrade(t,checks){
    if(!t.active||t.registration?.mode!=='automatic'||t.registration.version>=17)return t;
    var updated=process(t.name,t.revision,t.text,{type_ids:t.type_ids,roles:t.roles,stance:t.stance},checks,t.extraction);
    // 자동 인식의 갱신은 수동 연결·표현변형·입력 필드 선택을 지우는 작업이 아니다.
    (t.bindings||[]).forEach(function(old){var fresh=updated.bindings.find(function(b){return b.check_id===old.check_id;});
      if(!old.shared_judgment){updated.bindings=updated.bindings.filter(function(b){return b.check_id!==old.check_id;}).concat([old]);}
      else if(fresh&&old.variants)fresh.variants=old.variants;
    });
    updated.fields=t.fields||updated.fields;updated.previous_registration=t;
    return L.validate({format:L.VERSION,templates:[updated]}).templates[0];
  }
  return {VERSION:17,process:process,upgrade:upgrade};
})();
if(typeof module!=='undefined')module.exports=TemplateRegister;
