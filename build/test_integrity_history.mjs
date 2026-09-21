/* 격리 Chrome 9223. 합성 문서만 사용: 기능 제거·완결성·계약 태그 연결. */
import fs from 'node:fs/promises';
const target=await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
  if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
  await cdp('Runtime.enable');await cdp('Network.enable');
  await cdp('Page.navigate',{url:new URL('../dist/contract-review.html#admin',import.meta.url).href});
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof reviewHistory!=='undefined'&&reviewHistory&&legalOpinionKnowledge){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(Error('init'));}},50);})`);
  const checks=await evaluate(`(async()=>{
    const e=id=>document.getElementById(id);function check(ok,label){if(!ok)throw Error(label);}
    check(!document.querySelector('[data-tab="business"]')&&!e('pane-business')&&typeof BusinessScope==='undefined','feature removed');
    const text='용역계약서\\n1. 목적\\n서버 운영 용역은 제2조에 따른다.\\n2. 기간\\n계약기간은 1년이다. 제99조를 참조한다.';
    e('contract-text').value=text;refreshInputSetup();e('btn-analyze').click();
    for(let i=0;i<100&&(!state.result||e('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,50));
    check(state.integrityAssessment.status==='limited','limited assessment');
    check(!state.integrityFindings.some(x=>x.rule_id==='REF-01'),'no false missing articles');
    check(e('document-review-block').textContent.includes('자동 점검 범위 제한'),'one neutral status');
    check(!e('document-review-block').querySelector('.integrity-card'),'no mandatory error card');
    renderReport();check(document.querySelector('.tile-integrity').textContent.includes('점검 범위 제한'),'report not complete claim');
    const headers=ReviewHistory.COLUMNS.map(c=>c.header).concat(['태그 1','태그 52','계약검토번호']);
    const row=Array(36).fill('');row[1]='완료';row[3]='2026-01-01';row[4]='정보보호';row[7]='서버 운영 용역';row[15]='서버 운영 백업 복구';row[19]='2026-01-02';row[23]='서버 운영 용역';row[31]='과거 이상없음';row[33]='백업 복구';row[34]='서버 운영';row[35]='SYNTHETIC-A';
    const before=JSON.stringify(verdictStore),engineBefore=SafetyRuntime.engineFingerprint();
    reviewHistory=ReviewHistory.mergeDataset(ReviewHistory.emptyHistory(),ReviewHistory.datasetFromRows([headers,row],{fingerprint:'synthetic'})).history;
    legalOpinionKnowledge=LegalOpinionKnowledge.emptyKnowledge();
    renderReviewHistory();
    check(state.historyRelated.some(x=>x.doc.review_id==='SYNTHETIC-A'),'history only retrieval');
    check(e('history-auto-reference').textContent.includes('태그 보유 1건'),'knowledge status');
    check(e('history-auto-reference').textContent.includes('서버 운영'),'matching tags shown');
    check(document.querySelector('#pane-report .contract-review-reference'),'report reference');
    check(engineBefore!==SafetyRuntime.engineFingerprint(),'history changes environment fingerprint');
    check(!Object.values(verdictStore).some(x=>x.origin==='auto'&&x.verdict==='이상없음'),'no historical verdict carry');
    const saved=state.result;state.result={checkpoints:[CR.common,...CR.types].flatMap(x=>x.checks),results:[]};
    const html=renderIssueGroupedCards(['CMN-08','SP-UNF-09','CMN-09'].map(cpId=>({r:{cpId,coverage:'verify',best:{clauseIndex:0,reasons:[]}},ev:false})));
    const box=document.createElement('div');box.innerHTML=html;
    check(box.querySelectorAll('.check-intent-group').length===1&&box.querySelectorAll('.compare-item').length===3,'check groups preserved');state.result=saved;
    const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>제１조（목적）</w:t></w:r></w:p><w:p><w:r><w:t>제2조에 따른다.</w:t></w:r></w:p><w:p><w:r><w:t>제２조［기간］</w:t></w:r></w:p><w:p><w:r><w:t>계약기간은 1년이다.</w:t></w:r></w:p></w:body></w:document>');
    const bytes=await zip.generateAsync({type:'uint8array'}),extracted=await extractFileText(new File([bytes],'synthetic.docx'));
    const raw=typeof extracted==='string'?extracted:extracted.text;
    check(raw&&Integrity.analyze(raw,segmentContract(raw)).assessment.explicit_article_count===2,'docx noncanonical headings');
    activatePane('knowledge');e('history-auto-reference').scrollIntoView();
    return {featureRemoved:true,noncanonicalHeadings:true,limitedNotError:true,contractHistoryConnected:true,tagsRetained:true,checkGrouping:true,noAutomaticCarry:true};
  })()`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('#history-auto-reference details').open=true;document.getElementById('history-auto-reference').scrollIntoView();new Promise(resolve=>setTimeout(resolve,500));`);
  const shot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile('/private/tmp/contract-review-integrity-history.png',Buffer.from(shot.data,'base64'));
  if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));
  console.log(JSON.stringify({...checks,externalRequests:external.length},null,2));
}finally{ws.close();}
