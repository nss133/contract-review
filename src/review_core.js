"use strict";
/* 실사용·평가 공통 매칭과 출처 기반 표시 위치. 저장소·원래 매핑을 변경하지 않는다. */
var ReviewCore=(function(){
  function run(clauses,docs,options,subDocs){
    var m=typeof analyze==='function'?{analyze:analyze,buildModel:buildModel,subDocCoverage:subDocCoverage}:require('./matcher');
    var segment=typeof segmentContract==='function'?segmentContract:require('./segmenter').segmentContract;
    var result=m.analyze(clauses,docs,options),byId={};docs.forEach(function(d){(d.checkpoints||[]).forEach(function(cp){byId[cp.id]=cp;});});
    result.results=result.results.filter(function(r){return activeCheck(byId[r.cpId]);});
    if(result.checkpoints)result.checkpoints=result.checkpoints.filter(activeCheck);
    // 의견 속 표현이 현재 조항에 실제 등장할 때 검색 후보만 보강한다. 과거 결과는 복사하지 않는다.
    if(options.judgmentHints){var J=typeof JudgmentHints!=='undefined'?JudgmentHints:require('./judgment_hints');
      var currentDocs=[{name:'본문',text:(clauses||[]).map(function(c){return [c.heading,c.body].join('\n');}).join('\n')}].concat(subDocs||[]);
      result.results.forEach(function(r){if(r.roleGated||r.relationshipGated||r.serviceGated)return;
        r.judgmentHints=J.retrieve(byId[r.cpId],currentDocs,options.judgmentHints,clauses);
        var found=r.judgmentHints.filter(function(h){return h.current_evidence.document_index===0;});
        if(found.length&&['quiet','consider'].includes(r.coverage)&&(!r.best||r.best.score<=0||r.best.clauseIndex===found[0].current_evidence.clause_index)){
          r.best={clauseIndex:found[0].current_evidence.clause_index,score:0,reasons:['과거 검토사유의 표현과 현재 원문 일치 — 검색 후보'],gate:null};
          r.coverage='verify';r.judgment_hint_candidate=true;
        }
      });
    }
    var cps=result.results.filter(function(r){return !r.roleGated&&!r.relationshipGated&&!r.serviceGated;}).map(function(r){return byId[r.cpId];}).filter(Boolean);
    var subCoverage=cps.length&&(subDocs||[]).length?m.subDocCoverage(cps,(subDocs||[]).map(function(d){return {name:d.name,clauses:segment(d.text)};}),m.buildModel(docs,options.modules,options.stance)):{};
    // 정형 근거가 별첨에 있지만 단어 유사도 문턱에 못 미치는 경우 후보만 보강한다.
    // 여기서는 최종판정하지 않으며 전체 요건·단서 검사는 StandardAuto에서 다시 한다.
    var standard=typeof StandardAuto!=='undefined'?StandardAuto:require('./standard_auto');
    var policies=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy');
    cps.forEach(function(cp){var rule=standard.catalog[cp.id],policy=policies.get(cp);if(subCoverage[cp.id]||!rule||policy.active===false||policy.compatible===false)return;
      (subDocs||[]).some(function(d){var text=String(d.text||'').split(/\n|(?<=다\.)\s+/).find(function(s){var hit=standard.recognize(cp.id,s);return hit&&!hit.heading;});
        if(!text)return false;subCoverage[cp.id]={docName:d.name,score:null,heading:'정형 요건 후보',quote:text,source:'standard_pattern_candidate'};return true;});
    });
    return {result:result,subCoverage:subCoverage};
  }
  function activeCheck(cp){
    if(!cp||cp.active===false||cp.review_scope==='execution_only')return false;
    var P=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy');
    return P.get(cp).active!==false;
  }
  function meaning(cp){return {id:cp.id,revision:cp.meaning_revision||cp.checklist_revision||cp.check};}
  // 사람이 확인한 질문과 실제 관련 원문만 추적한다. 표시명·태그 DB·다른 체크 이동은 의존하지 않는다.
  function manualDependency(cp,documents,scope){
    var A=typeof AgreementEvidence!=='undefined'?AgreementEvidence:require('./agreement_evidence');
    var terms=(cp.triggers||{}).keywords||[],rows=terms.length?A.scanUnits(terms,documents):[];
    var sources=rows.map(function(r){return [r.document,String(r.text||'').normalize('NFC').replace(/\s+/g,' ').trim()];});
    // 관련 근거를 못 찾은 사람 판단(부재·포괄 판단)은 전체 원문을 의존한다.
    if(!sources.length)sources=(documents||[]).map(function(d){return [d.name,String(d.text||'').normalize('NFC').replace(/\s+/g,' ').trim()];});
    sources.sort(function(a,b){return JSON.stringify(a).localeCompare(JSON.stringify(b));});scope=scope||{};
    var P=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy'),policy=P.get(cp),depends={stance:scope.stance};
    // 관할·VAT 등 존재 확인에는 다른 업무 모듈·부서·회사 호칭이 영향을 주지 않는다.
    if(policy.level!=='presence'||['CNS-END','CNS-DAMAGE','CNS-IP'].includes(cp.id)){
      depends.type=scope.type;depends.roles=scope.roles;depends.party=scope.party;
    }
    var module=cp.module||policy.applicability?.module;
    if(module&&module!=='M-COMMON')depends.module_active=(scope.modules||[]).includes(module);
    return {version:3,meaning:meaning(cp),sources:sources,scope:depends};
  }
  function completionLocations(verdict,documents,limit){
    if(verdict?.origin!=='auto'||verdict.verdict!=='이상없음'||verdict.needs_reconfirmation||!verdict.auto_proof)return [];
    function norm(s){return String(s||'').normalize('NFC').replace(/\s/g,'');}
    var locations=[];
    for(var e of verdict.auto_proof.evidence||[]){
      if(!e.text)continue;
      var di=Number.isInteger(e.document_index)?e.document_index:(documents||[]).findIndex(function(d){return d.name===e.document;});
      var d=(documents||[])[di];if(!d||d.name!==e.document)continue;
      var start=e.start??e.span?.start,end=e.end??e.span?.end;
      if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||norm(d.text.slice(start,end))!==norm(e.text)){
        start=String(d.text).indexOf(e.text);if(start<0)continue;end=start+e.text.length;
        if(String(d.text).indexOf(e.text,start+1)>=0)continue;
      }
      locations.push({document:di,name:d.name,start:start,end:end,text:e.text,section:e.section||'',source:e.source||null});
      if(limit>0&&locations.length>=limit)break;
    }
    return locations;
  }
  function completionAnchor(result,verdict,clauses,documents,clauseStarts){
    if(!result||result.reassigned||result.opinionScope||result.roleGated||result.relationshipGated||result.serviceGated||
      verdict?.origin!=='auto'||verdict.verdict!=='이상없음'||verdict.safety_hold||verdict.needs_reconfirmation||!verdict.auto_proof)return null;
    var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules'),anchors=[];
    if(documents&&documents[0]){
      var D=typeof DocumentStructure!=='undefined'?DocumentStructure:require('./document_structure');
      var starts=clauseStarts||D.clauseStarts(documents[0].text,clauses);
      completionLocations(verdict,documents).filter(function(e){return e.document===0;}).forEach(function(e){
        var lo=0,hi=starts.length-1,i=-1;
        while(lo<=hi){var mid=(lo+hi)>>1;if(starts[mid].start<=e.start){i=mid;lo=mid+1;}else hi=mid-1;}
        if(i>=0&&e.end>(starts[i+1]?.start??documents[0].text.length))i=-1;
        if(i>=0)anchors.push(starts[i].index);
      });
      if(anchors.length)return Math.min.apply(null,anchors);
    }
    function norm(s){return String(s||'').normalize('NFC').replace(/\s/g,'');}
    (verdict.auto_proof.evidence||[]).filter(function(e){return e.document==='본문'&&e.text;}).forEach(function(e){
      var h=E.heading(e.text),quote=norm(h?e.text.slice(h.prefix.length):e.text);if(!quote)return;
      var matches=(clauses||[]).filter(function(c){return norm(c.body).includes(quote);});
      if(matches.length===1)anchors.push(matches[0].index);
    });
    return anchors.length?Math.min.apply(null,anchors):null;
  }
  return {run:run,activeCheck:activeCheck,meaning:meaning,manualDependency:manualDependency,completionLocations:completionLocations,completionAnchor:completionAnchor};
})();
if(typeof module!=='undefined')module.exports=ReviewCore;
