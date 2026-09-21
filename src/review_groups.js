"use strict";
// Parent decisions are independent judgments, never fabricated child gold labels.
var ReviewGroups=(function(){
  var defs=[],version='review-groups-v1',lookup={};
  var digest=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  function configure(catalog){
    var next={},groups=catalog&&catalog.groups||[];
    groups.forEach(function(g){g.members.forEach(function(id){if(next[id])throw Error('Duplicate group member: '+id);next[id]=g;});});
    defs=groups;lookup=next;version=catalog&&catalog.version||version;
  }
  function definition(id){return lookup[id]||null;}
  function units(results){
    var grouped={};(results||[]).forEach(function(r){var d=definition(r.cpId);if(!d)return;
      if(!grouped[d.id])grouped[d.id]={id:d.id,title:d.title,definition:d,results:[]};
      if(!grouped[d.id].results.some(function(x){return x.cpId===r.cpId;}))grouped[d.id].results.push(r);
    });
    return defs.map(function(d){return grouped[d.id];}).filter(Boolean);
  }
  function fingerprint(unit,contextKey,store){
    return digest.of({version:version,definition:unit.definition,context:contextKey,
      children:unit.results.map(function(r){var v=store[r.cpId];return [r.cpId,
        v&&v.origin!=='auto'?{verdict:v.verdict,reason:v.reason,comment:v.comment,reconfirm:!!v.needs_reconfirmation}:null];}).sort(function(a,b){return a[0].localeCompare(b[0]);})});
  }
  function status(unit,store,parents,contextKey){
    var p=parents&&parents[unit.id],key=fingerprint(unit,contextKey,store);
    var children=unit.results.map(function(r){return store[r.cpId]||{};}),known=children.filter(function(v){return v.verdict&&!v.needs_reconfirmation;});
    var issue=known.some(function(v){return v.verdict==='검토의견'||v.reason==='수용 가능한 위험';});
    if(p&&!p.needs_reconfirmation&&p.fingerprint===key&&['이상없음','검토의견'].includes(p.verdict))
      return {done:true,verdict:p.verdict,reason:p.reason||'',comment:p.comment||'',origin:'manual',source:'parent',issue:issue,record:p,known:known.length,total:children.length};
    // Changed parent never silently falls back to child aggregation.
    if(p)return {done:false,stale:true,verdict:'',issue:issue,record:p,known:known.length,total:children.length};
    if(known.length===children.length&&children.length){
      return {done:true,verdict:issue?'검토의견':'이상없음',reason:'세부 판정 종합',
        comment:known.map(function(v){return v.comment;}).filter(Boolean).join('\n'),
        origin:known.every(function(v){return v.origin==='auto';})?'auto':'derived',source:'children',issue:issue,known:known.length,total:children.length};
    }
    return {done:false,verdict:'',issue:issue,known:known.length,total:children.length};
  }
  function decide(unit,store,parents,contextKey,input){
    if(!['이상없음','검토의견'].includes(input.verdict))throw Error('판정을 선택하세요.');
    var previous=status(unit,store,{},contextKey);
    if(input.verdict==='이상없음'&&previous.issue&&!String(input.comment||'').trim())throw Error('기존 보완·위험수용 의견과 다른 결론을 내리는 이유를 입력하세요.');
    var next=Object.assign({},parents);
    next[unit.id]={version:version,group_id:unit.id,title:unit.title,members:unit.results.map(function(r){return r.cpId;}).sort(),
      fingerprint:fingerprint(unit,contextKey,store),verdict:input.verdict,reason:input.reason||'',comment:String(input.comment||''),
      date:input.date||'',origin:'manual',judgment_scope:'group_only',
      judgment_tags:{topics:[unit.id],verdict:input.verdict,scope:'group_only',auto_approval:false}};
    return next;
  }
  function normalize(raw){var out={};if(!raw||raw.version!==version||!raw.records)return out;
    Object.keys(raw.records).forEach(function(id){var p=raw.records[id];if(p&&p.version===version&&p.group_id===id&&typeof p.fingerprint==='string'&&Array.isArray(p.members)&&['이상없음','검토의견'].includes(p.verdict))out[id]=JSON.parse(JSON.stringify(p));});return out;}
  function pack(records){return {version:version,records:JSON.parse(JSON.stringify(records||{}))};}
  function history(corpus,id){return Object.keys(corpus&&corpus.judgment_ledger&&corpus.judgment_ledger.records||{}).map(function(key){
    var rec=corpus.judgment_ledger.records[key],s=rec.snapshot||{},p=s.group_reviews&&s.group_reviews.records&&s.group_reviews.records[id];
    if(rec.pending||!p||p.version!==version||p.needs_reconfirmation)return null;
    return {source:key,date:s.meta&&s.meta.date||p.date,verdict:p.verdict,comment:p.comment||'',reference_only:true};
  }).filter(Boolean);}
  function evaluate(packet,candidates){
    var saved=normalize(packet.group_reviews),rows=[],candidateMap={},checkIds=new Set((packet.checks||[]).map(function(c){return c.id;}));
    candidates.forEach(function(r){candidateMap[r.check_id]=r;});
    units(packet.items).forEach(function(u){var p=saved[u.id];
      if(!p||p.needs_reconfirmation||p.reason==='수용 가능한 위험'||p.reason==='해당사항 없음'||p.definition_fingerprint!==digest.of(u.definition))return;
      var members=u.results.map(function(r){return r.cpId;}).sort();
      if(JSON.stringify(p.members)!==JSON.stringify(members)||members.some(function(id){return !checkIds.has(id);}))return;
      var candidate=members.length>0&&members.every(function(id){return candidateMap[id]&&candidateMap[id].eligible;});
      rows.push({group_id:u.id,truth:p.verdict==='검토의견'?'issue':'safe',candidate:candidate,
        false_safe:candidate&&p.verdict==='검토의견',members:members});
    });return {checked:rows.length,candidates:rows.filter(function(r){return r.candidate;}).length,false_safe:rows.filter(function(r){return r.false_safe;}).length,rows:rows};
  }
  function metrics(results,store,parents,contextKey){var us=units(results),states=us.map(function(u){return status(u,store,parents,typeof contextKey==='function'?contextKey(u):contextKey);});
    return {raw_items:(results||[]).length,group_units:us.length,group_done:states.filter(function(s){return s.done;}).length,
      group_auto:states.filter(function(s){return s.done&&s.origin==='auto';}).length,
      raw_auto:(results||[]).filter(function(r){var v=store[r.cpId];return v&&v.origin==='auto'&&v.verdict==='이상없음'&&!v.needs_reconfirmation;}).length};}
  return {configure:configure,definition:definition,units:units,fingerprint:fingerprint,status:status,decide:decide,normalize:normalize,pack:pack,metrics:metrics,history:history,evaluate:evaluate};
})();
if(typeof module!=='undefined')module.exports=ReviewGroups;
