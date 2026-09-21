const {test}=require('node:test');const assert=require('node:assert/strict');
global.PF={};global.DocumentStructure=require('../src/document_structure');
require('../src/extract-hwp');require('../src/extract-pdf');
function record(tag,bytes,level=0){const out=new Uint8Array(4+bytes.length);new DataView(out.buffer).setUint32(0,(bytes.length<<20)|(level<<10)|tag,true);out.set(bytes,4);return out;}
function join(...arrays){return Uint8Array.from(arrays.flatMap(a=>Array.from(a)));}
function text(s){const b=new Uint8Array(s.length*2),d=new DataView(b.buffer);for(let i=0;i<s.length;i++)d.setUint16(i*2,s.charCodeAt(i),true);return b;}
test('HWP 문단 헤더·레코드 주소와 번호 정의를 보존하고 선언된 번호를 복원',()=>{
  const header=new Uint8Array(12),dv=new DataView(header.buffer);dv.setUint16(8,0,true);
  const bytes=join(record(66,header),record(67,text('(목적)')),record(66,header),record(67,text('(기간)')));
  const defs={shapes:[{kind:2,number_id:1,level:0,indent:100}],numbers:[[{template:'제^1조',start:3}]]};
  const out=PF._hwpStructuredRecords(bytes,'BodyText/Section0',defs);
  assert.equal(out.blocks[0].text,'제3조 (목적)');assert.equal(out.blocks[1].text,'제4조 (기간)');
  assert.equal(out.blocks[0].source.paragraph_shape,0);assert.equal(out.blocks[0].source.record_offset,16);
  assert.equal(out.blocks[0].numbering.confirmed,true);
});
test('HWP 의미를 모르는 자동번호에 순차 조문 번호를 날조하지 않는다',()=>{
  const out=PF._hwpStructuredRecords(record(67,text('제'+String.fromCharCode(18)+'\0'.repeat(7)+'조(목적)')),'Section0');
  assert.ok(!out.blocks[0].text.includes('제1조'));assert.equal(out.blocks[0].numbering.confirmed,false);assert.equal(out.warnings.length,1);
});
test('HWP 잘린 레코드를 조용히 부분 성공으로 넘기지 않는다',()=>{assert.throws(()=>PF._hwpStructuredRecords(Uint8Array.from([67,0,240,127]),'Section0'));});
test('HWP DocInfo의 문단 모양과 7수준 번호 정의를 연결한다',()=>{
  const shape=new Uint8Array(54),dv=new DataView(shape.buffer);dv.setUint32(0,2<<23,true);dv.setUint16(30,1,true);
  const levels=Array.from({length:7},(_,i)=>{const t=text('^'+(i+1)+'.'),h=new Uint8Array(14);new DataView(h.buffer).setUint16(12,t.length/2,true);return join(h,t);});
  const start=new Uint8Array(30);new DataView(start.buffer).setUint16(0,1,true);for(let i=0;i<7;i++)new DataView(start.buffer).setUint32(2+i*4,1,true);
  const defs=PF._hwpDefinitions(join(record(25,shape),record(23,join(...levels,start))));
  assert.equal(defs.shapes[0].number_id,1);assert.equal(defs.numbers[0][0].template,'^1.');
});
test('PDF 텍스트 순서를 좌표로 복원하고 표제 조각·출처 좌표를 보존',()=>{
  function item(str,x,y,width){return {str,width,transform:[12,0,0,12,x,y],fontName:'f'};}
  const blocks=PF._pdfPageBlocks([item('(목적)',80,700,30),item('기간',60,650,25),item('제1조',50,700,30)],2,800);
  assert.equal(blocks[0].text,'제1조(목적)');assert.equal(blocks[0].source.page,2);assert.equal(blocks[0].source.spans.length,2);
  const separated=PF._pdfPageBlocks([item('왼쪽',50,500,30),item('오른쪽',350,500,40)],1,800);
  assert.equal(separated.length,2);
});
test('HWP 표 컨트롤의 행·열·병합과 레코드 경계를 읽고 밖으로 전파하지 않음',()=>{
 const ctrl=new Uint8Array(4);new DataView(ctrl.buffer).setUint32(0,0x74626c20,true);
 const table=new Uint8Array(8),td=new DataView(table.buffer);td.setUint16(4,2,true);td.setUint16(6,3,true);
 function cell(row,col,s,span=1){const b=new Uint8Array(34),d=new DataView(b.buffer);d.setUint16(8,col,true);d.setUint16(10,row,true);d.setUint16(12,span,true);d.setUint16(14,1,true);return join(record(72,b,2),record(66,new Uint8Array(12),3),record(67,text(s),4));}
 const bytes=join(record(71,ctrl,1),record(77,table,2),cell(0,0,'주체'),cell(0,1,'대상'),cell(0,2,'의무'),cell(1,0,'수탁자'),cell(1,1,'개인정보'),cell(1,2,'기술적·관리적 보호조치를 취하여야 한다.'),record(66,new Uint8Array(12),0),record(67,text('표 밖'),1));
 const x=DocumentStructure.fromBlocks('hwp',PF._hwpStructuredRecords(bytes,'Section0').blocks,[]);
 assert.equal(x.blocks[4].source.table.col,1);assert.equal(x.blocks[4].source.table.row,1);assert.equal(x.blocks[6].source.table,null);
 const R=require('../src/requirement_rules'),cp={id:'PRIV-03',check:R.catalog['PRIV-03'].question};assert.equal(R.evaluate(cp,[DocumentStructure.document('본문',x.text,x)]).eligible,true);
 const bad=PF._hwpStructuredRecords(join(record(71,ctrl,1),record(77,table,2),cell(1,2,'병합',2)),'Section0');assert.equal(bad.blocks[0].source.table.invalid,true);
});
test('PDF 명시 열 머리글과 좌표가 맞는 표만 구조화하고 빠진 셀은 표시',()=>{
 const row=(values,y)=>values.map((str,i)=>({str,width:30,transform:[12,0,0,12,50+i*200,y]}));
 const items=[...row(['주체','대상','의무'],700),{str:' ',width:170,transform:[12,0,0,12,80,700]},...row(['수탁자','개인정보','기술적·관리적 보호조치를 취하여야 한다.'],675)];
 const x=DocumentStructure.fromBlocks('pdf',PF._pdfPageBlocks(items,1,800),[]),R=require('../src/requirement_rules'),cp={id:'PRIV-03',check:R.catalog['PRIV-03'].question};
 assert.equal(x.blocks[5].source.table.col,2);assert.equal(R.evaluate(cp,[DocumentStructure.document('본문',x.text,x)]).eligible,true);
 items.pop();const bad=DocumentStructure.fromBlocks('pdf',PF._pdfPageBlocks(items,1,800),[]);assert.equal(bad.blocks[3].source.table.invalid,true);assert.equal(R.evaluate(cp,[DocumentStructure.document('본문',bad.text,bad)]).eligible,false);
});
