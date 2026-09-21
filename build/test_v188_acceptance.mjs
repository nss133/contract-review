/* Isolated-browser acceptance: synthetic real files -> actual extraction -> automatic
 * second-column completion -> persistence -> finish. No private input is injected.
 * A new incognito browser context is mandatory; existing user storage is untouched.
 */
import {readFile} from 'node:fs/promises';
const expectedVersion=process.env.CR_EXPECTED_VERSION||(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim();
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9359';
const version=await fetch(endpoint+'/json/version').then(r=>r.json());
const ws=new WebSocket(version.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;errors.push({text:d.text,description:d.exception?.description,url:d.url,line:d.lineNumber,column:d.columnNumber,stack:d.stackTrace});}
  if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
  const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function send(method,params={},sessionId){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
const {browserContextId}=await send('Target.createBrowserContext');
let sessionId;
async function run(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}

async function suite(){
  const check=(value,label)=>{if(!value)throw Error(label);},e=id=>document.getElementById(id);
  const wait=async(predicate,label)=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,30));}throw Error('timeout: '+label);};
  const lines=['합성 용역계약서','제1조(대금)','대금은 발주 건별 계약단가에 따라 정산한다.','계약대금 1000000원(부가세 별도)',
    '제2조(기간)','계약기간 2026년 5월 11일 ~ 2026년 10월 30일','제3조(해지)','을이 계약을 위반하면 갑은 계약을 해지할 수 있다.',
    '제4조(손해배상)','을은 귀책사유로 갑에게 발생한 손해를 배상한다.','[별첨 1] 분쟁해결약정','제1조(관할)',
    '본 계약의 분쟁에 관한 소송은 갑의 본사 소재지를 관할하는 법원을 관할법원으로 한다.'];
  const wp=s=>'<w:p><w:r><w:t>'+s+'</w:t></w:r></w:p>';
  const dz=new JSZip();dz.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+lines.map(wp).join('')+'</w:body></w:document>');
  const docx=new File([await dz.generateAsync({type:'uint8array'})],'acceptance.docx');
  const hz=new JSZip();hz.file('Contents/section0.xml','<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp">'+lines.map(s=>'<hp:p><hp:run><hp:t>'+s+'</hp:t></hp:run></hp:p>').join('')+'</hs:sec>');
  const hwpx=new File([await hz.generateAsync({type:'uint8array'})],'acceptance.hwpx');
  function utf16(s){const a=new Uint8Array(s.length*2),v=new DataView(a.buffer);for(let i=0;i<s.length;i++)v.setUint16(i*2,s.charCodeAt(i),true);return a;}
  function record(text){const p=utf16(text),a=new Uint8Array(p.length+4);new DataView(a.buffer).setUint32(0,(p.length<<20)|67,true);a.set(p,4);return a;}
  const body=Uint8Array.from(lines.flatMap(s=>Array.from(record(s))));check(body.length<=4096,'synthetic HWP body limit');
  const cfb=new Uint8Array(512*19),v=new DataView(cfb.buffer);cfb.set([208,207,17,224,161,177,26,225]);
  v.setUint16(24,62,true);v.setUint16(26,3,true);v.setUint16(28,65534,true);v.setUint16(30,9,true);v.setUint16(32,6,true);
  v.setUint32(44,1,true);v.setUint32(48,0,true);v.setUint32(56,4096,true);v.setUint32(60,0xfffffffe,true);v.setUint32(68,0xfffffffe,true);
  for(let i=0;i<109;i++)v.setUint32(76+i*4,i?0xffffffff:1,true);
  for(let i=0;i<128;i++)v.setUint32(1024+i*4,0xffffffff,true);v.setUint32(1024,0xfffffffe,true);v.setUint32(1028,0xfffffffd,true);
  for(let i=2;i<18;i++)v.setUint32(1024+i*4,i===9||i===17?0xfffffffe:i+1,true);
  function directory(i,name,type,start,size){const p=512+i*128;cfb.set(utf16(name+'\0'),p);v.setUint16(p+64,(name.length+1)*2,true);v.setUint8(p+66,type);v.setUint32(p+116,start,true);v.setUint32(p+120,size,true);}
  directory(0,'Root Entry',5,0xfffffffe,0);directory(1,'FileHeader',2,2,4096);directory(2,'Section0',2,10,4096);
  cfb.set(new TextEncoder().encode('HWP Document File'),1536);v.setUint32(1536+32,0x05000300,true);cfb.set(body,5632);
  const hwp=new File([cfb],'acceptance.hwp');
  const hex=s=>Array.from(s).map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange '+lines.length+' beginbfchar '+lines.map((s,i)=>'<'+(65+i).toString(16)+'> <'+hex(s)+'>').join(' ')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const content='BT /F1 12 Tf 50 750 Td '+lines.map((s,i)=>(i?'0 -25 Td ':'')+'('+String.fromCharCode(65+i)+') Tj').join('\n')+' ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream','<< /Length '+cmap.length+' >>\nstream\n'+cmap+'\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const at=pdf.length;
  pdf+='xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+at+'\n%%EOF';
  const files=[docx,hwpx,hwp,new File([pdf],'acceptance.pdf')],results=[];
  const ids=['CMN-19','CMN-05','CNS-PRICE','CNS-TERM','CNS-END','CNS-DAMAGE'];
  function assertAutomatic(label){for(const id of ids){
    check(verdictStore[id]?.origin==='auto'&&verdictStore[id]?.verdict==='이상없음',label+' automatic '+id);
    const control=document.querySelector('.cr-reviewed [data-vcp="'+id+'"]');check(control,label+' second column '+id);
    check(control.closest('.clause-row')?.children.length===3,label+' existing three-column frame '+id);
  }}
  for(const file of files){
    const start=performance.now();await loadContractFile(file);
    await wait(()=>!e('input-error').textContent.includes('추출 중')||e('input-error').hidden,'file extraction');
    check(e('input-error').hidden&&state.fileName===file.name,file.name+' successful file extraction');
    check(e('contract-text').value.includes('관할법원'),file.name+' extracted court clause');
    e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();
    await wait(()=>state.result&&!e('btn-analyze').disabled,'analysis');assertAutomatic(file.name);
    check(!state.integrityFindings.some(f=>f.rule_id==='NUM-01'),file.name+' annex numbering false duplicate');
    const autoBefore=JSON.stringify(Object.fromEntries(ids.map(id=>[id,verdictStore[id].verdict])));
    for(let n=0;n<3;n++){renderClauses();renderReport();applyAutoVerdicts();}
    // Real analysis loads persisted decisions then revalidates automatic proof.
    // loadVerdicts() alone intentionally strips imported auto tickets and is not
    // a complete user-visible reload path.
    await runAnalysis();await wait(()=>state.result&&!e('btn-analyze').disabled,'repeat analysis');assertAutomatic(file.name+' reanalysis');
    check(JSON.stringify(Object.fromEntries(ids.map(id=>[id,verdictStore[id].verdict])))===autoBefore,'unchanged verdicts');
    // Finish is checked after explicitly completing only the remaining synthetic
    // manual questions. This does not claim that every contract item was automated.
    renderReport();const pendingItems=pendingReviewItems();
    for(const item of pendingItems){
      if(item.kind==='check'){check(document.querySelector('[data-vcp="'+item.id+'"]'),'pending visible '+item.id);applyVerdict(item.id,'이상없음','합성 수용시험 직접 확인','반영되어 있음');}
      else if(item.kind==='integrity'||item.kind==='finding'){
        state.findingStore=Findings.decide(state.findingStore,item.id,'no_issue',{comment:'합성 수용시험',reviewer:getReviewer(),date:verdictToday()});saveFindings();
      }
      else throw Error('unexpected separate review unit '+item.kind);
    }
    renderClauses();renderReport();check(pendingReviewCount()===0,file.name+' no hidden pending');
    await runAnalysis();await wait(()=>state.result&&!e('btn-analyze').disabled,'completed reanalysis');check(pendingReviewCount()===0,file.name+' completion retained');
    check(finishReview()!==false,file.name+' finish action');check(e('finish-msg').textContent.includes('저장되었음'),file.name+' actual saved finish');
    results.push({format:file.name.split('.').pop(),automatic:ids.length,manual_remaining_completed:pendingItems.length,elapsed_ms:Math.round(performance.now()-start)});
  }
  applyVerdict('CMN-19','검토의견','최신 수기 의견','','manual');await runAnalysis();await wait(()=>state.result&&!e('btn-analyze').disabled,'manual reanalysis');
  check(verdictStore['CMN-19']?.origin==='manual'&&verdictStore['CMN-19']?.comment==='최신 수기 의견','manual result never overwritten');
  return {version:CR.app_version,formats:results,second_column:true,finish:true,manual_preserved:true,private_data_used:false};
}

try{
  const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}));
  await send('Runtime.enable',{},sessionId);await send('Network.enable',{},sessionId);
  await send('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href},sessionId);
  await run("new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'&&typeof runAnalysis==='function'){clearInterval(t);ok();}else if(++n>300){clearInterval(t);no(Error('startup'));}},50);})");
  const result=await run('('+suite.toString()+')()');
  if(result.version!==expectedVersion)throw Error('HTML version '+result.version+' differs from expected '+expectedVersion);
  if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));
  console.log(JSON.stringify({...result,external_requests:external.length},null,2));
}catch(error){console.error(JSON.stringify({message:error.message,errors,external},null,2));throw error;
}finally{await send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});ws.close();}
