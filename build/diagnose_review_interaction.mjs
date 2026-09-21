// Read-only production diagnostics using disposable synthetic review sessions.
import {connect190,createDiverseFixture} from './test_v190_performance.mjs';
import {createFixture} from './benchmark_v189_runtime.mjs';
const client=await connect190();
try{
  for(const repeat of [4,20]){
    const payload=createDiverseFixture();payload.text=createFixture({repeat,tagDocuments:0,corpusContracts:0}).text;
    const page=await client.page('current','editing-'+repeat,{cpu:4});await client.install(page,payload);
    const report=await client.run(page,`(async()=>{
      applyMotionPreference('reduce',false);
      let start=performance.now();if(!await runAnalysis())throw Error('Initial analysis failed');
      const initial=performance.now()-start;
      globalThis.__editStats={};
      function watch(obj,key,name){const original=obj[key];if(typeof original!=='function')return;obj[key]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{const s=__editStats[name]||(__editStats[name]={calls:0,ms:0});s.calls++;s.ms+=performance.now()-t;}};}
      for(const key of ['runAnalysis','applyVerdict','saveVerdicts','renderClauses','renderReport','refreshSafetyObservations','buildSafetyDocuments','clauseRowHtml'])watch(globalThis,key,key);
      for(const key of ['manualInputKeyV3','describe','standardPacket','apply'])watch(SafetyRuntime,key,'SafetyRuntime.'+key);
      watch(SafetyDigest,'of','digest');watch(TemplateLibraryRuntime,'resolveDocuments','template.resolve');
      watch(DocumentStructure,'revisionToken','structure.revision');watch(AgreementJudgment,'evaluate','agreement.evaluate');
      const operations=[];
      async function measure(name,fn){__editStats={};const t=performance.now();fn();const sync=performance.now()-t;await new Promise(r=>setTimeout(r,1000));operations.push({name,sync_ms:sync,stats:__editStats});}
      function button(){return [...document.querySelectorAll('.vd-btn[data-vcp="CNS-DAMAGE"][data-vd="검토의견"]')].find(x=>x.closest('.compare-item'));}
      await measure('verdict_click',()=>{if(!button())throw Error('No verdict button');button().click();});
      function note(){return [...document.querySelectorAll('.vd-note[data-vcp="CNS-DAMAGE"][data-vfor="검토의견"]')].find(x=>x.closest('.compare-item'));}
      await measure('memo_input_10_characters',()=>{const n=note();if(!n)throw Error('No note');for(const ch of '합성 검토 메모 작성'){n.value+=ch;n.dispatchEvent(new Event('input',{bubbles:true}));}});
      await measure('memo_change',()=>note().dispatchEvent(new Event('change',{bubbles:true})));
      await measure('memo_archive_on',()=>{StandardAutoArchive.setEnabled(true);const n=note();n.value+=' 저장';n.dispatchEvent(new Event('input',{bubbles:true}));});
      __editStats={};const sel=document.querySelector('.reassign-sel[data-rcp="CNS-DAMAGE"]');
      if(!sel)throw Error('No reassign control');sel.dispatchEvent(new Event('focus'));sel.value='0';sel.dispatchEvent(new Event('change',{bubbles:true}));
      const reassignRuns=__editStats.runAnalysis?.calls||0;
      cancelAnalysis('합성 진단 종료');StandardAutoArchive.setEnabled(false);
      return {initial_ms:initial,characters:state.text.length,clauses:state.clauses.length,checks:state.result.checkpoints.length,operations,reassignment_starts_full_analysis:reassignRuns};
    })()`);
    console.log(JSON.stringify({repeat,cpu:4,tag_documents:500,unique_evidence:26000,...report}));
    await client.cleanPage(page);
  }
}finally{await client.close();}
