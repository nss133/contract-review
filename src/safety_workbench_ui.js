"use strict";
var SafetyWorkbenchUI=(function(){
  var review=null,activeReviewId="",cases=Object.create(null),golds=[],dataset=null;
  function el(id){return document.getElementById("wb-"+id);}
  function msg(s){el("message").textContent=s;}
  function guard(fn){return function(){try{return fn();}catch(e){msg("보류: "+e.message);}};}
  function read(file){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){try{resolve(JSON.parse(r.result));}catch(e){reject(e);}};r.onerror=function(){reject(Error("파일 읽기 실패"));};r.readAsText(file);});}
  function save(obj,name){var url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=name+".json";a.click();URL.revokeObjectURL(url);}
  function indices(s){if(!s.trim())return [];return s.split(",").map(function(v){if(!/^\d+$/.test(v.trim()))throw Error("본문 index는 정수와 쉼표로 입력하세요");return Number(v.trim());});}
  function showReview(){
    if(!review)return;var l=review.labels.find(function(x){return x.check_id===el("review-check").value;});if(!l)return;
    activeReviewId=l.check_id;
    el("review-question").textContent=l.check+(l.guidance&&l.guidance.pass?" / 충분성 기준: "+l.guidance.pass:"");
    el("truth").value=l.truth;el("direct").value=l.direct_clause_indices.join(",");el("evidence").value=l.evidence;el("note").value=l.note;
  }
  function captureReview(){
    if(!review)throw Error("블라인드 정답 양식을 먼저 불러오세요");
    review.reviewer=el("reviewer").value.trim();review.source_reviewed=el("source-reviewed").checked;review.independent=el("independent").checked;
    var l=review.labels.find(function(x){return x.check_id===activeReviewId;});
    var direct=indices(el("direct").value);
    if(!direct.every(function(i){return review.clauses.some(function(c){return c.index===i;});}))throw Error("양식에 없는 본문 index");
    if(el("truth").value&&(!el("note").value.trim()||!el("evidence").value.trim()))throw Error("판단 사유와 원본 위치 필요");
    Object.assign(l,{truth:el("truth").value,direct_clause_indices:direct,evidence:el("evidence").value.trim(),note:el("note").value.trim()});
    return review;
  }
  function invalidate(){dataset=null;el("dataset-save").disabled=true;el("evaluation").textContent="시험셋 변경 — 다시 고정·평가 필요";}
  function rows(){return Object.keys(cases).map(function(id){var c=cases[id];c.golds=golds.filter(function(g){return g.run_id===id;});return c;});}
  function renderCases(){
    var list=rows();el("cases").innerHTML='<table><thead><tr><th>실행/계열</th><th>분할</th><th>검수 파일</th></tr></thead><tbody>'+list.map(function(c){
      var p=c.observation;return '<tr><td>'+esc(p.run_id)+' / '+esc(p.family_id)+'</td><td><select data-split="'+esc(p.run_id)+'">'+
        ['development','test','adversarial'].map(function(s){return '<option'+(s===c.split?' selected':'')+'>'+s+'</option>';}).join('')+'</select></td><td>'+c.golds.length+'</td></tr>';
    }).join('')+'</tbody></table>';
    el("cases").querySelectorAll('[data-split]').forEach(function(select){select.addEventListener('change',function(){cases[select.dataset.split].split=select.value;invalidate();});});
    el("resolve-case").innerHTML=list.map(function(c){return '<option value="'+esc(c.observation.run_id)+'">'+esc(c.observation.run_id)+'</option>';}).join('');
  }
  function rawDataset(){return {format:"cr-safety-dataset-v1",id:el("dataset-id").value.trim(),owner:el("owner").value.trim(),frozen_on:verdictToday(),cases:rows()};}
  function policy(){var s=SafetyRuntime.get();el("rule-select").innerHTML=Object.keys(s.rules).map(function(id){return '<option>'+esc(id)+'</option>';}).join('');
    el("policy-status").textContent=(s.enabled?"승인 범위 활성화":"자동허용 비활성화")+" · "+Object.keys(s.approvals).map(function(id){var a=s.approvals[id];return id+": "+a.status+" (만료 "+a.expires+")";}).join(" / ");
    el("events").textContent=JSON.stringify(s.events,null,2);el("history-map").value=JSON.stringify(s.historyFamilies||{},null,2);
  }
  function actor(){return el("actor").value.trim();}function basis(){return el("basis").value.trim();}
  function report(out){
    el("scopes").innerHTML=Object.keys(out.groups).map(function(k){var v=JSON.parse(k);return '<option value="'+esc(k)+'">'+esc(v[0]+' · '+v[1].join(' / '))+'</option>';}).join('');
    el("evaluation").innerHTML='<p>차단 사례 '+out.blocking_cases+' · 반례/판단불가에서 보류 '+out.negative_cases+'건</p><table><tr><th>검증된 유형/역할</th><th>시험 후보 계열 수</th><th>0오류 95% 상한</th></tr>'+Object.keys(out.groups).map(function(k){var g=out.groups[k];return '<tr><td>'+esc(k)+'</td><td>'+g.family_count+'</td><td>'+(g.upper95===null?'추정 불가':(g.upper95*100).toFixed(3)+'%')+'</td></tr>';}).join('')+'</table><p>'+esc(out.caveat)+'</p>'+
      '<p>이 규칙 체크의 매핑 Top1 정답 '+out.mapping.top1_correct+'/'+out.mapping.reviewed+' · Top3 직접 근거 포함 '+out.mapping.top3_found+'/'+out.mapping.direct+' · 근거 없는 조항 연결 '+out.mapping.false_direct+' · 문제 정답 중 비노출 '+out.mapping.unsurfaced_issues+'/'+out.mapping.issue_count+'</p>'+
      '<details><summary>유형·부서별 진단 (부서는 적용범위 제한이 아님)</summary><pre>'+esc(JSON.stringify(out.slices,null,2))+'</pre></details>';
  }
  function init(){if(!el("review-file"))return;
    if(SafetyRuntime.loadError())msg("승인 원장을 사용하지 못해 자동허용을 중지했습니다: "+SafetyRuntime.loadError());
    policy();
    el("review-file").addEventListener("change",function(){var file=this.files[0];if(!file)return;read(file).then(function(g){
      if(g.format!=="cr-safety-gold-v1"||!Array.isArray(g.labels)||!g.labels.length)throw Error("블라인드 정답 파일 필요");
      review=g;el("reviewer").value=g.reviewer||"";el("source-reviewed").checked=g.source_reviewed===true;el("independent").checked=g.independent===true;
      el("review-docs").innerHTML=(g.documents||[]).map(function(d){return '<details><summary>'+esc(d.name)+'</summary><pre>'+esc(d.text)+'</pre></details>';}).join('')+'<details><summary>본문 index 목록</summary><pre>'+esc(JSON.stringify(g.clauses,null,2))+'</pre></details>';
      el("review-check").innerHTML=g.labels.map(function(l){return '<option value="'+esc(l.check_id)+'">'+esc(l.check_id+' '+l.check)+'</option>';}).join('');showReview();msg("예측 없이 원본과 질문만 불러왔습니다. 미검수는 빈값으로 남겨도 작업 저장할 수 있습니다.");
    }).catch(function(e){msg(e.message);});});
    el("review-check").addEventListener("change",function(){try{captureReview();showReview();}catch(e){el("review-check").value=activeReviewId;msg(e.message);}});
    ["dataset-id","owner"].forEach(function(id){el(id).addEventListener("input",invalidate);});
    el("label-save").addEventListener("click",guard(function(){captureReview();var sel=el("review-check");if(sel.selectedIndex<sel.options.length-1)sel.selectedIndex++;showReview();msg(review.labels.filter(function(l){return !!l.truth;}).length+"/"+review.labels.length+"개 검수 기록. 작업 파일을 내부에 저장하세요.");}));
    el("review-save").addEventListener("click",guard(function(){save(captureReview(),"safety-gold-"+review.run_id+"-"+(review.reviewer||"draft"));}));
    el("case-files").addEventListener("change",function(){var files=Array.from(this.files);Promise.all(files.map(read)).then(function(objects){
      objects.forEach(function(obj){
        if(obj.format==="cr-safety-observation-v1"){
          if(cases[obj.run_id]&&cases[obj.run_id].observation.seal!==obj.seal)throw Error("동일 실행 ID의 다른 관찰 기록 — 새 데이터셋에서 비교하세요");
          cases[obj.run_id]=cases[obj.run_id]||{split:"test",observation:obj,golds:[],resolutions:{}};
        }else if(obj.format==="cr-safety-gold-v1"){
          var at=golds.findIndex(function(g){return g.run_id===obj.run_id&&g.reviewer===obj.reviewer;});
          if(at>=0){if(SafetyDigest.of(golds[at])!==SafetyDigest.of(obj))throw Error("동일 검수자 정답 변경 — 기존 자료를 보존한 새 데이터셋을 사용하세요");}else golds.push(obj);
        }else if(obj.format==="cr-safety-dataset-v1"){
          if(Object.keys(cases).length)throw Error("데이터셋 복구는 빈 작업 화면에서 수행하세요 (새로고침 후 로드)");
          (obj.cases||[]).forEach(function(c){cases[c.observation.run_id]=c;golds=golds.concat(c.golds||[]);});el("dataset-id").value=obj.id;el("owner").value=obj.owner;
        }else throw Error("지원하지 않는 내부 평가 파일");
      });invalidate();renderCases();msg("자료 로드 완료. 개발/시험/반례 분할과 두 검수자의 파일을 확인하세요.");
    }).catch(function(e){invalidate();renderCases();msg(e.message);});});
    el("replay").addEventListener("click",guard(function(){var list=rows(),excluded=list.filter(function(c){return c.split!=="development";}).map(function(c){return c.observation.family_id;});
      if(!list.length)throw Error("케이스를 먼저 불러오세요");invalidate();el("replay").disabled=true;var index=0,replayed=[];
      function tick(){try{if(index===list.length){replayed.forEach(function(p){cases[p.run_id].observation=p;});el("replay").disabled=false;renderCases();msg("전 케이스 재실행 완료. 정답은 변경하지 않았습니다. 시험셋을 다시 고정하세요.");return;}
        replayed.push(SafetyRuntime.replay(list[index].observation,excluded));index++;msg("폐쇄망 내부 재실행 "+index+"/"+list.length);setTimeout(tick,0);
      }catch(e){el("replay").disabled=false;msg("재실행 중단 (기존 관찰 보존): "+e.message);}}tick();
    }));
    el("freeze").addEventListener("click",guard(function(){dataset=SafetyWorkbench.freeze(rawDataset());el("dataset-save").disabled=false;msg("시험셋 고정: "+dataset.id+" / "+dataset.seal.slice(0,16));}));
    el("dataset-save").addEventListener("click",guard(function(){if(!dataset)throw Error("먼저 시험셋을 고정하세요");save(dataset,"safety-dataset-"+dataset.id);}));
    el("conflict-show").addEventListener("click",guard(function(){var c=cases[el("resolve-case").value];if(!c)throw Error("케이스 필요");var id=el("resolve-check").value.trim();
      el("conflict").textContent=JSON.stringify(c.golds.map(function(g){return {reviewer:g.reviewer,label:g.labels.find(function(l){return l.check_id===id;})};}),null,2);}));
    el("resolution-save").addEventListener("click",guard(function(){var c=cases[el("resolve-case").value];if(!c)throw Error("케이스 필요");var id=el("resolve-check").value.trim(),r={reviewer:el("resolver").value.trim(),date:verdictToday(),
      truth:el("resolution").value,direct_clause_indices:indices(el("resolution-direct").value),note:el("resolution-note").value.trim(),evidence:el("resolution-evidence").value.trim()};
      var next=Object.assign({},c.resolutions||{});next[id]=r;var result=SafetyWorkbench.consensus(c.observation,c.golds,next);
      if(!result[id]||result[id].agreement!=="resolved")throw Error("선택 체크는 조정할 이견이 아닙니다");c.resolutions=next;invalidate();msg("원래 두 검수 결과를 보존한 제3자 조정 기록 저장");}));
    el("rule-template").addEventListener("click",function(){el("rule").value=JSON.stringify({id:"",check_id:"",revision:"1",type_ids:[],party_roles:[],rationale:"",obligations:[{id:"요건1",actors:[],actions:[],objects:[],conditions:[],polarity:"obligation"}]},null,2);});
    el("rule-register").addEventListener("click",guard(function(){var r=JSON.parse(el("rule").value),cp=SafetyRuntime.allChecks().find(function(c){return c.id===r.check_id;});
      if(!cp)throw Error("현재 지식에 없는 체크 ID");if(cp.auto_verdict===false)throw Error("이 체크는 사람 판단 전용이며 자동 규칙으로 우회할 수 없습니다");
      SafetyRuntime.save(SafetyWorkbench.register(SafetyRuntime.get(),r,actor(),verdictToday()));policy();msg("규칙 등록 완료. 아직 자동허용되지 않습니다.");}));
    el("evaluate").addEventListener("click",guard(function(){if(!dataset)throw Error("고정 시험셋 필요");var s=SafetyRuntime.get(),id=el("rule-select").value,out=SafetyWorkbench.evaluate(dataset,s.rules[id],SafetyRuntime.engineFingerprint());report(out);
      if(out.blocking_cases&&s.approvals[id]){SafetyRuntime.save(SafetyWorkbench.stop(s,id,actor(),"평가 오류/미해결 사례 발견",verdictToday()));policy();msg("평가에서 차단 사례가 확인되어 해당 승인 규칙을 중지했습니다.");}else msg("고정 시험셋 평가 완료. 아직 승인하지 않았습니다.");
    }));
    el("approve").addEventListener("click",guard(function(){if(!dataset)throw Error("고정 시험셋 필요");var options={approver:actor(),basis:basis(),representative:el("representative").checked,risk_limit:Number(el("risk").value)/100,expires:el("expires").value,scope_keys:Array.from(el("scopes").selectedOptions).map(function(o){return o.value;})};
      SafetyRuntime.save(SafetyWorkbench.approve(SafetyRuntime.get(),el("rule-select").value,dataset,options,SafetyRuntime.engineFingerprint(),verdictToday()));policy();msg("검증된 유형·역할 조합에 한해 승인 기록. 활성화는 별도입니다.");}));
    el("enable").addEventListener("click",guard(function(){SafetyRuntime.save(SafetyWorkbench.enable(SafetyRuntime.get(),actor(),basis(),verdictToday()));policy();msg("승인 범위 활성화. 만료·엔진 변경·요건 미충족·원본 미확인은 계속 보류합니다.");}));
    el("stop-rule").addEventListener("click",guard(function(){SafetyRuntime.save(SafetyWorkbench.stop(SafetyRuntime.get(),el("rule-select").value,actor(),basis(),verdictToday()));policy();msg("규칙 중지 완료. 재활성화에는 시험셋 재평가·재승인이 필요합니다.");}));
    el("stop-all").addEventListener("click",guard(function(){SafetyRuntime.save(SafetyWorkbench.stop(SafetyRuntime.get(),null,actor(),basis(),verdictToday()));policy();msg("자동판정 전역 중지 완료");}));
    el("history-save").addEventListener("click",guard(function(){var map=JSON.parse(el("history-map").value);if(!map||Array.isArray(map))throw Error("source_id별 객체 필요");Object.keys(map).forEach(function(id){var m=map[id];if(!m.family_id||!/^\d{4}-\d{2}-\d{2}$/.test(m.date||""))throw Error("계열 ID·검토 기준일 필요");});
      if(!actor()||!basis())throw Error("검색 메타데이터 확인자·사유 필요");
      var s=SafetyRuntime.get();s.historyFamilies=map;s.enabled=false;s.events.push({kind:"history_metadata_changed",actor:actor(),reason:basis(),date:verdictToday()});Object.keys(s.approvals).forEach(function(id){s.approvals[id].status="data_changed";});SafetyRuntime.save(s);invalidate();policy();msg("원본을 바꾸지 않고 검색 메타데이터 저장. 기존 승인은 데이터 변경으로 보류합니다.");}));
    el("backup").addEventListener("click",function(){save(SafetyRuntime.get(),"safety-workbench-backup-"+verdictToday());});
    el("restore").addEventListener("change",function(){var f=this.files[0];if(!f)return;read(f).then(function(obj){var previous=SafetyRuntime.get(),next=SafetyWorkbench.restore(obj,actor(),basis(),verdictToday());next.events=previous.events.concat(next.events);save(previous,"safety-before-restore-"+verdictToday());SafetyRuntime.save(next);policy();msg("이전 원장은 내부 백업하고 복구했습니다. 승인 활성화는 재평가 후 진행하세요.");}).catch(function(e){msg(e.message);});});
  }
  function acceptDataset(d){SafetyWorkbench.freeze(d);if(Object.keys(cases).length)throw Error('승인 작업대에 기존 작업이 있습니다. 먼저 내부 저장 후 새로고침하고 전달하세요.');d.cases.forEach(function(c){cases[c.observation.run_id]=JSON.parse(JSON.stringify(c));golds=golds.concat(c.golds);});el('dataset-id').value=d.id;el('owner').value=d.owner;dataset=JSON.parse(JSON.stringify(d));renderCases();el('dataset-save').disabled=false;msg('일반 평가 화면에서 시험셋을 받았습니다. 규칙 평가·승인을 진행하세요.');}
  init();return {init:init,acceptDataset:acceptDataset};
})();
