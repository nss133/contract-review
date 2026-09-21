"use strict";
var JudgmentPolicy=(function(){
  var labels={presence:'약정 존재·반영',clarity:'내용·범위의 명확성',appropriateness:'적정성·유불리',execution_excluded:'실제 이행 — 검토 제외',unclassified:'질문 변경 — 기준 재정리 필요'},map=null;
  function all(){if(!map){
    // 단일 HTML은 앱의 CR 변수 초기화보다 엔진 선언이 먼저 실행된다.
    var data=typeof CR!=='undefined'&&CR?CR.judgment_policies:
      typeof document!=='undefined'&&document.getElementById('cr-data')?JSON.parse(document.getElementById('cr-data').textContent).judgment_policies:
      typeof require==='function'?require('../knowledge/judgment_policies.json'):null;
    map={};(data&&data.checks||[]).forEach(function(c){map[c.id]=c;});}return map;}
  function get(cp){cp=cp||{};var row=all()[cp.id];
    // 표시 문구가 아닌 의미 버전으로 연결. 버전 없는 구 자료는 현행 질문과 일치해야 한다.
    var compatible=row&&(cp.meaning_revision?cp.meaning_revision===row.meaning_revision:row.question===cp.check);
    var level=compatible?row.level:'unclassified';
    return Object.assign({},row||{},{level:level,label:labels[level],active:row?row.active!==false:true,compatible:!!compatible});}
  return {get:get,all:all,labels:labels};
})();
if(typeof module!=='undefined')module.exports=JudgmentPolicy;
