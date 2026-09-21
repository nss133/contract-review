"use strict";
/* 누적 의견은 검색 단서다. 결과 태그를 현재 약정의 존재·정답으로 바꾸지 않는다. */
var JudgmentHints=(function(){
  var T=typeof ContractTags!=='undefined'?ContractTags:require('./contract_tags');
  var L=typeof Loop!=='undefined'?Loop:require('./loop');
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  var S=typeof segmentContract!=='undefined'?segmentContract:require('./segmenter').segmentContract;
  var last=null,builds=0,tagCache=new Map(),currentCache=new WeakMap(),queryCache=new WeakMap(),phraseCache=new WeakMap(),phraseGroups=new Map(),rowCache=new WeakMap(),matchCache=new WeakMap();
  function same(a,b){return a.length===b.length&&a.every(function(v,i){return v===b[i];});}
  function compact(s){return String(s||'').normalize('NFC').replace(/\s+/g,'').toLowerCase();}
  function content(text){text=String(text||'');if(tagCache.has(text))return tagCache.get(text);
    var tagged=L.judgmentTags({comment:text}),value=tagged.facets||T.values(T.analyzeClause({heading:'',body:text},''));
    value.judgment_topics=tagged.topics;
    tagCache.set(text,value);if(tagCache.size>5000)tagCache.delete(tagCache.keys().next().value);return value;
  }
  function tagVerdict(v){var tags=L.judgmentTags(v||{});return {version:'judgment-hints-v1',
    content_tags:content(v?.comment||''),result_tags:{verdict:tags.verdict,reason_kind:tags.reason_kind,origin:tags.origin,human_confirmed:tags.human_confirmed},
    reference_only:true,auto_approval:false};}
  function phrases(text){var out=[],seen=new Set();
    function add(s){s=String(s||'').trim();var key=compact(s);if(key.length<6||key.length>300||seen.has(key)||/^(?:이상없음|특이사항없음|문제없음|반영되어있음|검토의견없음|확인하였음|계약서확인함)$/.test(key))return;seen.add(key);out.push({text:s,key:key});}
    text=String(text||'');var quoted=/[“「"‘']([^”」"’'\n]{6,500})[”」"’']/g,quote;
    while(out.length<100&&(quote=quoted.exec(text)))add(quote[1]);
    var sentences=out.length<100?text.split(/[\n;。]+/):[];
    for(var si=0;si<sentences.length&&out.length<100;si++){var s=sentences[si];add(s);var tokens=s.split(/\s+/).filter(Boolean);
      // 부분 일치는 그대로 등장한 연속 표현만 사용한다. 단어의 부정·조건을 치환하지 않는다.
      if(tokens.length>2)for(var n=2;n<=Math.min(5,tokens.length)&&out.length<100;n++)for(var i=0;i+n<=tokens.length&&out.length<100;i++)add(tokens.slice(i,i+n).join(' '));
    }return out;
  }
  function lazyPhrases(row){var text,value,assigned=false;
    Object.defineProperty(row,'phrases',{enumerable:true,configurable:true,get:function(){
      if(!assigned&&(value===undefined||text!==row.text)){text=row.text;value=phrases(text);}return value;
    },set:function(next){value=next;assigned=true;}});return row;
  }
  function revision(x){return x?.revision||x?.meta?.updated_at||x?.meta?.updated||x?.meta?.version||'';}
  function sourceState(knowledge,corpus,packets){
    var out=[];function verdict(v){out.push(v.comment,v.verdict,v.reason,v.origin,!!v.auto_proof,!!v.needs_reconfirmation);}
    Object.keys(corpus?.judgment_ledger?.records||{}).forEach(function(hash){var r=corpus.judgment_ledger.records[hash],s=r.snapshot||{};out.push('record',hash,!!r.pending,s.meta?.title,s.meta?.department);
      Object.keys(s.verdicts||{}).forEach(function(id){out.push(id);verdict(s.verdicts[id]);});});
    Object.keys(corpus?.byCheck||{}).forEach(function(id){out.push('aggregate',id);(corpus.byCheck[id].comments||[]).forEach(function(v){out.push(v.text,v.verdict,v.count);});});
    (packets||[]).forEach(function(p){out.push('packet',p.id,!!p.pending,p.documents?.[0]?.name,!!p.documents?.some(function(d){return d.text;}));Object.keys(p.verdicts||{}).forEach(function(id){out.push(id);verdict(p.verdicts[id]);});});
    var latest=knowledge?.latest||{},keys=Object.keys(latest),docs=keys.length?keys.map(function(k){out.push('latest',k,latest[k]);return knowledge.documents?.[latest[k]];}):Object.values(knowledge?.documents||{});
    docs.filter(Boolean).forEach(function(d){out.push('doc',d.source_id,d.source_kind,d.title,d.department);(d.evidence||[]).forEach(function(e){out.push(e.check_id,e.tag_id,e.sentence);});});return out;
  }
  function isCurrent(value,input){input=input||{};
    return !!(last&&last.value===value&&last.knowledge===(input.knowledge||null)&&last.corpus===(input.corpus||null)&&last.packets===(input.packets||null)&&
      last.revision===[revision(input.knowledge),revision(input.corpus),input.packet_revision||''].join('|')&&same(last.snapshot,sourceState(input.knowledge,input.corpus,input.packets)));
  }
  function index(input){input=input||{};var knowledge=input.knowledge||null,corpus=input.corpus||null,packets=input.packets||null;
    var rev=[revision(knowledge),revision(corpus),input.packet_revision||''].join('|'),snapshot=sourceState(knowledge,corpus,packets);
    if(last&&last.knowledge===knowledge&&last.corpus===corpus&&last.packets===packets&&last.revision===rev&&same(last.snapshot,snapshot))return last.value;
    var rows=[],seen=new Set(),stats={individual:0,aggregate:0,tag_documents:0,excluded_system:0};
    function add(source,text,v,rawLinked){
      if(!String(text||'').trim())return;
      if(v&&(v.origin==='auto'||v.origin==='llm_draft'||v.auto_proof)){stats.excluded_system++;return;}
      var key=source.id+'|'+source.check_id+'|'+text;if(seen.has(key))return;seen.add(key);
      var tagged=tagVerdict(v||{comment:text,origin:'legacy'});
      rows.push(lazyPhrases(Object.assign({},source,{text:String(text),content_tags:content(text),result_tags:tagged.result_tags,
        reference_only:true,auto_approval:false,raw_linked:!!rawLinked,evaluable:false})));
    }
    Object.keys(corpus?.judgment_ledger?.records||{}).forEach(function(hash){var rec=corpus.judgment_ledger.records[hash],snap=rec.snapshot||{};
      Object.keys(snap.verdicts||{}).forEach(function(id){var v=snap.verdicts[id];stats.individual++;
        add({id:'corpus:'+hash+':'+id,check_id:id,kind:'corpus_judgment',title:snap.meta?.title||'누적 사용자 검토',department:snap.meta?.department||'',pending:!!rec.pending||!!v.needs_reconfirmation},v.comment,v,false);
      });
    });
    Object.keys(corpus?.byCheck||{}).forEach(function(id){(corpus.byCheck[id].comments||[]).forEach(function(cm,n){stats.aggregate++;
      add({id:'aggregate:'+id+':'+n,check_id:id,kind:'aggregate_comment',title:'과거 집계 의견',count:cm.count||0},cm.text,{verdict:cm.verdict,comment:cm.text,origin:'legacy'},false);
    });});
    (packets||[]).forEach(function(p){Object.keys(p.verdicts||{}).forEach(function(id){var v=p.verdicts[id];
      add({id:'packet:'+p.id+':'+id,check_id:id,kind:'review_packet',title:p.documents?.[0]?.name||'검토 원문',pending:!!p.pending||!!v.needs_reconfirmation},v.comment,v,!!p.documents?.some(function(d){return d.text;}));
    });});
    var latest=knowledge?.latest||{},documents=Object.keys(latest).length?Object.values(latest).map(function(id){return knowledge.documents?.[id];}).filter(Boolean):Object.values(knowledge?.documents||{});
    documents.forEach(function(d){stats.tag_documents++;(d.evidence||[]).forEach(function(e,n){
      add({id:'tag:'+d.source_id+':'+n,check_id:e.check_id||'',kind:d.source_kind||'tag_reference',title:d.title||'',department:d.department||'',tag_id:e.tag_id||''},e.sentence,null,false);
    });});
    var byCheck={},byTopic={};rows.forEach(function(row){if(row.check_id)(byCheck[row.check_id]||(byCheck[row.check_id]=[])).push(row);
      topicKeys(row.content_tags).forEach(function(t){(byTopic[t]||(byTopic[t]=[])).push(row);});});
    var value={version:'judgment-hints-v1',revision:H.of([rev,rows.map(function(r){return [r.id,r.text];})]),rows:rows,by_check:byCheck,by_topic:byTopic,stats:stats,
      // 명시적으로 적재된 동의어만 원래 지식에서 유지. 의견의 공동 출현으로 새 동치를 발명하지 않는다.
      knowledge:knowledge||{tags:{}}};
    builds++;last={knowledge:knowledge,corpus:corpus,packets:packets,revision:rev,snapshot:snapshot,value:value};return value;
  }
  function current(documents,mainClauses){var cached=currentCache.get(documents);
    var main=(mainClauses||[]).flatMap(function(c){return [c.index,c.heading,c.body];});
    if(cached&&cached.main===mainClauses&&same(cached.mainState,main)&&cached.inputs.length===documents.length&&documents.every(function(d,i){return d.text===cached.inputs[i].text&&d.name===cached.inputs[i].name;}))return cached.rows;
    var rows=[];(documents||[]).forEach(function(d,di){(di===0&&mainClauses?mainClauses:S(d.text||'')).forEach(function(c){var row={document:d.name,document_index:di,clause_index:c.index,heading:c.heading,text:c.body,key:compact(c.body)},tags;
      // 원문에 일치하는 표현이 없는 1,400조항까지 매번 태깅하지 않는다.
      Object.defineProperty(row,'tags',{enumerable:true,get:function(){return tags||(tags=content(row.text));}});rows.push(row);});});
    currentCache.set(documents,{main:mainClauses,mainState:main,inputs:documents.map(function(d){return {text:d.text,name:d.name};}),rows:rows});return rows;
  }
  // 후보로 선택된 행만 준비한다. 전체 DB의 구절·그룹×본건 조항 목록은 만들지 않는다.
  function preparedPhrases(row){
    var list=row.phrases||[],saved=phraseCache.get(row);
    if(saved&&saved.list===list&&saved.keys.length===list.length&&list.every(function(p,i){return p.key===saved.keys[i]&&p.text===saved.texts[i];}))return saved;
    var key=JSON.stringify(list.map(function(p){return [p.key,p.text];})),group=phraseGroups.get(key);
    if(!group){
      // 사용자 배열을 동결하지 않고 내부 구절 스냅샷만 공유한다. 한 출처의 제자리 변경은 다른 출처를 바꾸지 않는다.
      var sorted=list.map(function(p,i){return {phrase:{key:p.key,text:p.text},order:i};}).sort(function(a,b){return b.phrase.key.length-a.phrase.key.length||a.order-b.order;});
      group={sorted:sorted,matches:new WeakMap()};phraseGroups.set(key,group);if(phraseGroups.size>512)phraseGroups.delete(phraseGroups.keys().next().value);
    }
    var value={list:list,keys:list.map(function(p){return p.key;}),texts:list.map(function(p){return p.text;}),sorted:group.sorted,matches:group.matches};phraseCache.set(row,value);return value;
  }
  function prepareMatches(selected,now){
    var cache=matchCache.get(now);if(!cache){cache=new Map();matchCache.set(now,cache);}
    var needed=new Set();selected.forEach(function(s){if(!s.phrases.matches.has(now))s.phrases.sorted.forEach(function(p){if(!cache.has(p.phrase.key))needed.add(p.phrase.key);});});
    if(needed.size){
      // 전 DB가 아니라 이번 후보의 미검색 구절만 합친다. 같은 구절은 출처 수와 무관하게 한 번 검색한다.
      var nodes=[{next:new Map(),fail:0,output:null,suffix:0}],queue=[];
      needed.forEach(function(key){cache.set(key,[]);var at=0;
        for(var i=0;i<key.length;i++){var ch=key[i],next=nodes[at].next.get(ch);if(next===undefined){next=nodes.length;nodes[at].next.set(ch,next);nodes.push({next:new Map(),fail:0,output:null,suffix:0});}at=next;}
        nodes[at].output=key;
      });
      nodes[0].next.forEach(function(at){queue.push(at);});
      for(var qi=0;qi<queue.length;qi++){var at=queue[qi];nodes[at].next.forEach(function(child,ch){
        var fallback=nodes[at].fail;while(fallback&&!nodes[fallback].next.has(ch))fallback=nodes[fallback].fail;
        nodes[child].fail=nodes[fallback].next.has(ch)?nodes[fallback].next.get(ch):0;
        var fail=nodes[child].fail;nodes[child].suffix=nodes[fail].output!==null?fail:nodes[fail].suffix;queue.push(child);
      });}
      now.forEach(function(cl,ci){var at=0,found=new Set();if(needed.has(''))found.add('');
        for(var i=0;i<cl.key.length;i++){var ch=cl.key[i];while(at&&!nodes[at].next.has(ch))at=nodes[at].fail;
          at=nodes[at].next.has(ch)?nodes[at].next.get(ch):0;
          if(nodes[at].output!==null)found.add(nodes[at].output);
          for(var suffix=nodes[at].suffix;suffix;suffix=nodes[suffix].suffix)found.add(nodes[suffix].output);
        }found.forEach(function(key){cache.get(key).push(ci);});
      });
    }
    selected.forEach(function(s){var prepared=s.phrases;if(prepared.matches.has(now))return;
      var best=new Map();for(var i=0;i<prepared.sorted.length&&best.size<now.length;i++){
        var phrase=prepared.sorted[i].phrase;(cache.get(phrase.key)||[]).forEach(function(ci){if(!best.has(ci))best.set(ci,phrase);});
      }
      // 후보 순서 다음에는 본건 조항 순서가 동점 우선순위다.
      var matches=Array.from(best.keys()).sort(function(a,b){return a-b;}).map(function(ci){return {clause:now[ci],phrase:best.get(ci)};});prepared.matches.set(now,matches);
    });
    // 장시간 탐색해도 모든 과거 자료의 구절을 본건 캐시에 영구 누적하지 않는다.
    while(cache.size>20000)cache.delete(cache.keys().next().value);
  }
  var tagFields=['topics','judgment_topics','actions','objects'];
  function rowVersion(row,prepared){
    var meta=[row.id,row.kind,row.title,row.department,row.check_id,row.raw_linked,row.result_tags,row.content_tags],tags=row.content_tags||{},saved=rowCache.get(row);
    if(saved&&saved.phrases===prepared&&same(saved.meta,meta)&&tagFields.every(function(f){return same(saved.tags[f],tags[f]||[]);}))return saved;
    var copied={};tagFields.forEach(function(f){copied[f]=(tags[f]||[]).slice();});
    var value={phrases:prepared,meta:meta,tags:copied};rowCache.set(row,value);return value;
  }
  function candidatesFor(compiled,ids,tags){
    var out=[],seen=new Set();
    function append(rows){for(var i=0;i<rows.length&&out.length<200;i++){var row=rows[i];if(!seen.has(row)){seen.add(row);out.push(row);}}}
    for(var i=0;i<ids.length&&out.length<200;i++)append(compiled.by_check[ids[i]]||[]);
    var topics=topicKeys(tags);for(var j=0;j<topics.length&&out.length<200;j++)append(compiled.by_topic[topics[j]]||[]);
    return out;
  }
  function topicKeys(tags){return (tags.topics||[]).concat((tags.judgment_topics||[]).map(function(t){return 'judgment:'+t;}));}
  function overlap(a,b){var hits=[];['topics','judgment_topics','actions','objects'].forEach(function(f){(a[f]||[]).forEach(function(t){if((b[f]||[]).includes(t))hits.push(f+':'+t);});});return hits;}
  function retrieve(cp,documents,compiled,mainClauses){
    if(!cp||!compiled||cp.active===false)return [];
    var tags=Object.assign({},content(cp.check),cp.tag_signature||{}),ids=[cp.id].concat(cp.legacy_check_ids||[]),now=current(documents||[],mainClauses),out=[];
    var selected=[];candidatesFor(compiled,ids,tags).forEach(function(row){var linked=ids.includes(row.check_id),hits=overlap(tags,row.content_tags);
      if(linked||hits.some(function(t){return t.includes('topics:');})){var phrases=preparedPhrases(row);selected.push({row:row,linked:linked,hits:hits,phrases:phrases,version:rowVersion(row,phrases)});}});
    var byCurrent=queryCache.get(compiled);if(!byCurrent){byCurrent=new WeakMap();queryCache.set(compiled,byCurrent);}
    var cached=byCurrent.get(now);if(!cached){cached=new Map();byCurrent.set(now,cached);}
    var qkey=JSON.stringify([ids,tags]),versions=selected.map(function(s){return s.version;}),prior=cached.get(qkey);
    if(prior&&same(prior.versions,versions))return prior.value;
    prepareMatches(selected,now);
    selected.forEach(function(selection){var row=selection.row,linked=selection.linked,hits=selection.hits;
      selection.phrases.matches.get(now).forEach(function(found){var cl=found.clause,match=found.phrase;
        // 결과 선택/부서/제목만 일치한 기록은 현재 조항의 후보가 되지 않는다.
        if(!linked&&!overlap(cl.tags,row.content_tags).some(function(t){return t.includes('topics:');}))return;
        var score=(linked?1:0)+Math.min(0.5,match.key.length/100);
        // 동일 점수는 먼저 나온 후보·조항이 우선이다. 5등 이하 객체를 대량 생성하지 않는다.
        if(out.length===5&&score<=out[4].score)return;
        out.push({source_id:row.id,kind:row.kind,title:row.title,department:row.department||'',check_id:cp.id,reference_only:true,auto_approval:false,raw_linked:row.raw_linked,
          result_tags:row.result_tags,content_tags:row.content_tags,matched_phrase:match.text,tag_hits:hits,current_evidence:{document:cl.document,document_index:cl.document_index,clause_index:cl.clause_index,heading:cl.heading,text:cl.text},score:score});
        out.sort(function(a,b){return b.score-a.score;});if(out.length>5)out.pop();
      });
    });cached.set(qkey,{versions:versions,value:out});return out;
  }
  return {index:index,isCurrent:isCurrent,retrieve:retrieve,tagVerdict:tagVerdict,current:current,buildCount:function(){return builds;}};
})();
if(typeof module!=='undefined')module.exports=JudgmentHints;
