import assert from 'node:assert/strict';
import {connect190} from './test_v190_performance.mjs';
import {createFixture} from './benchmark_v189_runtime.mjs';
const client=await connect190();
try{
  const page=await client.page('current','integrity retirement',{cpu:1});await client.install(page,createFixture({repeat:1,tagDocuments:0,corpusContracts:0}));
  const input=await client.run(page,"document.getElementById('contract-text').value");
  const result=await client.run(page,`(async()=>{
    const k=findingKey(hashText(document.getElementById('contract-text').value));
    localStorage.setItem(k,JSON.stringify({manual:{},decisions:{old:{decision:'opinion',comment:'기존 수기 의견 보존',reviewer:'합성 검토자',date:'2026-09-17'}}}));
    const analyzed=await runAnalysis();if(analyzed.status!=='completed')throw Error('분석 실패');
    renderReport();renderClauses();
    const before={warnings:state.integrityFindings.length,structure:state.documentStructure.sections.length,
      pending:pendingReviewItems().filter(x=>x.kind==='integrity').length,
      integrityUI:document.querySelectorAll('.integrity-fold,#rpt-sec-integrity,.tile-integrity,.document-integrity-status').length,
      retained:document.body.textContent.includes('기존 수기 의견 보존'),automatic:Object.values(verdictStore).filter(v=>v.origin==='auto').length};
    state.integrityFindings=[{id:'stale',confidence:'high',title:'이전 자동 경고'}];
    before.stalePending=pendingReviewItems().filter(x=>x.kind==='integrity').length;
    return before;
  })()`);
  assert.equal(result.warnings,0);assert.equal(result.pending,0);assert.equal(result.stalePending,0);assert.equal(result.integrityUI,0);assert.equal(result.retained,true);assert.ok(result.automatic>0);assert.ok(result.structure>0);
  await client.reload(page);
  // Contract input is deliberately not persisted by the app. Re-open the same
  // synthetic contract without reinstalling (or clearing) stored decisions.
  assert.equal(await client.run(page,`(async()=>{document.getElementById('contract-text').value=${JSON.stringify(input)};refreshInputSetup();const result=await runAnalysis();if(result.status!=='completed')throw Error('재분석 실패');renderReport();return document.body.textContent.includes('기존 수기 의견 보존');})()`),true);
  await client.cleanPage(page);console.log(JSON.stringify(result));
}finally{await client.close();}
