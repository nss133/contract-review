"use strict";
/* 등록 표준과 현재 약정에 동일한 질문 인식기를 사용한다. */
var RegisteredPresence=(function(){
  var J=typeof AgreementJudgment!=='undefined'?AgreementJudgment:require('./agreement_judgment');
  var P=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy');
  function link(cp,text){var p=P.get(cp);if(!p.compatible||!p.active||p.level!=='presence')return null;
    var r=J.evaluate(cp,[{name:'등록 표준',text:text}],{source_standard:true});
    return r.eligible?{quotes:r.evidence.map(function(e){return e.text;}),terms:J.profiles[cp.id].terms,element:r.elements.join(' · ')}:null;
  }
  function compare(cp,t,documents){var source=link(cp,t.text);if(!source)return {eligible:false,evidence:[],reason:'표준에 해당 질문의 유효한 약정 근거 없음'};
    var r=J.evaluate(cp,documents);return Object.assign({},r,{kind:'registered_clauses',reason:r.eligible?'본건에서 표준과 같은 질문의 약정 확인':r.blockers.map(function(b){return b.reason;}).concat(r.missing).join(' · ')});
  }
  return {VERSION:'registered-presence-v3',profiles:J.profiles,link:link,compare:compare};
})();
if(typeof module!=='undefined')module.exports=RegisteredPresence;
