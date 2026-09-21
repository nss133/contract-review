"use strict";
/* 사용자 판단 재사용: 동일 문서 또는 출처 있는 관련 조항·조건의 동등성. */
var HumanPrecedent=(function(){
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest'),cache=new WeakMap();
  var D=typeof DecisionEvidence!=='undefined'?DecisionEvidence:require('./decision_evidence');
  var J=typeof JudgmentSources!=='undefined'?JudgmentSources:require('./judgment_sources');
  function documentsKey(docs){
    if(!Array.isArray(docs)||!docs.length||docs.some(function(d){return !String(d.text||'').trim()||/�/.test(d.text);}))return null;
    return H.of(docs.map(function(d){var row=[d.name||'',String(d.text).normalize('NFC').replace(/\s+/g,' ').trim()];if(d.extraction)row.push(d.extraction);return row;}));
  }
  function scopeKey(s){if(!s?.type)return null;return H.of({type:s.type,roles:(s.roles||[]).slice().sort(),stance:s.stance||'party',party:s.party||null,modules:(s.modules||[]).slice().sort(),title:s.title||'',scope_answers:s.scope_answers||{},baseText:s.baseText||''});}
  function collect(input){
    var out={},key=documentsKey(input.documents),scope=scopeKey(input.scope),localScope=D.scopeKey(input.scope),currentBundles={};if(!key||!scope)return out;
    var index=input.judgment_sources||J.compile(input.review_packets,input.corpus,input.knowledge);
    index.packets.forEach(function(p){
      if(!p.id||p.pending||p.judgment_link_conflict||(input.exclude_source_ids||[]).includes(p.id)||(input.exclude_source_ids||[]).includes(p.review_id)||(input.exclude_contract_hashes||[]).some(function(h){return h===p.contract_hash||h===p.judgment_record_hash;})||input.date&&p.date&&p.date>input.date)return;
      var exact=scopeKey(p.context)===scope&&documentsKey(p.documents)===key;
      if(!exact&&(D.scopeKey(p.context)!==localScope||!documentsKey(p.documents)))return;
      var record=input.corpus?.judgment_ledger?.records?.[p.judgment_record_hash||p.contract_hash];
      if(record?.pending)return;
      (p.checks||[]).forEach(function(cp){
        var v=p.verdicts?.[cp.id],current=record?.snapshot?.verdicts?.[cp.id];
        if(current?.origin==='auto')current=null; // 시스템 결과는 기존 사용자 정답의 정정이 아니다.
        // 원자료 수정·재확인 대기는 과거 저장본의 정답성을 무효화한다.
        if(current){if(current.origin!=='manual'||current.needs_reconfirmation)return;
          if(current.verdict==='검토의견'||current.reason==='수용 가능한 위험')v=current;
          else if(H.of(current)!==H.of(v))return;
        }
        if(!v||v.origin!=='manual'||v.needs_reconfirmation||v.auto_proof)return;
        var safe=v.verdict==='이상없음'&&v.reason==='반영되어 있음',issue=v.verdict==='검토의견'||v.verdict==='이상없음'&&v.reason==='수용 가능한 위험';
        if(!safe&&!issue)return;
        var sourceBundle=null,currentBundle=null;
        if(!exact){
          if(cp.review_scope==='execution_only'||cp.text_effect==='required_absent')return;
          currentBundle=currentBundles[cp.id]||(currentBundles[cp.id]=D.bundle(cp,input.documents));
          if(!currentBundle.reusable)return;
          sourceBundle=D.bundle(cp,p.documents);
          if(!sourceBundle.reusable||sourceBundle.key!==currentBundle.key)return;
        }
        var row={source:'packet:'+p.id,contract_hash:p.contract_hash,check_hash:H.of(cp),safe:safe,issue:issue,
          source_hash:H.of([p.documents,p.context,cp,v]),comment:v.comment||'',verdict:v.verdict,reason:v.reason||'',
          kind:exact?'reused':'clause_reused',evidence:currentBundle?.evidence||[],tags:currentBundle?.tags||{},judgment_source:p.judgment_sources?.[cp.id]||null,tag_sources:p.tag_sources||[]};
        (out[cp.id]||(out[cp.id]=[])).push(row);
      });
    });return out;
  }
  function prepare(input){var p=Object.freeze(Object.assign({},input,{judgment_sources:J.compile(input.review_packets,input.corpus,input.knowledge)}));cache.set(p,collect(p));return p;}
  function lookup(cp,input){
    var rows=(cache.get(input)||collect(input))[cp.id]||[];rows=rows.filter(function(r){return r.check_hash===H.of(cp);});
    return {eligible:rows.some(function(r){return r.safe;})&&!rows.some(function(r){return r.issue;}),conflict:rows.some(function(r){return r.issue;}),sources:rows};
  }
  return {prepare:prepare,lookup:lookup,documentsKey:documentsKey,scopeKey:scopeKey};
})();
if(typeof module!=='undefined')module.exports=HumanPrecedent;
