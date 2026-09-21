"use strict";
/* 자동 계열 추정은 평가 편의 기능이며 독립 표본 인증이 아니다. 원자료는 외부 전송하지 않는다. */
var DecisionEvaluation=(function(){
  var D=typeof DecisionEvidence!=='undefined'?DecisionEvidence:require('./decision_evidence');
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  var S=typeof Sim!=='undefined'?Sim:require('./sim');
  function families(packets){
    if(packets.length>400)throw Error('자동 계열 비교는 400건까지 지원합니다. 일반 검토·판정에는 영향이 없습니다.');
    var parent=packets.map(function(_,i){return i;}),text=packets.map(function(p){return (p.documents||[]).map(function(d){return D.key(d.text).replace(/\d+/g,'#');}).join('\n');}),words=packets.map(function(p){return new Set(Object.keys(S.keywords((p.documents||[]).map(function(d){return d.text;}).join(' '))));});
    function similarWords(i,j){var a=words[i],b=words[j],intersection=0;a.forEach(function(w){if(b.has(w))intersection++;});return a.size+b.size?intersection/(a.size+b.size-intersection):0;}
    function root(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    // 동일 출처·명시 계열·근접 복사본을 전이적으로 묶어 자기 정답 유입을 막는다.
    for(var i=0;i<packets.length;i++)for(var j=0;j<i;j++){
      var a=packets[i],b=packets[j],linked=(a.family_id&&a.family_id===b.family_id)||(a.review_id&&a.review_id===b.review_id)||(a.contract_hash&&a.contract_hash===b.contract_hash);
      var similar=text[i]===text[j]||similarWords(i,j)>=0.85;
      if(linked||similar)parent[root(i)]=root(j);
    }
    return packets.map(function(_,i){return 'auto-family:'+H.of(root(i));});
  }
  function sources(packets,groups,index){var current=packets[index];if(!current)return [];return packets.filter(function(p,j){return groups[j]!==groups[index]&&/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')&&p.date<current.date;});}
  return {families:families,sources:sources};
})();
if(typeof module!=='undefined')module.exports=DecisionEvaluation;
