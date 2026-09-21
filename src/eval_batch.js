"use strict";
var _BatchHash=typeof SafetyDigest!=="undefined"?SafetyDigest:require("./safety_digest");
var _BatchTrial=typeof EvalTrial!=="undefined"?EvalTrial:require("./eval_trial");
var _BatchHistory=typeof HistoryAssist!=="undefined"?HistoryAssist:require("./history_assist");
var EvalBatch=(function(){
  var MODES=["basic","tags","contract","legal","combined"];
  function hash(x){return _BatchHash.of(x);}
  function copy(x){return JSON.parse(JSON.stringify(x));}
  function need(ok,s){if(!ok)throw Error(s);}
  function date(s){return typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
  function family(s){return String(s||"").normalize("NFC").trim().replace(/\s+/g," ");}
  function body(t){return hash(t.snapshot.documents.filter(function(d){return d.role==="main";}).map(function(d){return d.text.normalize("NFC").replace(/\d+(?:[.,]\d+)*/g,"#").replace(/\s+/g,"");}));}
  function documents(k){return Object.keys(k.latest||{}).map(function(id){return k.documents[k.latest[id]];}).filter(Boolean);}
  function freeze(store,entries,metadata,knowledge,checks,engine,owner){
    need(String(owner||"").trim(),"평가 담당자를 입력하세요.");need(entries.length>=2,"서로 다른 평가 대상 2건 이상을 선택하세요.");
    var seen=new Set(),families=Object.create(null),sources=Object.create(null),bodies=Object.create(null),latestDev="",earliestTest="9999-99-99";
    var cases=entries.map(function(e){
      need(!seen.has(e.trial_id),"같은 평가 대상 중복 선택");seen.add(e.trial_id);
      var t=store.trials[e.trial_id],c=t&&store.cases[t.snapshot.case_key];_BatchTrial.fresh(t,c);_BatchTrial.consensus(t);
      need(t.snapshot.checks_digest===hash(checks),"체크 기준 변경 — 독립 검수부터 다시 확인하세요.");
      var f=family(e.family);need(f&&date(e.date)&&["development","test","adversarial"].includes(e.split),"계약 묶음·실제 계약 기준일·분할을 확인하세요.");
      need(!families[f]||families[f]===e.split,"같은 계약 묶음을 개발·시험·반례에 나눌 수 없습니다.");families[f]=e.split;
      var source=c.source.id,b=body(t);need(!sources[source]||sources[source]===f,"같은 원천의 버전은 같은 계약 묶음으로 지정하세요.");sources[source]=f;
      need(!bodies[b]||bodies[b]===f,"동일/숫자만 다른 본문은 같은 계약 묶음으로 지정하세요.");bodies[b]=f;
      if(e.split==="development"&&e.date>latestDev)latestDev=e.date;
      if(e.split==="test"&&e.date<earliestTest)earliestTest=e.date;
      return {trial:copy(t),source:copy(c.source),family:f,date:e.date,split:e.split,review_digest:_BatchTrial.truthDigest(t)};
    });
    need(!latestDev||latestDev<earliestTest,"개발 자료는 시험 자료보다 이전 날짜여야 합니다. 같은 날짜·미상 시점은 시험으로 분리하지 마세요.");
    var corpus=[],excluded=0,identities=Object.create(null);
    documents(knowledge).forEach(function(d){var m=metadata[d.source_id];
      if(!m||m.confirmed!==true){excluded++;return;}
      need(m.source_digest===hash(d),"참고자료 원천이 변경되었습니다. 실제 검토일·계열을 다시 확인하세요.");
      need(family(m.family)&&date(m.date),"참고자료의 계약 묶음·실제 검토일을 확인하세요.");
      var f=family(m.family),rid=d.review_id||(d.original&&d.original.review_id),identity=rid?"review:"+rid:"source:"+d.source_id;
      need(!identities[identity]||(identities[identity].family===f&&identities[identity].date===m.date),"같은 원천의 파생 참고자료에 서로 다른 묶음·날짜가 지정됐습니다.");identities[identity]={family:f,date:m.date};
      var own=cases.find(function(c){return c.source.review_id&&c.source.review_id===rid;});
      need(!own||own.family===f,"평가 계약과 연결된 태깅자료는 같은 묶음으로 지정하세요.");
      need(["contract_review","legal_review"].includes(d.source_kind),"참고자료 종류가 불명확합니다.");
      corpus.push(Object.assign(copy(d),{family_id:f,date:m.date}));
    });
    var snapshot={cases:cases,corpus:corpus,excluded_unconfirmed:excluded,knowledge_digest:hash(knowledge),checks_digest:hash(checks),engine:engine,owner:owner.trim(),
      protocol:"selected-check-history-ablation-v1",approval_eligible:false};
    var seal=hash(snapshot);return {id:"BATCH-"+seal.slice(0,24),snapshot:snapshot,seal:seal,runs:[],created_at:new Date().toISOString()};
  }
  function valid(b){need(b&&b.snapshot&&b.seal===hash(b.snapshot),"고정 평가묶음 변경 — 다시 고정하세요.");}
  function fresh(b,store,knowledge,checks,engine){valid(b);need(b.snapshot.engine===engine&&b.snapshot.checks_digest===hash(checks)&&b.snapshot.knowledge_digest===hash(knowledge),"엔진·체크·참고 DB 변경 — 새 평가묶음으로 비교하세요.");
    b.snapshot.cases.forEach(function(c){var t=store.trials[c.trial.id];need(t&&t.seal===c.trial.seal&&_BatchTrial.truthDigest(t)===c.review_digest,"독립 검수·조정 변경 — 평가묶음을 다시 고정하세요.");_BatchTrial.fresh(t,store.cases[t.snapshot.case_key]);});
  }
  function retrieve(b,c,mode){valid(b);need(MODES.includes(mode),"알 수 없는 비교 조건");if(mode==="basic"||mode==="tags")return [];
    var excluded=b.snapshot.cases.filter(function(x){return x.split!=="development";}).map(function(x){return x.family;}).concat(c.family);
    var ownIds=b.snapshot.cases.filter(function(x){return excluded.includes(x.family);}).flatMap(function(x){return [x.source.id,x.source.review_id].filter(Boolean);});
    var k={latest:{},documents:{}};b.snapshot.corpus.forEach(function(d,i){
      if(mode==="contract"&&d.source_kind!=="contract_review"||mode==="legal"&&d.source_kind!=="legal_review")return;
      // 같은 날짜도 선후를 알 수 없으므로 배제한다. 연결된 파생자료 역시 원천 ID로 배제한다.
      var rid=d.review_id||(d.original&&d.original.review_id);
      if(d.date>=c.date||ownIds.includes(rid))return;
      k.latest[i]=i;k.documents[i]=d;
    });
    return _BatchHistory.retrieve(k,c.source.title+" "+c.trial.snapshot.documents.map(function(d){return d.text;}).join(" "),c.source.department,
      {strictIsolation:true,asOf:c.date,excludeSourceIds:ownIds,excludeFamilyIds:excluded});
  }
  function score(b,mode,predictions){valid(b);need(MODES.includes(mode)&&predictions.length===b.snapshot.cases.length,"비교 조건·예측 수 불일치");
    var rows=b.snapshot.cases.map(function(c,i){need(predictions[i].trial_id===c.trial.id,"예측 순서/대상 불일치");return {trial_id:c.trial.id,title:c.source.title,family:c.family,split:c.split,metrics:_BatchTrial.score(c.trial,predictions[i].items),predictions:copy(predictions[i].items),sources:predictions[i].sources||[]};});
    var splits={};["development","test","adversarial"].forEach(function(split){var selected=rows.filter(function(r){return r.split===split;}),total={cases:selected.length,families:new Set(selected.map(function(r){return r.family;})).size};
      ["selected","agreed","conflicts","unknown","mapping_total","top1","top3","issues","missed","false_direct"].forEach(function(k){total[k]=selected.reduce(function(n,r){return n+r.metrics[k];},0);});splits[split]=total;
    });return {mode:mode,splits:splits,rows:rows,approval_eligible:false};
  }
  function compare(b,base,next){valid(b);var out={base:base.mode,next:next.mode,improved:[],regressed:[],new_misses:[]};
    b.snapshot.cases.forEach(function(c){var a=base.rows.find(function(r){return r.trial_id===c.trial.id;}),z=next.rows.find(function(r){return r.trial_id===c.trial.id;});need(a&&z,"동일 계약의 쌍대 비교 결과 필요");
      _BatchTrial.consensus(c.trial).forEach(function(g){if(!g.agreement||g.truth==="unknown")return;var p=a.predictions.find(function(x){return x.id===g.id;}),q=z.predictions.find(function(x){return x.id===g.id;});need(p&&q,"동일 체크 예측 필요");
        var row={trial_id:c.trial.id,title:c.source.title,id:g.id,split:c.split};if(g.direct.length){var before=g.direct.includes(p.top1),after=g.direct.includes(q.top1);if(!before&&after)out.improved.push(row);if(before&&!after)out.regressed.push(row);}
        if(g.truth==="issue"&&p.surfaced&&!q.surfaced)out.new_misses.push(row);
      });
    });return out;
  }
  return {MODES:MODES,freeze:freeze,valid:valid,fresh:fresh,retrieve:retrieve,score:score,compare:compare,documents:documents};
})();
if(typeof module!=="undefined")module.exports=EvalBatch;
