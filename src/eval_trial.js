"use strict";
var _TrialHash=typeof SafetyDigest!=="undefined"?SafetyDigest:require("./safety_digest");
var EvalTrial=(function(){
  function hash(x){return _TrialHash.of(x);}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function need(ok,s){if(!ok)throw Error(s);}
  function name(s){return String(s||"").normalize("NFC").replace(/\s+/g,"").toLowerCase();}
  function context(c){return hash([c.source,c.version,c.documents,c.items]);}
  function freeze(c,checks,clauses){
    need(c&&c.source.kind==="contract","법률검토 참고자료는 특정 계약의 정답 시험으로 만들지 않습니다.");
    need(c.version!=="unknown"&&c.documents.filter(function(d){return d.role==="main";}).length===1,"본문 1개와 문서 버전을 확인하세요.");
    var reviewed=c.items.filter(function(i){return i.status==="reviewed_draft";});
    need(reviewed.length&&reviewed.every(function(i){return i.context_digest===hash([c.version,c.documents]);}),"현재 원문 기준으로 초안 확인을 마치세요.");
    var ids=Array.from(new Set(reviewed.map(function(i){return i.check_id;}).filter(function(id){return id!=="unmapped";})));
    var questions=checks.filter(function(cp){return ids.includes(cp.id);}).map(function(cp){return {id:cp.id,question:cp.decision_question||cp.check||cp.label,guidance:{pass:cp.pass_guidance||"",opinion:cp.opinion_guidance||"",sources:clone(cp.sources||[])}};});
    need(questions.length&&questions.length===ids.length,"채점할 활성 체크가 없습니다. 체크 미대응 쟁점은 별도 보존합니다.");
    var snapshot={case_key:c.key,context_digest:context(c),documents:clone(c.documents),version:c.version,clauses:clone(clauses),questions:questions,
      preparers:Array.from(new Set(reviewed.map(function(i){return name(i.reviewer);}))),
      unmapped:reviewed.filter(function(i){return i.check_id==="unmapped";}).map(function(i){return i.id;}),
      scope:"selected_checks_only",history_retrieval:"disabled",checks_digest:hash(checks)};
    return {id:"TRIAL-"+hash(snapshot).slice(0,24),snapshot:snapshot,seal:hash(snapshot),reviews:[],runs:[],created_at:new Date().toISOString()};
  }
  function valid(t){need(t&&t.snapshot&&t.seal===hash(t.snapshot),"평가 대상이 변경되었습니다. 새 대상을 고정하세요.");}
  function fresh(t,c){valid(t);need(c&&t.snapshot.context_digest===context(c),"원문·초안이 변경되었습니다. 새 평가 대상으로 고정하세요.");}
  function blind(t){valid(t);return {id:t.id,documents:clone(t.snapshot.documents),clauses:clone(t.snapshot.clauses),questions:clone(t.snapshot.questions)};}
  function saveReview(t,review){
    valid(t);var r=clone(review),who=name(r.reviewer);
    need(who&&!t.snapshot.preparers.includes(who),"초안 준비자와 다른 독립 검수자 이름이 필요합니다.");
    need(r.independent===true&&r.source_reviewed===true,"과거 의견·다른 검수 결과를 보지 않은 검수 및 원본 대조를 확인하세요.");
    need(r.trial_id===t.id&&r.seal===t.seal,"검수 대상이 일치하지 않습니다.");
    need(Array.isArray(r.labels)&&r.labels.length===t.snapshot.questions.length,"모든 선정 질문의 검수 결과가 필요합니다. 자료 부족도 선택할 수 있습니다.");
    var seen=new Set(),validIndices=t.snapshot.clauses.map(function(c){return c.index;});
    r.labels.forEach(function(l){
      need(t.snapshot.questions.some(function(q){return q.id===l.id;})&&!seen.has(l.id),"중복되거나 알 수 없는 질문");seen.add(l.id);
      need(["safe","issue","unknown","not_applicable"].includes(l.truth),"각 질문의 판단을 선택하세요.");
      need(String(l.reason||"").trim()&&String(l.evidence||"").trim(),"판단 이유와 근거 위치를 입력하세요.");
      need(Array.isArray(l.direct)&&l.direct.every(function(i){return Number.isInteger(i)&&validIndices.includes(i);})&&new Set(l.direct).size===l.direct.length,"근거 조항 위치를 확인하세요.");
      if(l.truth==="not_applicable")need(!l.direct.length,"비적용 항목에는 직접 근거 조항을 연결하지 마세요.");
    });
    need(!t.reviews.some(function(x){return name(x.reviewer)===who;}),"같은 검수자의 결과가 이미 저장되어 있습니다. 기존 기록은 덮어쓰지 않습니다.");
    need(t.reviews.length<2,"두 검수 결과가 이미 저장되었습니다. 이견은 새 검수 대상으로 재확인하세요.");
    r.saved_at=new Date().toISOString();t.reviews.push(r);return t;
  }
  function consensus(t){
    valid(t);need(t.reviews.length===2,"서로 다른 독립 검수자 2명의 결과가 필요합니다.");
    // 저장된 파일의 선언만 신뢰하지 않고 검수 구조를 재검증한다.
    var audit={id:t.id,snapshot:t.snapshot,seal:t.seal,reviews:[]};t.reviews.forEach(function(r){saveReview(audit,r);});
    return t.snapshot.questions.map(function(q){
      var a=t.reviews[0].labels.find(function(l){return l.id===q.id;}),b=t.reviews[1].labels.find(function(l){return l.id===q.id;});
      var same=a.truth===b.truth&&hash(a.direct.slice().sort(function(x,y){return x-y;}))===hash(b.direct.slice().sort(function(x,y){return x-y;}));
      var r=(t.resolutions||{})[q.id];if(r){validateResolution(t,r);need(!same,"일치한 정답에는 이견 조정을 적용하지 않습니다.");return {id:q.id,truth:r.truth,direct:r.direct,agreement:true,resolved:true,question:q.question};}
      return {id:q.id,truth:same?a.truth:"unknown",direct:same?a.direct:[],agreement:same,question:q.question};
    });
  }
  function validateResolution(t,r){
    var who=name(r.reviewer);need(who&&!t.snapshot.preparers.includes(who)&&!t.reviews.some(function(x){return name(x.reviewer)===who;}),"초안 준비자·두 검수자와 다른 제3자 이름이 필요합니다.");
    need(r.seal===t.seal&&r.review_digest===hash(t.reviews),"조정 당시 원문·검수 결과와 다릅니다.");
    need(t.snapshot.questions.some(function(q){return q.id===r.id;})&&["safe","issue","unknown","not_applicable"].includes(r.truth),"조정 질문·판단을 선택하세요.");
    need(String(r.reason||"").trim()&&String(r.evidence||"").trim()&&r.source_reviewed===true,"조정 사유·근거 위치·원문 대조 확인이 필요합니다.");
    need(Array.isArray(r.direct)&&new Set(r.direct).size===r.direct.length&&r.direct.every(function(i){return Number.isInteger(i)&&t.snapshot.clauses.some(function(c){return c.index===i;});}),"조정 근거 조항을 확인하세요.");
    need(r.truth!=="not_applicable"||!r.direct.length,"비적용 판단에는 직접 근거를 연결하지 않습니다.");
  }
  function resolve(t,input){
    var g=consensus(t).find(function(x){return x.id===input.id;});need(g&&!g.agreement,"미해결 이견 항목만 조정할 수 있습니다. 기존 조정은 덮어쓰지 않습니다.");
    var r=Object.assign(clone(input),{seal:t.seal,review_digest:hash(t.reviews),saved_at:new Date().toISOString()});validateResolution(t,r);
    t.resolutions=t.resolutions||{};t.resolutions[r.id]=r;return t;
  }
  function truthDigest(t){return hash({reviews:t.reviews,resolutions:t.resolutions||{}});}
  function score(t,predictions){
    var gold=consensus(t),seen=new Set();
    need(predictions.length===gold.length,"예측 항목 수 불일치");
    predictions.forEach(function(p){need(gold.some(function(g){return g.id===p.id;})&&!seen.has(p.id),"예측 항목 중복/불일치");seen.add(p.id);
      need(typeof p.surfaced==="boolean"&&typeof p.auto_safe==="boolean","예측 형식 오류");});
    var out={selected:gold.length,agreed:0,conflicts:0,unknown:0,mapping_total:0,top1:0,top3:0,issues:0,missed:0,false_direct:0,
      auto_safe:0,false_safe:0,unsafe_unresolved:0,unmapped:t.snapshot.unmapped.length,scope:t.snapshot.scope,safety_proven:false,errors:[]};
    gold.forEach(function(g){var p=predictions.find(function(x){return x.id===g.id;});
      if(!g.agreement){out.conflicts++;out.errors.push({id:g.id,kind:"검수 이견 — 정답 미확정"});}else out.agreed++;
      if(g.truth==="unknown")out.unknown++;
      if(g.agreement&&g.truth!=="unknown"){
        if(g.direct.length){out.mapping_total++;if(g.direct.includes(p.top1))out.top1++;else out.errors.push({id:g.id,kind:"최상위 조항 오연결/미연결"});if((p.top3||[]).some(function(i){return g.direct.includes(i);}))out.top3++;}
        else if(p.top1!==null&&p.top1!==undefined){out.false_direct++;out.errors.push({id:g.id,kind:"직접 근거 없음인데 조항 연결"});}
        if(g.truth==="issue"){out.issues++;if(!p.surfaced){out.missed++;out.errors.push({id:g.id,kind:"문제 항목 비노출"});}}
      }
      if(p.auto_safe){out.auto_safe++;if(g.agreement&&g.truth==="issue")out.false_safe++;if(!g.agreement||g.truth==="unknown")out.unsafe_unresolved++;}
    });return out;
  }
  return {freeze:freeze,valid:valid,fresh:fresh,blind:blind,saveReview:saveReview,consensus:consensus,resolve:resolve,truthDigest:truthDigest,score:score,context:context};
})();
if(typeof module!=="undefined")module.exports=EvalTrial;
