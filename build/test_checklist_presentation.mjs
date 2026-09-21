// Uses an isolated context on a task-owned Chrome instance; synthetic input only.
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {connect190} from './test_v190_performance.mjs';
import {createFixture} from './benchmark_v189_runtime.mjs';
const client=await connect190();
try{
  const page=await client.page('current','checklist presentation',{cpu:1});
  await client.install(page,createFixture({repeat:1,tagDocuments:0,corpusContracts:0}));
  await client.run(page,"applyMotionPreference('reduce',false)");
  const result=await client.run(page,`(async()=>{
    const before=JSON.stringify(CR.common.checks);
    if(!await runAnalysis())throw Error('분석 실패');
    const ids=CR.checklist_revision.replacements.map(r=>r.id);
    const checks=[CR.common,...CR.types].flatMap(d=>d.checks),cards=ids.map(id=>{
      const cp=checks.find(c=>c.id===id),copy=ChecklistPresentation.get(cp),html=renderConsiderItem({cpId:id});
      return {id,title:copy.title,question:copy.question,html:html||renderCheckCard(cp)};
    });
    const auto=Object.entries(verdictStore).filter(([id,v])=>v.origin==='auto').map(([id,v])=>({id,points:ChecklistPresentation.confirmedPoints(v),html:verdictControlHtml(id,true)}));
    const damage=checks.find(c=>c.id==='CNS-DAMAGE');
    return {cards,auto,unchanged:before===JSON.stringify(CR.common.checks),detail:renderDetail(damage),old:damage.check,version:CR.app_version};
  })()`);
  assert.equal(result.version,(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim());assert.equal(result.unchanged,true);
  for(const card of result.cards){assert.ok(card.html.includes(card.title),card.id);assert.ok(card.html.includes(card.question),card.id);assert.ok(card.html.includes('확인할 내용'),card.id);assert.doesNotMatch(card.html,/내부 추적|5케이스 전부 quiet/);}
  assert.ok(result.auto.length>0);
  for(const v of result.auto){if(v.points.length){assert.ok(v.html.includes('자동 확인'));for(const p of v.points)assert.ok(v.html.includes(p));}assert.ok((v.html.match(/vd-evidence-open/g)||[]).length<=1);}
  assert.doesNotMatch(result.detail,/내부 추적/);
  assert.match(result.old,/책임 편중/); // Engine question is deliberately untouched.
  await client.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false},page.sessionId);
  await client.run(page,`(()=>{document.querySelector('[data-tab="clauses"]').click();const control=document.querySelector('[data-vcp="CNS-DAMAGE"]');if(control){const folded=control.closest('details');if(folded)folded.open=true;control.closest('.compare-item')?.scrollIntoView({block:'center'});}})()`);
  const screenshot=await client.send('Page.captureScreenshot',{format:'png'},page.sessionId);
  await writeFile('/private/tmp/cr-checklist-copy.5Yq2rC/screen.png',Buffer.from(screenshot.data,'base64'));
  const manual=await client.run(page,`(()=>{applyVerdict('CNS-DAMAGE','검토의견','수기 의견 보존','','manual');return verdictControlHtml('CNS-DAMAGE',true);})()`);
  assert.doesNotMatch(manual,/vd-confirmed-points/);assert.match(manual,/수기 의견 보존/);
  await client.cleanPage(page);
  console.log(JSON.stringify({version:result.version,integrated_cards:result.cards.length,automatic_cards:result.auto.length,engine_questions_unchanged:true,manual_preserved:true,console_errors:0}));
}finally{await client.close();}
