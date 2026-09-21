// Presentation only. Analysis, permissions, saved verdicts and completion live in FastAPI.
const el = (tag, text, cls) => {const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(cls)node.className=cls;return node;};
const id = name => document.getElementById(name);
export function renderReview(state, {save, dirty, canEdit}) {
  const root=id('clause-rows');root.replaceChildren();
  id('analyze-result').hidden=!state.analysis;
  id('clauses-empty').hidden=!!state.analysis;
  if(!state.analysis)return;
  const result=state.analysis.result;
  const verdicts=new Map(state.verdicts.map(v=>[v.check_id,v]));
  for(const item of result.items){
    const row=el('article',undefined,'clause-row server-review-row');row.dataset.checkId=item.cpId;
    const source=el('div',undefined,'cr-cell');
    const best=item.best && result.clauses[item.best.clauseIndex];
    source.append(el('h3',best?.heading||'계약 전체 확인'),el('pre',item.quote||'이 항목과 연결된 원문을 찾지 못했습니다. 본문 전체와 적용 여부를 확인하세요.','server-quote'));
    if(item.annex)source.append(el('p','별첨 근거: '+item.annex.docName),el('pre',item.annex.quote||item.annex.heading||'','server-quote'));
    const check=el('div',undefined,'cr-cell');const cp=item.checkpoint;
    check.append(el('h3',(cp.label||item.cpId)),el('p',cp.check),el('p',(cp.severity||'')+' · '+item.cpId,'sec-hint'));
    const labels={addressed:'관련 원문 있음',verify:'관련 문구 확인 권장',consider:'적용·보완 판단 필요',quiet:'적용 여부 확인',base_covered:'원계약 근거 확인'};
    check.append(el('p',item.required ? labels[item.coverage]||'검토 대상' : '현재 적용 조건에서 제외'));
    for(const ref of cp.sources||[]){const details=el('details');details.append(el('summary',[ref.law,ref.article].filter(Boolean).join(' ')||'검토 근거'),el('p',ref.quote||ref.note||''));check.append(details);}
    const automatic=item.automatic;
    if(automatic){
      check.append(el('p',automatic.eligible?'자동 확인: '+automatic.message:automatic.message,'server-auto-status'));
      for(const evidence of automatic.evidence||[]){const details=el('details');details.append(el('summary','자동판정 근거 · '+evidence.document+' · '+(evidence.section||evidence.element)),el('pre',evidence.text,'server-quote'));source.append(details);}
      for(const blocker of automatic.blockers||[])check.append(el('p',blocker.message||blocker.label||blocker.reason||JSON.stringify(blocker),'sec-hint'));
      if(automatic.missing?.length)check.append(el('p','추가 확인: '+automatic.missing.join(', '),'sec-hint'));
    }
    const opinion=el('div',undefined,'cr-cell');
    if(!item.required){opinion.append(el('p','유형·역할 등의 적용 조건에 따라 제외된 항목입니다.'));row.append(source,check,opinion);root.append(row);continue;}
    const old=verdicts.get(item.cpId);
    const select=el('select');select.setAttribute('aria-label',item.cpId+' 검토 결과');
    for(const [value,label] of [['','선택하세요'],['이상없음','이상없음'],['검토의견','검토의견']])select.add(new Option(label,value));
    select.value=old?.verdict||'';
    const reason=el('input');reason.placeholder='판단 사유 (해당사항 없음 등)';reason.setAttribute('aria-label',item.cpId+' 판단 사유');reason.value=old?.reason||'';reason.maxLength=1000;
    const comment=el('textarea');comment.placeholder='검토의견과 수정 제안을 작성하세요';comment.setAttribute('aria-label',item.cpId+' 검토의견');comment.value=old?.comment||'';comment.maxLength=100000;comment.rows=5;
    select.addEventListener('change',()=>{if(old?.origin==='auto'&&select.value==='검토의견'&&reason.value==='반영되어 있음')reason.value='';});
    const status=el('p',old?.needs_reconfirmation?'원문·분석 변경으로 재확인이 필요합니다. 기존 의견은 보존했습니다.':old?.origin==='auto'?'자동 확인됨 · 근거를 검토하고 필요하면 의견을 수정하세요.':old?'저장됨':'아직 검토하지 않았습니다.','server-row-status');status.setAttribute('role','status');
    const button=el('button',old?.needs_reconfirmation?'확인 후 의견 저장':'의견 저장','primary');
    button.addEventListener('click',async()=>{
      if(!select.value){status.textContent='검토 결과를 선택하세요.';return;}
      if(select.value==='검토의견'&&!comment.value.trim()){status.textContent='검토의견 내용을 작성하세요.';return;}
      const payload={verdict:select.value,comment:comment.value,reason:reason.value};
      button.disabled=true;
      try{await save(item.cpId,payload);status.textContent='저장됨';}
      catch(error){status.textContent=error.message;}
      finally{button.disabled=!canEdit();}
    });
    for(const control of [select,reason,comment])control.addEventListener('input',()=>{status.textContent='저장하지 않은 변경이 있습니다.';dirty(item.cpId);});
    for(const control of [select,reason,comment,button]){control.disabled=!canEdit();control.dataset.workflowControl='true';}
    opinion.append(select,reason,comment,button,status);row.append(source,check,opinion);root.append(row);
  }
}

export function renderReport(snapshot, draft=false) {
  const root=id('report-body');root.replaceChildren();id('report-empty').hidden=true;
  root.append(el('h2',draft?'검토 진행 현황':'최종 검토 리포트'),el('h3',snapshot.review.title||'계약 검토'));
  if(!draft)root.append(el('p','검토 완료: '+new Date(snapshot.completed_at*1000).toLocaleString('ko-KR')));
  root.append(el('p','계약 유형: '+snapshot.analysis.type_name));
  if(snapshot.summary)root.append(el('pre',snapshot.summary,'server-quote'));
  const verdicts=new Map(snapshot.verdicts.map(v=>[v.check_id,v]));
  for(const item of snapshot.analysis.items.filter(r=>r.required)){
    const v=verdicts.get(item.cpId);const section=el('section',undefined,'server-report-item');
    section.append(el('h3',item.checkpoint.label||item.cpId),el('p',item.checkpoint.check),
      el('p',v&&!v.needs_reconfirmation?v.verdict:'검토 중'),el('p',(v?.origin==='auto'?'자동 확인 · ':'')+(v?.reason||'')),el('pre',v?.comment||'','server-quote'));
    if(v?.origin==='auto')for(const evidence of v.proof?.evidence||[]){const details=el('details');details.append(el('summary','자동 확인 근거 · '+evidence.document+' · '+(evidence.section||evidence.element)),el('pre',evidence.text,'server-quote'));section.append(details);}
    root.append(section);
  }
}

export function downloadJSON(name, value) {
  const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);const link=el('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
