"use strict";
/* 폐쇄망 등록 표준. 본건과 표준을 동일한 질문별 약정 기준으로 확인한다. */
var TemplateLibrary=(function(){
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules');
  var A=typeof AgreementEvidence!=='undefined'?AgreementEvidence:require('./agreement_evidence');
  var Q=typeof ClauseEquivalence!=='undefined'?ClauseEquivalence:require('./clause_equivalence');
  var F=typeof TemplateFields!=='undefined'?TemplateFields:require('./template_fields');
  var D=typeof DecisionEvidence!=='undefined'?DecisionEvidence:require('./decision_evidence');
  var Sem=typeof ClauseSemantics!=='undefined'?ClauseSemantics:require('./clause_semantics');
  var RP=typeof RegisteredPresence!=='undefined'?RegisteredPresence:require('./registered_presence');
  var P=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy');
  var J=typeof AgreementJudgment!=='undefined'?AgreementJudgment:require('./agreement_judgment');
  var VERSION='template-library-v1',tickets=new WeakMap(),prepared=new WeakMap(),evaluations=new WeakMap(),resolved=new WeakMap(),sourceCache=new WeakMap();
  function currentKey(input){return prepared.get(input)?.hash||H.of([input.current,input.documents,input.scope]);}
  function checkKey(cp,item){return H.of([cp.id,cp.meaning_revision,cp.check,cp.active,cp.review_scope,item&&[item.roleGated,item.relationshipGated,item.serviceGated,item.opinionScope]]);}
  function norm(s){return String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();}
  function canonical(s){
    s=D.wording(norm(s)).replace(/^\s*(?:제\s*\d+\s*조(?:의\s*\d+)?\s*[（(][^）)]+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/,'');
    var frame=Q.frame(s);if(frame)return 'frame:'+frame.key;
    // 주체·대상·조건을 보존한, 유한한 동의 표현만 허용한다. 숫자/부정/단서는 지우지 않는다.
    s=s.replace(/사전에/g,'미리').replace(/서면으로 동의/g,'서면 동의').replace(/하여서는 아니 된다/g,'해서는 안 된다')
      .replace(/하여야 한다/g,'해야 한다');
    var m=s.match(/^(수탁자|을)는 (위탁자|갑)의 사전 서면 동의 없이 (재위탁)할 수 없다[.]?$/);
    if(!m)m=s.match(/^(수탁자|을)가 업무를 (재위탁)하려면 (위탁자|갑)의 서면 동의를 미리 받아야 한다[.]?$/)?.map(function(v,i,a){return i===2?a[3]:i===3?a[2]:v;});
    if(m)return 'prior-written-consent:'+m[1]+':'+m[2]+':'+m[3];
    return s.replace(/[.。]$/,'').replace(/\s/g,'');
  }
  function units(text){var docs=[{name:'문서',text:text}];return A.units(docs).filter(function(s){return !A.isDocumentTitle(s,docs)&&canonical(s.text)&&!(E.heading(s.text)&&norm(s.text)===norm(E.heading(s.text).prefix));});}
  function documentUnits(docs){var all=[];Sem.contexts(docs).rows.forEach(function(s){var env=s.aliases;
    if(s.boundary||s.list_header&&s.list_valid||A.isDocumentTitle(s,docs)||!canonical(s.text)||E.heading(s.text)&&norm(s.text)===norm(E.heading(s.text).prefix)||Sem.aliasDefinition(s.text,env))return;
    (Sem.keys(s.semantic_text||s.text,env)||[canonical(Sem.roleText(s.text,env))+Sem.literalScope(s.text,env)]).forEach(function(key){all.push({document:s.document,document_index:s.document_index,section_index:s.section_index,sentence_index:s.sentence_index,text:s.text,key:key,aliases:env,list_intros:(s.list_intros||[]).map(function(p){return p.text;})});});});return all;}
  function quoteEnvironment(contexts,text,quote){var envs=[],offset=0,at;while((at=text.indexOf(quote,offset))!==-1){var end=at+quote.length;
    contexts.rows.filter(function(s){return s.start<end&&s.end>at;}).forEach(function(s){if(!envs.includes(s.aliases))envs.push(s.aliases);});offset=at+1;}
    if(!envs.length||envs.some(function(e){return e.conflicts.length;})||new Set(envs.map(function(e){return JSON.stringify(Object.entries(e.map).sort());})).size>1)return {map:{},conflicts:['quote_scope'],definitions:[]};
    return envs[0];}
  function freezeCopy(value){var copy=JSON.parse(JSON.stringify(value||{}));function freeze(v){if(v&&typeof v==='object'){Object.keys(v).forEach(function(k){freeze(v[k]);});Object.freeze(v);}return v;}return freeze(copy);}
  function prepare(input){var p=Object.assign({},input,{documents:Object.freeze((input.documents||[]).map(function(d){return freezeCopy(d);})),scope:freezeCopy(input.scope),source_states:freezeCopy(input.source_states)});
    Object.freeze(p);prepared.set(p,{hash:H.of([p.documents,p.scope])});return p;}
  function empty(){return {format:VERSION,templates:[]};}
  function validate(lib){
    if(!lib||lib.format!==VERSION||!Array.isArray(lib.templates)||lib.templates.length>200)throw Error('표준서식 백업 형식 오류');
    var ids=new Set();lib.templates.forEach(function(t){
      if(!t.id||ids.has(t.id)||!t.name||!t.revision||typeof t.text!=='string'||t.text.length>2000000||!Array.isArray(t.bindings)||!Array.isArray(t.type_ids)||!t.type_ids.length||!Array.isArray(t.roles))throw Error('표준서식 정보 누락/중복');
      ids.add(t.id);if(t.fingerprint!==H.of(t.text))throw Error('표준서식 원문 지문 불일치');
      if(t.extraction&&(!Structure.validExtraction(t.text,t.extraction)||t.structure_fingerprint!==H.of(t.extraction)))throw Error('표준서식 표 구조·원문 지문 불일치');
      F.validate(t.text,t.fields||[]);
      var checks=new Set();t.bindings.forEach(function(b){
        if(!b.check_id||checks.has(b.check_id)||!b.check_hash||!Array.isArray(b.quotes)||!b.quotes.length||b.quotes.some(function(q){return !norm(q)||!t.text.includes(q);}))throw Error('체크항목별 원문 근거 누락/중복');
        checks.add(b.check_id);
        if(b.match_terms!==undefined&&(!Array.isArray(b.match_terms)||!b.match_terms.length||b.match_terms.length>20||b.match_terms.some(function(s){return typeof s!=='string'||s.length<2||s.length>80;})))throw Error('자동 연결 쟁점어 형식 오류');
        if(b.variants!==undefined&&(!Array.isArray(b.variants)||b.variants.length>200))throw Error('표현 변형 목록 형식 오류');
        (b.variants||[]).forEach(function(v){if(!v.id||v.check_id!==b.check_id||v.check_hash!==b.check_hash||!v.source?.id||!v.source.hash||!v.scope?.type||!Array.isArray(v.scope.roles)||!Array.isArray(v.quotes)||!v.quotes.length||v.quotes.some(function(q){return typeof q!=='string'||!q.trim()||q.length>20000;}))throw Error('표현 변형의 출처·범위·근거 누락');});
      });
    });return lib;
  }
  var Structure=typeof DocumentStructure!=='undefined'?DocumentStructure:require('./document_structure');
  function draft(name,revision,text,scope,extraction){
    if(!norm(text)||!/[가-힣A-Za-z0-9]/.test(text))throw Error('원문 추출 상태를 확인하세요. 판독할 텍스트가 없습니다.');
    var t={id:H.of([name,revision,text,scope]),name:name,revision:revision,text:text,fingerprint:H.of(text),
      type_ids:scope.type_ids,roles:scope.roles||[],stance:scope.stance||'party',bindings:[],fields:[],active:false};
    if(/�/.test(text))t.extraction_warnings=['일부 판독 불가 문자가 있습니다. 해당 근거만 자동 연결에서 제외합니다.'];
    if(Structure.validExtraction(text,extraction)){t.extraction=JSON.parse(JSON.stringify(extraction));t.structure_fingerprint=H.of(t.extraction);t.id=H.of([t.id,t.structure_fingerprint]);}return t;
  }
  function bind(t,cp,quotes){
    if(cp.review_scope==='execution_only')throw Error('실제 이행 확인은 계약내용 판정 대상이 아닙니다.');
    if(cp.text_effect==='required_absent')throw Error('금지 문구의 부재는 표준문구 존재만으로 승인할 수 없습니다.');
    var b={check_id:cp.id,check_hash:H.of(cp),question:cp.check,meaning_revision:P.get(cp).meaning_revision,quotes:quotes.slice()};
    var tagger=typeof ContractTags!=='undefined'?ContractTags:require('./contract_tags');
    b.tags=tagger.analyzeClause({heading:'',body:quotes.join('\n')},t.name);
    t.bindings=t.bindings.filter(function(x){return x.check_id!==cp.id;}).concat([b]);validate({format:VERSION,templates:[t]});return b;
  }
  function sourceJudgment(t,cp,policy){
    var extraction=Structure.revisionToken(t.extraction),saved=sourceCache.get(t);
    if(!saved||saved.name!==t.name||saved.text!==t.text||saved.extraction!==extraction||saved.version!==J.VERSION){
      saved={name:t.name,text:t.text,extraction:extraction,version:J.VERSION,documents:[{name:t.name,text:t.text,extraction:t.extraction}],questions:new Map()};sourceCache.set(t,saved);
    }
    var key=JSON.stringify([cp.id,policy.meaning_revision,cp.check]),profile=Structure.revisionToken(J.profiles[cp.id]),cached=saved.questions.get(key);
    if(cached&&cached.profile===profile)return cached.value;
    // 같은 표준 원문은 한 문서 배열로 전처리하고 질문별 결과만 보관한다.
    // 저장한 결과는 외부 화면의 근거 편집이나 mutable 추출 객체와 공유하지 않는다.
    var value=freezeCopy(J.evaluate(cp,saved.documents,{source_standard:true}));saved.questions.set(key,{profile:profile,value:value});return value;
  }
  function evaluate(lib,cp,item,input){
    input=input||{};var policy=P.get(cp),out={eligible:false,evidence:[],reason:'질문에 필요한 현재 약정 내용 미확인'},resolution;
    function end(result){var t=(lib.templates||[]).find(function(t){return t.id===result.template_id;});evaluations.set(result,{lib:lib,binding:checkKey(cp,item),input:input,input_key:currentKey(input),tag_state:Structure.revisionToken(input.knowledge?.tags),resolution:resolution,
      template:t,text:t&&t.text,template_state:t&&Structure.revisionToken(t),digest:H.of(result)});return result;}
    if(!input.current||!item||!policy.compatible||!policy.active||policy.level!=='presence'||cp.active===false||cp.review_scope==='execution_only'||item.roleGated||item.relationshipGated||item.serviceGated||item.opinionScope)return end(out);
    var scope=input.scope||{};resolution=resolveDocuments(lib,input.documents||[]);var docs=resolution.documents;
    var current=J.evaluate(cp,docs,{scope:scope,knowledge:input.knowledge});
    if(!current.eligible)return end(Object.assign(out,current,{reason:current.blockers.map(function(b){return b.reason;}).concat(current.missing).join(' · ')}));
    var candidates=(lib.templates||[]).filter(function(t){return t.active&&t.bindings.some(function(b){return b.check_id===cp.id&&(b.meaning_revision?b.meaning_revision===policy.meaning_revision:b.question===cp.check);});});
    for(var t of candidates){
      var b=t.bindings.find(function(b){return b.check_id===cp.id;});
      // 예전 수기 연결도 현재 질문의 표준 원문을 재검사. 승인·유사도·과거 결론만으로 우회하지 않는다.
      var source=sourceJudgment(t,cp,policy);
      if(!source.eligible)continue;
      return end(Object.assign({},current,{reason:'본건 약정이 등록 표준과 같은 질문 요건을 충족',template_id:t.id,template_name:t.name,revision:t.revision,
        template_hash:t.fingerprint,template_policy_hash:H.of([b.meaning_revision,b.quotes]),source_evidence:JSON.parse(JSON.stringify(source.evidence)),
        kind:source.evidence.every(function(e){return current.evidence.some(function(x){return norm(x.text)===norm(e.text);});})?'exact':'equivalent',equivalence_version:J.VERSION}));
    }
    return end(out);
  }
  function compactName(s){return norm(s).replace(/[^가-힣A-Za-z0-9]/g,'').toLowerCase();}
  function standardNames(name){
    var clean=norm(name).replace(/\.(?:hwp|hwpx|docx|pdf|txt)$/i,'');
    clean=clean.replace(/[_\s-]*[（(]\s*(?:(?:버전|판본|개정판|개정일)\s*|v\s*)?\d+(?:[.\/-]\d+)*\s*(?:개정|개정판|판)?\s*[）)]$/i,'');
    // 파일 관리용 접미사만 제거한다. 재위탁형·개인정보형 등 의미 있는 서식 구분은 남긴다.
    clean=clean.replace(/[_\s-]*(?:개정[_\s-]*)?(?:입력항목[（(][^）)]*[）)][_\s-]*)?(?:\d{4}[._-]?\d{2}(?:[._-]?\d{2})?)(?:[_\s-]*(?:개정|개정판))?$/,'');
    var key=compactName(clean),aliases=[key];
    if(key==='개인신용정보보안관리약정서일반')aliases.push('개인신용정보보안관리약정서');
    return aliases.filter(function(s){return s.length>=3;});
  }
  function nameOccurrence(text,aliases){
    var raw=norm(text),compact='',positions=[];
    for(var i=0;i<raw.length;i++)if(/[가-힣A-Za-z0-9]/.test(raw[i])){compact+=raw[i].toLowerCase();positions.push(i);}
    var found=[];
    aliases.forEach(function(alias){var at=-1;while((at=compact.indexOf(alias,at+1))!==-1){
      var start=positions[at],end=positions[at+alias.length-1]+1,tail=raw.slice(end),after=compact.slice(at+alias.length);
      if(start>0&&/[가-힣A-Za-z0-9]/.test(raw[start-1]))continue;
      // 일반형 별칭이 재위탁 등 다른 변형의 제목 앞부분에 붙지 않도록 한다.
      if(after&&!/^(?:[0-9]|v[0-9]|버전|판본|개정|현행|현재|최신|을|를|은|는|에|과|와|적용|첨부|별첨|편입|준용|따른|$)/i.test(after))continue;
      found.push({name:alias,start:start,end:end,tail:tail});
    }});
    return found.sort(function(a,b){return b.name.length-a.name.length||a.start-b.start;})[0];
  }
  function referenceRevision(tail){
    var m=tail.match(/^[\s(（\[【:：_-]*(?:(?:버전|판본|개정판|개정일|제)\s*|v\s*)?(\d+(?:[.\/-]\d+)*(?:년\s*\d+월(?:\s*\d+일)?)?)/i);
    if(m)return /^[A-Za-z0-9]/.test(tail.slice(m[0].length))?'unrecognized:'+norm(tail):revisionKey(m[1]);
    return /^[\s(（\[【:：_-]*(?:버전|판본|개정판|개정일|v\s*\d)/i.test(tail)?'unrecognized:'+norm(tail):null;
  }
  function revisionKey(revision){
    var value=norm(revision).replace(/^v\s*/i,'').replace(/[년월]/g,'.').replace(/일$/,'').replace(/[\/\s-]+/g,'.'),date=value.match(/^(\d{4})[.]?(\d{2})(?:[.]?(\d{2}))?$/);
    // 날짜 형식만 구두점을 통일한다. 판본 1.1과 11은 서로 다른 값이다.
    return date?date.slice(1).filter(Boolean).join('.'):value;
  }
  function suppliedStandards(documents,wanted){
    var names=new Map();function add(name,index){standardNames(name).forEach(function(n){if(wanted.has(n)&&!names.has(n))names.set(n,index);});}
    for(var i=0;i<documents.length;i++){
      var d=documents[i];if(d.registered_reference)continue;
      add(d.name,i);
      // 한 파일에 이어 붙인 별첨도 본건 원문이다. 본문 속 이름 언급은 제목으로 보지 않는다.
      var lines=String(d.text||'').split(/\r?\n/);
      for(var j=0;j<lines.length;j++){
        var line=norm(lines[j]).replace(/^(?:[\[【(（]?\s*(?:별첨|별지|첨부|부속서류)\s*\d*\s*[\]】)）.:：-]?\s*)/,'');
        if(line.length<=160&&lines.slice(j+1,j+5).some(function(s){return /제\s*\d+\s*조|^\s*\d+[.)]/.test(s);}))add(line,i);
      }
    }
    return names;
  }
  // 본건의 명시적 적용·첨부를 실제 등록 원문에 연결한다. 유일한 판본에는 반복 선택을 요구하지 않는다.
  // 복수 판본, 다른 서식, 참고·예정·배제 및 제출된 수정 별첨은 등록 원문으로 덮어쓰지 않는다.
  function resolveDocuments(lib,documents){
    var state=(lib.templates||[]).map(function(t){return [t.id,t.active,t.revision,t.name,t.text,t.extraction,Structure.revisionToken(t.extraction)];}),previous=resolved.get(lib),documentState=documents.map(function(d){return Structure.revisionToken(d.extraction);}),metadata=documents.map(function(d){var other=[];Object.keys(d).forEach(function(k){if(k!=='text'&&k!=='extraction')other.push(k,Structure.revisionToken(d[k]));});return other;});
    if(previous&&previous.state.length===state.length&&state.every(function(row,i){return row.every(function(v,j){return v===previous.state[i][j];});})&&previous.rows.length===documents.length&&documents.every(function(d,i){var p=previous.rows[i];return d.name===p.name&&d.text===p.text&&d.extraction===p.extraction&&p.structure===documentState[i]&&p.metadata.length===metadata[i].length&&metadata[i].every(function(v,j){return p.metadata[j]===v;});}))return previous.value;
    var result=documents.slice(),references=[],ambiguous=[];
    var active=(lib.templates||[]).filter(function(t){return t.active;}),named=active.map(function(t){return {template:t,names:standardNames(t.name)};});
    var nonContractSections=new Set();
    var referenceRows=active.length?A.units(documents).map(function(r,i,rows){var context=norm(r.text),next=rows[i+1],section=r.document_index+':'+r.section_index;
      // 예시·검토 메모의 다음 줄을 계약의 실제 별첨 선언으로 승격하지 않는다.
      if(/^(?:작성예시|작성요령|예시|예문|견본|검토의견|검토결과|검토메모)(?:[:：(（]|$)/.test(context.replace(/\s/g,'')))nonContractSections.add(section);
      if(next&&next.document_index===r.document_index&&next.section_index===r.section_index&&/^(?:다만|단[,，\s]|이\s*약정|본\s*약정|해당\s*약정)/.test(norm(next.text)))context+=' '+norm(next.text);
      return {row:r,text:norm(r.text),context:context,non_contract:nonContractSections.has(section)};
    }).filter(function(r){
      return !r.non_contract&&/(?:적용한다|따른다|일부로\s*한다|편입한다|준용한다|첨부한다|별첨한다)(?![가-힣A-Za-z])/.test(r.text)&&!/(?:적용|첨부|별첨|편입|준용)\s*(?:하지|되지)|따르지|제외한다|적용.{0,6}배제|참고|예시|추후|향후|예정|미정/.test(r.context);
    }):[];
    var supplied=referenceRows.length?suppliedStandards(documents,new Set(named.flatMap(function(n){return n.names;}))):new Map();
    referenceRows.forEach(function(reference){
      var matches=named.map(function(n){return {template:n.template,names:n.names,match:nameOccurrence(reference.text,n.names)};}).filter(function(n){return n.match;});
      // 하나의 문장에 다른 표준이 함께 언급되어도 각 이름별로 판본을 독립적으로 해소한다.
      var groups=new Map();matches.forEach(function(n){var key=n.match.start+':'+n.match.end;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);});
      groups.forEach(function(group){
        var ref=reference.row,revision=referenceRevision(group[0].match.tail),candidates=group.filter(function(n){return !revision||revisionKey(n.template.revision)===revision;}),name=group[0].template.name;
        var aliases=Array.from(new Set(group.flatMap(function(n){return n.names;}))),actual=aliases.map(function(n){return supplied.get(n);}).find(function(i){return i!==undefined;});
        if(actual>=0){references.push({name:name,document:ref.document,document_index:ref.document_index,text:ref.text,start:ref.start,end:ref.end,binding_kind:'current_document',target_document_index:actual});return;}
        if(candidates.length!==1){var reason=!candidates.length?'명시된 개정판의 등록 원문 없음':'적용할 표준 원문이 여러 개';
          if(!ambiguous.some(function(a){return a.name===name&&a.reason===reason;}))ambiguous.push({name:name,reason:reason});return;}
        var t=candidates[0].template;
        if(!result.some(function(d){return d.text===t.text;}))result.push({name:t.name+' ('+t.revision+' · 본건 편입)',text:t.text,extraction:t.extraction,template_id:t.id,registered_reference:true});
        references.push({template_id:t.id,name:t.name,document:ref.document,document_index:ref.document_index,text:ref.text,start:ref.start,end:ref.end,revision:t.revision,binding_kind:'registered_reference'});
      });
    });
    var value=freezeCopy({documents:result,references:references,ambiguous:ambiguous});resolved.set(lib,{state:state,rows:documents.map(function(d,i){return {name:d.name,text:d.text,extraction:d.extraction,metadata:metadata[i],structure:documentState[i]};}),value:value});return value;
  }
  function ticketFromEvaluation(lib,cp,item,input,r){
    var known=evaluations.get(r);if(!known||known.lib!==lib||known.binding!==checkKey(cp,item)||known.input!==input||known.input_key!==currentKey(input)||!r.eligible||known.digest!==H.of(r))return null;
    if(known.tag_state!==Structure.revisionToken(input.knowledge?.tags)||known.resolution!==resolveDocuments(lib,input.documents||[]))return null;
    if(!known.template||!(lib.templates||[]).includes(known.template)||known.text!==known.template.text||known.template_state!==Structure.revisionToken(known.template))return null;
    var t={};tickets.set(t,Object.assign({},r,{version:VERSION,check_id:cp.id,rule_id:'TEMPLATE-'+cp.id,input_hash:H.of([input.documents,input.scope]),rule_hash:H.of([cp.id,P.get(cp).meaning_revision])}));return t;
  }
  function ticket(lib,cp,item,input){return ticketFromEvaluation(lib,cp,item,input,evaluate(lib,cp,item,input));}
  function consume(t,id){var p=tickets.get(t);if(!p||p.check_id!==id)return null;tickets.delete(t);return p;}
  function replay(lib,packet,currentChecks,sourceStates){var rows=[],excluded=0,changed=0;(packet.checks||[]).forEach(function(cp){
    var current=currentChecks&&currentChecks.find(function(c){return c.id===cp.id;});
    if(cp.active===false||cp.review_scope==='execution_only'||current&&(current.active===false||current.review_scope==='execution_only')){excluded++;return;}
    if(currentChecks&&(!current||(cp.meaning_revision&&current.meaning_revision?current.meaning_revision!==cp.meaning_revision:current.check!==cp.check))){changed++;return;}
    var v=(packet.verdicts||{})[cp.id];
    if(!v||v.origin!=='manual'||v.needs_reconfirmation||!(v.verdict==='검토의견'||v.verdict==='이상없음'&&v.reason==='반영되어 있음'))return;
    var r=evaluate(lib,current||cp,(packet.items||[]).find(function(i){return i.cpId===cp.id;}),{current:true,scope:packet.context,documents:packet.documents,source_states:sourceStates||{},exclude_contract_hash:packet.contract_hash,exclude_source_ids:['packet:'+packet.id+':'+cp.id]});
    rows.push({check_id:cp.id,eligible:r.eligible,false_safe:r.eligible&&v.verdict==='검토의견',reason:r.reason});});
    return {rows:rows,excluded:excluded,changed:changed,candidates:rows.filter(function(r){return r.eligible;}).length,false_safe:rows.filter(function(r){return r.false_safe;}).length,independent:false};}
  return {VERSION:VERSION,empty:empty,validate:validate,draft:draft,bind:bind,canonical:canonical,units:units,prepare:prepare,evaluate:evaluate,ticket:ticket,ticketFromEvaluation:ticketFromEvaluation,consume:consume,replay:replay,resolveDocuments:resolveDocuments};
})();
if(typeof module!=='undefined')module.exports=TemplateLibrary;
