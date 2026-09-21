"use strict";
var _OpHash=typeof SafetyDigest!=="undefined"?SafetyDigest:require('./safety_digest');
var _OpTrial=typeof EvalTrial!=="undefined"?EvalTrial:require('./eval_trial');
var _OpWB=typeof SafetyWorkbench!=="undefined"?SafetyWorkbench:require('./safety_workbench');
var _OpEval=typeof SafetyEval!=="undefined"?SafetyEval:require('./safety_eval');
var EvalOperational=(function(){
  function hash(x){return _OpHash.of(x);}
  function copy(x){return JSON.parse(JSON.stringify(x));}
  function need(v,s){if(!v)throw Error(s);}
  function texts(ds){return ds.map(function(d){return d.text.normalize('NFC');}).sort();}
  function bind(t,c,input,checks,actor,engine){
    _OpTrial.fresh(t,c);_OpTrial.consensus(t);need(String(actor||'').trim(),'연결 확인자를 입력하세요.');
    need(t.snapshot.checks_digest===hash(checks),'체크 기준이 변경되어 새 독립 검수가 필요합니다.');
    need(input.analyzed&&input.context.source_quality_confirmed&&input.context.scope_confirmed,'현재 계약 재분석 및 원문·유형·역할·범위 확인이 필요합니다.');
    var main=t.snapshot.documents.find(function(d){return d.role==='main';});
    need(main&&main.text===input.documents[0].text&&hash(texts(input.documents))===hash(texts(t.snapshot.documents)),'현재 분석의 본문·원계약·별첨이 평가 원문 묶음과 다릅니다. 같은 자료를 입력 화면에서 분석하세요.');
    var simplify=function(cs){return cs.map(function(x){return [x.index,x.heading,x.body];});};
    need(hash(simplify(input.clauses))===hash(simplify(t.snapshot.clauses.slice(0,input.clauses.length))),'본문 조항 위치가 독립 검수와 다릅니다. 새 검수가 필요합니다.');
    need(input.context.type&&Array.isArray(input.context.roles)&&Array.isArray(input.context.modules)&&input.context.analysis_type_ids.length,'실사용 유형·역할·모듈 정보를 확인하세요.');
    t.snapshot.questions.forEach(function(q){var cp=checks.find(function(x){return x.id===q.id;});need(cp&&q.guidance&&hash(q.guidance)===hash({pass:cp.pass_guidance||'',opinion:cp.opinion_guidance||'',sources:cp.sources||[]}),'충족·검토 기준이 표시된 새 독립 검수가 필요합니다. 구버전 부분검수를 자동 승격하지 않습니다.');});
    var data={trial_seal:t.seal,truth_digest:_OpTrial.truthDigest(t),context:copy(input.context),main_clauses:copy(input.clauses),subDocs:copy(input.subDocs||[]),actor:actor.trim(),engine:engine};
    return {data:data,seal:hash(data),date:new Date().toISOString()};
  }
  function binding(t,engine){var b=t.operational;need(b&&b.seal===hash(b.data)&&b.data.engine===engine&&b.data.trial_seal===t.seal&&b.data.truth_digest===_OpTrial.truthDigest(t),'실사용 분석 연결이 없거나 원문·검수·엔진이 바뀌었습니다. 계약별 연결을 다시 확인하세요.');return b.data;}
  function caseFrom(t,c,entry,result,engine,appVersion){
    var p=_OpEval.build({runId:'OP-'+hash([t.id,entry.family,entry.date,result.context,engine]).slice(0,24),contractHash:hash(t.snapshot.documents),familyId:entry.family,appVersion:appVersion,
      documents:t.snapshot.documents,clauses:t.snapshot.clauses,checkpoints:result.checks,results:result.results,context:result.context});
    p.engine_fingerprint=engine;p.checks_fingerprint=t.snapshot.checks_digest;p.case_date=entry.date;
    p.protocol='shared-review-core-v1';p.subdoc_coverage=result.subCoverage;p.trial_id=t.id;p.truth_digest=_OpTrial.truthDigest(t);p.incident_ids=c.source.incident_id?[c.source.incident_id]:[];
    need(!p.incident_ids.length||entry.split==='adversarial','오판 신고 사례는 반례로 편입하세요.');
    var golds=t.reviews.map(function(r){var g=_OpEval.goldTemplate(p);g.reviewer=r.reviewer;g.independent=r.independent;g.source_reviewed=r.source_reviewed;
      g.labels.forEach(function(l){var x=r.labels.find(function(v){return v.id===l.check_id;});Object.assign(l,{truth:x.truth,direct_clause_indices:x.direct,note:x.reason,evidence:x.evidence});});return g;});
    var resolutions={};Object.keys(t.resolutions||{}).forEach(function(id){var r=t.resolutions[id];resolutions[id]={reviewer:r.reviewer,date:r.saved_at.slice(0,10),truth:r.truth,direct_clause_indices:r.direct,note:r.reason,evidence:r.evidence};});
    p=_OpWB.seal(p);_OpWB.consensus(p,golds,resolutions);return {split:entry.split,observation:p,golds:golds,resolutions:resolutions};
  }
  function intake(store,incident,packet,cp){
    need(incident&&incident.kind==='incident'&&incident.id&&packet&&packet.documents.length&&cp,'오판 신고와 원문 묶음이 필요합니다.');
    need(!incident.source_digest||incident.source_digest===hash(packet.documents),'신고 당시 원문 묶음과 다릅니다. 같은 본문·원계약·별첨으로 다시 시도하세요.');
    var key=hash(['incident',incident.id]),next=copy(store);if(next.cases[key])return next;
    var source={id:'incident:'+incident.id,incident_id:incident.id,kind:'contract',title:'오판 재검수 · '+(packet.title||cp.check),department:packet.department||'',tags:[],references:[],conflicts:[],opinion:incident.reason};
    next.cases[key]={key:key,source:source,internal_id:'CASE-'+key.slice(0,12),version:'unknown',documents:packet.documents.map(function(d,i){return {name:d.name,text:d.text,role:i===0?'main':'attachment'};}),
      items:[{id:hash([key,cp.id]),quote:'오판 의심 신고: '+incident.reason,source:source.id,suggestion:'unknown',truth:'',check_id:cp.id,evidence:'',reason:'',status:'draft'}],status:'preparing',created_at:new Date().toISOString()};
    next.incidents=next.incidents||{};next.incidents[incident.id]={event:copy(incident),packet:copy(packet),case_key:key};next.active=Array.from(new Set((next.active||[]).concat(key)));return next;
  }
  return {bind:bind,binding:binding,caseFrom:caseFrom,intake:intake};
})();
if(typeof module!=='undefined')module.exports=EvalOperational;
