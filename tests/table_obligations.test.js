const {test}=require('node:test'),assert=require('node:assert/strict');
const Structure=require('../src/document_structure'),Q=require('../src/clause_semantics'),D=require('../src/decision_evidence'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register'),P=require('../src/human_precedent');
const checks=require('../knowledge/judgment_policies.json').checks.map(p=>({id:p.id,check:p.question})),cp=id=>checks.find(c=>c.id===id),item={coverage:'addressed'},scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]};
const grid=[['주체','대상','의무'],['수탁자','개인정보','기술적·관리적 보호조치를 취하여야 한다.'],['수탁자','제공받은 개인신용정보의 식별정보를','암호화하여야 한다.']];
function make(cells=grid){const x=Structure.fromBlocks('docx',[{text:'제1조(보호조치)'}].concat(cells.flatMap((row,r)=>row.map((text,c)=>({text,source:{cell:r+':'+c,table:{id:'t',row:r,col:c,colspan:1,rowspan:1}}})))),[]);return [Structure.document('본문',x.text,x)];}
const run=(id,docs)=>S.evaluate(cp(id),item,{confirmed:true,documents:docs});
test('표 머리글과 모든 셀을 연결하여 직접 요건·태그·원문 근거 제공',()=>{
 const docs=make();for(const id of ['PRIV-03','PRIV-19']){const r=run(id,docs);assert.equal(r.eligible,true,JSON.stringify(r));assert.ok(r.evidence.some(e=>/보호조치|암호화/.test(e.text)));assert.ok(r.evidence.every(e=>docs[0].text.includes(e.text)));}
 const plain=[{name:'본문',text:'제1조(보호조치)\n수탁자는 개인정보 기술적·관리적 보호조치를 취하여야 한다.\n수탁자는 제공받은 개인신용정보의 식별정보를 암호화하여야 한다.'}];
 assert.equal(D.bundle(cp('PRIV-03'),docs).key,D.bundle(cp('PRIV-03'),plain).key);
});
test('표의 주체·대상·의무 열 순서가 바뀌어도 머리글로 연결',()=>{assert.equal(run('PRIV-03',make(grid.map(r=>[r[2],r[0],r[1]]))).eligible,true);});
test('셀 안의 완전 문장은 읽되 셀 머리글과 명시 주체의 충돌은 보존',()=>{
 const rows=[['의무주체','대상정보','의무내용'],['수탁자','개인정보','수탁자는 개인정보 기술적·관리적 보호조치를 취하여야 한다.']];
 assert.equal(run('PRIV-03',make(rows)).eligible,true);rows[1][2]=rows[1][2].replace('수탁자','위탁자');assert.equal(run('PRIV-03',make(rows)).eligible,false);
});
test('표의 명시 조건은 보존하고 조건을 생략하지 않음',()=>{
 const docs=make([['의무자','적용조건','약정내용'],['수탁자','업무수행인력이 변경되는 경우','인수인계를 실시하여야 한다.'],['수탁자','업무수행인력이 변경되는 경우에만','인수인계를 실시하여야 한다.']]);
 assert.equal(run('ITSEC-12',docs).eligible,false);assert.equal(D.bundle(cp('ITSEC-12'),docs).reusable,false);
});
test('셀 사이 연결을 복원할 수 없는 표와 재량 문구를 충족으로 추정하지 않음',()=>{
 assert.equal(run('PRIV-03',make(grid.map(r=>r.map(s=>s.replace('하여야 한다','할 수 있다'))))).eligible,false);
 const variants=[make([grid[0],['','개인정보',grid[1][2]]]),make([['담당','대상','업무'],grid[1]])];
 assert.equal(run('PRIV-03',make([grid[0],['수탁자','개인정보','기술적·관리적 보호조치']])).eligible,true);
 assert.equal(run('PRIV-03',make([grid[0],['위탁자',...grid[1].slice(1)]])).eligible,false);
 const merged=make();merged[0].extraction.blocks[4].source.table.rowspan=2;variants.push(merged);
 const gap=make();gap[0].extraction.blocks[4].source.table.row=3;variants.push(gap);
 const unknown=make();unknown[0].extraction.blocks[4].source.table.invalid=true;variants.push(unknown);
 for(const docs of variants)assert.equal(run('PRIV-03',docs).eligible,false,JSON.stringify(docs));
});
test('표 구조가 없는 평문·다른 원문의 구조·캐시 변경을 추정하지 않음',()=>{
 const docs=make(),before=JSON.stringify(docs),ctx=Q.contexts(docs);assert.equal(JSON.stringify(docs),before);assert.equal(Q.contexts(docs),ctx);
 docs[0].extraction.blocks[4].source.table.colspan=2;assert.notEqual(Q.contexts(docs),ctx);assert.equal(run('PRIV-03',docs).eligible,false);
 assert.equal(run('PRIV-03',[{name:'본문',text:make()[0].text}]).eligible,false);
 const edited=make();edited[0].text+='변경';assert.equal(run('PRIV-03',edited).eligible,false);
 assert.equal(run('PRIV-03',[{name:'본문',text:'수탁자는 개인정보의 기술적·관리적 보호조치를 취하여야 한다.'}]).eligible,true);
});
test('표준 표 등록·백업·준비 입력과 완전 문장 상호 비교',()=>{
 const docs=make(),t=Register.process('표준표','1',docs[0].text,{type_ids:['outsourcing']},checks,docs[0].extraction),lib=L.validate(JSON.parse(JSON.stringify({format:L.VERSION,templates:[t]})));
 assert.ok(t.bindings.some(b=>b.check_id==='PRIV-03'));assert.ok(t.structure_fingerprint);
 for(const target of [docs,[{name:'본문',text:'수탁자는 개인정보 기술적·관리적 보호조치를 취하여야 한다.'}]])assert.equal(L.evaluate(lib,cp('PRIV-03'),item,L.prepare({current:true,scope,documents:target})).eligible,true);
 lib.templates[0].extraction.blocks[4].source.table.row=3;assert.throws(()=>L.validate(lib));
});
test('표를 포함한 사람 판단은 셀 구조 수정시 정확일치 재사용하지 않음',()=>{
 const source=make(),packet={id:'table-source',documents:source,context:scope,checks:[cp('PRIV-03')],verdicts:{'PRIV-03':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const target=make();assert.equal(P.lookup(cp('PRIV-03'),P.prepare({documents:target,scope,review_packets:[packet]})).eligible,true);
 target[0].extraction.blocks[4].source.table.colspan=2;assert.equal(P.lookup(cp('PRIV-03'),P.prepare({documents:target,scope,review_packets:[packet]})).eligible,false);
});
test('표준의 허용 입력란만 채운 본건 별첨도 표 구조와 원문 위치를 유지',()=>{
 const F=require('../src/template_fields'),source=make()[0],x=Structure.fromBlocks('docx',[{text:'상호: 가상기업'}].concat(source.extraction.blocks),[]),fields=F.candidates(x.text),d=F.fillDocument('별첨',x.text,fields,{상호:'시험기업'},x);
 assert.equal(Structure.validExtraction(d.text,d.extraction),true);assert.equal(d.text.includes('시험기업'),true);assert.equal(run('PRIV-03',[d]).eligible,true);
 assert.throws(()=>F.fillDocument('별첨',x.text,fields,{상호:'모든 의무 면제'},x));
});
test('한글 분해 문자도 추출 시 위치를 같이 정규화하고 오래된 불일치 좌표는 사용하지 않음',()=>{
 const d=make(grid.map(row=>row.map(s=>s.normalize('NFD'))));assert.equal(d[0].text,d[0].text.normalize('NFC'));assert.equal(run('PRIV-03',d).eligible,true);
 const source=make()[0],blocks=source.extraction.blocks.map(b=>({...b,text:b.text.normalize('NFD')}));let at=0;
 for(const b of blocks){b.start=at;b.end=at+b.text.length;at=b.end+1;}
 const text=blocks.map(b=>b.text+'\n').join(''),old={...source,text,extraction:{...source.extraction,text,blocks}};assert.equal(run('PRIV-03',[old]).eligible,false);
});
