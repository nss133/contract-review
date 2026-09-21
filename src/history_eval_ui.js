"use strict";
(function () {
  var rows=[], current=null, confirmation="", KEY="cr-history-eval-drafts-v1";
  function el(id){return document.getElementById("he-"+id);}
  function message(t){el("message").textContent=t;}
  function draft(){return {family:el("family").value,date:el("date").value,version:el("version").value,confirmed:el("confirm").checked};}
  function drafts(){return JSON.parse(localStorage.getItem(KEY)||"{}");}
  function saveDraft(){if(!current)return;var data=drafts();data[current.id]={revision:current.revision,draft:Object.assign(draft(),{confirmed:false})};localStorage.setItem(KEY,JSON.stringify(data));}
  function select(){
    current=rows.find(function(r){return r.id===el("candidate").value;});el("confirm").checked=false;confirmation="";
    if(!current){el("detail").textContent="적재된 이력이 없습니다.";return;}
    var saved=drafts()[current.id],d=saved&&saved.revision===current.revision?saved.draft:{};
    el("family").value=d.family||"";el("date").value=d.date||"";el("version").value=d.version||"unknown";
    el("detail").textContent=[current.department,current.type,"과거 의견: "+(current.has_opinion?"있음 (정답으로 복사하지 않음)":"없음 (이상없음으로 간주하지 않음)"),
      "태그: "+current.tags.join(" · "),"첨부 참조: "+current.attachments.join(" · "),"신청·결과 충돌: "+current.conflicts].join("\n");
  }
  function refresh(){
    rows=HistoryEval.candidates(reviewHistory||{latest:{}});
    var query=el("search").value.trim().toLowerCase();
    var filtered=rows.filter(function(r){return [r.title,r.department,r.type,r.tags.join(" ")].join(" ").toLowerCase().includes(query);});
    el("candidate").innerHTML=filtered.map(function(r){return '<option value="'+esc(r.id)+'">'+esc(r.title+' · '+r.department)+'</option>';}).join('');
    select();message(filtered.length+" / "+rows.length+"건 — 목록은 후보이며 검수된 정답이 아닙니다.");
  }
  function download(obj,name){var url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=name+".json";a.click();setTimeout(function(){URL.revokeObjectURL(url);},3000);}
  function generate(){
    var fresh=HistoryEval.candidates(reviewHistory).find(function(r){return current&&r.id===current.id;});
    if(!fresh||fresh.revision!==current.revision)throw Error("이력이 변경되었습니다. 후보 목록을 새로 불러오세요.");
    var d=draft();HistoryEval.validate(current,d,{analyzed:!!state.result,text:state.text||"",live:document.getElementById("contract-text").value});
    if(confirmation!==SafetyRuntime.inputKey())throw Error("원문·별첨·분석 조건이 변경되었습니다. 연결 대조를 다시 확인하세요.");
    if(JSON.stringify(segmentContract(state.text))!==JSON.stringify(state.clauses))throw Error("현재 원문을 재분석하세요.");
    var context=Object.assign({},SafetyRuntime.bundle().context,{history_evaluation:true,department:current.department});
    var p=SafetyEval.build({runId:"history-eval-"+Date.now()+"-"+SafetyDigest.of(current).slice(0,12),
      contractHash:hashText(state.text),familyId:d.family.trim(),appVersion:CR.app_version,
      documents:safetyDocuments(),clauses:state.clauses,checkpoints:SafetyRuntime.allChecks(),results:[],context:context});
    p.checks_fingerprint=SafetyRuntime.checksFingerprint();p.case_date=d.date;
    p=SafetyRuntime.replay(p,[p.family_id]);
    // 이력 ID·과거 의견은 블라인드 정답 파일에 넣지 않는다.
    var gold=SafetyEval.goldTemplate(p);
    var trace={format:"cr-history-eval-trace-v1",run_id:p.run_id,source_id:current.id,revision:current.revision,
      family_id:p.family_id,document_version:d.version,case_date:d.date,documents_digest:SafetyDigest.of(p.documents),history_retrieval:"disabled"};
    saveDraft();download(p,p.run_id+"-observation");download(gold,p.run_id+"-gold");download(trace,p.run_id+"-trace");
    message("관찰·빈 정답·연결 이력 3개 파일 저장 요청. 다운로드 차단 여부를 확인하세요. 정답 파일만 독립 검수자에게 전달하고 아래 검수 작업대에서 여세요.");
  }
  function guard(fn){return function(){try{fn();}catch(e){message(e.message);}};}
  el("refresh").addEventListener("click",guard(refresh));el("search").addEventListener("input",guard(refresh));
  el("candidate").addEventListener("change",guard(select));el("save").addEventListener("click",guard(function(){saveDraft();message("후보 준비 상태 저장. 원본 대조 확인은 매번 새로 받습니다.");}));
  el("generate").addEventListener("click",guard(generate));
  el("confirm").addEventListener("change",function(){confirmation=this.checked?SafetyRuntime.inputKey():"";});
  ["family","date","version"].forEach(function(id){el(id).addEventListener("change",function(){el("confirm").checked=false;});});
})();
