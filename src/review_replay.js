"use strict";
var _ReplayCore=typeof ReviewCore!=='undefined'?ReviewCore:require('./review_core');
var _ReplayDigest=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
/* 저장된 예전 매핑/coverage를 정답처럼 재사용하지 않는다. 원문에서 조항 분할부터 재실행. */
var ReviewReplay=(function(){
  function run(packet,knowledge,related){
    var segment=typeof segmentContract==='function'?segmentContract:require('./segmenter').segmentContract;
    var ctx=packet.context,documents=packet.documents;
    if(!ctx||!documents||!documents.length||!documents[0].text)throw Error('재실행할 본문·검토 맥락이 없습니다.');
    var ids=ctx.analysis_type_ids||[ctx.type],types=knowledge.types||[];
    if(ids.some(function(id){return !types.some(function(t){return t.meta.type_id===id;});}))throw Error('현재 기준에 없는 계약 유형입니다.');
    var selected=[knowledge.common].concat(ids.map(function(id){return types.find(function(t){return t.meta.type_id===id;});}));
    var docs=selected.map(function(d){return {checkpoints:d.checks};});
    var base=ctx.baseText||'',offset=1;
    if(base){if(!documents[1]||documents[1].text!==base)throw Error('원계약 역할·원문 연결이 일치하지 않습니다.');offset++;}
    var clauses=segment(documents[0].text),sub=documents.slice(offset);
    var options={modules:ctx.modules||[],stance:ctx.stance,baseClauses:segment(base),docTitle:ctx.title||'',
      partyRoles:ctx.roles||[],partyContext:ctx.party||null,historyRelated:related||[]};
    var core=_ReplayCore.run(clauses,docs,options,sub),old={};
    (packet.checks||[]).forEach(function(cp){old[cp.id]=cp;});
    var comparable=core.result.checkpoints.filter(function(cp){return old[cp.id]&&_ReplayDigest.of(old[cp.id])===_ReplayDigest.of(cp);});
    var items=core.result.results.map(function(r){return Object.assign({},r,{annexEvidence:!!core.subCoverage[r.cpId]});});
    var mapping={reviewed:0,correct:0};comparable.forEach(function(cp){var gold=(packet.mapping_gold||{})[cp.id];if(!gold)return;
      var r=items.find(function(i){return i.cpId===cp.id;}),cl=r&&r.best&&clauses.find(function(c){return c.index===r.best.clauseIndex;});
      mapping.reviewed++;if(cl&&_ReplayDigest.of([cl.heading,cl.body])===gold)mapping.correct++;
    });
    return {packet:Object.assign({},packet,{checks:comparable,items:items}),clauses:clauses,subCoverage:core.subCoverage,
      mapping:mapping,
      results:items,excluded_checks:(packet.checks||[]).length-comparable.length,extraction_replayed:false,
      segmentation_replayed:true,mapping_replayed:true,annex_search_replayed:true};
  }
  return {run:run};
})();
if(typeof module!=='undefined')module.exports=ReviewReplay;
