"use strict";
var EvalPreparationUI=(function(){
  var store=EvalPrepare.empty(), selected="", selectedItem="", db=null, busy=false, editVersion=0;
  function e(id){return document.getElementById("ep-"+id);}
  function msg(s){e("message").textContent=s;}
  function current(){return store.cases[selected];}
  function item(){var c=current();return c&&c.items.find(function(i){return i.id===selectedItem;});}
  function persistCorpus(next){
    // 저장 실패 시 메모리만 바뀌어 성공한 것처럼 보이지 않도록 한다.
    localStorage.setItem(LOOP_KEY,JSON.stringify(next));loopCorpus=next;
  }
  e('legacy-file').addEventListener('change',async function(){
    var file=this.files[0];if(!file)return;
    e('legacy-confirm').checked=false;
    try{
      if(!state.text||document.getElementById('contract-text').value!==state.text)throw Error('당시 계약서를 먼저 분석하세요.');
      var hash=hashText(state.text),obj=JSON.parse(await file.text());
      if(!obj.meta||obj.meta.contract_hash!==hash||!obj.verdicts||typeof obj.verdicts!=='object'||Array.isArray(obj.verdicts))throw Error('현재 계약과 일치하는 개별 판정파일이 아닙니다. 집계 백업은 이곳에서 연결할 수 없습니다.');
      if(hash!==hashText(state.text)||document.getElementById('contract-text').value!==state.text)throw Error('입력이 바뀌었습니다. 다시 선택하세요.');
      persistCorpus(Loop.mergeIntoCorpus(loopCorpus,obj));
      e('legacy-reviewer').value=getReviewer();
      var record=loopCorpus.judgment_ledger.records[hash];
      e('legacy-status').textContent=record.pending?'상충하는 판정파일이 있어 연결을 보류했습니다. 현재 계약의 최종 판정을 확인해 누적 저장하세요.':
        '개별 판정 '+Object.keys(obj.verdicts).length+'개를 보존했습니다. 아래 동일 문서 확인 후 연결하세요.';
    }catch(err){e('legacy-status').textContent=err.message;}finally{this.value='';}
  });
  e('legacy-bind').addEventListener('click',function(){
    try{
      if(!state.result||document.getElementById('contract-text').value!==state.text)throw Error('현재 계약을 먼저 분석하세요.');
      var next=Loop.bindJudgmentSource(loopCorpus,{contract_hash:hashText(state.text),comparison_context:SafetyRuntime.comparisonContext(),
        reviewer:e('legacy-reviewer').value,source_confirmed:e('legacy-confirm').checked,date:verdictToday(),
        note:'동일 본문·별첨 버전 및 직접 확정한 사람 판정의 현행 체크 비교 재사용 확인'});
      persistCorpus(next);e('legacy-confirm').checked=false;
      e('legacy-status').textContent='문서 연결을 저장했습니다. 현재 계약을 과거 판정과 비교할 수 있습니다. 기존 집계 수치는 중복 변경하지 않았습니다.';
    }catch(err){e('legacy-status').textContent=err.message;}
  });
  e('corpus-compare').addEventListener('click',async function(){
    var button=this;if(button.disabled)return;button.disabled=true;e('compare-results').textContent='';
    try{
      if(!state.result||!state.text||document.getElementById('contract-text').value!==state.text)throw Error('계약을 입력하고 먼저 분석하세요.');
      var hash=hashText(state.text),ctx=SafetyRuntime.comparisonContext(),corpus=loopCorpus;
      var probe=EvalPrepare.compareCurrent(corpus,{contract_hash:hash,comparison_context:ctx});
      if(['unlinked','source_mismatch'].indexOf(probe.status)!==-1)throw Error('동일한 본문·별첨·검토 조건이 기록된 누적 판정이 없습니다. 기존 집계만으로는 개별 계약을 재채점할 수 없습니다.');
      e('compare-summary').textContent='과거 자료 참고 전·후의 매핑을 다시 계산하고 있습니다. 현재 판정은 변경하지 않습니다.';
      await new Promise(function(resolve){setTimeout(resolve,0);});
      if(SafetyDigest.of(ctx)!==SafetyDigest.of(SafetyRuntime.comparisonContext())||document.getElementById('contract-text').value!==state.text)throw Error('입력이 변경되었습니다. 다시 분석하세요.');
      var docs=analysisDocs(),options={modules:state.activeModules,stance:state.stance,baseClauses:state.baseClauses||[],
        docTitle:state.docTitle||'',partyRoles:state.partyRoles||[],partyContext:state.partyContext||null,historyRelated:[]};
      var before=ReviewCore.run(state.clauses,docs,options,state.subDocs||[]);
      options.historyRelated=HistoryAssist.retrieve(currentHistoryKnowledge(),(state.docTitle||'')+' '+state.text,document.getElementById('input-department').value);
      var after=ReviewCore.run(state.clauses,docs,options,state.subDocs||[]);
      var result=EvalPrepare.compareCurrent(corpus,{contract_hash:hash,comparison_context:ctx,before:before.result.results,after:after.result.results,subCoverage:after.subCoverage});
      var labels={addressed:'근거 후보 있음',verify:'확인 필요',consider:'검토 후보',quiet:'미노출',not_selected:'미선정',base_covered:'원계약 근거'};
      e('compare-summary').textContent='비교 가능한 사람 판정 '+result.rows.length+'개 · 명시적 근거 조항 정답 '+result.mapping.reviewed+'개 · 최초 추천 일치 '+result.mapping.before_correct+' → '+result.mapping.after_correct+'개. '+result.warning;
      e('compare-results').innerHTML=result.rows.length?'<table><thead><tr><th>항목</th><th>과거 판정</th><th>참고 전 → 후</th><th>확인사항</th></tr></thead><tbody>'+result.rows.map(function(r){var cp=_cpById(r.check_id);return '<tr><td>'+esc(cp&&(cp.label||cp.check)||r.check_id)+'</td><td>'+esc(r.verdict)+'</td><td>'+esc(labels[r.before]||r.before)+' → '+esc(labels[r.after]||r.after)+'</td><td>'+(r.needs_attention?'근거 연결·쟁점 노출 확인':r.annex_found?'별첨 후보 있음 — 충족 판정 아님':'')+'</td></tr>';}).join('')+'</tbody></table>':'<p>원문은 일치하지만 비교할 수 있는 사람 판정·현행 체크 기준이 없습니다.</p>';
    }catch(err){e('compare-summary').textContent=err.message;}finally{button.disabled=false;}
  });
  e('corpus-scan').addEventListener('click',function(){
    var result=EvalPrepare.corpusReadiness(loopCorpus,SafetyRuntime.allChecks());
    e('corpus-summary').textContent='누적 계약 '+result.contracts+'건 · 개별 판정 기록 '+result.recorded_contracts+
      '건 · 검토 ID 보유 '+result.linked_reviews+'건 · 개선 확인 항목 '+result.rows.length+'개. 원문 재채점은 실행하지 않았습니다.';
    e('corpus-results').innerHTML=result.rows.length?'<table><thead><tr><th>체크항목</th><th>근거 불충분 표시 후 이상없음</th><th>과거 검토의견</th><th>확인 방향</th></tr></thead><tbody>'+
      result.rows.slice(0,30).map(function(r){return '<tr><td>'+esc(r.label)+'</td><td>'+r.weak_safe+'</td><td>'+r.issue+'</td><td>'+esc(r.status)+'</td></tr>';}).join('')+
      '</tbody></table><p>최대 30개 우선 표시. 횟수는 누적 관찰이며 독립 계약 수나 안전한 자동처리 가능 수가 아닙니다. 제외된 구 체크 '+result.excluded_checks+'개.</p>':
      '<p>현재 코퍼스에서 우선 확인할 항목이 없습니다. 자료가 없으면 팀·지식관리에서 코퍼스를 불러오세요.</p>';
  });
  function open(){return new Promise(function(resolve,reject){var r=indexedDB.open("cr-evaluation-preparation",1);
    r.onupgradeneeded=function(){r.result.createObjectStore("work");};r.onsuccess=function(){db=r.result;resolve();};r.onerror=function(){reject(r.error);};});}
  function save(){return new Promise(function(resolve,reject){var tx=db.transaction("work","readwrite");tx.objectStore("work").put(store,"current");tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error);};});}
  function load(){return new Promise(function(resolve,reject){var tx=db.transaction("work"),r=tx.objectStore("work").get("current");r.onsuccess=function(){if(r.result)store=r.result;resolve();};r.onerror=function(){reject(r.error);};});}
  function controls(on){busy=on;e("root").querySelectorAll("button,input,select,textarea").forEach(function(n){n.disabled=on;});}
  function guard(fn){return async function(){if(busy)return;editVersion++;controls(true);try{await fn();}catch(err){msg("처리 실패: "+err.message+". 저장 여부를 확인하세요.");}finally{controls(false);}};}
  function choice(value,label){return '<option value="'+esc(value)+'">'+esc(label)+'</option>';}
  function render(){
    var q=e("search").value.trim().toLowerCase(),keys=(store.active||[]).filter(function(k){var s=store.cases[k].source;return [s.title,s.department,(s.tags||[]).map(function(t){return t.label||t.hashtag;}).join(" ")].join(" ").toLowerCase().includes(q);});
    if(keys.indexOf(selected)===-1)selected=keys[0]||"";
    e("cases").innerHTML=keys.map(function(k){var c=store.cases[k];return choice(k,(c.source.kind==="legal"?"법률검토 참고 · ":"계약 · ")+c.source.title);}).join("");e("cases").value=selected;
    var c=current();e("workspace").hidden=!c;e("summary").textContent=keys.length+"건 · 현재 목록의 확인 초안 "+keys.reduce(function(n,k){return n+store.cases[k].items.filter(function(i){return i.status==="reviewed_draft";}).length;},0)+"건 (독립 정답 확정 전)";
    if(!c)return;
    e("source").textContent=c.source.title+" / "+c.source.department+"\n첨부 참조: "+c.source.references.join(" · ")+"\n신청·결과 충돌: "+c.source.conflicts.length+"\n과거 검토내용:\n"+(c.source.opinion||"검토결론 원문 없음 — 태그 근거만으로 정답을 만들지 않습니다.");
    e("support").textContent=(c.source.support||[]).map(function(x){return x.source+": "+x.quote;}).join("\n");
    e("version").value=c.version;e("source-confirmed").checked=false;
    e("docs").innerHTML=c.documents.map(function(d,index){return '<details><summary>'+esc(d.name)+' · '+(d.role==="main"?"본문":"별첨/기타")+'</summary><pre>'+esc(d.text)+'</pre><button class="ep-main" data-index="'+index+'">이 파일을 본문으로 지정</button>'+(d.warnings||[]).map(function(w){return '<p>'+esc(typeof w==="string"?w:JSON.stringify(w))+'</p>';}).join("")+'</details>';}).join("");
    e("docs").querySelectorAll(".ep-main").forEach(function(b){b.addEventListener("click",guard(async function(){c.documents.forEach(function(d,i){d.role=i===Number(b.dataset.index)?"main":"attachment";});EvalPrepare.invalidate(c);await save();render();}));});
    if(!c.items.some(function(i){return i.id===selectedItem;}))selectedItem=c.items[0]&&c.items[0].id;
    e("items").innerHTML=c.items.map(function(i){return choice(i.id,({draft:"확인 전",recheck:"재확인",held:"보류",reviewed_draft:"초안 확인됨",reference_checked:"참고 기준 확인됨"}[i.status]||"확인 전")+" · "+i.quote.slice(0,80));}).join("");e("items").value=selectedItem||"";renderItem();
  }
  function renderItem(){var c=current(),i=item();e("answer").hidden=!i;if(!i)return;
    e("quote").textContent=i.quote;e("suggestion").textContent="초안 제안: "+({safe:"문제없음 후보",issue:"문제 있음 후보",unknown:"해석 확인 필요"}[i.suggestion])+" — 단순 표현 탐지 결과이며 확정 정답이 아닙니다.";
    var checks=SafetyRuntime.allChecks(),top=EvalPrepare.candidates(i,checks);
    e("mapping").innerHTML=choice("","대응 체크를 확인하세요")+choice("unmapped","기존 체크에 없는 쟁점")+top.map(function(x){return choice(x.id,"후보 · "+x.id+" "+x.label);}).join("")+checks.filter(function(cp){return !top.some(function(t){return t.id===cp.id;});}).map(function(cp){return choice(cp.id,cp.id+" "+(cp.label||cp.check));}).join("");
    e("mapping").value=i.check_id||"";e("truth").value=i.truth||"";e("reason").value=i.reason||"";e("evidence").value=i.evidence||"";
    e("reviewer").value=i.reviewer||getReviewer();
  }
  // 입력은 즉시 메모리에 반영하고 트랜잭션으로 저장한다. 확인 버튼은 별도이다.
  function autosave(){var i=item();if(!i||busy)return;Object.assign(i,{check_id:e("mapping").value,truth:e("truth").value,reason:e("reason").value,evidence:e("evidence").value,reviewer:e("reviewer").value});
    if(i.status!=="draft")i.status="recheck";var revision=++editVersion;save().then(function(){if(revision===editVersion)msg("작업 저장됨 · 확인 완료는 별도 버튼으로 처리합니다.");}).catch(function(err){msg("저장 실패: "+err.message);});}
  e("prepare").addEventListener("click",guard(async function(){store=EvalPrepare.prepare(store,reviewHistory,legalOpinionKnowledge);await save();render();msg("자료 준비됨. 과거 의견이 있는 계약부터 확인하고 필요한 원문만 추가하세요. 기존 검토 중인 계약 화면은 변경하지 않습니다.");}));
  e("cases").addEventListener("change",function(){selected=this.value;selectedItem="";render();});e("items").addEventListener("change",function(){selectedItem=this.value;renderItem();});e("search").addEventListener("input",render);
  e("files").addEventListener("change",guard(async function(){var c=current();if(!c)return;var files=Array.from(e("files").files),errors=[];
    for(var f of files){try{var d=await extractFileStructure(f);if(!d.text.trim())throw Error("추출된 본문 없음");if(c.documents.some(function(x){return x.digest===d.file_sha256;}))continue;c.documents.push({name:f.name,text:d.text,digest:d.file_sha256,role:"attachment",warnings:d.warnings||[]});EvalPrepare.invalidate(c);await save();}catch(err){errors.push(f.name+": "+err.message);}}
    e("files").value="";render();msg(errors.length?errors.join(" / "):"파일 저장됨. 본문 파일을 지정하고 문서 버전을 확인하세요.");}));
  e("version").addEventListener("change",guard(async function(){var c=current();c.version=e("version").value;EvalPrepare.invalidate(c);await save();render();}));
  ["mapping","truth","reason","evidence","reviewer"].forEach(function(id){e(id).addEventListener("input",autosave);e(id).addEventListener("change",autosave);});
  e("confirm").addEventListener("click",guard(async function(){var c=current(),i=item();EvalPrepare.confirm(c,i,{truth:e("truth").value,check_id:e("mapping").value,reason:e("reason").value,evidence:e("evidence").value,reviewer:e("reviewer").value,source_confirmed:e("source-confirmed").checked});await save();render();msg(c.source.kind==="legal"?"법률검토 기준 확인됨. 특정 계약의 정답으로 자동 승격하지 않습니다.":"정답 초안 확인 저장됨. 독립 검수 전이며 채점·자동승인에 아직 사용하지 않습니다.");}));
  e("add").addEventListener("click",guard(async function(){var c=current();if(!c)return;var quote=e("new").value.trim();if(!quote)return;var added=EvalPrepare.splitOpinion(quote,"manual:"+Date.now());c.items=c.items.concat(added);selectedItem=added[0].id;e("new").value="";await save();render();}));
  e("backup").addEventListener("click",guard(async function(){await save();var url=URL.createObjectURL(new Blob([JSON.stringify(store)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="evaluation-preparation-"+verdictToday()+".json";a.click();setTimeout(function(){URL.revokeObjectURL(url);},3000);msg("원문·과거 의견 포함 내부 백업 생성. 폐쇄망 밖으로 반출하지 마세요.");}));
  e("restore").addEventListener("change",guard(async function(){var f=e("restore").files[0];if(!f)return;store=EvalPrepare.restore(store,JSON.parse(await f.text()));await save();render();msg("추가 복구됨. 기존 로컬 작업은 덮어쓰지 않았으며 복구된 판단은 재확인 대상입니다.");e("restore").value="";}));
  controls(true);open().then(load).then(function(){render();msg("평가자료 준비를 누르면 기존 적재 자료를 읽습니다. 이 화면은 정답 초안 준비 단계입니다.");controls(false);}).catch(function(err){msg("저장소 열기 실패: "+err.message);});
  async function receiveIncident(incident,packet,cp){if(busy)throw Error('평가 저장 작업 중입니다. 중지는 완료되었으며 신고 원문 편입은 다시 시도하세요.');controls(true);var old=store;try{store=EvalOperational.intake(store,incident,packet,cp);await save();render();}catch(err){store=old;throw err;}finally{controls(false);}}
  return {current:current,getStore:function(){return store;},save:save,isBusy:function(){return busy;},refresh:render,receiveIncident:receiveIncident};
})();
