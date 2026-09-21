"use strict";
var TemplateLibraryRuntime=(function(){
  var KEY='cr-template-library-v1',lib=TemplateLibrary.empty(),draft=null,error='',lastRows=[],proposalRows=[],variantRows=[],packetCache=[],proposalKey='',variantKey='';
  var sourceCache=null,inputCache=null,decisionCache=new Map(),reloadPromise=null,reloadAll=false,reloadIds=new Set(),packetDigests=new Map();
  function el(id){return document.getElementById('template-'+id);}
  function status(s){el('status').textContent=s;}
  try{var raw=JSON.parse(localStorage.getItem(KEY)||'null');if(raw)lib=TemplateLibrary.validate(raw);}catch(e){error=e.message;}
  function checks(){return SafetyRuntime.allChecks().filter(function(c){return ReviewCore.activeCheck(c)&&!['aggregate_only','anomaly_only'].includes(c.surface_policy);});}
  // 자동 생성 연결만 현행 규칙으로 갱신한다. 수동 연결·사용 중지 자료는 유지한다.
  try{var upgraded=false,next=JSON.parse(JSON.stringify(lib));next.templates=next.templates.map(function(t){
    if(t.active&&t.registration?.mode==='automatic'&&t.registration.version<(TemplateRegister.VERSION||16)){upgraded=true;
      return TemplateRegister.upgrade(t,checks());}return t;
  });if(upgraded){TemplateLibrary.validate(next);localStorage.setItem(KEY,JSON.stringify(next));lib=next;}}catch(e){error='자동 연결 갱신 실패: '+e.message;}
  function refresh(){if(state.result){applyAutoVerdicts();renderClauses();renderReport();}}
  function save(next){TemplateLibrary.validate(next);localStorage.setItem(KEY,JSON.stringify(next));lib=next;refresh();render();}
  function register(name,text,extraction){
    var t=TemplateRegister.process(name,new Date().toISOString().slice(0,10),text,{type_ids:CR.types.map(function(x){return x.meta.type_id;}),roles:[],stance:'party'},checks(),extraction);
    var next=JSON.parse(JSON.stringify(lib));
    // 같은 자료를 다시 넣어도 기존 수동 설정을 덮어쓰지 않는다.
    var existing=next.templates.find(function(x){return x.name===t.name&&x.text===t.text&&x.structure_fingerprint===t.structure_fingerprint;});
    if(existing&&existing.active){load(existing);return existing;}
    if(existing)next.templates=next.templates.filter(function(x){return x.id!==existing.id;});
    next.templates.forEach(function(x){if(x.name===t.name)x.active=false;});next.templates.push(t);save(next);load(t);return t;
  }
  function sources(includeDraft){var used=lib.templates.concat(includeDraft===false?[]:draft?[draft]:[]).flatMap(function(t){return t.bindings.flatMap(function(b){return (b.variants||[]).map(function(v){return v.source.id;});});}).concat(includeDraft===false?[]:variantRows.map(function(v){return v.source.id;}));
    var key=JSON.stringify(Array.from(new Set(used)).sort());
    if(sourceCache&&sourceCache.key===key&&sourceCache.corpus===loopCorpus&&sourceCache.packets===packetCache)return sourceCache.value;
    var value=used.length?TemplateAssist.sourceStates(loopCorpus,packetCache,used):{};sourceCache={key:key,corpus:loopCorpus,packets:packetCache,value:value};return value;
  }
  function input(){
    var ds=safetyDocuments(),scope=SafetyRuntime.templateScope(),sourceStates=sources(false),current=!!state.result&&document.getElementById('contract-text').value===state.text&&
      (state.analyzedText===undefined||state.analyzedText===state.text);
    var revisions=ds.map(function(d){return typeof DocumentStructure!=='undefined'&&DocumentStructure.revisionToken?DocumentStructure.revisionToken(d.extraction):d.extraction;});
    var key=SafetyDigest.of({scope:scope,current:current});
    if(inputCache&&inputCache.key===key&&inputCache.lib===lib&&inputCache.sources===sourceStates&&inputCache.documents.length===ds.length&&ds.every(function(d,i){var old=inputCache.documents[i];return old.name===d.name&&old.text===d.text&&old.extraction===d.extraction&&inputCache.revisions[i]===revisions[i];}))return inputCache.value;
    var value=TemplateLibrary.prepare({current:current,scope:scope,documents:ds,source_states:sourceStates});
    inputCache={key:key,lib:lib,sources:sourceStates,documents:ds,revisions:revisions,value:value};decisionCache.clear();return value;
  }
  function evaluate(cp,r,p){
    var key=SafetyDigest.of({cp:cp,item:{cpId:r.cpId,coverage:r.coverage,reassigned:r.reassigned,opinionScope:r.opinionScope,roleGated:r.roleGated,relationshipGated:r.relationshipGated,serviceGated:r.serviceGated}});
    var cached=decisionCache.get(key);if(cached&&cached.input===p&&cached.lib===lib)return cached.value;
    var value=TemplateLibrary.evaluate(lib,cp,r,p);decisionCache.set(key,{input:p,lib:lib,value:value});return value;
  }
  function apply(store,onlyIds){
    var p=input(),result=store;lastRows=onlyIds?lastRows.filter(function(r){return !onlyIds.has(r.check_id);}):[];
    (state.result?.checkpoints||[]).forEach(function(cp){
      if(onlyIds&&!onlyIds.has(cp.id))return;
      var r=resultFor(cp);if(!r)return;r.templateEvidence=null;
      if(!ReviewCore.activeCheck(cp)||!lib.templates.some(function(t){return t.active&&t.bindings.some(function(b){return b.check_id===cp.id;});}))return;
      if(SafetyRuntime.standardAllowed&&!SafetyRuntime.standardAllowed(cp.id)){r.templateEvidence={eligible:false,status:'stopped',reason:'사용자 설정으로 이 항목의 자동판정 중지',evidence:[]};lastRows.push({check_id:cp.id,question:cp.check,result:r.templateEvidence});return;}
      var report=evaluate(cp,r,p);lastRows.push({check_id:cp.id,question:cp.check,result:report});r.templateEvidence=report;
      var ticket=report.eligible&&(TemplateLibrary.ticketFromEvaluation?TemplateLibrary.ticketFromEvaluation(lib,cp,r,p,report):TemplateLibrary.ticket(lib,cp,r,p));if(ticket)result=Verdict.applyTemplate(result,cp.id,verdictToday(),ticket);
    });return result;
  }
  function mapResult(r){
    // 매핑 점수·원래 조항 연결은 보존한다. 완료 위치는 ReviewCore의 본건 근거 주소로만 표시한다.
    return r;
  }
  function render(){
    el('list').innerHTML=lib.templates.map(function(t){return '<div class="template-entry" data-template-entry>'+esc(t.name)+' · '+esc(t.revision)+' · 자동판정 연결 '+t.bindings.length+'개 · '+(t.active?(t.bindings.length?'등록 완료':'자료 저장됨 — 자동 충족 연결 없음'):'사용 중지')+
      ' <button data-template-edit="'+esc(t.id)+'">내용·연결 확인</button> <button data-template-toggle="'+esc(t.id)+'">'+(t.active?'자동판정 중지':'자동 처리하여 재개')+'</button>'+
      (t.fields||[]).map(function(f){return '<label>'+esc(f.label)+' <input data-field-label="'+esc(f.label)+'" placeholder="본건 입력값" value=""></label>';}).join('')+
      ' <button data-template-use="'+esc(t.id)+'">본건 별첨으로 사용</button></div>';}).join('')||'<p>등록된 표준서식이 없습니다.</p>';
    el('list').querySelectorAll('[data-template-edit]').forEach(function(b){b.onclick=function(){load(lib.templates.find(function(t){return t.id===b.dataset.templateEdit;}));el('advanced').open=true;};});
    el('list').querySelectorAll('[data-template-toggle]').forEach(function(b){b.onclick=function(){try{var next=JSON.parse(JSON.stringify(lib)),t=next.templates.find(function(t){return t.id===b.dataset.templateToggle;});
      if(!t.active){var processed=TemplateRegister.process(t.name,t.revision,t.text,{type_ids:t.type_ids,roles:t.roles,stance:t.stance},checks(),t.extraction);next.templates[next.templates.indexOf(t)]=processed;save(next);status('자동 처리 완료. 별도 승인은 필요하지 않습니다.');return;}t.active=false;save(next);status('기준 사용 중지. 해당 자동판정은 현재 근거로 재검사했습니다.');}catch(e){status(e.message);}};});
    el('list').querySelectorAll('[data-template-use]').forEach(function(b){b.onclick=function(){try{var t=lib.templates.find(function(t){return t.id===b.dataset.templateUse;});
      if(!t.active)throw Error('사용 중지된 자료입니다. 자동 처리하여 재개 버튼으로 다시 사용할 수 있습니다.');if(!state.text)throw Error('먼저 계약 본문을 입력·분석하세요.');
      var values={};b.closest('[data-template-entry]').querySelectorAll('[data-field-label]').forEach(function(f){values[f.dataset.fieldLabel]=f.value;});
      var filled=TemplateFields.fillDocument(t.name+' ('+t.revision+' · 적용 서식)',t.text,t.fields||[],values,t.extraction);
      if(state.subDocs.some(function(d){return d.template_id===t.id;}))throw Error('이미 적용된 별첨입니다. 변경하려면 입력 탭에서 해당 별첨을 제거한 뒤 다시 적용하세요.');
      state.subDocs.push(Object.assign(filled,{template_id:t.id}));
      renderSubDocList();runAnalysis();status('검토 대상 별첨에 추가했습니다. 실제 체결·이행 확인을 의미하지 않습니다.');}catch(e){status(e.message);}};});
  }
  function load(t){draft=JSON.parse(JSON.stringify(t));el('name').value=t.name;el('revision').value=t.revision;el('text').value=t.text;
    Array.from(el('type').options).forEach(function(o){o.selected=t.type_ids.includes(o.value);});el('role').value=t.roles[0]||'';el('stance').value=t.stance;el('approve').checked=false;clauses();bindings();resetCandidates();}
  function clauses(){var text=el('text').value,parts=segmentContract(text);if(!parts.length)parts=[{heading:'전체',body:text}];
    el('quotes').innerHTML=parts.map(function(c,i){var q=[c.heading,c.body].filter(Boolean).join('\n');
      // 원문에 포함된 연속 구간만 승인할 수 있다. 추출기가 만든 제목은 근거에 넣지 않는다.
      if(!text.includes(q))q=c.body;if(!q||!text.includes(q))q=text;
      return '<label style="display:block"><input type="checkbox" data-quote-index="'+i+'">'+esc(q)+'</label>';}).join('');
    el('quotes').querySelectorAll('input').forEach(function(cb,i){var c=parts[i],q=[c.heading,c.body].filter(Boolean).join('\n');if(!text.includes(q))q=c.body;if(!q||!text.includes(q))q=text;cb._quote=q;cb.onchange=suggest;});suggest();fields();}
  function fields(){var rows=TemplateFields.candidates(el('text').value);el('fields').innerHTML=rows.map(function(f,i){return '<label><input type="checkbox" data-template-field="'+i+'"'+(draft?.fields?.some(function(x){return x.source===f.source;})?' checked':'')+'>'+esc(f.source)+' — '+esc(f.kind==='execution_date'?'체결일 입력값만 허용':'표시 정보 입력값만 허용')+'</label>';}).join('')||'<p>상호: … / 대표자: … / 주소: … / 체결일: … 형태의 독립된 입력란이 없습니다. 본문 숫자·기한은 변경 허용하지 않습니다.</p>';
    el('fields').querySelectorAll('input').forEach(function(cb,i){cb._field=rows[i];cb.onchange=function(){el('approve').checked=false;};});}
  function selectedQuotes(){return Array.from(el('quotes').querySelectorAll('input:checked')).map(function(c){return c._quote;});}
  function suggest(){
    var text=selectedQuotes().join('\n'),cl={heading:'',body:text};
    var rows=checks().map(function(c){var kws=(c.triggers||{}).keywords||[],score=kws.filter(function(w){return text.includes(w);}).length;
      var tags=ContractTags.matchClause(c,cl,el('name').value);if(tags?.eligible)score+=2;return {cp:c,score:score};}).sort(function(a,b){return b.score-a.score;});
    el('check').innerHTML=rows.map(function(r){return '<option value="'+esc(r.cp.id)+'">'+(r.score?'후보 · ':'')+esc(r.cp.check)+'</option>';}).join('');
    el('tags').textContent=text?'자동 태그: '+JSON.stringify(ContractTags.values(ContractTags.analyzeClause(cl,el('name').value))):'근거 조항을 선택하면 관련 질문과 태그를 제안합니다.';
  }
  function bindings(){el('bindings').innerHTML=(draft?.bindings||[]).map(function(b){return '<p>'+esc(b.question)+' <button data-unbind="'+esc(b.check_id)+'">연결 제외</button><br>'+b.quotes.map(esc).join('<br>')+
    (b.variants||[]).map(function(v){return '<br>승인 표현 · '+esc(v.source.title)+' · '+v.quotes.map(esc).join(' / ')+' <button data-variant-remove="'+esc(v.id)+'">표현 제외</button>';}).join('')+'</p>';}).join('');
    el('bindings').querySelectorAll('[data-unbind]').forEach(function(b){b.onclick=function(){draft.bindings=draft.bindings.filter(function(x){return x.check_id!==b.dataset.unbind;});el('approve').checked=false;bindings();};});
    el('bindings').querySelectorAll('[data-variant-remove]').forEach(function(b){b.onclick=function(){draft.bindings.forEach(function(x){x.variants=(x.variants||[]).filter(function(v){return v.id!==b.dataset.variantRemove;});});el('approve').checked=false;bindings();};});}
  function currentDraft(){var scope={type_ids:Array.from(el('type').selectedOptions).map(function(o){return o.value;}),roles:el('role').value?[el('role').value]:[],stance:el('stance').value};
    if(!scope.type_ids.length)scope.type_ids=CR.types.map(function(x){return x.meta.type_id;});
    var t=TemplateLibrary.draft(el('name').value.trim(),el('revision').value.trim(),el('text').value,scope,draft?.text===el('text').value?draft.extraction:null);
    if(!t.name||!t.revision)throw Error('서식 이름과 버전을 입력하세요.');
    if(draft&&draft.text===t.text) t.bindings=JSON.parse(JSON.stringify(draft.bindings));
    t.fields=Array.from(el('fields').querySelectorAll('input:checked')).map(function(cb){return cb._field;});TemplateFields.validate(t.text,t.fields);return t;}
  function draftKey(t){return SafetyDigest.of([t.id,t.bindings.map(function(b){return [b.check_id,b.check_hash,b.quotes];})]);}
  function resetCandidates(){proposalRows=[];variantRows=[];proposalKey='';variantKey='';el('proposals').innerHTML='';el('variants').innerHTML='';el('variant-confirm').checked=false;}
  el('propose').onclick=function(){try{draft=currentDraft();resetCandidates();
    var allowed=new Set([CR.common].concat(CR.types.filter(function(t){return draft.type_ids.includes(t.meta.type_id);})).flatMap(function(d){return d.checks.map(function(c){return c.id;});}));
    proposalRows=TemplateAssist.proposals(draft,checks().filter(function(c){return allowed.has(c.id);}));
    proposalKey=draft.id;
    el('proposals').innerHTML=proposalRows.map(function(p,i){return '<div class="template-proposal"><label><input type="checkbox" data-proposal="'+i+'">'+esc(p.question)+'</label><p>'+p.evidence.map(function(e){return esc(e.heading)+' · 핵심어 '+esc(e.keywords.join(', '))+' · 태그 '+e.tag_hits.length+'개';}).join('<br>')+'</p><blockquote>'+p.quotes.map(esc).join('<br>')+'</blockquote><small>'+esc(p.warning)+'</small></div>';}).join('');
    status(proposalRows.length+'개 연결 초안을 만들었습니다. 내용을 확인한 초안만 선택해 연결하세요.');
  }catch(e){status(e.message);}};
  el('accept-proposals').onclick=function(){try{draft=currentDraft();if(draft.id!==proposalKey)throw Error('원문·범위가 변경되어 연결 초안을 다시 만들어야 합니다.');var n=0;el('proposals').querySelectorAll('input:checked').forEach(function(cb){var p=proposalRows[+cb.dataset.proposal],cp=checks().find(function(c){return c.id===p.check_id;});TemplateLibrary.bind(draft,cp,p.quotes);n++;});el('approve').checked=false;bindings();status(n+'개 초안을 연결했습니다. 마지막 승인 전까지 판정에는 사용하지 않습니다.');}catch(e){status(e.message);}};
  el('find-variants').onclick=async function(){this.disabled=true;try{draft=currentDraft();var originalKey=draftKey(draft),backup=await StandardAutoArchive.backup();packetCache=backup.packets||[];
    if(draftKey(currentDraft())!==originalKey)throw Error('서식이 변경되어 표현 후보를 다시 찾아야 합니다.');variantKey=originalKey;
    var found=TemplateAssist.variants(draft,checks(),loopCorpus,packetCache);variantRows=found.candidates;el('variant-confirm').checked=false;
    el('variants').innerHTML=variantRows.map(function(v,i){return '<div class="template-proposal"><label><input type="checkbox" data-variant="'+i+'">'+esc(v.question)+'</label><p>출처: '+esc(v.source.title)+' · '+(v.needs_original?'의견 속 인용 — 실제 원문과 일치하는지 확인 필요':'원문·사람의 조항 연결 확인됨')+'</p><blockquote>'+v.quotes.map(esc).join('<br>')+'</blockquote><p>자동 태그: '+esc(JSON.stringify(ContractTags.values(v.tags)))+'</p></div>';}).join('');
    status(variantRows.length+'개 표현 후보 / 실제 문구 없음 '+found.stats.no_quote+'개 / 시스템 판정·위험수용·충돌 등 제외 '+found.stats.excluded+'개. 원문이 없는 판단 메모만으로 규칙을 만들지 않습니다.');
  }catch(e){status(e.message);}finally{this.disabled=false;}};
  el('accept-variants').onclick=function(){try{draft=currentDraft();if(draftKey(draft)!==variantKey)throw Error('서식·연결 근거가 변경되어 표현 후보를 다시 찾아야 합니다.');var n=0;el('variants').querySelectorAll('input:checked').forEach(function(cb){var v=variantRows[+cb.dataset.variant];
    if(sources()[v.source.id]!==v.source.hash)throw Error('후보의 원자료가 바뀌었습니다. 다시 검색하세요.');
    TemplateAssist.approveVariant(draft,checks().find(function(c){return c.id===v.check_id;}),v,el('variant-confirm').checked);n++;});el('approve').checked=false;bindings();status(n+'개 표현을 연결했습니다. 등록·활성화 버튼으로 최종 저장하세요.');}catch(e){status(e.message);}};
  el('type').innerHTML=CR.types.map(function(t){return '<option value="'+esc(t.meta.type_id)+'">'+esc(t.meta.type_name||t.meta.type_id)+'</option>';}).join('');
  el('role').innerHTML='<option value="">지위 무관 — 이 기준을 양측에 적용</option>'+Array.from(new Set(ROLE_TERMS.concat(checks().flatMap(function(c){return c.party_roles||[];})))).map(function(r){return '<option>'+esc(r)+'</option>';}).join('');
  el('file').onchange=async function(){var files=Array.from(this.files),done=0,count=0,errors=[];this.disabled=true;
    try{for(var f of files){status(f.name+' 자동 처리 중…');try{var r=await extractFileStructure(f),t=register(f.name,r.text,r);done++;count+=t.bindings.length;}catch(e){errors.push(f.name+': '+e.message);}await new Promise(function(ok){setTimeout(ok,0);});}
      status(done+'개 자료 등록 완료 · 자동판정 연결 '+count+'개. 별도 승인은 필요하지 않습니다.'+(errors.length?' 처리 실패: '+errors.join(' / '):''));
    }finally{this.value='';this.disabled=false;}};
  el('split').onclick=function(){try{draft=null;el('approve').checked=false;clauses();bindings();resetCandidates();status('원문 변경으로 기존 연결 초안을 초기화했습니다.');}catch(e){status(e.message);}};
  el('bind').onclick=function(){try{draft=currentDraft();var cp=checks().find(function(c){return c.id===el('check').value;});TemplateLibrary.bind(draft,cp,selectedQuotes());bindings();status('질문에 근거를 연결했습니다. 질문 전체를 충족하는 조항을 모두 선택했는지 확인하세요.');}catch(e){status(e.message);}};
  el('save').onclick=function(){try{var t=currentDraft();if(!el('approve').checked)t=TemplateRegister.process(t.name,t.revision,t.text,{type_ids:t.type_ids,roles:t.roles,stance:t.stance},checks(),t.extraction);t.active=true;
    var next=JSON.parse(JSON.stringify(lib));next.templates=next.templates.filter(function(x){return x.id!==t.id;});next.templates.forEach(function(x){if(x.name===t.name)x.active=false;});next.templates.push(t);save(next);draft=t;status('등록 완료. 같은 이름의 이전 버전은 보존하되 자동판정을 중지했습니다.');}catch(e){status(e.message);}};
  el('backup').onclick=function(){var a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(lib)],{type:'application/json'}));a.href=url;a.download='표준서식_폐쇄망백업.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);};
  el('restore').onchange=async function(){try{if(!this.files[0])return;var data=TemplateLibrary.validate(JSON.parse(await this.files[0].text())),next=JSON.parse(JSON.stringify(lib)),n=0;
    data.templates.forEach(function(t){if(!next.templates.some(function(x){return x.id===t.id;})){t=TemplateRegister.process(t.name,t.revision,t.text,{type_ids:t.type_ids,roles:t.roles,stance:t.stance},checks());next.templates.push(t);n++;}});save(next);status(n+'개 복구·자동 처리 완료. 기존 자료는 유지하며 별도 승인은 필요하지 않습니다.');}catch(e){status('복구 실패: '+e.message);}finally{this.value='';}};
  el('evaluate').onclick=async function(){try{var backup=await StandardAutoArchive.backup(),packets=backup.packets||[],rows=[],excluded=0,changed=0;
    packetCache=packets;
    for(var p of packets){var result=TemplateLibrary.replay(lib,p,SafetyRuntime.allChecks(),sources());rows=rows.concat(result.rows);excluded+=result.excluded;changed+=result.changed;await new Promise(function(ok){setTimeout(ok,0);});}
    status('내부 저장본 '+packets.length+'건 / 사용자 정답 '+rows.length+'개 / 자동충족 '+rows.filter(function(r){return r.eligible;}).length+'개 / 검토의견을 통과시킨 불일치 '+rows.filter(function(r){return r.false_safe;}).length+'개 / 이행확인 제외 '+excluded+'개 / 질문변경 별도 '+changed+'개. 학습자료와 겹칠 수 있어 독립 정확도는 아닙니다.');
  }catch(e){status('평가 실패: '+e.message);}};
  window.addEventListener('storage',function(e){if(e.key===KEY){try{lib=e.newValue?TemplateLibrary.validate(JSON.parse(e.newValue)):TemplateLibrary.empty();}catch(err){lib=TemplateLibrary.empty();status(err.message);}refresh();render();}});
  async function reloadSources(event){
    var id=event?.detail?.id;if(id)reloadIds.add(id);else reloadAll=true;
    if(reloadPromise)return reloadPromise;
    reloadPromise=(async function(){var changed=false,recheck=false;
      do{var full=reloadAll,ids=Array.from(reloadIds);reloadAll=false;reloadIds.clear();
        try{
          var next=full?(await StandardAutoArchive.backup()).packets||[]:await Promise.all(ids.map(function(id){return StandardAutoArchive.get(id);}));
          var hashes=new Map(),changedIds=[],previous=new Map(packetCache.map(function(p){return [p.id,p];}));
          next.forEach(function(p){if(!p)return;var hash=SafetyDigest.of(p);hashes.set(p.id,hash);if(packetDigests.get(p.id)!==hash)changedIds.push(p.id);});
          if(full){packetDigests.forEach(function(_,id){if(!hashes.has(id))changedIds.push(id);});}
          else ids.forEach(function(id){if(!hashes.has(id)&&packetDigests.has(id))changedIds.push(id);});
          if(changedIds.length){
            changed=true;
            var byId=new Map(next.filter(Boolean).map(function(p){return [p.id,p];}));
            // 본건의 새 수기 메모는 다음 분석부터 검색 자료에 반영한다. 현재 화면을 다시 만들지 않는다.
            // 단, 표준 표현의 출처로 쓰인 패킷은 변경 즉시 재검사한다.
            recheck=recheck||changedIds.some(function(id){var p=byId.get(id)||previous.get(id);
              return !p||p.contract_hash!==verdictHash||lib.templates.some(function(t){return t.bindings.some(function(b){return (b.variants||[]).some(function(v){return v.source.id.startsWith('packet:'+id+':');});});});});
            if(full){packetCache=next;packetDigests=hashes;}
            else{var affected=new Set(ids);packetCache=packetCache.filter(function(p){return !affected.has(p.id);}).concat(next.filter(Boolean)).sort(function(a,b){return a.id<b.id?-1:a.id>b.id?1:0;});
              ids.forEach(function(id){if(hashes.has(id))packetDigests.set(id,hashes.get(id));else packetDigests.delete(id);});}
          }
        }catch(e){if(packetCache.length){packetCache=[];packetDigests.clear();changed=true;recheck=true;}status('과거 표현 자료를 읽지 못했습니다. 현재 계약·표준 원문 검사는 계속합니다. '+e.message);}
      }while(reloadAll||reloadIds.size);
      if(changed&&recheck)refresh();
    })();
    try{await reloadPromise;}finally{reloadPromise=null;}
  }
  window.addEventListener('cr-evaluation-packet-changed',reloadSources);
  window.addEventListener('storage',function(e){if(e.key==='cr-template-sources-changed'){var detail;try{detail=JSON.parse(e.newValue);}catch(err){}reloadSources({detail:detail});}});
  reloadSources();
  render();if(error)status('등록 자료 읽기 실패: '+error+' — 자동판정 비활성. 백업으로 복구하세요.');
  function resolveDocuments(documents){var result=TemplateLibrary.resolveDocuments(lib,documents),notice=document.getElementById('standard-reference-notice');
    if(notice){notice.hidden=!result.ambiguous.length;notice.textContent=result.ambiguous.map(function(r){return r.name+': '+r.reason;}).join(' / ')+(result.ambiguous.length?' — 적용할 원문을 부속 서류로 추가하거나, 등록 표준서식의 본건 별첨으로 사용을 선택하세요. 다른 읽힌 조항의 자동판정은 계속합니다.':'');}
    return result.documents;
  }
  function analysisPackets(packets,contractHash){return (packets||[]).filter(function(p){return !contractHash||p.contract_hash!==contractHash||lib.templates.some(function(t){
    return t.bindings.some(function(b){return (b.variants||[]).some(function(v){return v.source.id.startsWith('packet:'+p.id+':');});});});});}
  return {apply:apply,mapResult:mapResult,packets:function(){return packetCache;},analysisPackets:analysisPackets,inputVersion:function(){return DocumentStructure.revisionToken(lib);},resolveDocuments:resolveDocuments,get:function(){return JSON.parse(JSON.stringify(lib));},report:function(){return lastRows;}};
})();
