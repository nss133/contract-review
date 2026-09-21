'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const J=require('../src/agreement_judgment'),A=require('../src/agreement_evidence'),Q=require('../src/clause_semantics');
const D=require('../src/document_structure'),L=require('../src/template_library'),S=require('../src/standard_auto');
const inventory=require('../knowledge/checklist_inventory_v188.json').checks;
const cp=id=>{const r=inventory.find(r=>r.id===id);return {id,check:r.question,meaning_revision:r.meaning_revision};};
const court='본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.';
const law='수탁자는 관련 법령을 준수한다.';
const item={coverage:'addressed'};
function library(text=court,checks=[cp('CMN-19')]){
 const t=L.draft('합성표준약정서','1',text,{type_ids:['outsourcing'],roles:[]});
 checks.forEach(c=>L.bind(t,c,[text]));t.active=true;return {format:L.VERSION,templates:[t]};
}
function input(text=court,knowledge){return {current:true,confirmed:true,documents:[{name:'본건 계약서',text}],scope:{},knowledge};}
function table(){
 const cells=[['주체','대상','의무'],['수탁자','개인정보','기술적·관리적 보호조치를 취하여야 한다.']];
 const x=D.fromBlocks('docx',[{text:'제1조(보호조치)'}].concat(cells.flatMap((r,ri)=>r.map((text,ci)=>({text,source:{table:{id:'t',row:ri,col:ci,rowspan:1,colspan:1}}})))),[]);
 return D.document('표 약정서',x.text,x);
}
test('v1.89 중첩 변경 토큰은 키·배열·부분 freeze의 제자리 수정까지 감지한다',()=>{
 const data=Object.freeze({blocks:[{source:{table:{row:1,col:0}},text:'원문'}]});
 const token=D.revisionToken(data);assert.equal(D.revisionToken(data),token);
 data.blocks[0].source.table.col=2;const next=D.revisionToken(data);assert.notEqual(next,token);assert.equal(D.revisionToken(data),next);
 data.blocks[0].source.table.extra=true;assert.notEqual(D.revisionToken(data),next);
 const before=D.revisionToken(data);data.blocks.push({text:'추가'});assert.notEqual(D.revisionToken(data),before);
 const frozen=Object.freeze({x:Object.freeze([Object.freeze({v:'고정'})])});assert.equal(D.revisionToken(frozen),D.revisionToken(frozen));
 assert.equal(Object.isFrozen(data.blocks),false,'사용자 원본의 자식을 얼리지 않는다');
});
test('v1.89 추출 구조 캐시 hit에서는 전체 JSON을 직렬화하지 않는다',()=>{
 const docs=[table()],rows=A.units(docs),original=JSON.stringify;let serializations=0;
 try{JSON.stringify=function(...args){serializations++;return original.apply(this,args);};for(let i=0;i<20;i++)assert.equal(A.units(docs),rows);}
 finally{JSON.stringify=original;}
 assert.equal(serializations,0);
 docs[0].extraction.blocks[4].source.table.colspan=2;assert.notEqual(A.units(docs),rows);
 assert.equal(J.evaluate(cp('PRIV-03'),docs).eligible,false);
});
test('v1.89 표준 전처리는 표준당 한 번, 질문 결과는 표준·질문당 한 번 재사용한다',()=>{
 const checks=[cp('CMN-19'),cp('CORE-06')],good=court+'\n'+law;
 const templates=Array.from({length:20},(_,i)=>library(i===19?good:'당사자는 회의를 월요일에 진행한다.',checks).templates[0]);
 templates.forEach((t,i)=>{t.id='synthetic-'+i;});const lib={templates},i=L.prepare(input(good));
 const evaluate=J.evaluate,contexts=Q.contexts;let sources=0,preparations=0;
 try{
  J.evaluate=function(c,docs,options){if(options?.source_standard)sources++;return evaluate(c,docs,options);};
  Q.contexts=function(...args){preparations++;return contexts.apply(this,args);};
  checks.forEach(c=>assert.equal(L.evaluate(lib,c,item,i).eligible,true));
  assert.equal(sources,40);assert.equal(preparations,21,'현재 자료 한 번과 표준 20개 각각 한 번');
  checks.forEach(c=>assert.equal(L.evaluate(lib,c,item,i).eligible,true));
  assert.equal(sources,40,'같은 질문의 표준 원문을 다시 판정하지 않는다');assert.equal(preparations,21);
 }finally{J.evaluate=evaluate;Q.contexts=contexts;}
});
test('v1.89 표준 원문·이름·연결 기준 변경은 캐시와 기존 티켓을 무효화한다',()=>{
 const c=cp('CMN-19'),lib=library(),t=lib.templates[0],i=L.prepare(input());
 let result=L.evaluate(lib,c,item,i);assert.equal(result.eligible,true);
 t.text='관할은 추후 정한다.';assert.equal(L.ticketFromEvaluation(lib,c,item,i,result),null);assert.equal(L.evaluate(lib,c,item,i).eligible,false);
 t.text=court;t.name='변경된 표준약정서';result=L.evaluate(lib,c,item,i);assert.equal(result.eligible,true);assert.equal(result.source_evidence[0].document,t.name);
 t.bindings[0].meaning_revision='다른 질문';assert.equal(L.ticketFromEvaluation(lib,c,item,i,result),null);assert.equal(L.evaluate(lib,c,item,i).eligible,false);
 t.bindings[0].meaning_revision=c.meaning_revision;result=L.evaluate(lib,c,item,i);assert.equal(result.eligible,true);
 t.bindings[0].quotes[0]='변경 인용';assert.equal(L.ticketFromEvaluation(lib,c,item,i,result),null);
});
test('v1.89 표준 결과 인용 편집은 비공개 원문 판정 캐시를 오염시키지 않는다',()=>{
 const c=cp('CMN-19'),lib=library(),i=L.prepare(input()),result=L.evaluate(lib,c,item,i);
 result.source_evidence[0].text='화면 편집';assert.equal(L.ticketFromEvaluation(lib,c,item,i,result),null);
 const again=L.evaluate(lib,c,item,i);assert.equal(again.source_evidence[0].text,court);assert.ok(L.ticketFromEvaluation(lib,c,item,i,again));
 assert.equal(Object.isFrozen(lib.templates[0]),false);
});
test('v1.89 표준의 같은 extraction 객체 내부 셀 변경도 재판정한다',()=>{
 const c=cp('PRIV-03'),d=table(),t=L.draft('합성표준약정서','1',d.text,{type_ids:['outsourcing'],roles:[]},d.extraction);
 L.bind(t,c,[d.text]);t.active=true;const lib={templates:[t]},i=L.prepare(input('수탁자는 개인정보의 기술적·관리적 보호조치를 취하여야 한다.'));
 const result=L.evaluate(lib,c,item,i);assert.equal(result.eligible,true);assert.equal(Object.isFrozen(t.extraction),false);
 t.extraction.blocks[4].source.table.colspan=2;
 assert.equal(L.ticketFromEvaluation(lib,c,item,i,result),null);assert.equal(L.evaluate(lib,c,item,i).eligible,false);
 t.extraction.blocks[4].source.table.colspan=1;assert.equal(L.evaluate(lib,c,item,i).eligible,true);
});
test('v1.89 현재 원문·중첩 표 구조 변경 후에는 이전 표준 근거를 재사용하지 않는다',()=>{
 const c=cp('PRIV-03'),d=table(),lib=library('수탁자는 개인정보의 기술적·관리적 보호조치를 취하여야 한다.',[c]),i=input();i.documents=[d];
 const result=L.evaluate(lib,c,item,i);assert.equal(result.eligible,true);
 d.extraction.blocks[4].source.table.rowspan=2;assert.equal(L.ticketFromEvaluation(lib,c,item,i,result),null);assert.equal(L.evaluate(lib,c,item,i).eligible,false);
 const plain=input(),j=library(),old=L.evaluate(j,cp('CMN-19'),item,plain);plain.documents[0].text='관할은 추후 정한다.';
 assert.equal(L.ticketFromEvaluation(j,cp('CMN-19'),item,plain,old),null);assert.equal(L.evaluate(j,cp('CMN-19'),item,plain).eligible,false);
});
test('v1.89 태그 사전 변경은 StandardAuto와 표준 연결의 이전 티켓을 무효화한다',()=>{
 for(const mutate of [k=>k.tags.t.aliases[0]='다른표현',k=>k.tags.t.label='다른주제',k=>k.tags.t.type='department',k=>delete k.tags.t]){
  const c=cp('PRIV-19'),knowledge={tags:{t:{label:'암호화',type:'content',aliases:['비가독화처리']}}},i=input('수탁자는 개인정보를 비가독화처리하여 저장한다.',knowledge);
  const lib=library('수탁자는 개인정보를 암호화하여 저장한다.',[c]);
  const standard=S.evaluate(c,item,i),template=L.evaluate(lib,c,item,i);assert.equal(standard.eligible,true);assert.equal(template.eligible,true);
  mutate(knowledge);
  assert.equal(S.ticketFromEvaluation(c,item,i,standard),null);assert.equal(L.ticketFromEvaluation(lib,c,item,i,template),null);
  assert.equal(S.evaluate(c,item,i).eligible,false);assert.equal(L.evaluate(lib,c,item,i).eligible,false);
 }
});
