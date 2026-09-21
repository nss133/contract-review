'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const J=require('../src/agreement_judgment'),D=require('../src/document_structure');
const inventory=require('../knowledge/checklist_inventory_v188.json').checks;
const cp=id=>{const r=inventory.find(r=>r.id===id);return {id,check:r.question,meaning_revision:r.meaning_revision};};
test('v1.89 무관한 별칭 수천 개를 매 문장마다 다시 정규화하지 않는다',()=>{
 const knowledge={tags:Object.fromEntries(Array.from({length:2000},(_,i)=>['t'+i,{label:'비관련주제'+i,type:'content',aliases:['동의표현'+i]}]))};
 knowledge.tags.encryption={label:'암호화',type:'content',aliases:['비가독화처리']};
 const docs=[{name:'본문',text:'수탁자는 개인정보를 비가독화처리하여 저장한다.\n'+Array.from({length:200},(_,i)=>'제'+(i+2)+'조(회의)\n회의는 월요일에 한다.').join('\n')}];
 assert.equal(J.evaluate(cp('PRIV-19'),docs,{knowledge}).eligible,true);
 const original=String.prototype.normalize;let calls=0;
 try{String.prototype.normalize=function(...args){calls++;return original.apply(this,args);};assert.equal(J.evaluate(cp('PRIV-19'),docs,{knowledge}).eligible,true);}
 finally{String.prototype.normalize=original;}
 assert.ok(calls<1000,'매 문장×전체 별칭 루프가 되살아남: 정규화 '+calls+'회');
 knowledge.tags.encryption.aliases[0]='다른처리';assert.equal(J.evaluate(cp('PRIV-19'),docs,{knowledge}).eligible,false);
 knowledge.tags.encryption.aliases.push('비가독화처리');assert.equal(J.evaluate(cp('PRIV-19'),docs,{knowledge}).eligible,true);
});
test('v1.89 같은 별칭이 여러 명시 주제에 연결되어도 본래 순서와 원문 부정을 보존한다',()=>{
 const knowledge={tags:{first:{label:'암호화',type:'content',aliases:['비가독화처리']},second:{label:'식별정보',type:'content',aliases:['비가독화처리']}}};
 const good=[{name:'본문',text:'수탁자는 개인정보를 비가독화처리하여 저장한다.'}],r=J.evaluate(cp('PRIV-19'),good,{knowledge});
 assert.equal(r.eligible,true);assert.deepEqual(r.tag_evidence[0].tags.filter(t=>t.tag_id).map(t=>t.tag_id),['first','second']);
 const bad=[{name:'본문',text:'수탁자는 개인정보를 비가독화처리하지 않으며 저장한다.'}];assert.equal(J.evaluate(cp('PRIV-19'),bad,{knowledge}).eligible,false);
});
test('v1.89 구조 분석은 앞선 줄 전체를 복사하지 않고 이전 비어 있지 않은 줄을 유지한다',()=>{
 const text=['본 계약서','', '별첨 1', '', '별첨 2', '', '제1조(목적)', '업무를 수행한다.', '', '별첨 3', '', '제1조(다른 약정)', '별도 업무를 수행한다.'].join('\n');
 const map=D.inspect(text);assert.deepEqual(map.sections.map(s=>s.start),[0,9]);
 const original=Array.prototype.slice;let prefixCopies=0;
 try{Array.prototype.slice=function(start,end){if(start===0&&end>0)prefixCopies++;return original.apply(this,arguments);};D.inspect(Array.from({length:5000},(_,i)=>'문단 '+i).join('\n'));}
 finally{Array.prototype.slice=original;}
 assert.equal(prefixCopies,0,'줄마다 앞선 전체 줄을 복사하는 제곱 연산');
});
test('v1.89 근거 개수 최적화로 내부 원문 근거를 삭제하지 않는다',()=>{
 const docs=[{name:'기간 계약서',text:Array.from({length:400},(_,i)=>'제'+(i+1)+'조(업무)\n본 계약의 기간은 체결일부터 9개월로 한다.').join('\n')}];
 const r=J.evaluate(cp('CNS-TERM'),docs);assert.equal(r.eligible,true);assert.equal(r.evidence.length,400);assert.equal(r.recognition.evidence.length,400);
 assert.equal(new Set(r.evidence.map(e=>e.start)).size,400);assert.ok(r.evidence.every(e=>docs[0].text.slice(e.start,e.end)===e.text));
});
test('v1.89 금액 접두부 분리는 기존 확정 금액·요율 인식을 보존한다',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),file=require.resolve('../src/agreement_judgment');
 const original=/(?:계약금액|총대금|대금|대가|수수료|보수)(?:은|는|:|：|총|일금)*([일금영일이삼사오육칠팔구십백천만억조정]*\d[\d,]*(?:\.\d+)?)(원|만원|억원|%)/;
 // 생산 코드나 공개 API를 바꾸지 않고 직전 금액 인식식과 캡처값 효과를 교차 대조한다.
 const baseline={module:{exports:{}},require:createRequire(file)};
 vm.runInNewContext(fs.readFileSync(file,'utf8').replace('m=numericPrice(s);','m=s.match('+original.toString()+');'),baseline);
 for(const name of ['계약금액','총대금','대가','수수료','보수'])for(const prefix of ['은','일금','은일금총일금','일금는일금'])for(const amount of ['100원','1,000만원','12.5%','일백100원']){
  const text=name+prefix+amount+'으로 정한다.',m=original.exec(text);assert.ok(m);
  const docs=[{name:'대가 약정서',text:text+'\n'+name+'은 '+m[1]+m[2]+'으로 정한다.'}];
  const r=J.evaluate(cp('CNS-PRICE'),docs),old=baseline.module.exports.evaluate(cp('CNS-PRICE'),docs);
  assert.equal(JSON.stringify(r),JSON.stringify(old),text+' 금액·단위 캡처 동등성');assert.equal(r.eligible,true,text);assert.equal(r.evidence.length,2);
 }
});
test('v1.89 긴 미완성 금액과 뒤의 독립된 유효 금액을 구별한다',()=>{
 const incomplete='대금은'+'일금'.repeat(10000)+'0'+'1'.repeat(10000);
 assert.equal(J.evaluate(cp('CNS-PRICE'),[{name:'대가 약정서',text:incomplete}]).eligible,false);
 const good='대금은 미정. 수수료는 100원으로 정한다.';
 // 다른 대가가 미정이면 이를 남겨야 하며, 성능을 위해 앞의 미정 문구를 삭제하지 않는다.
 assert.equal(J.evaluate(cp('CNS-PRICE'),[{name:'대가 약정서',text:good}]).eligible,false);
 assert.equal(J.evaluate(cp('CNS-PRICE'),[{name:'대가 약정서',text:'대금 안내. 수수료는 100원으로 정한다.'}]).eligible,true);
});
