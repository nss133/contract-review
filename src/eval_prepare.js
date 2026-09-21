"use strict";
var _PrepDigest=typeof SafetyDigest!=="undefined"?SafetyDigest:require("./safety_digest");
var EvalPrepare=(function(){
  function empty(){return {format:"cr-evaluation-preparation-v1",cases:{}};}
  function text(x){return String(x||"").trim();}
  function splitOpinion(opinion,source){
    return text(opinion).split(/\n+|(?<=[.!?。])\s+/).map(text).filter(Boolean).map(function(quote,i){
      var safe=/이상\s*없|문제\s*없|수정\s*불필요/.test(quote);
      var issue=/수정\s*(필요|요청)|보완\s*(필요|요청)|삭제\s*(필요|요청)|추가\s*(필요|요청)|과도|불리|미흡/.test(quote);
      var uncertain=/경우|다면|여부|다만|단,|아니|없지|없다고|없다는|불필요하지/.test(quote)||/다만|단,|예외/.test(opinion);
      return {id:_PrepDigest.of([source,i,quote]),quote:quote,source:source,
        suggestion:!uncertain&&safe!==issue?(issue?"issue":"safe"):"unknown",truth:"",check_id:"",evidence:"",reason:"",status:"draft"};
    });
  }
  function sources(history,knowledge){
    var out=[];
    Object.keys((history||{}).latest||{}).forEach(function(id){
      var r=history.records[history.latest[id]];if(!r)return;
      var q=r.request||{},a=r.result||{};
      out.push({id:"contract:"+id,kind:"contract",title:a.contract_name||q.contract_name||id,
        department:a.department||q.department||"",tags:r.tags||[],revision:r.fingerprint||history.latest[id],
        opinion:text(a.review_text),references:[q.contract_attachment,q.related_attachments,a.attachments].filter(Boolean),
        review_id:id,conflicts:r.conflicts||[]});
    });
    Object.keys((knowledge||{}).latest||{}).forEach(function(id){
      var d=knowledge.documents[knowledge.latest[id]];if(!d)return;
      var linked=d.original&&d.original.review_id, result=d.original&&d.original.result;
      // 같은 원천이라는 명시적 ID가 있을 때만 중복을 묶는다. 추정 병합하지 않는다.
      var existing=linked&&out.find(function(c){return c.review_id===linked;});
      var evidence=(d.evidence||[]).map(function(e){return {source:e.source||"출처 미상",quote:e.sentence||""};});
      if(existing){existing.tags=existing.tags.concat(d.tags||[]);existing.support=evidence;existing.revision=_PrepDigest.of([existing.revision,d.fingerprint||knowledge.latest[id]]);return;}
      out.push({id:"legal:"+id,kind:"legal",title:d.title||d.request_title||id,department:d.department||"",tags:d.tags||[],
        revision:d.fingerprint||knowledge.latest[id],opinion:text(result&&result.review_text),references:[],support:evidence,conflicts:[]});
    });
    return out;
  }
  function prepare(store,history,knowledge){
    var next=JSON.parse(JSON.stringify(store||empty())), active=[];
    sources(history,knowledge).forEach(function(s){
      var key=_PrepDigest.of([s.id,s.revision]);active.push(key);
      if(next.cases[key])return;
      next.cases[key]={key:key,source:s,internal_id:"CASE-"+key.slice(0,12),version:"unknown",documents:[],
        items:splitOpinion(s.opinion,s.id),status:"preparing",created_at:new Date().toISOString()};
    });
    next.active=Array.from(new Set(active.concat(Object.keys(next.cases).filter(function(k){return !!next.cases[k].source.incident_id;}))));return next;
  }
  function candidates(item,checks){
    return checks.map(function(cp){var hits=(cp.triggers&&cp.triggers.keywords||[]).filter(function(w){return w.length>=2&&item.quote.includes(w);});
      return {id:cp.id,label:cp.label||cp.check,score:hits.length,terms:hits};
    }).filter(function(r){return r.score>0;}).sort(function(a,b){return b.score-a.score;}).slice(0,5);
  }
  function confirm(c,item,answer){
    if(!text(answer.reviewer))throw Error("확인자 이름을 입력하세요.");
    if(!text(answer.reason)||!text(answer.evidence))throw Error("판단 이유와 원본 근거 위치를 입력하세요.");
    if(["safe","issue","unknown","not_applicable"].indexOf(answer.truth)===-1)throw Error("판단을 선택하세요.");
    if(c.source.kind==="contract"&&answer.truth!=="unknown"){
      if(!c.documents.some(function(d){return d.role==="main"&&text(d.text);}))throw Error("이 계약의 본문 파일을 추가하세요.");
      if(c.version==="unknown"||!answer.source_confirmed)throw Error("문서 버전과 본문·별첨 연결을 확인하세요.");
      if(!text(answer.check_id))throw Error("대응 체크 또는 ‘기존 체크에 없는 쟁점’을 선택하세요.");
    }
    Object.assign(item,answer,{status:answer.truth==="unknown"?"held":c.source.kind==="legal"?"reference_checked":"reviewed_draft",
      context_digest:_PrepDigest.of([c.version,c.documents]),checked_at:new Date().toISOString(),independent:false});
    // 과거 판단을 본 담당자의 확인은 독립 정답 검수로 위장하지 않는다.
    return item;
  }
  function invalidate(c){c.items.forEach(function(i){if(i.status!=="draft"){i.status="recheck";}});}
  function restore(store,input){
    if(!input||input.format!==empty().format||!input.cases||Array.isArray(input.cases))throw Error("평가 준비 백업 형식이 아닙니다.");
    var next=JSON.parse(JSON.stringify(store)),added=[];
    Object.keys(input.cases).forEach(function(key){
      var c=input.cases[key];
      if(!/^[a-f0-9]{64}$/.test(key)||!c||c.key!==key||!c.source||!["contract","legal"].includes(c.source.kind)||
        typeof c.source.title!=="string"||typeof c.source.id!=="string"||!Array.isArray(c.source.tags)||!Array.isArray(c.source.references)||!Array.isArray(c.source.conflicts)||
        !Array.isArray(c.documents)||!Array.isArray(c.items)||!["before","after","unknown"].includes(c.version))throw Error("손상된 후보 구조");
      c.items.forEach(function(i){if(!i||typeof i.id!=="string"||typeof i.quote!=="string")throw Error("손상된 판단 구조");});
      c.documents.forEach(function(d){if(!d||typeof d.name!=="string"||typeof d.text!=="string"||!["main","attachment"].includes(d.role))throw Error("손상된 원문 구조");});
      // 충돌하는 작업은 덮어쓰지 않는다. 동일 원천의 기존 로컬 작업이 우선이다.
      if(next.cases[key])return;
      next.cases[key]=JSON.parse(JSON.stringify(c));invalidate(next.cases[key]);added.push(key);
    });
    if(input.trials){
      next.trials=next.trials||{};
      Object.keys(input.trials).forEach(function(id){var t=input.trials[id];
        if(!/^TRIAL-[a-f0-9]{24}$/.test(id)||!t||t.id!==id||!t.snapshot||t.seal!==_PrepDigest.of(t.snapshot)||!Array.isArray(t.reviews)||!Array.isArray(t.runs))throw Error("손상된 독립 검수 기록");
        if(!next.trials[id])next.trials[id]=JSON.parse(JSON.stringify(t));
      });
    }
    if(input.batches){
      next.batches=next.batches||{};
      Object.keys(input.batches).forEach(function(id){var b=input.batches[id];
        if(!/^BATCH-[a-f0-9]{24}$/.test(id)||!b||b.id!==id||!b.snapshot||b.seal!==_PrepDigest.of(b.snapshot)||!Array.isArray(b.snapshot.cases)||!Array.isArray(b.runs))throw Error("손상된 다계약 비교 기록");
        if(!next.batches[id])next.batches[id]=JSON.parse(JSON.stringify(b));
      });
    }
    ['operational_sets','incidents'].forEach(function(kind){if(input[kind]){next[kind]=next[kind]||{};Object.keys(input[kind]).forEach(function(id){var v=input[kind][id];
      if(kind==='operational_sets'){var raw=JSON.parse(JSON.stringify(v));delete raw.seal;if(!v||v.format!=='cr-safety-dataset-v1'||v.id!==id||!Array.isArray(v.cases)||v.seal!==_PrepDigest.of(raw))throw Error('손상된 승인용 시험셋');}
      else if(!v||!v.event||v.event.id!==id||!v.packet||!Array.isArray(v.packet.documents)||!v.packet.documents.every(function(d){return d&&typeof d.name==='string'&&typeof d.text==='string';}))throw Error('손상된 오판 신고 기록');
      if(!Object.prototype.hasOwnProperty.call(next[kind],id))next[kind][id]=JSON.parse(JSON.stringify(v));});}});
    // 복구한 입력은 편의용 초안일 뿐 검증·승인을 승계하지 않는다.
    if(!next.batch_settings&&input.batch_settings&&Array.isArray(input.batch_settings.entries)&&input.batch_settings.metadata)next.batch_settings=JSON.parse(JSON.stringify(input.batch_settings));
    next.active=Array.from(new Set((next.active||[]).concat(added)));return next;
  }
  function corpusReadiness(corpus,checks){
    var lookup={};(checks||[]).forEach(function(cp){lookup[cp.id]=cp;});
    var rows=[],excluded=0;
    Object.keys(corpus&&corpus.byCheck||{}).forEach(function(id){
      if(!lookup[id]){excluded++;return;}
      var slot=corpus.byCheck[id],p=slot.system_verdict_pairs||{},counts=slot.counts||{};
      var weak=(p['possible_evidence::이상없음']||0)+(p['evidence_not_found::이상없음']||0)+(p['not_surfaced::이상없음']||0);
      if(weak||(counts['검토의견']||0))rows.push({check_id:id,label:lookup[id].label||lookup[id].check||id,
        weak_safe:weak,issue:counts['검토의견']||0,safe:counts['이상없음']||0,
        status:counts['검토의견']?'과거 보완 의견 확인':'보류 개선 후보'});
    });
    rows.sort(function(a,b){return b.weak_safe-a.weak_safe||b.issue-a.issue||a.check_id.localeCompare(b.check_id);});
    var records=corpus&&corpus.judgment_ledger&&corpus.judgment_ledger.records||{};
    return {rows:rows,excluded_checks:excluded,contracts:corpus&&corpus.meta&&corpus.meta.contract_count||0,
      recorded_contracts:Object.keys(records).length,linked_reviews:Object.keys(records).filter(function(k){
        var r=records[k];return !r.pending&&r.snapshot&&r.snapshot.history_reference&&r.snapshot.history_reference.review_id;
      }).length,replayed_cases:0};
  }
  function compareCurrent(corpus,input){
    var rec=corpus&&corpus.judgment_ledger&&corpus.judgment_ledger.records[input.contract_hash];
    var out={status:'unlinked',rows:[],mapping:{reviewed:0,before_correct:0,after_correct:0},replayed:false,
      warning:'자동판정 정확도나 독립 시험 성적이 아닌 같은 계약의 과거 확정판정 기준 매핑 비교입니다.'};
    if(!rec||rec.pending)return out;
    var s=rec.snapshot||{},old=s.comparison_context,now=input.comparison_context;
    if(!old||!now||old.version!==now.version||old.documents!==now.documents||old.context!==now.context){out.status='source_mismatch';return out;}
    var before={},after={};(input.before||[]).forEach(function(r){before[r.cpId]=r;});(input.after||[]).forEach(function(r){after[r.cpId]=r;});
    Object.keys(s.verdicts||{}).forEach(function(id){
      var v=s.verdicts[id],legacyConfirmed=s.source_binding&&s.source_binding.kind==='human_confirmed_legacy_binding'&&
        (!v||!v.origin||v.origin==='legacy');
      if(!v||v.origin!=='manual'&&!legacyConfirmed||v.needs_reconfirmation||!v.verdict)return;
      if(!old.checks||!now.checks||!old.checks[id]||old.checks[id]!==now.checks[id])return;
      var b=before[id]||{},a=after[id]||{},ob=s.matching_observations&&s.matching_observations.items&&s.matching_observations.items[id];
      var gold=!(s.source_binding&&s.source_binding.mapping_confirmed===false)&&old.clauses===now.clauses&&ob&&['confirmed_match','reassigned'].indexOf(ob.human_evidence_source)!==-1&&
        Number.isInteger(ob.human_clause_index)&&ob.human_clause_index>=0?ob.human_clause_index:null;
      var row={check_id:id,verdict:v.verdict,reason:v.reason||'',before:b.coverage||'not_selected',after:a.coverage||'not_selected',
        before_clause:b.best?b.best.clauseIndex:null,after_clause:a.best?a.best.clauseIndex:null,human_clause:gold,
        annex_found:!!(input.subCoverage&&input.subCoverage[id])};
      if(gold!==null){out.mapping.reviewed++;if(row.before_clause===gold)out.mapping.before_correct++;if(row.after_clause===gold)out.mapping.after_correct++;}
      row.needs_attention=v.verdict==='검토의견'&&['addressed','verify','consider','base_covered'].indexOf(row.after)===-1||
        gold!==null&&row.after_clause!==gold;
      out.rows.push(row);
    });
    out.rows.sort(function(a,b){return Number(b.needs_attention)-Number(a.needs_attention);});
    out.status=out.rows.length?'compared':'no_comparable_labels';out.replayed=true;return out;
  }
  return {empty:empty,sources:sources,prepare:prepare,candidates:candidates,confirm:confirm,invalidate:invalidate,splitOpinion:splitOpinion,restore:restore,corpusReadiness:corpusReadiness,compareCurrent:compareCurrent};
})();
if(typeof module!=="undefined")module.exports=EvalPrepare;
