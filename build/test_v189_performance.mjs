/* Independent v1.89 behavior/performance probes. No user's browser/store/data. */
import assert from 'node:assert/strict';
import {connect,createFixture,statistics,integer,hash,emitResult} from './benchmark_v189_runtime.mjs';

function verifyCards(repeat){
  const check=(value,label)=>{if(!value)throw Error(label);};
  const snapshot=__v189.snapshot();check(snapshot.automatic_ids.length>0,'Expected automatic verdicts');
  check(snapshot.max_buttons_per_card<=1,'At most one evidence button per card');
  check(snapshot.max_auto_comment_characters<=300,'Automatic note must be a short label, not a quotation bundle');
  for(const id of snapshot.automatic_ids){
    const v=verdictStore[id];
    check(!(v.auto_proof.evidence||[]).some(e=>e.text.length>=40&&(v.comment||'').includes(e.text)),'No long evidence duplicated in automatic comment '+id);
    check(document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),'Automatic card remains in column two '+id);
    const button=document.querySelector('.clause-row .vd-evidence-open[data-vcp="'+id+'"]');
    check(button,'Evidence remains accessible '+id);
  }
  for(const id of ['CMN-19','CNS-TERM'])check(verdictStore[id]?.auto_proof.evidence.length>=repeat,'Retain all repeated-source proof, not only the displayed sample '+id);
  const first=document.querySelector('.clause-row .vd-evidence-open[data-vcp="CMN-19"]');first.click();
  const dialog=document.getElementById('auto-evidence-dialog'),mark=dialog.querySelector('mark');
  check(dialog.open&&mark?.textContent,'Evidence dialog opens exact original quotation');
  const locations=ReviewCore.completionLocations(verdictStore['CMN-19'],safetyDocuments());
  check(locations.some(e=>e.text===mark.textContent),'Displayed mark corresponds to retained source evidence');dialog.close();
  return {...snapshot,evidence_dialog_verified:true};
}

async function archiveAndTyping(packetCount){
  const check=(value,label)=>{if(!value)throw Error(label);};
  const wait=async(fn,label)=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+label);};
  const cp=SafetyRuntime.allChecks().find(c=>c.id==='CMN-19'),packets=[];
  for(let i=0;i<packetCount;i++){
    const documents=[{name:'합성 과거계약 '+i,text:'제1조(관할)\n본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.\n합성 기록 번호 '+i}],context={type:'outsourcing',stance:'party',roles:[],modules:[]};
    packets.push({id:SafetyDigest.of([documents,context]),contract_hash:'synthetic-archive-'+i,documents,context,checks:[cp],items:[{cpId:cp.id,coverage:'addressed'}],
      verdicts:{[cp.id]:{verdict:'이상없음',reason:'반영되어 있음',comment:'합성 과거 관할 약정 확인 '+i,origin:'manual'}},confirmed:true,date:'2026-09-10'});
  }
  const archiveLoadStarted=performance.now(),restored=await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets});check(restored===packetCount,'Load all synthetic packets');
  await wait(()=>TemplateLibraryRuntime.packets().length>=packetCount,'Packet source reload');
  const archiveLoadMs=+(performance.now()-archiveLoadStarted).toFixed(3);
  const oldPacket=await StandardAutoArchive.get(packets[0].id);check(oldPacket,'Single-packet get API');
  StandardAutoArchive.setEnabled(true);runAnalysis();renderClauses();
  const before=__v189.snapshot(),button=document.querySelector('.clause-row .vd-btn[data-vcp="CMN-19"][data-vd="검토의견"]');check(button,'Manual review control');button.click();
  const note=document.querySelector('.clause-row .vd-note[data-vcp="CMN-19"][data-vfor="검토의견"]:not([disabled])');check(note,'Editable actual note');note.focus();
  const value='합성 메모 입력 응답과 마지막 저장을 확인합니다.',samples=[];note.value='';
  for(const char of value){const start=performance.now();note.value+=char;note.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:char}));samples.push(+(performance.now()-start).toFixed(3));}
  check(verdictStore['CMN-19'].comment===value,'In-memory note tracks every input immediately');
  const commitStarted=performance.now();note.dispatchEvent(new Event('change',{bubbles:true}));note.blur();
  const key=Verdict.verdictKey(verdictHash);
  await wait(()=>JSON.parse(localStorage.getItem(key)||'{}')['CMN-19']?.comment===value,'Blur/change persists final note');
  const localCommitMs=+(performance.now()-commitStarted).toFixed(3);
  check(verdictStore['CMN-19'].manual_context_v3,'New manual context uses v3');
  check(!verdictStore['CMN-19'].manual_context&&!verdictStore['CMN-19'].manual_context_v2,'Do not write obsolete manual contexts');
  const currentId=SafetyRuntime.standardPacket().id;
  await wait(async()=>{const p=await StandardAutoArchive.get(currentId);return p?.verdicts['CMN-19']?.comment===value;},'Archive latest manual packet');
  const archiveCommitMs=+(performance.now()-commitStarted).toFixed(3);
  check(JSON.stringify(await StandardAutoArchive.get(packets[0].id))===JSON.stringify(oldPacket),'Unrelated old packet is unchanged');
  runAnalysis();check(verdictStore['CMN-19'].origin==='manual'&&verdictStore['CMN-19'].comment===value,'Reanalysis keeps manual input');
  const after=__v189.snapshot();check(JSON.stringify(after.automatic_ids)===JSON.stringify(before.automatic_ids.filter(id=>id!=='CMN-19')),'Other automatic verdicts remain');
  const last=document.querySelector('.clause-row .vd-note[data-vcp="CMN-19"][data-vfor="검토의견"]:not([disabled])');check(last,'Note after reanalysis');last.focus();
  const final=value+' 새로고침 직전 최종 입력';last.value=final;last.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:' 새로고침 직전 최종 입력'}));
  // Deliberately no blur, explicit save, wait, or synthetic unload event here.
  // The host immediately reloads the page and tests the actual unload flush.
  return {key,final,currentId,samples,archive_packets_loaded:packetCount,archive_load_ms:archiveLoadMs,local_commit_ms:localCommitMs,archive_commit_ms:archiveCommitMs,old_packet_preserved:true,other_automatic_preserved:true,manual_preserved:true};
}

