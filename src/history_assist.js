"use strict";
/* 과거 자료는 현재 문서의 직접 근거가 있는 후보만 보강한다. */
var _HistoryEvidence = typeof EvidenceRules !== "undefined" ? EvidenceRules :
  (typeof require !== "undefined" ? require("./evidence_rules") : null);
var HistoryAssist = (function () {
  var contentCache=new WeakMap(),sentenceCache=new WeakMap();
  function same(a,b){return a.length===b.length&&a.every(function(v,i){return v===b[i];});}
  // 문서 뷰를 새로 만들어도 원래 문서의 색인을 공유한다. 같은 객체의 문장/태그 수정도 검사한다.
  function contentProfile(doc){
    var values=[doc.request_title||doc.title,doc.request_context],evidence=doc.evidence||[],tags=doc.tags||[];
    values.push(evidence.length);evidence.forEach(function(e){values.push(e.sentence);});
    values.push(tags.length);tags.forEach(function(t){values.push(t.type,t.label);});
    var cacheable=doc&&typeof doc==='object',old=cacheable&&contentCache.get(doc);if(old&&same(old.values,values))return old;
    var words=contentTerms(doc),value={values:values,words:words,set:new Set(words)};if(cacheable)contentCache.set(doc,value);return value;
  }
  function parsedSentences(owner,name,text){
    var cacheable=owner&&typeof owner==='object',old=cacheable&&sentenceCache.get(owner);if(old&&old.name===name&&old.text===text)return old.value;
    var value=_HistoryEvidence.sentences([{name:name,text:text}]);if(cacheable)sentenceCache.set(owner,{name:name,text:text,value:value});return value;
  }
  function opinionEvidence(text){return String(text||"").split(/\n+|(?<=[.!?。])\s+/).map(function(s){return s.trim();}).filter(Boolean).map(function(s){return {source:"계약검토 결과 (과거 의견, 본건 근거 아님)",sentence:s,evidence_kind:"review_opinion"};});}
  function humanJudgment(v,s){return v&&(v.origin==='manual'||
    ((!v.origin||v.origin==='legacy')&&s.source_binding&&s.source_binding.kind==='human_confirmed_legacy_binding'));}
  function combined(knowledge,history,corpus,options) {
    var out={latest:{},documents:{},tags:knowledge&&knowledge.tags||{}},linked={};
    Object.keys((knowledge||{}).latest||{}).forEach(function(id){
      var d=knowledge.documents[knowledge.latest[id]];if(!d)return;
      var reviewId=d.original&&d.original.review_id;
      var copy=Object.assign({},d,{source_kind:reviewId?"contract_review":"legal_review",review_id:reviewId||""});
      var record=reviewId&&history&&history.latest&&history.records[history.latest[reviewId]];
      if(record){var seenSentences=new Set();copy.evidence=(d.evidence||[]).concat(opinionEvidence((record.result||{}).review_text)).filter(function(e){if(seenSentences.has(e.sentence))return false;seenSentences.add(e.sentence);return true;});}
      out.latest["tag:"+id]="tag:"+id;out.documents["tag:"+id]=copy;
      if(reviewId)linked[reviewId]=true;
    });
    Object.keys((history||{}).latest||{}).forEach(function(id){
      if(linked[id])return;
      var r=history.records[history.latest[id]];if(!r)return;
      var req=r.request||{},res=r.result||{},key="contract:"+id;
      out.latest[key]=key;
      out.documents[key]={source_id:key,review_id:id,source_kind:"contract_review",title:req.contract_name||res.contract_name||"",
        request_title:req.contract_name||res.contract_name||"",request_context:req.context||"",department:req.department||res.department||"",
        date:res.created_at||req.created_at||"",family_id:r.family_id||"",tags:r.tags||[],
        evidence:opinionEvidence(res.review_text),
        original:{request:req,result:res,conflicts:r.conflicts||[],review_id:id},
        evidence_limit:"과거 검토의견은 검색·쟁점 연결 보조일 뿐 본건의 직접 근거나 안전 정답이 아닙니다."};
    });
    var records=corpus&&corpus.judgment_ledger&&corpus.judgment_ledger.records||{};
    var own=options&&records[options.excludeContractHash],excludedReview=options&&options.excludeReviewId||
      own&&own.snapshot&&own.snapshot.history_reference&&own.snapshot.history_reference.review_id;
    if(excludedReview)Object.keys(out.latest).forEach(function(k){
      var docKey=out.latest[k];if(out.documents[docKey].review_id===excludedReview){delete out.documents[docKey];delete out.latest[k];}
    });
    var documentByReview=new Map();Object.keys(out.documents).forEach(function(k){var id=out.documents[k].review_id;if(id&&!documentByReview.has(id))documentByReview.set(id,k);});
    Object.keys(records).forEach(function(hash){
      var rec=records[hash],s=rec.snapshot||{},meta=s.meta||{};
      var effectiveDate=[meta.date||'',s.source_binding&&s.source_binding.date||''].sort().pop();
      if(rec.pending||(options&&options.excludeContractHash===hash))return;
      var id=s.history_reference&&s.history_reference.review_id;
      if(id&&id===excludedReview)return;
      if(!Object.keys(s.verdicts||{}).some(function(cpId){var v=s.verdicts[cpId],t=rec.tags&&rec.tags[cpId];
        return humanJudgment(v,s)&&t&&t.reason_kind!=='risk_accepted'&&String(v.comment||'').trim();}))return;
      var key=id&&documentByReview.get(id);
      if(!key){key='corpus:'+hash;out.latest[key]=key;out.documents[key]={source_id:key,source_kind:'contract_review',
        contract_hash:hash,review_id:id||'',title:'누적 계약검토',tags:[],evidence:[],date:effectiveDate,family_id:meta.family_id||''};if(id)documentByReview.set(id,key);}
      var doc=out.documents[key];doc.evidence=(doc.evidence||[]).slice();doc.tags=(doc.tags||[]).slice();
      Object.keys(s.verdicts||{}).forEach(function(cpId){
        var v=s.verdicts[cpId],t=rec.tags&&rec.tags[cpId];
        // 시스템 출력·위험 수용은 매핑 가산 근거로 재생산하지 않는다.
        if(!humanJudgment(v,s)||!t||t.reason_kind==='risk_accepted'||!String(v.comment||'').trim())return;
        var sentence=String(v.comment).trim();
        if(!doc.evidence.some(function(e){return e.check_id===cpId&&e.sentence===sentence;}))
          doc.evidence.push({source:'사용자 확정 코퍼스 의견 (본건 직접 근거 아님)',sentence:sentence,
            evidence_kind:'judgment_opinion',check_id:cpId,contract_hash:hash,date:effectiveDate,verdict:v.verdict,
            reason_kind:t.reason_kind,reviewer:meta.reviewer||''});
        (t.topics||[]).forEach(function(topic){
          if(!doc.tags.some(function(tag){return tag.type==='judgment_topic'&&tag.label===topic;}))
            doc.tags.push({type:'judgment_topic',label:topic});
        });
      });
      // 새 의견을 과거 날짜의 자료로 시험 검색에 노출하지 않는다.
      doc.date=doc.date&&effectiveDate?([doc.date,effectiveDate].sort().pop()):'';
    });
    // 자료가 바뀌어 combined가 재생성될 때만 검색용 단어를 계산한다.
    var index={};Object.keys(out.latest).forEach(function(id){var key=out.latest[id];index[key]=contentProfile(out.documents[key]).words;});
    Object.defineProperty(out,'search_index',{value:index,enumerable:false});
    return out;
  }
  function terms(value) {
    return Array.from(new Set(String(value || "").normalize("NFC").toLowerCase()
      .match(/[가-힣a-z0-9]{2,}/g) || [])).filter(function (s) {
      return !/^(계약|계약서|업무|검토|관련|사항|정보|회사|대한|위한|한다|있다)$/.test(s);
    });
  }
  function retrieve(knowledge, input, department, options) {
    var opts = options || {};
    var query = terms(input), out = [];
    if (!knowledge || !query.length) return out;
    Object.keys(knowledge.latest || {}).forEach(function (id) {
      var docKey=knowledge.latest[id],doc = knowledge.documents[docKey];
      if (!doc) return;
      var original=doc,metadata = (opts.familyMap || {})[doc.source_id];
      if (metadata) doc = Object.assign({}, doc, { family_id: metadata.family_id, date: metadata.date });
      if ((opts.excludeSourceIds || []).indexOf(doc.source_id) !== -1 ||
          (doc.review_id && (opts.excludeSourceIds || []).indexOf(doc.review_id) !== -1) ||
          (opts.excludeFamilyIds || []).indexOf(doc.family_id) !== -1) return;
      if (opts.strictIsolation && (!doc.family_id || !/^\d{4}-\d{2}-\d{2}/.test(doc.date || ""))) return;
      if (opts.asOf && (!doc.date || String(doc.date).slice(0, 10) > opts.asOf)) return;
      var profile=contentProfile(original),content=profile.words;
      var hits = query.filter(function (word) { return profile.set.has(word); });
      if (hits.length < 2) return;
      var semantic = hits.length / Math.sqrt(Math.max(1, query.length * content.length));
      out.push({ doc: doc, hits: hits, score: semantic +
        (department && department === doc.department ? Math.min(0.02, semantic * 0.05) : 0) });
    });
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 8);
  }
  function contentTerms(doc){
    return terms([doc.request_title||doc.title,doc.request_context,(doc.evidence||[]).map(function(e){return e.sentence;}).join(' '),
      (doc.tags||[]).filter(function(t){return !/부서|유형|결론|효과|department|case_type/.test(t.type);}).map(function(t){return t.label;}).join(' ')].join(' '));
  }
  function rankTypes(ranked, related, types, classify) {
    var votes = {};
    related.forEach(function (item) {
      if(item.doc.original && (item.doc.original.conflicts||[]).indexOf("contract_name")!==-1)return;
      // 원본 부서별 유형을 정답으로 학습하지 않는다.
      var inferred = classify(item.doc.request_context || "", types, item.doc.request_title || item.doc.title || "", "");
      if (!inferred[0] || !inferred[0].titleHit) return;
      var id = inferred[0].typeId;
      votes[id] = (votes[id] || 0) + item.score;
    });
    var protectedTitle = ranked[0] && ranked[0].titleHit;
    return ranked.map(function (r) {
      var bonus = !protectedTitle && r.score > 0 && r.hits.length ? Math.min(2, votes[r.typeId] || 0) : 0;
      return Object.assign({}, r, { score: r.score + bonus, baseScore: r.score, historyBonus: bonus });
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function clauseSupport(related, check, clause) {
    if(!related.length)return {bonus:0,terms:[],sources:[],evidence:[],conflicts:[]};
    var required = terms((check.triggers && check.triggers.keywords || []).join(" "));
    var body = String(clause.body || "");
    var hits = [], sources = [], evidence = [], conflicts = [];
    var current = parsedSentences(clause,"본건",body);
    related.forEach(function (item) {
      (item.doc.evidence || []).forEach(function (e) {
        if(e.check_id&&e.check_id!==check.id)return;
        parsedSentences(e,item.doc.source_id,e.sentence||"").forEach(function (prior) {
          current.forEach(function (now) {
            var common = required.filter(function (word) { return now.text.indexOf(word) !== -1 && prior.text.indexOf(word) !== -1; });
            if (common.length < 2) return; // 서로 다른 과거문장의 단어를 합쳐 가산하지 않는다.
            var actor = function (s) { var m = s.match(/(?:^|\s|["“])(갑|을|위탁자|수탁자|임대인|임차인)["”]?\s*[은는이가]\s/); return m && m[1]; };
            var differentActor = actor(now.text) && actor(prior.text) && actor(now.text) !== actor(prior.text);
            var differentTime = (/사전/.test(now.text) && /사후/.test(prior.text)) || (/사후/.test(now.text) && /사전/.test(prior.text));
            var opposite = now.direction !== "unknown" && prior.direction !== "unknown" && now.direction !== prior.direction;
            if (differentActor || differentTime || opposite || now.exception || prior.exception) {
              conflicts.push({ source_id: item.doc.source_id, current: now.text, prior: prior.text,
                actor: !!differentActor, timing: differentTime, direction: opposite }); return;
            }
            common.forEach(function (word) { if (hits.indexOf(word) === -1) hits.push(word); });
            if (sources.indexOf(item.doc.source_id) === -1) sources.push(item.doc.source_id);
            evidence.push({ source_id: item.doc.source_id, family_id: item.doc.family_id || "", date: item.doc.date || "", source_kind:item.doc.source_kind||"",evidence_kind:e.evidence_kind||"tag_reference",source_label:e.source||"",
              sentence: prior.text, current: now.text, terms: common });
          });
        });
      });
    });
    return { bonus: evidence.length && !conflicts.length ? Math.min(3, hits.length) : 0,
      terms: hits, sources: sources, evidence: evidence, conflicts: conflicts };
  }
  return { combined:combined, retrieve: retrieve, rankTypes: rankTypes, clauseSupport: clauseSupport };
})();
if (typeof module !== "undefined") module.exports = HistoryAssist;
