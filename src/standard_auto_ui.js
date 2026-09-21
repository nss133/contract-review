"use strict";
(function(){
  function e(id){return document.getElementById('standard-auto-'+id);}
  function summary(){
    var ids=(state.result?.checkpoints||[]).map(function(c){return c.id;}),auto=ids.filter(function(id){var v=verdictStore[id];return v?.verdict==='이상없음'&&v.origin==='auto'&&v.auto_proof;}),templates=auto.filter(function(id){return verdictStore[id].auto_proof.version===TemplateLibrary.VERSION;});
    e('summary').textContent=!state.result?'계약을 분석하면 자동판정이 실행됩니다. 별도 자료 승인은 필요하지 않습니다.':
      '자동판정 '+auto.length+'개 (표준서식 '+templates.length+'개 포함) · 약정 확인 '+(SafetyRuntime.standardEnabled()?'자동 실행 중':'사용자 설정으로 중지됨')+'. '+
      (auto.length?'근거가 확인된 항목은 이미 이상없음으로 반영했습니다.':'현재 근거로 자동 충족된 항목이 없습니다. 보류 이유에서 미연결·문구 미인식·중지를 구분할 수 있습니다.');
  }
  function render(){
    var r=SafetyRuntime.standardReport();summary();
    var links=r.source_connections;
    if(links)e('summary').textContent+=' 참고 자료 연결: 원문 묶음 '+links.raw_packets+'건 · 태깅자료 연결 '+links.linked_tag_documents+'건 · 원문과 대응한 누적 판정 '+links.hydrated_judgments+'항목 · 원문 연결 미확인 판정 '+links.unbound_judgments+'항목. 검색·표현 후보를 보강하며 과거 결론을 복사하지 않습니다.';
    var search=r.tag_search||{status:'unqueried'},labels={unqueried:'태깅 참고 후보 미조회 — 현재 원문 자동판정과 별개입니다.',loading:'태깅 참고 후보 검색 중 — 계약 검토·의견 입력은 계속할 수 있습니다.',ready:'태깅 참고 후보 조회 완료 — 아래 목록은 통과 근거와 구별됩니다.',stale:'입력·자료가 변경되어 이전 참고 목록을 표시하지 않습니다. 다시 분석 후 조회하세요.',error:'태깅 참고 검색 실패 — 자동판정·수기 의견은 유지됩니다.'};
    var searchHtml='<p class="tag-reference-status" data-reference-status="'+esc(search.status)+'">'+esc(labels[search.status]||labels.unqueried)+(search.error?' '+esc(search.error):'')+
      (['unqueried','error'].includes(search.status)?' <button data-reference-load>참고 후보 조회</button>':search.status==='loading'?' <button data-reference-cancel>참고 검색 취소</button>':'')+'</p>';
    e('results').innerHTML=searchHtml+'<table><thead><tr><th>항목</th><th>판정·보류 이유</th><th>근거</th><th>중지</th></tr></thead><tbody>'+r.rows.map(function(row){
      var cp=_cpById(row.check_id),v=verdictStore[row.check_id],template=typeof TemplateLibraryRuntime!=='undefined'&&TemplateLibraryRuntime.report().find(function(t){return t.check_id===row.check_id;}),message=row.message,evidence=row.evidence;
      if(v?.origin==='auto'&&v.verdict==='이상없음'&&v.auto_proof?.version===TemplateLibrary.VERSION){message='표준서식 근거로 이상없음 반영';evidence=v.auto_proof.evidence;}
      else if(template&&!row.eligible){message+=' / 표준서식: '+template.result.reason;}
      var recognition=row.recognition,stage=(row.policy?.label||'판정 기준 확인')+' · '+(row.status==='no_rule'?'사람의 판단이 필요한 질문':row.status==='stopped'?'사용자 중지 설정':row.eligible?'현재 약정 확인 완료':recognition?.stage==='clause_found'?'관련 조항 확인 — 아래 구체적 사유 확인':'해당 약정의 근거 미확인');
      var details=(row.blockers||[]).map(function(x){return '판정 차단 근거 · '+x.code+' '+x.reason+' · '+x.document+': '+x.text;});
      (row.tag_sources||[]).forEach(function(s){details.push('태깅자료 후보 (통과 근거와 구별) · '+s.title+' · '+s.tag_hits.join(', '));});
      (row.hint_sources||[]).forEach(function(h){details.push('누적 의견 표현 참고 · '+h.title+' · 현재 원문 일치: '+h.matched_phrase+' · '+(h.raw_linked?'원문 연결 자료':'원문 미연결·집계 참고')+' (과거 결론 승계 없음)');});
      (row.tag_evidence||[]).forEach(function(s){details.push('판정에 사용한 요건·태그 · '+(s.element||(s.tags||[]).map(function(t){return t.label;}).filter(Boolean).join(', '))+' · '+s.document+': '+s.text);});
      (row.tag_evidence||[]).forEach(function(s){(s.facts||[]).forEach(function(f){var fields=[];
        [['actor','주체'],['counterparty','상대 주체'],['object','대상'],['action','행위'],['condition','조건'],['method','방법'],['instruction_parties','지시 주체'],['laws','준수 대상']].forEach(function(pair){if(f[pair[0]])fields.push(pair[1]+': '+f[pair[0]]);});
        if(f.minimum_per_year)fields.push('평가 주기: 연 '+f.minimum_per_year+'회 이상');
        if(fields.length)details.push('확인한 약정 요소 · '+fields.join(' / '));
      });});
      (row.history||[]).forEach(function(s){if(s.judgment_source)details.push('원문·질문 지문으로 연결한 사용자 판정 · '+s.judgment_source.contract_hash+' · '+s.judgment_source.date);
        (s.tag_sources||[]).forEach(function(t){details.push('판정 출처에 연결된 태깅자료 · '+t.title+' · '+t.source_id);});});
      if(!evidence.length&&!details.length&&recognition)details=recognition.evidence.slice(0,3).map(function(x){return '인식 근거 (충족 확정 아님) · '+x.document+': '+x.text;});
      if(!evidence.length&&!details.length)details=['현재 검색에서 관련 근거를 찾지 못했습니다. 문구의 부재를 확정한 것은 아닙니다.'];
      return '<tr><td>'+esc(cp&&(cp.label||cp.check)||row.check_id)+'</td><td>'+esc(stage)+'<br>'+esc(message)+((row.missing||[]).length?'<br>미확인 요건: '+esc(row.missing.join(', ')):'')+((row.references||[]).length?'<br>동일 정형 패턴의 사용자 판정 이력 '+row.references.length+'건 (정확도 표본 아님)':'')+'</td><td>'+evidence.map(function(x){return esc('확인한 근거 · '+x.document+': '+x.text);}).concat(details.map(esc)).join('<br>')+'</td><td>'+(row.eligible?'<button data-standard-stop="'+esc(row.check_id)+'">정형 판정 중지</button>':'')+'</td></tr>';
    }).join('')+'</tbody></table>';
    e('results').querySelectorAll('[data-standard-stop]').forEach(function(b){b.onclick=function(){SafetyRuntime.stopStandard(b.dataset.standardStop);render();};});
    e('results').querySelectorAll('[data-reference-load]').forEach(function(b){b.onclick=loadReferences;});
    e('results').querySelectorAll('[data-reference-cancel]').forEach(function(b){b.onclick=function(){SafetyRuntime.cancelReferences();render();};});
  }
  function loadReferences(){var request=SafetyRuntime.requestReferences();render();
    request.then(function(){if(state.result)render();}).catch(function(){if(state.result&&document.getElementById('contract-text').value===state.text)render();});}
  e('start').onclick=function(){try{SafetyRuntime.setStandard(true);render();}catch(err){e('summary').textContent=err.message;}};
  e('stop').onclick=function(){try{SafetyRuntime.setStandard(false);render();}catch(err){e('summary').textContent=err.message;}};
  e('inspect').onclick=function(){try{render();loadReferences();}catch(err){e('summary').textContent=err.message;}};
  e('archive').checked=StandardAutoArchive.enabled();
  e('archive').onchange=function(){try{StandardAutoArchive.setEnabled(this.checked);}catch(err){e('eval-status').textContent=err.message;}};
  e('evaluate').onclick=async function(){this.disabled=true;try{await StandardAutoArchive.run();}catch(err){e('eval-status').textContent='점검 실패: '+err.message;}finally{this.disabled=false;}};
  e('cancel').onclick=function(){StandardAutoArchive.cancel();};
  e('backup').onclick=async function(){try{var data=await StandardAutoArchive.backup(),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');
    a.href=url;a.download='internal-evaluation-'+verdictToday()+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},3000);e('eval-status').textContent='원문 포함 내부 백업입니다. 폐쇄망 밖으로 반출하지 마세요.';
  }catch(err){e('eval-status').textContent=err.message;}};
  e('restore').onchange=async function(){try{if(!this.files[0])return;var n=await StandardAutoArchive.restore(JSON.parse(await this.files[0].text()));e('eval-status').textContent=n+'건 추가 복구. 기존 자료·자동판정 활성화 설정은 변경하지 않았습니다.';}catch(err){e('eval-status').textContent=err.message;}finally{this.value='';}};
  document.getElementById('contract-text').addEventListener('input',function(){SafetyRuntime.cancelReferences();e('summary').textContent='본문 변경 — 재분석하면 변경된 근거로 자동판정합니다.';e('results').textContent='';});
  window.addEventListener('cr-auto-verdict-updated',function(){summary();e('results').textContent='';});
  summary();
})();