const client=await connect(),repeat=integer('CR_DOC_REPEAT',100,1,200),packetCount=integer('CR_ARCHIVE_PACKETS',100,10,1000),results=[];
try{
  // Exercise the loaded-knowledge -> app analysis -> visible verdict path,
  // not merely a direct AgreementJudgment call. The same noun alias cannot
  // convert an explicitly negative current obligation into a positive one.
  for(const mode of ['without-alias','alias-positive','alias-negative']){
    const payload=createFixture({repeat:1}),negative=mode==='alias-negative';
    payload.text+='\n제15조(저장 방식)\n수탁자는 개인정보를 비가독화처리'+(negative?'하지 않으며':'하여')+' 저장한다.';
    if(mode!=='without-alias')payload.knowledge.tags['synthetic-encryption']={id:'synthetic-encryption',type:'content',label:'암호화',aliases:['비가독화처리']};
    Object.assign(payload.scale,{authored_clauses:15,characters:payload.text.length,utf8_bytes:Buffer.byteLength(payload.text),tag_definitions:Object.keys(payload.knowledge.tags).length});
    const e=await client.page('current','ui-tag-'+mode);await client.install(e,payload);await client.run(e,'__v189.initial()');
    const state=await client.run(e,`(()=>{
      const id='PRIV-19',v=verdictStore[id],snapshot=__v189.snapshot();
      if(!state.result.checkpoints.some(c=>c.id===id))throw Error('Encryption question must be active in this UI fixture');
      return {automatic:!!(v?.origin==='auto'&&v?.verdict==='이상없음'),column_two:!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),evidence_locations:snapshot.locations[id]||0,identity:snapshot.identity};
    })()`);
    assert.equal(state.automatic,mode==='alias-positive','Top-level UI tag alias: '+mode);
    if(mode==='alias-positive'){assert.equal(state.column_two,true);assert(state.evidence_locations>0);}
    results.push({case:e.label,html_sha256:e.html_sha256,fixture_sha256:hash(JSON.stringify(payload)),expected_automatic:mode==='alias-positive',...state});
    await client.cleanPage(e);process.stderr.write(JSON.stringify({progress:e.label,passed:true})+'\n');
  }
  for(const structured of [false,true]){
    const payload=createFixture({repeat,structured}),e=await client.page('current',structured?'structured-cards':'plain-cards');await client.install(e,payload);
    const initial=await client.run(e,'__v189.initial()'),before=await client.run(e,'('+verifyCards.toString()+')('+repeat+')');
    const repeatSamples=[];for(let n=0;n<3;n++)repeatSamples.push(await client.run(e,'__v189.measure("reanalysis")'));
    const after=await client.run(e,'('+verifyCards.toString()+')('+repeat+')');assert.deepEqual(after.automatic_ids,before.automatic_ids);assert.deepEqual(after.anchors,before.anchors);
    if(structured)assert.equal(after.structure_blocks,payload.scale.structure_blocks);
    results.push({case:e.label,html_sha256:e.html_sha256,fixture_sha256:hash(JSON.stringify(payload)),scale:payload.scale,initial_ms:initial,reanalysis:statistics(repeatSamples),checks:after});await client.cleanPage(e);
    process.stderr.write(JSON.stringify({progress:e.label,passed:true})+'\n');
  }
  {
    const count=integer('CR_STALE_TEMPLATES',40,1,150),payload=createFixture({repeat,staleTemplates:count}),e=await client.page('current','stale-template-candidates');await client.install(e,payload);
    const initial=await client.run(e,'__v189.initial()');
    const result=await client.run(e,`(()=>{
      const check=(v,s)=>{if(!v)throw Error(s);},r=TemplateLibraryRuntime.report().find(r=>r.check_id==='CMN-19');
      check(r?.result.eligible&&r.result.template_name==='합성 정상표준 ${count}','Skip all stale source bindings and select valid standard');
      const before=__v189.snapshot(),lib=TemplateLibraryRuntime.get();lib.templates[lib.templates.length-1].active=false;
      const value=JSON.stringify(lib);localStorage.setItem('cr-template-library-v1',value);window.dispatchEvent(new StorageEvent('storage',{key:'cr-template-library-v1',newValue:value}));
      const changed=TemplateLibraryRuntime.report().find(r=>r.check_id==='CMN-19');check(!changed?.result.eligible,'Disabled valid source must not remain cached');
      check(verdictStore['CMN-19']?.origin==='auto'&&verdictStore['CMN-19']?.verdict==='이상없음','Current explicit court clause still directly passes');
      return {stale_candidates:${count},valid_selected:true,source_change_invalidated:true,direct_verdict_retained:true,before,after:__v189.snapshot()};
    })()`);
    results.push({case:e.label,html_sha256:e.html_sha256,initial_ms:initial,...result});await client.cleanPage(e);process.stderr.write(JSON.stringify({progress:e.label,passed:true})+'\n');
  }
  {
    const payload=createFixture({repeat,structured:true}),e=await client.page('current','archive-typing-reload');await client.install(e,payload);await client.run(e,'__v189.initial()');
    const typed=await client.run(e,'('+archiveAndTyping.toString()+')('+packetCount+')');
    await client.reload(e);
    const stored=await client.run(e,'({record:JSON.parse(localStorage.getItem('+JSON.stringify(typed.key)+')||"{}")["CMN-19"],archive_enabled:StandardAutoArchive.enabled()})');
    assert.equal(stored.record?.comment,typed.final,'Last input survives actual page reload');assert.equal(stored.record?.origin,'manual');assert.equal(stored.archive_enabled,true);
    await client.install(e,payload);await client.run(e,'__v189.initial()');
    const final=await client.run(e,'({comment:verdictStore["CMN-19"]?.comment,origin:verdictStore["CMN-19"]?.origin,reconfirmation:!!verdictStore["CMN-19"]?.needs_reconfirmation})');
    assert.equal(final.comment,typed.final);assert.equal(final.origin,'manual');assert.equal(final.reconfirmation,false);
    results.push({case:e.label,html_sha256:e.html_sha256,scale:payload.scale,archive_packets:typed.archive_packets_loaded,archive_load_ms:typed.archive_load_ms,local_commit_ms:typed.local_commit_ms,archive_commit_ms:typed.archive_commit_ms,typing:statistics(typed.samples),last_input_real_reload_preserved:true,reanalysis_manual_preserved:true,old_packet_preserved:typed.old_packet_preserved,other_automatic_preserved:typed.other_automatic_preserved});
    await client.cleanPage(e);process.stderr.write(JSON.stringify({progress:e.label,passed:true})+'\n');
  }
  await emitResult({artifact:'v1.89-performance-regression',created_at:new Date().toISOString(),environment:{browser:client.version.Browser,node:process.version},synthetic_only:true,private_data_used:false,external_requests:0,all_checks_passed:true,results,
    limitations:['14개 문구 반복으로 만든 긴 합성 문서이며 실제 계약 다양성·스캔 추출 성능은 검증하지 않음.','타이핑 측정은 실제 input 이벤트 처리시간이며 인간 타자시간·GPU 페인트 시간은 제외.','하드웨어 의존 절대시간 통과선을 임의로 만들지 않고 원시 측정값을 보존함. 반복10회미만이면 P50/P95는 null.']});
}catch(error){console.error(error.stack);process.exitCode=1;
}finally{await client.close();}
