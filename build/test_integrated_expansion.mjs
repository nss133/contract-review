import fs from 'node:fs';
const endpoint=process.env.CR_TEST_ENDPOINT||'http://127.0.0.1:9359';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let seq=0;const pending=new Map(),errors=[],external=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
function cdp(method,params={}){return new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});}
async function run(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(){await run(`new Promise((ok,no)=>{let n=0;const t=setInterval(()=>{if(typeof TemplateLibraryRuntime!=='undefined'){clearInterval(t);ok();}else if(++n>300){clearInterval(t);no(Error('startup'));}},50);})`);}
async function suite(){
 const e=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};check(CR.app_version==='1.87.0','version');
 const grid=[['주체','대상','의무'],['수탁자','개인정보','기술적·관리적 보호조치를 취하여야 한다.'],['수탁자','제공받은 개인신용정보의 식별정보를','암호화하여야 한다.']];
 const wp=s=>'<w:p><w:r><w:t>'+s+'</w:t></w:r></w:p>',hp=s=>'<hp:p><hp:run><hp:t>'+s+'</hp:t></hp:run></hp:p>';
 const dx=new JSZip();dx.file('word/document.xml','<w:document xmlns:w="urn:w"><w:body>'+wp('제1조(개인정보 보호)')+'<w:tbl>'+grid.map(row=>'<w:tr>'+row.map(s=>'<w:tc>'+wp(s)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl></w:body></w:document>');
 const docx=new File([await dx.generateAsync({type:'uint8array'})],'합성_표준표.docx');
 const omitted=PF._docxXmlToText((await dx.file('word/document.xml').async('string')).replace('</w:tr><w:tr>','</w:tr><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>'),'','',true);
 check(omitted.blocks.some(b=>b.source?.table?.row===1&&b.source.table.invalid&&b.source.table.col===1),'docx omitted cell must not shift columns');
 check(!RequirementRules.evaluate(SafetyRuntime.allChecks().find(c=>c.id==='PRIV-03'),[DocumentStructure.document('본문',omitted.text,omitted)]).eligible,'omitted grid accepted');
 const hx=new JSZip();hx.file('Contents/section0.xml','<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp">'+hp('제1조(개인정보 보호)')+'<hp:tbl>'+grid.map((row,r)=>'<hp:tr>'+row.map((s,c)=>'<hp:tc><hp:cellAddr colAddr="'+c+'" rowAddr="'+r+'"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:subList>'+hp(s)+'</hp:subList></hp:tc>').join('')+'</hp:tr>').join('')+'</hp:tbl></hs:sec>');
 const hwpx=new File([await hx.generateAsync({type:'uint8array'})],'합성표.hwpx');
 function utf16(s){const a=new Uint8Array(s.length*2),d=new DataView(a.buffer);for(let i=0;i<s.length;i++)d.setUint16(i*2,s.charCodeAt(i),true);return a;}
 function rec(tag,payload,level=0){const a=new Uint8Array(4+payload.length);new DataView(a.buffer).setUint32(0,(payload.length<<20)|(level<<10)|tag,true);a.set(payload,4);return a;}
 const join=arrays=>Uint8Array.from(arrays.flatMap(a=>Array.from(a))),ctrl=new Uint8Array(4),tbl=new Uint8Array(8);new DataView(ctrl.buffer).setUint32(0,0x74626c20,true);new DataView(tbl.buffer).setUint16(4,3,true);new DataView(tbl.buffer).setUint16(6,3,true);
 const body=join([rec(66,new Uint8Array(12)),rec(67,utf16('제1조(개인정보 보호)'),1),rec(71,ctrl,1),rec(77,tbl,2),...grid.flatMap((row,r)=>row.flatMap((s,c)=>{const cell=new Uint8Array(34),d=new DataView(cell.buffer);d.setUint16(8,c,true);d.setUint16(10,r,true);d.setUint16(12,1,true);d.setUint16(14,1,true);return [rec(72,cell,2),rec(66,new Uint8Array(12),3),rec(67,utf16(s),4)];}))]);
 const cfb=new Uint8Array(512*19),v=new DataView(cfb.buffer);cfb.set([208,207,17,224,161,177,26,225]);v.setUint16(24,62,true);v.setUint16(26,3,true);v.setUint16(28,65534,true);v.setUint16(30,9,true);v.setUint16(32,6,true);v.setUint32(44,1,true);v.setUint32(48,0,true);v.setUint32(56,4096,true);v.setUint32(60,0xfffffffe,true);v.setUint32(68,0xfffffffe,true);
 for(let i=0;i<109;i++)v.setUint32(76+i*4,i?0xffffffff:1,true);for(let i=0;i<128;i++)v.setUint32(1024+i*4,0xffffffff,true);v.setUint32(1024,0xfffffffe,true);v.setUint32(1028,0xfffffffd,true);for(let i=2;i<18;i++)v.setUint32(1024+i*4,i===9||i===17?0xfffffffe:i+1,true);
 function dir(i,name,type,start,size){const p=512+i*128;cfb.set(utf16(name+'\0'),p);v.setUint16(p+64,(name.length+1)*2,true);v.setUint8(p+66,type);v.setUint32(p+116,start,true);v.setUint32(p+120,size,true);}
 dir(0,'Root Entry',5,0xfffffffe,0);dir(1,'FileHeader',2,2,4096);dir(2,'Section0',2,10,4096);cfb.set(new TextEncoder().encode('HWP Document File'),1536);v.setUint32(1536+32,0x05000300,true);cfb.set(body,5632);const hwp=new File([cfb],'합성표.hwp');
 const strings=['제1조(개인정보 보호)',...grid.flat()],hex=s=>Array.from(s).map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 const cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange '+strings.length+' beginbfchar '+strings.map((s,i)=>'<'+(65+i).toString(16)+'> <'+hex(s)+'>').join(' ')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
 const content=strings.map((s,i)=>{const x=i?50+((i-1)%3)*200:50,y=i?700-Math.floor((i-1)/3)*25:750;return 'BT /F1 12 Tf '+x+' '+y+' Td ('+String.fromCharCode(65+i)+') Tj ET';}).join('\n');
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream','<< /Length '+cmap.length+' >>\nstream\n'+cmap+'\nendstream'];
 let pdf='%PDF-1.4\n',offsets=[0];objs.forEach((s,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+s+'\nendobj\n';});const at=pdf.length;pdf+='xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+at+'\n%%EOF';const pdfFile=new File([pdf],'합성표.pdf');
 async function analyze(text){if(text!==undefined)e('contract-text').value=text;refreshInputSetup();e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));e('btn-analyze').click();for(let n=0;n<200&&(!state.result||e('btn-analyze').disabled);n++)await new Promise(r=>setTimeout(r,30));check(!!state.result,'analysis');if(state.typeId!=='outsourcing'){e('input-type').value='outsourcing';e('input-type').dispatchEvent(new Event('change'));}for(const module of ['X-PII','X-EFIN'])if(!state.activeModules.includes(module))document.querySelector('#input-screening [data-mid="'+module+'"]').click();}
 function verify(id){check(verdictStore[id]?.verdict==='이상없음'&&verdictStore[id]?.origin==='auto',id+' auto '+JSON.stringify(SafetyRuntime.standardReport().rows.find(r=>r.check_id===id)));check(!!document.querySelector('.cr-reviewed [data-vcp="'+id+'"]'),id+' column2');check(!pendingReviewItems().some(r=>r.id===id),id+' pending');}
 const formats=[];
 for(const file of [docx,hwpx,hwp,pdfFile]){const x=await extractFileStructure(file);check(x.blocks.some(b=>b.source?.table?.row===1),file.name+' table metadata');
  const rule=RequirementRules.evaluate(SafetyRuntime.allChecks().find(c=>c.id==='PRIV-03'),[DocumentStructure.document('본문',x.text,x)]);check(rule.eligible,file.name+' table semantics '+JSON.stringify(rule));
  loadContractFile(file);for(let n=0;n<200&&(state.fileName!==file.name||!e('input-error').hidden);n++)await new Promise(r=>setTimeout(r,30));check(state.fileName===file.name,'file load');await analyze();verify('PRIV-03');formats.push(x.source_format);
 }
 const dt=new DataTransfer();dt.items.add(docx);e('template-file').files=dt.files;await e('template-file').onchange();const t=TemplateLibraryRuntime.get().templates.find(t=>t.name===docx.name);check(t?.extraction?.blocks?.length&&t.bindings.some(b=>b.check_id==='PRIV-03'),'register structure');
 const packet=SafetyRuntime.standardPacket();check(packet.documents[0].extraction?.blocks?.length,'archive structure');await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[packet]});check((await StandardAutoArchive.backup()).packets.find(p=>p.id===packet.id).documents[0].extraction.blocks.length,'restore structure');
 const current=state.extractedDocument;current.blocks.find(b=>b.source?.table?.row===1).source.table.invalid=true;applyAutoVerdicts();renderClauses();check(!verdictStore['PRIV-03']?.verdict,'structure mutation must revoke');
 await analyze('제1조(보호)\n수탁자는 개인정보 기술적·관리적 보호조치를 이행하여야 한다.\n또한 위 개인정보에 대한 접근권한을 업무수행에 필요한 최소한의 범위로 제한하도록 한다.');verify('PRIV-03');verify('PRIV-06');
 const personnel='제1조(인력관리)\n① 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n가. 다음 각 세목의 사항을 이행할 것\n(1) 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시할 것\n(2) 업무수행인력이 변경되는 경우 인수인계를 실시할 것';
 await analyze(personnel);verify('ITSEC-12');await analyze(personnel.replace('(2)','(3)'));check(!verdictStore['ITSEC-12']?.verdict,'subitem gap');
 const branch='제1조(기록)\n① 기록은 전자파일로 작성한다.\n② 기록 보존기간은 3년이다.\n제1조의2(추가)\n① 추가 기록을 작성한다.\n제2조(열람)\n① 기록은 서면으로 요청한다.\n② 기록은 7일 이내 제공한다.\n제9조(비밀유지)\n비밀정보의 관리범위(합성시험 '+Date.now()+')는 제1조 제1항부터 제2조 제2항까지에 따른다.';
 await analyze(branch);check(!verdictStore['CNS-SECRET']?.verdict,'no independent truth');applyVerdict('CNS-SECRET','이상없음','합성 사람 판단','반영되어 있음','manual');const p=SafetyRuntime.standardPacket();await StandardAutoArchive.restore({format:'cr-standard-evaluation-backup-v1',packets:[p]});for(let n=0;n<100&&!TemplateLibraryRuntime.packets().some(x=>x.id===p.id);n++)await new Promise(r=>setTimeout(r,30));
 const equivalent=branch.replace('제1항부터 제2조 제2항까지','제1항 내지 제2조 제2항');await analyze(equivalent);verify('CNS-SECRET');check(verdictStore['CNS-SECRET'].auto_proof.kind==='clause_reused','history route');await analyze(equivalent.replace('7일','30일'));check(!verdictStore['CNS-SECRET']?.verdict,'middle condition changed');
 const condition='제1조(신원확인)\n수탁자는 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시하여야 한다.\n제2조(인수인계)\n수탁자는 업무수행인력이 변경되는 경우 다음의 의무를 이행하여야 한다.\n수탁자는 인수인계를 실시하여야 한다.';
 await analyze(condition);verify('ITSEC-12');await analyze(condition+'\n다만, 긴급한 경우 해당 의무를 생략할 수 있다.');check(!verdictStore['ITSEC-12']?.verdict,'related ambiguous exception');
 const independent='제1조(보호)\n수탁자는 개인정보 기술적·관리적 보호조치를 취하여야 한다.\n수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.\n다만, 수탁자의 개인정보처리현황점검 의무는 긴급한 경우에는 적용하지 아니한다.';
 await analyze(independent);verify('PRIV-03');check(!verdictStore['PRIV-07']?.verdict,'restricted duty approved');
 applyVerdict('PRIV-03','검토의견','직접 작성 의견','','manual');applyAutoVerdicts();check(verdictStore['PRIV-03'].origin==='manual'&&verdictStore['PRIV-03'].verdict==='검토의견','manual preserved');
 // 기존 자동 등록은 새 연결로 재생성하되 원본 표 좌표를 잃지 않는다.
 const saved=TemplateLibraryRuntime.get();saved.templates.forEach(t=>{t.registration.version=14;t.bindings=[];});localStorage.setItem('cr-template-library-v1',JSON.stringify(saved));
 return {formats,table_original_evidence:true,table_registration:true,archive_structure:true,structure_change_revokes:true,phrases_and_pronouns:true,three_levels:true,branch_and_cross_parent_history:true,condition_scope:true,independent_exception:true,related_exception_retained:true,manual_preserved:true,second_column:true};
}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.navigate',{url:new URL('../dist/contract-review.html',import.meta.url).href});await ready();await run('localStorage.clear();location.reload();');await new Promise(r=>setTimeout(r,300));await ready();
 const result=await run('('+suite.toString()+')()');await run('location.reload()');await new Promise(r=>setTimeout(r,300));await ready();
 const migration=await run(`(()=>{const t=TemplateLibraryRuntime.get().templates.find(t=>t.name==='합성_표준표.docx');if(t.registration.version!==15||!t.extraction||!t.bindings.some(b=>b.check_id==='PRIV-03'))throw Error('table migration');return true;})()`);
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));console.log(JSON.stringify({result,migration,errors,external}));
}catch(e){console.error(JSON.stringify({errors}));throw e;}finally{await fetch(endpoint+'/json/close/'+target.id);ws.close();}
