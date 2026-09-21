// Synthetic end-to-end acceptance. Disposable browser contexts, offline only.
import assert from 'node:assert/strict';
import {connect190,createDiverseFixture,runButton,captureSnapshot} from './test_v190_performance.mjs';
import {createFixture} from './benchmark_v189_runtime.mjs';
const client=await connect190(),results=[];
try{
  let baseline;
  for(const release of ['baseline1902','current']){
    const p=await client.page(release,release+'-500',{cpu:1});await client.install(p,createDiverseFixture());
    const timing=await runButton(client,p);assert.equal(timing.status,'completed');
    const snapshot=await client.run(p,'('+captureSnapshot.toString()+')()');
    if(!baseline)baseline=snapshot;else for(const key of ['questions','mapping','automatic_ids','verdicts','anchors','locations'])assert.deepEqual(snapshot[key],baseline[key],key+' unchanged');
    const repeat=await runButton(client,p);assert.equal(repeat.status,'completed');
    results.push({release,html_sha256:p.html_sha256,initial_ms:timing.total_ms,repeat_ms:repeat.total_ms,checks:snapshot.questions.length,auto:snapshot.automatic_ids.length,max_heartbeat_gap_ms:timing.max_heartbeat_gap_ms});
    if(release==='current'){
      assert.equal(await client.run(p,"SafetyRuntime.standardReport().tag_search.status"),'unqueried');
      // Observe actual UI-driven async lookup and edit while the worker is busy.
      await client.run(p,`(()=>{globalThis.__v1903={calls:[],runs:0};const evaluate=StandardAuto.evaluate,run=AnalysisRuntime.run;
        StandardAuto.evaluate=function(...args){__v1903.calls.push(args[0].id);return evaluate.apply(this,args);};
        AnalysisRuntime.run=function(...args){__v1903.runs++;return run.apply(this,args);};
        document.getElementById('standard-auto-inspect').click();
        if(document.querySelector('[data-reference-status]')?.dataset.referenceStatus!=='loading')throw Error('missing loading state');
        applyVerdict('CNS-DAMAGE','검토의견','참고 검색 중 작성한 수기 의견','','manual');
      })()`);
      const reference=await client.run(p,`(async()=>{const t=performance.now();await SafetyRuntime.requestReferences();
        if(verdictStore['CNS-DAMAGE']?.comment!=='참고 검색 중 작성한 수기 의견')throw Error('manual overwritten');
        if(__v1903.runs)throw Error('reference search remapped');
        const report=SafetyRuntime.standardReport();if(report.tag_search.status!=='ready')throw Error('not ready');
        return {wait_ms:performance.now()-t,rows:report.rows.reduce((n,r)=>n+r.tag_sources.length,0)};
      })()`);assert.ok(reference.rows>0);
      const editing=await client.run(p,`(async()=>{
        const results=[],id='CMN-19';
        function change(value){const before=JSON.stringify(Object.fromEntries(Object.entries(verdictStore).filter(([k])=>k!==id)));
          __v1903.calls=[];const sel=document.querySelector('.reassign-sel[data-rcp="'+id+'"]');if(!sel)throw Error('missing reassign control');
          sel.dispatchEvent(new Event('focus'));sel.value=value;const start=performance.now();sel.dispatchEvent(new Event('change',{bubbles:true}));
          if(__v1903.runs)throw Error('unexpected full analysis');if(__v1903.calls.some(k=>k!==id))throw Error('evaluated unrelated checks: '+__v1903.calls);
          if(JSON.stringify(Object.fromEntries(Object.entries(verdictStore).filter(([k])=>k!==id)))!==before)throw Error('unrelated verdict mutated');
          results.push({value,ms:performance.now()-start,evaluations:__v1903.calls.length});}
        change('0');change('__contract__');if(verdictStore[id]?.verdict==='이상없음')throw Error('contract-wide should revoke automatic');
        change('');if(verdictStore[id]?.verdict!=='이상없음')throw Error('restore automatic');change('__confirm__');
        StandardAutoArchive.setEnabled(true);applyVerdict('CNS-DAMAGE','검토의견','자동저장 후에도 부분 갱신 유지','','manual');
        for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(p=>p.contract_hash===verdictHash&&p.verdicts['CNS-DAMAGE']?.comment==='자동저장 후에도 부분 갱신 유지');n++)await new Promise(r=>setTimeout(r,50));
        if(!TemplateLibraryRuntime.packets().some(p=>p.contract_hash===verdictHash))throw Error('archive did not save');
        if(!canUpdateCheck())throw Error('self archive invalidated partial update');change('0');
        if(SafetyRuntime.standardReport().tag_search.status!=='ready')throw Error('self archive invalidated references');
        StandardAutoArchive.setEnabled(false);return results;
      })()`);
      // Real source update cancels stale reuse, then full reanalysis restores it.
      const invalidation=await client.run(p,`(async()=>{
        Object.values(legalOpinionKnowledge.documents)[0].evidence[0].sentence+=' 변경된 출처';
        if(canUpdateCheck())throw Error('source mutation not detected');
        if(SafetyRuntime.standardReport().tag_search.status!=='stale')throw Error('old source shown');
        const done=await runAnalysis();if(done.status!=='completed')throw Error(done.error);
        if(verdictStore['CNS-DAMAGE']?.comment!=='자동저장 후에도 부분 갱신 유지')throw Error('manual lost on full reanalysis');
        const pending=SafetyRuntime.requestReferences();SafetyRuntime.cancelReferences();
        try{await pending;throw Error('cancel did not reject');}catch(e){if(e.name!=='AbortError')throw e;}
        await SafetyRuntime.requestReferences();if(SafetyRuntime.standardReport().tag_search.status!=='ready')throw Error('retry failed');
        return {source_invalidation:true,cancel_retry:true,manual_preserved:true};
      })()`);
      results.push({reference,editing,invalidation});
    }
    await client.cleanPage(p);
  }
  const large=await client.page('current','large-edit-cpu4',{cpu:4}),payload=createDiverseFixture();payload.text=createFixture({repeat:20,tagDocuments:0,corpusContracts:0}).text;
  await client.install(large,payload);const initial=await runButton(client,large);assert.equal(initial.status,'completed');
  const largeEdit=await client.run(large,`(()=>{let mappings=0;const original=AnalysisRuntime.run;AnalysisRuntime.run=function(...args){mappings++;return original.apply(this,args);};
    const id='CMN-19',sel=document.querySelector('.reassign-sel[data-rcp="'+id+'"]');sel.dispatchEvent(new Event('focus'));sel.value='0';const t=performance.now();sel.dispatchEvent(new Event('change',{bubbles:true}));
    return {clauses:state.clauses.length,edit_ms:performance.now()-t,full_mappings:mappings};})()`);
  assert.equal(largeEdit.full_mappings,0);assert.ok(largeEdit.edit_ms<1000,'large placement edit must not block for >=1s');
  results.push({large_initial_ms:initial.total_ms,cpu:4,...largeEdit});await client.cleanPage(large);
  console.log(JSON.stringify({fixture:{tag_documents:500,evidence_rows:26000,corpus:29},results,diagnostics:client.diagnostics()},null,2));
}finally{await client.close();}
