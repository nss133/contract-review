/* Synthetic, offline browser acceptance for the unified three-column review. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {connect190,runButton} from './test_v190_performance.mjs';
const client=await connect190();
try{
  const page=await client.page('current','unified-review-ui',{cpu:1});
  await client.run(page,`(()=>{
    const e=id=>document.getElementById(id);
    e('contract-text').value='용역계약서\\n제1조(목적)\\n갑은 을에게 개발 용역을 위탁한다.\\n제2조(대금)\\n대금은 100원이며 부가세 별도이다.';
    state.subDocs=[{name:'합성 관할약정서',text:'제1조(관할)\\n본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.'}];
    refreshInputSetup();e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));
  })()`);
  const timing=await runButton(client,page);assert.equal(timing.status,'completed');
  const summary=await client.run(page,`(()=>{
    const check=(x,m)=>{if(!x)throw Error(m);},cp='CMN-19';
    document.querySelector('.tab[data-tab="clauses"]').click();
    check(!document.getElementById('action-queue-block'),'old action queue exists');
    check(!document.getElementById('action-anchor'),'old action anchor exists');
    const card=document.querySelector('#clause-rows .cr-reviewed .vd-btn[data-vcp="'+cp+'"][data-vd="이상없음"]');
    check(card&&verdictStore[cp]?.origin==='auto','annex automatic result missing from column two');
    const row=card.closest('.clause-row');check(row.dataset.reviewSource,'annex not in ordinary source row');
    check(row.querySelector('.reassign-sel').selectedOptions[0].textContent==='별첨 원문에 연결됨','connected source still asks for target confirmation');
    check(row.querySelector('.cr-src').textContent.includes('서울중앙지방법원'),'annex quotation missing');
    check(!document.getElementById('pane-clauses').textContent.includes('표현 검색 참고'),'historical hint still shown');
    const buttons=Array.from(document.querySelectorAll('#pane-clauses .vd-btn[data-vd="이상없음"]'));
    const counts={};buttons.forEach(b=>counts[b.dataset.vcp]=(counts[b.dataset.vcp]||0)+1);
    check(Object.values(counts).every(n=>n===1),'duplicate checklist card');
    for(const p of pendingReviewItems())check(counts[p.id]===1,'pending item has no control: '+p.id);
    return {automatic_cp:cp,source_row:row.dataset.reviewSource,visible_checks:buttons.length,pending:pendingReviewCount()};
  })()`);
  const interactions=await client.run(page,`(()=>{
    const check=(x,m)=>{if(!x)throw Error(m);};
    // A restored human verdict can require reconfirmation even when lexical coverage is quiet.
    // Seed that UI state explicitly; the actual automatic annex fixture above is unchanged.
    const target=state.result.results.find(r=>r.cpId!=='CMN-19'&&!r.roleGated&&!r.relationshipGated&&!r.serviceGated);check(target,'restored verdict fixture');
    target.coverage='quiet';target.ruleCoverage='quiet';target.best=null;target.ruleBest=null;
    delete state.subDocCov[target.cpId];target.standardEvidence=null;
    applyVerdict(target.cpId,'이상없음','기존 저장 메모','반영되어 있음');verdictStore[target.cpId].needs_reconfirmation=true;
    renderClauses();renderReport();check(_considerList.some(r=>r.cpId===target.cpId),'restored item not in unlinked row');
    const id=target.cpId;renderReport();
    const link=Array.from(document.querySelectorAll('.rpt-pending-goto')).find(b=>b.dataset.id===id);check(link,'report exact pending link');link.click();
    check(document.activeElement.dataset.vcp===id,'report link failed to focus unlinked control');
    const control=(selector)=>document.querySelector('#consider-block '+selector+'[data-vcp="'+id+'"]');
    document.querySelector('#consider-block .vd-btn[data-vcp="'+id+'"][data-vd="이상없음"]').click();
    const note=document.querySelector('#consider-block .vd-note[data-vcp="'+id+'"][data-vfor="이상없음"]');
    check(note&&!note.disabled,'manual note after approval');note.value='합성 사용자 메모 유지';note.dispatchEvent(new Event('input',{bubbles:true}));flushVerdictNotes();
    control('.vd-edit-done').click();
    check(!!document.querySelector('#consider-block .cr-reviewed .vd-btn[data-vcp="'+id+'"]'),'manual complete not column two');
    check(verdictStore[id].comment==='합성 사용자 메모 유지','manual note lost');
    const cp='CMN-19';
    document.querySelector('#clause-rows .vd-btn[data-vcp="'+cp+'"][data-vd="검토의견"]').click();
    check(!!document.querySelector('#clause-rows .source-review-row .cr-opinions .vd-btn[data-vcp="'+cp+'"]'),'annex opinion not column three');
    const opinion=document.querySelector('#clause-rows .vd-note[data-vcp="'+cp+'"][data-vfor="검토의견"]');
    opinion.value='합성 관할 협의 의견';opinion.dispatchEvent(new Event('input',{bubbles:true}));flushVerdictNotes();
    const sel=document.querySelector('#clause-rows .reassign-sel[data-rcp="'+cp+'"]');sel.dispatchEvent(new Event('focus'));
    const option=Array.from(sel.options).find(o=>/^\\d+$/.test(o.value));check(option,'numeric assignment fixture');
    const ci=Number(option.value);sel.value=option.value;sel.dispatchEvent(new Event('change'));
    check(state.reassign[cp]===ci,'assignment not saved');
    check(!!document.querySelector('#clause-rows [data-ci="'+ci+'"] .vd-btn[data-vcp="'+cp+'"]'),'assigned card not moved');
    check(verdictStore[cp].comment==='합성 관할 협의 의견','assigned opinion lost');
    applyAutoVerdicts();check(verdictStore[cp].origin==='manual','automatic overwrote human opinion');
    renderClauses();renderReport();
    check(!pendingReviewItems().some(p=>p.id===id),'completed item remains pending');
    return {unlinked_manual:id,manual_complete_column_two:true,report_exact_link:true,annex_opinion_column_three:true,reassignment_preserved:true,manual_note_preserved:true};
  })()`);
  // Restore the automatically confirmed fixture for representative responsive screenshots.
  await client.run(page,`delete state.reassign['CMN-19'];saveReassign();delete verdictStore['CMN-19'];saveVerdicts();`);
  await runButton(client,page);
  const layouts=[];
  for(const width of [1500,1200,1000,700]){
    await client.send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false},page.sessionId);
    await client.run(page,`(async()=>{applyMotionPreference('reduce',false);document.querySelector('.tab[data-tab="clauses"]').click();const row=document.querySelector('#clause-rows .source-review-row');scrollToClauseEl(row);await new Promise(r=>setTimeout(r,500));scrollToClauseEl(row);await new Promise(r=>setTimeout(r,150));})()`);
    const cells=await client.run(page,`Array.from(document.querySelector('#clause-rows .source-review-row').children).map(e=>({class:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth}))`);
    assert.equal(cells.length,3);assert(cells.every(c=>c.scrollWidth<=c.width+1),JSON.stringify({width,cells}));layouts.push({width,cells});
    if(width===1500){const shot=await client.send('Page.captureScreenshot',{format:'png'},page.sessionId);await writeFile('/private/tmp/cr-unified-review-ui.png',Buffer.from(shot.data,'base64'));}
  }
  await client.cleanPage(page);
  console.log(JSON.stringify({passed:true,synthetic_only:true,external_requests:0,html_sha256:page.html_sha256,summary,interactions,layouts,timing:{total_ms:timing.total_ms,max_heartbeat_gap_ms:timing.max_heartbeat_gap_ms}},null,2));
}catch(error){console.error(JSON.stringify(client.diagnostics()));throw error;}finally{await client.close();}
