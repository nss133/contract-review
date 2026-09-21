"use strict";
/* 태깅 DB → 검토 ID → 원문 패킷 → 사용자 판정을 연결한다.
   원문·맥락·질문 지문이 없는 의견/첨부파일명은 정답으로 승격하지 않는다. */
var JudgmentSources=(function(){
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  function contextKey(context){var c=Object.assign({},context);delete c.reassign;delete c.tag_mode;return H.of(c);}
  function human(v){return v&&v.origin==='manual'&&!v.auto_proof&&!v.needs_reconfirmation&&
    (v.verdict==='검토의견'||v.verdict==='이상없음'&&['반영되어 있음','수용 가능한 위험'].includes(v.reason));}
  function compile(packets,corpus,knowledge){
    var records=corpus?.judgment_ledger?.records||{},byReview=Object.create(null),tagsByReview=Object.create(null),tagsByHash=Object.create(null),recordsByCheck=Object.create(null),linkedTags=new Set(),bound=new Set();
    var docs=Object.values(knowledge?.documents||{}),stats={raw_packets:0,linked_tag_documents:0,hydrated_judgments:0,unbound_judgments:0,reference_only_documents:0};
    Object.keys(records).forEach(function(hash){var r=records[hash],s=r.snapshot||{},id=s.history_reference?.review_id;
      if(id)(byReview[id]||(byReview[id]=[])).push(hash);
      Object.keys(s.verdicts||{}).forEach(function(cp){(recordsByCheck[cp]||(recordsByCheck[cp]=[])).push({hash:hash,record:r});});
    });
    docs.forEach(function(d){var id=d.review_id||d.original?.review_id,hash=d.contract_hash;
      if(id)(tagsByReview[id]||(tagsByReview[id]=[])).push(d);if(hash)(tagsByHash[hash]||(tagsByHash[hash]=[])).push(d);
    });
    var enriched=(packets||[]).map(function(p){
      if(!p.id||!p.documents?.length||p.documents.some(function(d){return !String(d.text||'').trim()||/�/.test(d.text);}))return p;
      stats.raw_packets++;
      var tags=Array.from(new Set([...(tagsByReview[p.review_id]||[]),...(tagsByHash[p.contract_hash]||[])]));
      tags.forEach(function(d){linkedTags.add(d);});
      var provenance=tags.map(function(d){return {source_id:d.source_id,review_id:d.review_id||d.original?.review_id||'',kind:d.source_kind||'tag_reference',title:d.title||''};});
      var keys=records[p.contract_hash]?[p.contract_hash]:(byReview[p.review_id]||[]);
      // ID는 연결 단서일 뿐이다. 본문·별첨·당시 적용 범위까지 일치해야 한다.
      var documentHash=H.of(p.documents),contextHash=contextKey(p.context);
      var matches=keys.filter(function(hash){var r=records[hash],s=r.snapshot||{},c=s.comparison_context;
        return !r.pending&&c&&c.documents===documentHash&&c.context===contextHash&&/^\d{4}-\d{2}-\d{2}$/.test(s.meta?.date||'');
      });
      var out=Object.assign({},p,{tag_sources:provenance});
      if(matches.length!==1){out.judgment_link_conflict=keys.length>0&&(!records[p.contract_hash]||!!records[p.contract_hash].snapshot?.comparison_context);return out;}
      var hash=matches[0],s=records[hash].snapshot,verdicts=Object.assign({},p.verdicts),sources={};
      (p.checks||[]).forEach(function(cp){var v=s.verdicts?.[cp.id];
        if(!human(v)||s.comparison_context.checks?.[cp.id]!==H.of(cp))return;
        verdicts[cp.id]=v;sources[cp.id]={kind:'bound_corpus',contract_hash:hash,review_id:s.history_reference?.review_id||p.review_id||'',date:s.meta.date};
        bound.add(hash+':'+cp.id);if(H.of(v)!==H.of(p.verdicts?.[cp.id]||{}))stats.hydrated_judgments++;
      });
      out.verdicts=verdicts;out.judgment_sources=sources;out.judgment_record_hash=hash;
      out.date=[p.date||'',s.meta.date,s.source_binding?.date||''].sort().pop();return out;
    });
    Object.keys(records).forEach(function(hash){var r=records[hash];if(r.pending)return;
      Object.keys(r.snapshot?.verdicts||{}).forEach(function(cp){if(human(r.snapshot.verdicts[cp])&&!bound.has(hash+':'+cp))stats.unbound_judgments++;});
    });
    stats.linked_tag_documents=linkedTags.size;stats.reference_only_documents=docs.length-linkedTags.size;
    return {packets:enriched,stats:stats,records_by_check:recordsByCheck};
  }
  return {compile:compile,contextKey:contextKey};
})();
if(typeof module!=='undefined')module.exports=JudgmentSources;
