"use strict";
var _WBHash = typeof SafetyDigest !== "undefined" ? SafetyDigest : require("./safety_digest");
var _WBRules = typeof EvidenceRules !== "undefined" ? EvidenceRules : require("./evidence_rules");
var _WBEval = typeof SafetyEval !== "undefined" ? SafetyEval : require("./safety_eval");
/* 내부 검수·시험·승인 원장. 초기 승인 없음. 파일은 인증서가 아니며 내부 접근통제가 필요하다. */
var SafetyWorkbench = (function () {
  var tickets = new WeakMap();
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function need(ok,s) { if (!ok) throw Error(s); }
  function str(s) { return typeof s === "string" && s.trim().length > 0; }
  function date(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s; }
  function withoutSeal(x) { var c=clone(x);delete c.seal;return c; }
  function seal(x) { var c=withoutSeal(x);c.seal=_WBHash.of(c);return c; }
  function sealed(x) { return x && str(x.seal) && _WBHash.of(withoutSeal(x))===x.seal; }
  function empty() { return {format:"cr-safety-workbench-v1",enabled:false,rules:{},approvals:{},events:[]}; }
  function event(s,kind,actor,reason,at,extra) {
    need(str(actor)&&str(reason)&&date(at),"작업자·사유·날짜 필요");
    s.events.push(Object.assign({kind:kind,actor:actor,reason:reason,date:at},extra||{}));return s;
  }
  function register(store,rule,actor,at) {
    _WBRules.validate(rule);var s=clone(store),old=s.rules[rule.id];
    need(!old || _WBHash.of(old)===_WBHash.of(rule) || old.revision!==rule.revision,"규칙 수정 시 revision을 변경하세요");
    s.rules[rule.id]=clone(rule);
    if (s.approvals[rule.id]) s.approvals[rule.id].status="superseded";
    return event(s,"rule_registered",actor,rule.rationale,at,{rule_id:rule.id,rule_hash:_WBHash.of(rule)});
  }
  function consensus(p,golds,resolutions) {
    need(Array.isArray(golds)&&golds.length===2,"정답은 독립 검수자 2명의 파일이 필요합니다");
    need(golds[0].reviewer.trim()!==golds[1].reviewer.trim(),"서로 다른 검수자 2명 필요");
    golds.forEach(function(g){_WBEval.score(p,g);
      need(_WBHash.of(g.documents)===_WBHash.of(p.documents)&&_WBHash.of(g.clauses)===_WBHash.of(p.clauses),"정답의 원본/조항 위치가 관찰 기록과 다름");
      g.labels.forEach(function(l){var item=p.items.filter(function(i){return i.check_id===l.check_id;})[0];
        need(item&&item.check===l.check&&_WBHash.of(item.guidance)===_WBHash.of(l.guidance),"체크 질문·판단 기준 변경 — 재검수 필요");});
    });
    var maps=golds.map(function(g){var m=Object.create(null);g.labels.forEach(function(l){m[l.check_id]=l;});return m;});
    var out=Object.create(null);
    p.items.forEach(function(item){
      var a=maps[0][item.check_id],b=maps[1][item.check_id];
      if (!a||!b||!a.truth||!b.truth) {out[item.check_id]={truth:"",agreement:"unreviewed"};return;}
      var same=a.truth===b.truth && _WBHash.of(a.direct_clause_indices.slice().sort())===_WBHash.of(b.direct_clause_indices.slice().sort());
      if (same) {out[item.check_id]=Object.assign({},a,{agreement:"agreed"});return;}
      var r=(resolutions||{})[item.check_id];
      if (!r) {out[item.check_id]={truth:"unknown",agreement:"conflict",reviews:[a,b]};return;}
      need(str(r.reviewer)&&golds.every(function(g){return g.reviewer.trim()!==r.reviewer.trim();})&&str(r.note)&&str(r.evidence)&&date(r.date),"이견 조정은 제3 검토자·사유·원본 위치·날짜 필요");
      var g=clone(golds[0]);g.labels=[Object.assign({},r,{check_id:item.check_id})];_WBEval.score(p,g);
      need(str(r.truth),"조정 결론 필요");
      out[item.check_id]=Object.assign({},r,{agreement:"resolved",reviews:[a,b]});
    });return out;
  }
  function freeze(input) {
    need(input && input.format==="cr-safety-dataset-v1" && str(input.id)&&str(input.owner)&&date(input.frozen_on),"데이터셋 ID·담당자·고정일 필요");
    need(Array.isArray(input.cases)&&input.cases.length>0,"시험 케이스 필요");
    var runs=Object.create(null),families=Object.create(null),texts=Object.create(null),latestDev="",earliestTest="9999-99-99";
    input.cases.forEach(function(c){
      var p=c.observation;
      need(["development","test","adversarial"].indexOf(c.split)!==-1&&sealed(p),"분할 구분 및 무결성 있는 관찰 기록 필요");
      need(!runs[p.run_id],"동일 실행 중복");runs[p.run_id]=true;
      need(str(p.family_id)&&date(p.case_date)&&str(p.engine_fingerprint),"계열·계약 기준일·엔진 지문 필요 (새 스냅샷 생성)");
      var prior=families[p.family_id];need(!prior||prior===c.split,"같은 계약 계열의 개발/시험/반례 중복");families[p.family_id]=c.split;
      var body=_WBHash.of(p.documents.map(function(d){return String(d.text||"").normalize("NFC").toLowerCase().replace(/\d+(?:[.,]\d+)*/g,"#").replace(/\s+/g," ").trim();}));
      need(!texts[body]||texts[body]===p.family_id,"동일/숫자만 다른 본문을 다른 계열로 중복 계수할 수 없음");texts[body]=p.family_id;
      consensus(p,c.golds,c.resolutions);
      if(c.split==="development"&&p.case_date>latestDev)latestDev=p.case_date;
      if(c.split==="test"&&p.case_date<earliestTest)earliestTest=p.case_date;
    });
    need(!latestDev||latestDev<=earliestTest,"개발 자료가 시험 자료보다 미래임");
    input.cases.forEach(function(c){
      var p=c.observation;
      if(c.split==="development")return;
      need(p.context && p.context.retrieval && p.context.retrieval.strict===true,"시험 검색의 계열·시점 격리 기록 필요");
      (p.context.retrieval.sources||[]).forEach(function(source){
        need(str(source.family_id)&&date(source.date)&&source.date<=p.case_date,"검색 자료 계열/시점 미상 또는 미래 누수");
        need(!families[source.family_id]||families[source.family_id]==="development","시험/반례 계열이 검색 자료에 포함됨");
      });
    });
    return seal(input);
  }
  function scopeKey(ctx) {return _WBHash.canonical([ctx.type||ctx.type_id,(ctx.roles||ctx.party_roles||[]).slice().sort()]);}
  function ruleResult(rule,p) {
    var result=_WBRules.evaluate(rule,p.documents,{type_id:p.context.type,party_roles:p.context.roles});
    var hasException=_WBRules.blockingQualifiers(rule,p.documents).length>0;
    var item=(p.items||[]).filter(function(i){return i.check_id===rule.check_id;})[0];
    // 본문 매핑이 약해도 실제 문서 묶음에서 승인 규칙의 모든 요건을 확인했다면
    // 단순 매핑 상태만으로 다시 막지 않는다. 미선정·비적용은 계속 제외한다.
    var eligible=result.status==="supported"&&!hasException&&item&&["addressed","verify","consider","base_covered"].indexOf(item.coverage)!==-1&&
      !Object.prototype.hasOwnProperty.call(p.context.reassign||{},rule.check_id)&&
      p.context.source_quality_confirmed===true&&p.context.scope_confirmed===true;
    eligible=!!eligible;
    return {result:result,eligible:eligible};
  }
  function evaluate(dataset,rule,engine) {
    need(sealed(dataset),"데이터셋 변경 감지 — 다시 고정 필요");freeze(withoutSeal(dataset));_WBRules.validate(rule);
    var groups=Object.create(null),slices=Object.create(null),counts={development:0,test:0,adversarial:0},rows=[],bad=0,negative=0;
    var mapping={reviewed:0,top1_correct:0,direct:0,top3_found:0,false_direct:0,issue_count:0,unsurfaced_issues:0};
    dataset.cases.forEach(function(c){
      var p=c.observation;need(p.engine_fingerprint===engine,"엔진/규칙 환경 변경 — 현재 버전으로 관찰 재실행 필요");
      var labels=consensus(p,c.golds,c.resolutions),label=labels[rule.check_id];
      need(label,"규칙 체크의 독립 정답이 없음");counts[c.split]++;
      var evaluated=ruleResult(rule,p),candidate=evaluated.eligible;
      var error=candidate && label.truth!=="safe";
      if(c.split!=="development"){
        if(error||!label.truth||label.agreement==="conflict")bad++;
        if((label.truth==="issue"||label.truth==="unknown")&&!candidate)negative++;
        var item=p.items.filter(function(i){return i.check_id===rule.check_id;})[0];
        var direct=label.direct_clause_indices||[];
        if(label.truth&&label.truth!=="unknown"&&label.agreement!=="conflict"){
          mapping.reviewed++;
          if(direct.length){mapping.direct++;if(direct.indexOf(item.top1)!==-1)mapping.top1_correct++;
            if((item.top3||[]).some(function(i){return direct.indexOf(i)!==-1;}))mapping.top3_found++;
          }else if(item.top1===null)mapping.top1_correct++;else mapping.false_direct++;
        }
        if(label.truth==="issue"){mapping.issue_count++;if(!item.surfaced)mapping.unsurfaced_issues++;}
        var sliceKey=_WBHash.canonical([p.context.type,p.context.department||"부서 미상"]),slice=slices[sliceKey]||(slices[sliceKey]={cases:0,candidates:0,errors:0,unknown:0});
        slice.cases++;if(candidate)slice.candidates++;if(error)slice.errors++;if(label.truth==="unknown"||!label.truth)slice.unknown++;
        if(c.split==="test"&&candidate){
          var key=scopeKey(p.context),g=groups[key]||(groups[key]={families:{},failures:0,documents:0});
          g.families[p.family_id]=true;g.documents++;if(error)g.failures++;
        }
      }
      rows.push({run_id:p.run_id,family_id:p.family_id,split:c.split,check_id:rule.check_id,candidate:candidate,
        truth:label.truth,agreement:label.agreement,error:!!error,status:evaluated.result.status});
    });
    Object.keys(groups).forEach(function(key){var g=groups[key];g.family_count=Object.keys(g.families).length;
      g.upper95=g.family_count&&!g.failures?1-Math.pow(.05/Math.max(1,Object.keys(groups).length),1/g.family_count):null;delete g.families;});
    return {dataset_id:dataset.id,dataset_seal:dataset.seal,rule_hash:_WBHash.of(rule),engine_fingerprint:engine,
      groups:groups,slices:slices,mapping:mapping,counts:counts,blocking_cases:bad,negative_cases:negative,rows:rows,
      caveat:"계열 독립 가정의 상한. 모집단 대표성·계열 지정·독립 검수는 내부 책임자가 확인해야 함"};
  }
  function approve(store,id,dataset,options,engine,at) {
    var rule=store.rules[id];need(rule,"등록 규칙 없음");
    need(str(options.approver)&&str(options.basis)&&options.representative===true,"승인자·내부 승인 근거·대표성 확인 필요");
    need(typeof options.risk_limit==="number"&&options.risk_limit>0&&options.risk_limit<=.05,"위험 한도는 0 초과 5% 이하");
    need(date(at)&&date(options.expires)&&options.expires>at&&Date.parse(options.expires)-Date.parse(at)<=366*86400000,"유효기간은 승인 후 1년 이내");
    var report=evaluate(dataset,rule,engine);
    (store.events||[]).filter(function(e){return e.kind==='incident'&&e.id&&(e.rule_id===id||e.check_id===rule.check_id);}).forEach(function(e){
      need(dataset.cases.some(function(c){if(c.split!=='adversarial'||!(c.observation.incident_ids||[]).includes(e.id))return false;
        if(e.source_digest&&e.source_digest!==_WBHash.of(c.observation.documents.map(function(d){return {name:d.name,text:d.text};})))return false;
        var l=consensus(c.observation,c.golds,c.resolutions)[rule.check_id];return l&&['safe','issue','not_applicable'].includes(l.truth)&&l.agreement!=='conflict';}),'오판 신고 당시 원문을 반례로 편입하고 독립 검수를 마쳐야 같은 체크의 규칙을 승인할 수 있습니다.');
    });
    need(report.counts.development&&report.counts.test&&report.counts.adversarial&&report.negative_cases&&!report.blocking_cases,"개발·독립 시험·반례 및 미해결 오류/미검수 확인 필요");
    need(!report.mapping.false_direct&&!report.mapping.unsurfaced_issues&&report.mapping.top1_correct===report.mapping.reviewed,"근거 오연결·문제 항목 비노출 해결 후 재시험 필요");
    var keys=options.scope_keys===undefined?Object.keys(report.groups):options.scope_keys;
    need(Array.isArray(keys)&&keys.length>0&&new Set(keys).size===keys.length&&keys.every(function(k){return report.groups[k]&&report.groups[k].upper95!==null&&report.groups[k].upper95<=options.risk_limit;}),"선택 범위의 독립 시험 표본 부족 또는 위험 한도 미충족");
    need(!(store.events||[]).some(function(e){return e.kind==="incident"&&e.rule_id===id&&e.rule_hash===report.rule_hash&&e.dataset_seal===dataset.seal;}),"오판 신고 당시와 동일한 규칙·시험셋으로 재승인할 수 없습니다. 신고 사례를 반영해 재검증하세요.");
    var s=clone(store);s.approvals[id]={status:"approved",rule_hash:report.rule_hash,engine_fingerprint:engine,
      dataset_seal:dataset.seal,scope_keys:keys.slice(),approved_on:at,expires:options.expires,approver:options.approver,
      basis:options.basis,risk_limit:options.risk_limit,report:report};
    return event(s,"approved",options.approver,options.basis,at,{rule_id:id,dataset_seal:dataset.seal});
  }
  function stop(store,id,actor,reason,at) {
    var s=clone(store);if(id){need(s.approvals[id],"승인 기록 없음");s.approvals[id].status="suspended";}
    else s.enabled=false;
    return event(s,"suspended",actor,reason,at,{rule_id:id||"all"});
  }
  function enable(store,actor,reason,at) {var s=clone(store);s.enabled=true;return event(s,"enabled",actor,reason,at);}
  function incident(store,id,actor,reason,at,sourceDigest) {
    need(store.rules[id],"등록 규칙 없음");var s=clone(store),a=s.approvals[id];
    if(a)a.status="suspended";
    return event(s,"incident",actor,reason,at,{id:'INC-'+_WBHash.of([id,actor,reason,at,s.events.length,Date.now()]).slice(0,24),rule_id:id,check_id:s.rules[id].check_id,rule_hash:_WBHash.of(s.rules[id]),dataset_seal:a?a.dataset_seal:null,source_digest:sourceDigest||null});
  }
  function eligible(store,rule,cp,p,engine,at) {
    var a=store.approvals[rule.id];
    if(cp.id!==rule.check_id||!store.enabled||!a||a.status!=="approved"||a.rule_hash!==_WBHash.of(rule)||a.engine_fingerprint!==engine||
      !date(at)||at<a.approved_on||at>a.expires||a.scope_keys.indexOf(scopeKey(p.context))===-1||cp.auto_verdict===false)return false;
    return ruleResult(rule,p).eligible;
  }
  function ticket(store,rule,cp,p,engine,at) {
    if(!eligible(store,rule,cp,p,engine,at))return null;
    var t={},a=store.approvals[rule.id];tickets.set(t,{check_id:cp.id,rule_id:rule.id,rule_hash:_WBHash.of(rule),
      input_hash:_WBHash.of({documents:p.documents,context:p.context}),engine_fingerprint:engine,
      dataset_seal:a.dataset_seal,expires:a.expires,evidence:ruleResult(rule,p).result.evidence});return t;
  }
  function consume(t,id) {var proof=t&&tickets.get(t);if(!proof||proof.check_id!==id)return null;tickets.delete(t);return clone(proof);}
  // 복구/롤백은 규칙과 이력만 복원한다. 승인 활성화는 재평가·재승인 없이는 하지 않는다.
  function restore(payload,actor,reason,at) {
    need(payload&&payload.format==="cr-safety-workbench-v1"&&payload.rules&&Array.isArray(payload.events),"워크벤치 백업 형식 확인 필요");
    var s=empty();Object.keys(payload.rules).forEach(function(id){_WBRules.validate(payload.rules[id]);need(id===payload.rules[id].id,"규칙 ID 불일치");});
    s.rules=clone(payload.rules);s.events=clone(payload.events);s.approvals=clone(payload.approvals||{});
    Object.keys(s.approvals).forEach(function(id){s.approvals[id].status="restored_pending";});
    return event(s,"restored",actor,reason,at);
  }
  return {empty:empty,seal:seal,sealed:sealed,register:register,consensus:consensus,freeze:freeze,evaluate:evaluate,
    approve:approve,stop:stop,incident:incident,enable:enable,ticket:ticket,consume:consume,restore:restore,ruleResult:ruleResult,scopeKey:scopeKey};
})();
if(typeof module!=="undefined")module.exports=SafetyWorkbench;
