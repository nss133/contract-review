"use strict";
/* 폐쇄망 태깅자료를 질문별 후보로 색인한다. 검색 점수와 충족 판정은 분리한다. */
var DecisionReferences=(function(){
  var S=typeof Sim!=='undefined'?Sim:require('./sim');
  var D=typeof DecisionEvidence!=='undefined'?DecisionEvidence:require('./decision_evidence');
  var cache=new WeakMap(),fields=['topics','actions','objects','conditions'],QUERY_LIMIT=128,QUERY_CHARS=262144;
  // Worker sourceVersion changes rebuild HistoryAssist.combined (a new knowledge
  // object). Other callers mutating a snapshot in place must pass a new revision
  // or call invalidate; replacing knowledge.documents also invalidates the index.
  function invalidate(knowledge){if(knowledge&&typeof knowledge==='object')cache.delete(knowledge);}
  function index(knowledge,revision){
    if(!knowledge)return {rows:[],idf:{}};
    var old=cache.get(knowledge);if(old&&old.documents===knowledge.documents&&old.revision===revision)return old;
    var rows=Object.values(knowledge.documents||{}).map(function(doc){
      var evidence=doc.evidence||[],text=[doc.title,doc.request_context,evidence.map(function(e){return e.sentence||'';}).join(' '),(doc.tags||[]).map(function(t){return t.label||'';}).join(' ')].filter(Boolean).join(' ');
      return {doc:doc,text:text,tags:D.tags(text),check_ids:evidence.map(function(e){return e.check_id;}).filter(Boolean)};
    });
    var idf=S.buildIdf(rows.map(function(r){return r.text;})),byTag=new Map(),byCheck=new Map();
    function add(map,key,n){if(!map.has(key))map.set(key,[]);map.get(key).push(n);}
    rows.forEach(function(r,n){r.vector=S.tfidfVec(r.text,idf);r.words=S.keywords(r.text);r.wordCount=Object.keys(r.words).length;
      fields.forEach(function(f){new Set(r.tags[f]||[]).forEach(function(t){add(byTag,f+':'+t,n);});});
      new Set(r.check_ids).forEach(function(id){add(byCheck,id,n);});
    });
    var out={rows:rows,idf:idf,documents:knowledge.documents,revision:revision,byTag:byTag,byCheck:byCheck,queries:new Map(),queryChars:0};cache.set(knowledge,out);return out;
  }
  function copy(rows){return rows.map(function(r){return Object.assign({},r,{tag_hits:r.tag_hits.slice(),excerpts:r.excerpts.slice()});});}
  function remember(i,key,rows){
    if(key.length>QUERY_CHARS)return;
    while(i.queries.size>=QUERY_LIMIT||i.queryChars+key.length>QUERY_CHARS){var oldest=i.queries.keys().next().value;i.queryChars-=oldest.length;i.queries.delete(oldest);}
    i.queries.set(key,rows);i.queryChars+=key.length;
  }
  function retrieve(cp,documents,knowledge,revision){
    var i=index(knowledge,revision);if(!i.rows.length)return [];
    var b=D.bundle(cp,documents),text=cp.check+' '+b.evidence.map(function(e){return e.text;}).join(' '),key=JSON.stringify([cp.id,text]),cached=i.queries.get(key);
    if(cached){i.queries.delete(key);i.queries.set(key,cached);return copy(cached);}
    var tags=D.tags(text),hitsByRow=new Map(),linkedRows=new Set(i.byCheck.get(cp.id)||[]);
    // Match the old per-field/per-query-tag hit order, including duplicate query
    // tags. A row with fewer than two hits and no direct check link was always
    // filtered out, regardless of its similarity; it needs no vector scoring.
    fields.forEach(function(f){(tags[f]||[]).forEach(function(t){var label=f+':'+t;(i.byTag.get(label)||[]).forEach(function(n){if(!hitsByRow.has(n))hitsByRow.set(n,[]);hitsByRow.get(n).push(label);});});});
    var candidates=new Set(linkedRows);hitsByRow.forEach(function(hits,n){if(hits.length>=2)candidates.add(n);});
    var vector=S.tfidfVec(text,i.idf),words=S.keywords(text),wordKeys=Object.keys(words);
    // Ascending input positions preserve the exhaustive stable-sort tie order.
    var result=Array.from(candidates).sort(function(a,b){return a-b;}).map(function(n){var r=i.rows[n],hits=hitsByRow.get(n)||[],inter=0;
      wordKeys.forEach(function(w){if(r.words[w])inter++;});
      var jaccard=wordKeys.length&&r.wordCount?inter/(wordKeys.length+r.wordCount-inter):0;
      var linked=linkedRows.has(n),score=S.cosine(vector,r.vector)+jaccard*0.25+Math.min(0.25,hits.length*0.025)+(linked?1:0);
      return {source_id:r.doc.source_id,review_id:r.doc.review_id||'',kind:r.doc.source_kind||'tag_reference',title:r.doc.title||'',score:score,tag_hits:hits,
        linked_question:linked,reference_only:true,excerpts:(r.doc.evidence||[]).filter(function(e){return !e.check_id||e.check_id===cp.id;}).slice(0,2).map(function(e){return e.sentence;})};
    }).filter(function(r){return r.linked_question||r.tag_hits.length>=2&&r.score>0.1;}).sort(function(a,b){return b.score-a.score;}).slice(0,5);
    remember(i,key,result);return copy(result);
  }
  return {index:index,retrieve:retrieve,invalidate:invalidate};
})();
if(typeof module!=='undefined')module.exports=DecisionReferences;
