const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../src/decision_evidence'),S=require('../src/standard_auto'),P=require('../src/human_precedent'),L=require('../src/template_library'),Register=require('../src/template_register');
const checks=require('../knowledge/judgment_policies.json').checks.map(p=>({id:p.id,check:p.question})),cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]},item={coverage:'addressed'};
const obligations=require('./fixtures/presence_completion.json').find(c=>c.id==='ITDL-07').clauses;
const record=['기록은 전자파일로 작성한다.','기록의 보존기간은 5년으로 한다.','기록의 열람은 서면으로 요청한다.'];
const paragraphs='제1조(기록관리)\n'+record.map((s,i)=>'①②③'[i]+' '+s).join('\n');
const articles=record.map((s,i)=>'제'+(i+1)+'조(관리'+(i+1)+')\n'+s).join('\n');
const items='제1조(라이선스)\n① 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n'+obligations.map((s,i)=>(i+1)+'. '+s.replace(/^수탁자는 /,'')).join('\n');
const letters='제1조(라이선스)\n① 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n'+obligations.map((s,i)=>'가나다'[i]+'. '+s.replace(/^수탁자는 /,'')).join('\n');
const append=(base,path)=>base+'\n제9조(비밀유지)\n비밀정보 관리방법은 '+path+'에 따른다.';
const bundle=text=>D.bundle(cp('CNS-SECRET'),docs(text));
for(const [kind,base,prefix,start,end] of [['조',articles,'','제1조','제3조'],['항',paragraphs,'제1조 ','제1항','제3항'],['호',items,'제1조 제1항 ','제1호','제3호'],['목',letters,'제1조 제1항 제1호 ','가목','다목']]){
 test(kind+' 범위의 중간 번호를 모두 연결하고 명시된 표기 변형만 동등 비교',()=>{
  const variants=[start+'부터 '+end+'까지',start+' 내지 '+end,start+' 내지 '+end+'까지',start+'~'+end,start+' ∼ '+end,start+'～'+end];
  const baseline=bundle(append(base,prefix+variants[0]));assert.equal(baseline.reusable,true);
  for(const path of variants){const text=append(base,prefix+path),r=bundle(text);assert.equal(r.reusable,true,path);assert.equal(r.key,baseline.key,path);assert.ok(r.evidence.every(e=>text.includes(e.text)));}
  assert.equal(bundle(append(base,(prefix+variants[1]).replace(/\s/g,''))).key,baseline.key);
  assert.ok(baseline.evidence.some(e=>e.text.includes(kind==='조'||kind==='항'?record[1]:obligations[1].replace(/^수탁자는 /,''))));
 });
 test(kind+' 범위 누락·중복·역순·불완전 종결·과도한 범위를 통과시키지 않음',()=>{
  for(const range of [end+'부터 '+start+'까지',start+'부터 '+end,start+' - '+end,start+'부터 '+end+'까지부터 '+end+'까지',start+'부터 '])assert.equal(bundle(append(base,prefix+range)).reusable,false,range);
  const bad=kind==='조'?base.replace('제2조(관리2)\n'+record[1]+'\n',''):kind==='항'?base.replace('② '+record[1]+'\n',''):kind==='호'?base.replace(/^2\..*\n/m,''):base.replace(/^나\..*\n/m,'');
  assert.equal(bundle(append(bad,prefix+start+' 내지 '+end)).reusable,false);
  const dup=kind==='조'?base.replace('제2조','제1조'):kind==='항'?base.replace('②','①'):kind==='호'?base.replace('2.','1.'):base.replace('나.','가.');
  assert.equal(bundle(append(dup,prefix+start+' 내지 '+end)).reusable,false);
 });
 test(kind+' 범위 중간 내용·한정·주체·기간의 변경을 동등하게 처리하지 않음',()=>{
  const text=append(base,prefix+start+'부터 '+end+'까지'),r=bundle(text);
  for(const changed of [text.replace(kind==='조'||kind==='항'?'5년':'라이선스를 준수하여야 한다','2년'),text.replace(end+'까지',start+'까지'),text+'\n제10조(제한)\n'+prefix+start+'부터 '+end+'까지는 적용하지 않는다.'])assert.notEqual(bundle(changed).key,r.key);
 });
}
test('항 범위는 같은 조의 명시된 항만 사용하며 현재 항·다른 조를 혼동하지 않음',()=>{
 const text=paragraphs+'\n④ 비밀정보 관리방법은 제1항부터 제3항까지에 따른다.';assert.equal(bundle(text).reusable,true);
 assert.equal(bundle(append(paragraphs,'제1항부터 제3항까지')).reusable,false);
 assert.equal(bundle(append(paragraphs,'제1조 제1항부터 제2조 제3항까지')).reusable,false);
 assert.equal(bundle(append(paragraphs,'제1조 제1항부터 제3항까지 제1호')).reusable,false);
});
test('호 범위는 같은 항의 동일 목록에서만 가져옴',()=>{
 const second=items+'\n② 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n'+obligations.map((s,i)=>(i+1)+'. '+s.replace(/^수탁자는 /,'')).join('\n');
 assert.equal(bundle(append(second,'제1조 제2항 제1호부터 제3호까지')).reusable,true);
 assert.equal(bundle(append(second,'제1조 제1호부터 제3호까지')).reusable,false);
 assert.equal(bundle(second+'\n비밀정보 관리방법은 제1호 내지 제3호에 따른다.').reusable,true);
 assert.equal(bundle(append(second,'제1조 제1항 제1호부터 제2항 제3호까지')).reusable,true);
});
test('목 범위는 지정한 호 안에서만 찾고 다른 호의 동일 목을 가져오지 않음',()=>{
 const second=letters+'\n2. 다음 각 목의 사항을 이행할 것\n가. '+obligations[0].replace(/^수탁자는 /,'');
 assert.equal(bundle(append(second,'제1조 제1항 제1호 가목부터 다목까지')).reusable,true);
 assert.equal(bundle(append(second,'제1조 제1항 제2호 가목부터 다목까지')).reusable,false);
 assert.equal(bundle(append(second,'제1조 제1항 가목부터 다목까지')).reusable,false);
});
test('별첨 번호·제목을 통한 범위 참조는 다른 구역의 같은 조 번호를 사용하지 않음',()=>{
 const text='제1조(배송)\n배송지는 서울이다.\n제2조(비밀유지)\n비밀정보 관리방법은 별첨 1 제1조 제1항부터 제3항까지에 따른다.\n별첨 1 기록관리약정서\n'+paragraphs;
 assert.equal(bundle(text).reusable,true);assert.equal(bundle(text.replace('별첨 1 제1조','별첨 2 제1조')).reusable,false);
 const input=[{name:'본문',text:'제2조(비밀유지)\n비밀정보 관리방법은 「기록관리약정서」 제1조 제1항 내지 제3항에 따른다.'},{name:'기록관리약정서.docx',text:paragraphs}];
 assert.equal(D.bundle(cp('CNS-SECRET'),input).reusable,true);input.push({name:'기록관리약정서.pdf',text:paragraphs});assert.equal(D.bundle(cp('CNS-SECRET'),input).reusable,false);
});
test('조의 가지번호를 포함할 수 있는 범위는 임의로 건너뛰지 않음',()=>{
 const text=articles.replace('제3조','제2조의2(추가)\n추가 조건을 적용한다.\n제3조');
 assert.equal(bundle(append(text,'제1조부터 제3조까지')).reusable,true);
 assert.equal(bundle(append(text,'제2조의2부터 제3조까지')).reusable,true);
 assert.ok(bundle(append(text,'제1조부터 제3조까지')).evidence.some(e=>e.text.includes('추가 조건')));
});
test('번호 순서가 뒤섞이거나 번호만 남은 항 범위를 해소한 것으로 처리하지 않음',()=>{
 assert.equal(bundle(append(paragraphs.replace('①','④').replace('②','①').replace('④','②'),'제1조 제1항 내지 제3항')).reusable,false);
 assert.equal(bundle(append(paragraphs.replace('② '+record[1],'②'),'제1조 제1항 내지 제3항')).reusable,false);
});
test('과도한 숫자·혼합 단계·끊어진 범위는 반복 확장하지 않고 보류',()=>{
 for(const ref of ['제1조 제1항 내지 제999999999999999999항','제999999999999999999조 내지 제999999999999999999조','제1조 제0항 내지 제3항','제1조 제1항 내지 제3호','제1조 제1항~','제1조 제1항부터 의무에 따라 제3항까지'])assert.equal(bundle(append(paragraphs,ref)).reusable,false,ref);
 const many=Array.from({length:101},(_,i)=>'제'+(i+1)+'조(기록)\n기록번호는 '+(i+1)+'이다.').join('\n');
 assert.equal(bundle(many+'\n제999조(비밀유지)\n비밀정보 관리방법은 제1조 내지 제100조에 따른다.').reusable,true);
 assert.equal(bundle(many+'\n제999조(비밀유지)\n비밀정보 관리방법은 제1조 내지 제101조에 따른다.').reusable,false);
});
test('외부 법령 범위는 같은 번호의 계약 조항에 연결하지 않음',()=>{
 const text=append(articles,'가상시험법 제1조부터 제3조까지');assert.equal(bundle(text).reusable,false);
 const preserved=D.bundle(cp('CNS-SECRET'),docs(text),{registered_reference_context:true});assert.equal(preserved.reusable,true);assert.equal(preserved.preserved_reference_context,true);
 assert.ok(!preserved.evidence.some(e=>e.text===record[1]));
});
test('범위가 참조된 것만으로 새로운 이상없음을 만들지 않음',()=>{
 assert.equal(S.evaluate(cp('CNS-SECRET'),item,{confirmed:true,documents:docs(append(paragraphs,'제1조 제1항 내지 제3항'))}).eligible,false);
});
test('범위의 중간 조항을 배제하는 역방향 제한도 직접 판정에 반영',()=>{
 const base='제1조(장소)\n배송지는 서울이다.\n제2조(라이선스)\n'+obligations.join('\n')+'\n제3조(언어)\n계약은 국문으로 작성한다.';
 assert.equal(S.evaluate(cp('ITDL-07'),item,{confirmed:true,documents:docs(base)}).eligible,true);
 for(const ref of ['제1조부터 제3조까지','제1조부터 제4조까지','제1조부터 제9999999999999조까지']){
  const text=base+'\n제9조(적용)\n'+ref+'는 적용하지 않는다.';assert.equal(S.evaluate(cp('ITDL-07'),item,{confirmed:true,documents:docs(text)}).eligible,false,ref);
  assert.ok(D.bundle(cp('ITDL-07'),docs(text)).evidence.some(e=>e.text.includes('적용하지 않는다')));
 }
});
test('기록관리 범위만 참조한 비밀정보 문구는 과거 이상없음 유무와 무관하게 미충족',()=>{
 const source=append(paragraphs,'제1조 제1항부터 제3항까지')+'\n제10조(배송)\n배송지는 서울이다.',packet={id:'range-truth',date:'2026-09-15',documents:docs(source),context:scope,checks:[cp('CNS-SECRET')],verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const run=text=>S.evaluate(cp('CNS-SECRET'),item,P.prepare({confirmed:true,documents:docs(text),scope,date:'2026-09-17',review_packets:[packet]}));
 const target=source.replace('제1항부터 제3항까지','제1항 내지 제3항').replace('서울','부산');assert.equal(run(target).eligible,false);
 assert.equal(run(target.replace('5년','2년')).eligible,false);assert.equal(run(target.replace('내지 제3항','내지 제2항')).eligible,false);
 packet.verdicts['CNS-SECRET']={origin:'manual',verdict:'검토의견',comment:'중간 항 수정 필요'};assert.equal(run(target).eligible,false);
});
test('등록 표준의 범위 표기 변형을 문맥 전체와 비교하고 자동 연결',()=>{
 const source=paragraphs+'\n제9조(손해배상)\n당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.\n배상책임의 범위는 제1조 제1항부터 제3항까지에 따른다.';
 const t=Register.process('범위 기준','1',source,{type_ids:['outsourcing'],roles:[],stance:'party'},checks),lib={format:L.VERSION,templates:[t]};assert.ok(t.bindings.some(b=>b.check_id==='CNS-DAMAGE'));
 const target=source.replace('제1항부터 제3항까지','제1항 내지 제3항')+'\n제10조(배송)\n배송지는 부산이다.',run=text=>L.evaluate(lib,cp('CNS-DAMAGE'),item,{current:true,scope,documents:docs(text)});
 assert.equal(run(target).eligible,true,JSON.stringify(run(target)));assert.ok(run(target).evidence.some(e=>e.text.includes('배상')));assert.ok(run(target).evidence.every(e=>target.includes(e.text)));
 assert.equal(run(target.replace('5년','2년')).eligible,true);assert.equal(run(target.replace('③ '+record[2],'' )).eligible,false);
});
test('범위 캐시는 원문 변경을 반영하고 입력을 수정하지 않음',()=>{
 const input=docs(append(paragraphs,'제1조 제1항 내지 제3항')),before=JSON.stringify(input),first=D.bundle(cp('CNS-SECRET'),input);assert.equal(JSON.stringify(input),before);
 input[0].text=input[0].text.replace('② '+record[1]+'\n','');assert.equal(D.bundle(cp('CNS-SECRET'),input).reusable,false);assert.notEqual(D.bundle(cp('CNS-SECRET'),input).key,first.key);
});
test('중간 조 번호가 중복되거나 가지번호이면 역방향 제한을 버리지 않음',()=>{
 for(const middle of ['제2조(라이선스)\n'+obligations.join('\n')+'\n제2조(중복)\n배송지는 부산이다.','제2조(배송)\n배송지는 부산이다.\n제2조의2(라이선스)\n'+obligations.join('\n')]){
  const text='제1조(언어)\n국문을 사용한다.\n'+middle+'\n제3조(장소)\n배송지는 서울이다.\n제9조(특약)\n제1조부터 제3조까지는 적용하지 않는다.';
  const b=D.bundle(cp('ITDL-07'),docs(text));assert.equal(b.reusable,middle.includes('의2'));assert.ok(b.evidence.some(e=>e.text.includes('적용하지 않는다')));
  assert.equal(S.evaluate(cp('ITDL-07'),item,{confirmed:true,documents:docs(text)}).eligible,false);
 }
});
