"use strict";
/* 등록 보조는 후보만 생성한다. 승인 전에는 자동판정 근거로 사용하지 않는다. */
var TemplateAssist=(function(){
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  var Tags=typeof ContractTags!=='undefined'?ContractTags:require('./contract_tags');
  var segment=typeof segmentContract!=='undefined'?segmentContract:require('./segmenter').segmentContract;
  function parts(text){return segment(text).map(function(c){var q=[c.heading,c.body].filter(Boolean).join('\n');if(!text.includes(q))q=c.body;return {heading:c.heading||'',quote:q};}).filter(function(c){return c.quote&&text.includes(c.quote);});}
  function proposals(t,checks){
    var clauses=parts(t.text).map(function(c){c.tags=Tags.analyzeClause({heading:c.heading,body:c.quote},t.name);c.values=Tags.values(c.tags);return c;}),out=[];
    checks.forEach(function(cp){
      if(cp.review_scope==='execution_only'||cp.text_effect==='required_absent'||['aggregate_only','anomaly_only'].includes(cp.surface_policy))return;
      var keywords=(cp.triggers||{}).keywords||[],sig=cp.tag_signature||{};
      var ranked=clauses.map(function(c){var hits=keywords.filter(function(k){return c.quote.includes(k);});
        var tagHits=[];['topics','actions','objects','modalities'].forEach(function(f){(sig[f]||[]).forEach(function(v){if((c.values[f]||[]).includes(v))tagHits.push(f+':'+v);});});
        var gate=(cp.evidence_required_groups||[]).every(function(g){return g.some(function(k){return c.quote.includes(k);});});
        return {quote:c.quote,heading:c.heading,score:hits.length*2+Math.min(4,tagHits.length),keywords:hits,tag_hits:tagHits,gate:gate};
      }).filter(function(c){return c.gate&&(c.keywords.length>=2||c.keywords.length>=1&&c.tag_hits.length>=2);}).sort(function(a,b){return b.score-a.score;}).slice(0,4);
      if(ranked.length)out.push({check_id:cp.id,question:cp.check,quotes:ranked.map(function(c){return c.quote;}),evidence:ranked,approved:false,
        warning:'관련 조항 후보입니다. 질문 전체의 충족 여부는 승인 전에 확인하세요.'});
    });return out.sort(function(a,b){return b.evidence[0].score-a.evidence[0].score;});
  }
  function human(v,s){return !!v&&(v.origin==='manual'||(!v.origin||v.origin==='legacy')&&s?.source_binding?.kind==='human_confirmed_legacy_binding');}
  function safe(v,s){return human(v,s)&&!v.needs_reconfirmation&&v.verdict==='이상없음'&&v.reason==='반영되어 있음';}
  function corpusState(record,cpId){if(!record||record.pending)return null;var s=record.snapshot||{},v=s.verdicts?.[cpId];return safe(v,s)?H.of([s.meta,v,s.source_binding||null]):null;}
  function packetState(p,cpId,corpus){var v=p.verdicts?.[cpId];if(!safe(v,p))return null;
    var record=corpus?.judgment_ledger?.records?.[p.contract_hash];if(record&&record.snapshot?.verdicts?.[cpId]&&!corpusState(record,cpId))return null;
    return H.of([p.documents,p.context,p.checks?.find(function(c){return c.id===cpId;}),v,p.mapping_gold?.[cpId]]);}
  function sourceStates(corpus,packets,only){var states={},wanted=only?new Set(only):null;
    Object.keys(corpus?.judgment_ledger?.records||{}).forEach(function(id){var r=corpus.judgment_ledger.records[id];Object.keys(r.snapshot?.verdicts||{}).forEach(function(cp){var key='corpus:'+id+':'+cp;if(!wanted||wanted.has(key))states[key]=corpusState(r,cp);});});
    (packets||[]).forEach(function(p){Object.keys(p.verdicts||{}).forEach(function(cp){var key='packet:'+p.id+':'+cp;if(!wanted||wanted.has(key))states[key]=packetState(p,cp,corpus);});});return states;}
  function variants(t,checks,corpus,packets){
    var out=[],seen=new Set(),stats={no_quote:0,excluded:0},states=sourceStates(corpus,packets),map={};checks.forEach(function(c){map[c.id]=c;});
    function add(cpId,quotes,source,scope,needsOriginal){
      var b=t.bindings.find(function(b){return b.check_id===cpId;}),cp=map[cpId];
      if(!b||!cp||b.check_hash!==H.of(cp)||!scope?.type||!t.type_ids.includes(scope.type)||!quotes.length)return;
      var key=H.of([cpId,quotes,source.id]);if(seen.has(key))return;seen.add(key);
      out.push({id:key,check_id:cpId,question:cp.check,quotes:quotes,source:source,scope:scope,needs_original:needsOriginal,
        tags:Tags.analyzeClause({heading:'',body:quotes.join('\n')},source.title),approved:false});
    }
    Object.keys(corpus?.judgment_ledger?.records||{}).forEach(function(hash){var rec=corpus.judgment_ledger.records[hash],s=rec.snapshot||{};
      Object.keys(s.verdicts||{}).forEach(function(cpId){var id='corpus:'+hash+':'+cpId;if(!states[id]){stats.excluded++;return;}
        var comment=String(s.verdicts[cpId].comment||''),quotes=[];var re=/[“「"]([^”」"\n]{12,1500})[”」"]/g,m;
        while((m=re.exec(comment)))if(/한다[.]?$|없다[.]?$|된다[.]?$/.test(m[1].trim()))quotes.push(m[1].trim());
        if(!quotes.length){stats.no_quote++;return;}
        add(cpId,quotes,{id:id,hash:states[id],kind:'corpus_quote',title:s.meta?.title||'누적 검토 의견 인용',contract_hash:hash},
          {type:s.meta?.type_id,roles:s.meta?.party_roles||[],stance:s.meta?.stance||'party'},true);
      });
    });
    (packets||[]).forEach(function(p){Object.keys(p.verdicts||{}).forEach(function(cpId){var id='packet:'+p.id+':'+cpId;if(!states[id]){stats.excluded++;return;}
      var cp=map[cpId],old=p.checks?.find(function(c){return c.id===cpId;});if(!cp||old?.check!==cp.check)return;
      var main=p.documents?.[0]?.text||'',hash=p.mapping_gold?.[cpId];
      var clause=hash&&segment(main).find(function(c){return H.of([c.heading,c.body])===hash;});
      if(!clause){stats.no_quote++;return;}var q=clause.body;if(!q||!main.includes(q))return;
      add(cpId,[q],{id:id,hash:states[id],kind:'verified_clause',title:p.documents[0].name,contract_hash:p.contract_hash},p.context,false);
    });});return {candidates:out,stats:stats};
  }
  function approveVariant(t,cp,candidate,confirmed){
    var b=t.bindings.find(function(b){return b.check_id===cp.id;});
    if(!confirmed||!b||b.check_hash!==H.of(cp)||candidate.check_id!==cp.id||!candidate.source?.hash||!candidate.scope?.type||!t.type_ids.includes(candidate.scope.type)||!Array.isArray(candidate.quotes)||!candidate.quotes.length)throw Error('기존 기준·후보 원문·질문 전체 충족 확인이 필요합니다.');
    var v=JSON.parse(JSON.stringify(candidate));v.approved=true;v.check_hash=H.of(cp);
    b.variants=(b.variants||[]).filter(function(x){return x.id!==v.id;}).concat([v]);return v;
  }
  return {proposals:proposals,variants:variants,approveVariant:approveVariant,sourceStates:sourceStates,parts:parts};
})();
if(typeof module!=='undefined')module.exports=TemplateAssist;
