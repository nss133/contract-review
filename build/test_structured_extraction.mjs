/* 네 형식의 합성 파일 → 실제 추출기 → 구역 검사 → 앱 보정. 폐쇄망 실자료 사용 없음. */
import fs from 'node:fs/promises';
const target=await fetch('http://127.0.0.1:9223/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);
  if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function suite(){
  function check(ok,label){if(!ok)throw Error(label);}
  const e=id=>document.getElementById(id),main=['제1조(목적)','본 계약은 별첨 1 제2조에 따른다.','제2조(기간)','계약은 1년간 유효하다.'];
  const ann=['[별첨 1] 보안관리약정서','제1조(보안)','권한을 제한한다.','제2조(반환)','본 계약 제2조의 기간 종료 시 반환한다.'];
  const all=['용역계약서',...main,...ann];
  const wp=s=>'<w:p><w:r><w:t>'+s+'</w:t></w:r></w:p>';
  const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+all.map(wp).join('')+'</w:body></w:document>');
  const docx=new File([await zip.generateAsync({type:'uint8array'})],'synthetic.docx');
  const dx=await extractFileStructure(docx);check(dx.blocks.length===all.length&&dx.blocks[1].source.paragraph===1,'docx source');
  const nz=new JSZip();nz.file('word/document.xml','<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:pStyle w:val="child"/></w:pPr><w:r><w:t>(목적)</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="child"/></w:pPr><w:r><w:t>(기간)</w:t></w:r></w:p></w:body></w:document>');
  nz.file('word/styles.xml','<w:styles xmlns:w="urn:w"><w:style w:styleId="base"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style><w:style w:styleId="child"><w:basedOn w:val="base"/></w:style></w:styles>');
  nz.file('word/numbering.xml','<w:numbering xmlns:w="urn:w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="제%1조"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num></w:numbering>');
  const nd=await extractFileStructure(new File([await nz.generateAsync({type:'uint8array'})],'numbered.docx'));
  check(nd.text.includes('제4조(목적)')&&nd.text.includes('제5조(기간)'),'docx inherited numbering and restart');
  const tableDx=PF._docxXmlToText('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>상위문단</w:t><w:drawing><w:txbxContent><w:p><w:r><w:t>텍스트상자</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p><w:tbl><w:tr><w:tc>'+wp('별첨 1 보안약정서')+'</w:tc></w:tr></w:tbl></w:body></w:document>','','',true);
  check(tableDx.blocks.filter(b=>b.text==='텍스트상자').length===1&&tableDx.blocks.some(b=>b.source.cell&&b.text==='별첨 1 보안약정서'),'docx nested text/table once');
  const hz=new JSZip();hz.file('Contents/header.xml','<hh:head xmlns:hh="urn:hh"><hh:numbering id="1" start="1"><hh:paraHead level="1" numFormat="DIGIT">제^1조</hh:paraHead></hh:numbering><hh:paraPr id="1"><hh:heading type="NUMBER" idRef="1" level="0"/></hh:paraPr></hh:head>');
  hz.file('Contents/section0.xml','<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp">'+all.map(s=>'<hp:p><hp:run><hp:t>'+s+'</hp:t></hp:run></hp:p>').join('')+'</hs:sec>');
  const hx=await extractFileStructure(new File([await hz.generateAsync({type:'uint8array'})],'synthetic.hwpx'));
  check(hx.blocks[1].source.part==='Contents/section0.xml','hwpx part');
  const hn=PF._hwpxStructure('<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp"><hp:p paraPrIDRef="1"><hp:run><hp:t>(목적)</hp:t></hp:run></hp:p><hp:p paraPrIDRef="1"><hp:run><hp:t>(기간)</hp:t></hp:run></hp:p></hs:sec>',await hz.file('Contents/header.xml').async('string'),'Contents/section0.xml',{});
  check(hn.blocks[0].text.includes('제1조')&&hn.blocks[1].text.includes('제2조'),'hwpx numbering definitions');
  const tableHx=PF._hwpxStructure('<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp"><hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>별첨 1 보안약정서</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p></hs:sec>','','Contents/section0.xml',{});
  check(tableHx.blocks.filter(b=>b.text==='별첨 1 보안약정서').length===1&&tableHx.blocks.some(b=>b.source.cell),'hwpx nested table once');
  function utf16(s){const a=new Uint8Array(s.length*2),d=new DataView(a.buffer);for(let i=0;i<s.length;i++)d.setUint16(i*2,s.charCodeAt(i),true);return a;}
  function record(tag,payload){const a=new Uint8Array(4+payload.length);new DataView(a.buffer).setUint32(0,(payload.length<<20)|tag,true);a.set(payload,4);return a;}
  function join(arrays){return Uint8Array.from(arrays.flatMap(a=>Array.from(a)));}
  const body=join(all.map(s=>record(67,utf16(s))));
  // 정규 4096바이트 스트림을 가진 최소 CFB. 암호·압축 없는 HWP 5.0 합성 원본.
  const cfb=new Uint8Array(512*19),v=new DataView(cfb.buffer);cfb.set([208,207,17,224,161,177,26,225]);
  v.setUint16(24,62,true);v.setUint16(26,3,true);v.setUint16(28,65534,true);v.setUint16(30,9,true);v.setUint16(32,6,true);
  v.setUint32(44,1,true);v.setUint32(48,0,true);v.setUint32(56,4096,true);v.setUint32(60,0xfffffffe,true);v.setUint32(68,0xfffffffe,true);
  for(let i=0;i<109;i++)v.setUint32(76+i*4,i?0xffffffff:1,true);
  for(let i=0;i<128;i++)v.setUint32(1024+i*4,0xffffffff,true);v.setUint32(1024,0xfffffffe,true);v.setUint32(1028,0xfffffffd,true);
  for(let i=2;i<18;i++)v.setUint32(1024+i*4,i===9||i===17?0xfffffffe:i+1,true);
  function dir(i,name,type,start,size){const p=512+i*128;cfb.set(utf16(name+'\0'),p);v.setUint16(p+64,(name.length+1)*2,true);v.setUint8(p+66,type);v.setUint32(p+116,start,true);v.setUint32(p+120,size,true);}
  dir(0,'Root Entry',5,0xfffffffe,0);dir(1,'FileHeader',2,2,4096);dir(2,'Section0',2,10,4096);
  cfb.set(new TextEncoder().encode('HWP Document File'),1536);v.setUint32(1536+32,0x05000300,true);cfb.set(body,5632);
  const hw=await extractFileStructure(new File([cfb],'synthetic.hwp'));check(hw.blocks[1].source.record_offset>0,'hwp record provenance');
  // Type1 ToUnicode 매핑을 가진 최소 텍스트 PDF. 네트워크·외부 폰트 없음.
  function hex(s){return Array.from(s).map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');}
  const cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange '+all.length+' beginbfchar '+all.map((s,i)=>'<'+(65+i).toString(16)+'> <'+hex(s)+'>').join(' ')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const content='BT /F1 12 Tf 50 750 Td '+all.map((s,i)=>(i?'0 -25 Td ':'')+'('+String.fromCharCode(65+i)+') Tj').join('\n')+' ET';
  const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream','<< /Length '+cmap.length+' >>\nstream\n'+cmap+'\nendstream'];
  let pdf='%PDF-1.4\n',offsets=[0];objs.forEach((s,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+s+'\nendobj\n';});const at=pdf.length;pdf+='xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+at+'\n%%EOF';
  const pf=await extractFileStructure(new File([pdf],'synthetic.pdf'));check(pf.blocks[0].source.page===1,'pdf page provenance');
  for(const x of [dx,hx,hw,pf]){const r=Integrity.analyze(x.text,segmentContract(x.text),{structure:x});check(r.structure.sections.length===2,x.source_format+' annex boundary');check(!r.items.some(f=>['NUM-01','ATT-01','REF-01'].includes(f.rule_id)),x.source_format+' no false annex warnings');check(x.file_sha256.length===64,'file fingerprint');}
  // 실앱의 파일 열기와 수동 보정·보정 복구·입력 변경 무효화.
  loadContractFile(docx);for(let i=0;i<100&&state.extractedDocument!==dx&&e('input-error').textContent.includes('추출 중')&&!e('input-error').hidden;i++)await new Promise(r=>setTimeout(r,30));
  e('btn-analyze').click();for(let i=0;i<100&&(!state.result||e('btn-analyze').disabled);i++)await new Promise(r=>setTimeout(r,30));
  check(state.documentStructure.source_valid,'app uses extracted structure');
  const manualText=dx.text.replace('[별첨 1] 보안관리약정서','보안관리약정서');e('contract-text').value=manualText;refreshInputSetup();localStorage.removeItem('cr-structure-boundaries-v1:'+StructureReview.fingerprint());e('btn-analyze').click();
  for(let i=0;i<100&&e('btn-analyze').disabled;i++)await new Promise(r=>setTimeout(r,30));
  check(state.integrityFindings.some(f=>f.rule_id==='NUM-01'),'real repeated numbering before boundary');
  let box=document.querySelector('.structure-review');box.open=true;box.querySelector('.structure-line').value='5';box.querySelector('.structure-label').value='별첨 1 보안관리약정서';box.querySelector('.structure-save').click();
  check(!state.integrityFindings.some(f=>f.rule_id==='NUM-01'),'single boundary fixes all duplicates');
  check(StructureReview.boundaries().length===1,'boundary saved');refreshDocumentIntegrity();check(state.documentStructure.sections[1].manual,'boundary reapplied');
  const blobs=[],url=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{blobs.push(b);return url(b);};HTMLAnchorElement.prototype.click=function(){};
  box=document.querySelector('.structure-review');box.querySelector('.structure-export').click();const backup=await blobs[0].text();URL.createObjectURL=url;HTMLAnchorElement.prototype.click=click;
  box.querySelector('.structure-line').value='5';box.querySelector('.structure-remove').click();check(StructureReview.boundaries().length===0,'remove boundary');
  box=document.querySelector('.structure-review');const dt=new DataTransfer();dt.items.add(new File([backup],'synthetic.crstructure'));box.querySelector('.structure-import').files=dt.files;box.querySelector('.structure-import').dispatchEvent(new Event('change'));
  for(let i=0;i<50&&!StructureReview.boundaries().length;i++)await new Promise(r=>setTimeout(r,30));check(StructureReview.boundaries().length===1,'restore boundary');
  e('contract-text').value=manualText+'\n변경';refreshInputSetup();check(StructureReview.boundaries().length===0,'edit invalidates saved boundary');
  e('contract-text').value=manualText;refreshInputSetup();e('btn-analyze').click();for(let i=0;i<100&&e('btn-analyze').disabled;i++)await new Promise(r=>setTimeout(r,30));
  document.querySelector('.structure-review').open=true;document.querySelector('.structure-review').scrollIntoView();
  return {formats:[dx.source_format,hx.source_format,hw.source_format,pf.source_format],docxStyleInheritance:true,hwpxNumbering:true,annexNoFalseDuplicate:true,realDuplicateRetained:true,oneBoundaryCorrection:true,backupRestore:true,editInvalidation:true};
}
try{await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html#admin',import.meta.url).href});
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof StructureReview!=='undefined'&&reviewHistory&&legalOpinionKnowledge){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(Error('init'));}},50);})`);
  const result=await evaluate('('+suite.toString()+')()');await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('new Promise(resolve=>setTimeout(resolve,500))');const shot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile('/private/tmp/contract-review-structure.png',Buffer.from(shot.data,'base64'));
  if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({...result,externalRequests:external.length},null,2));
}finally{ws.close();}
