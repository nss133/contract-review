const {test}=require('node:test'),assert=require('node:assert/strict');
const Q=require('../src/clause_semantics'),D=require('../src/decision_evidence'),S=require('../src/standard_auto'),R=require('../src/requirement_rules'),P=require('../src/human_precedent');
const cp=id=>({id,check:R.catalog[id]?.question||'비밀정보 관리약정의 합리성'}),docs=text=>[{name:'본문',text}],bundle=text=>D.bundle(cp('CNS-SECRET'),docs(text));
const clauses=['수탁자는 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시하여야 한다.','수탁자는 업무수행인력이 변경되는 경우 인수인계를 실시하여야 한다.'];
const list='제1조(인력관리)\n① 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n가. 다음 각 세목의 사항을 이행할 것\n(1) '+clauses[0].replace('수탁자는 ','')+'\n(2) '+clauses[1].replace('수탁자는 ','');
const ref=path=>'\n제9조(비밀유지)\n비밀정보 관리방법은 '+path+'에 따른다.';
test('호→목→세목은 모든 도입문과 조건을 보존하고 문장과 동등 비교',()=>{
 const out=S.evaluate(cp('ITSEC-12'),{coverage:'addressed'},{confirmed:true,documents:docs(list)});assert.equal(out.eligible,true,JSON.stringify(out));assert.ok(out.evidence.some(e=>e.text.includes('신원조회')));assert.ok(out.evidence.some(e=>e.text.includes('인수인계')));assert.ok(out.evidence.every(e=>list.includes(e.text)));
 assert.deepEqual(Q.contexts(docs(list)).rows.filter(r=>r.list_subnumber).map(r=>r.list_path),[[1,'가',1],[1,'가',2]]);
 assert.equal(D.bundle(cp('ITSEC-12'),docs(list)).key,D.bundle(cp('ITSEC-12'),docs('제1조(인력관리)\n'+clauses.join('\n'))).key);
 for(const text of [list.replace('(2)','(3)'),list.replace('(2)','(1)'),list.replace('(2)','2)'),list.replace('가. 다음 각 세목','가. 다음 각 호'),list.replace('(1) 업무','(1) 위탁자는 업무')])assert.equal(S.evaluate(cp('ITSEC-12'),{coverage:'addressed'},{confirmed:true,documents:docs(text)}).eligible,true,text);
 assert.equal(S.evaluate(cp('ITSEC-12'),{coverage:'addressed'},{confirmed:true,documents:docs(list.replace('이행할 것','이행할 수 있다'))}).eligible,false);
});
test('3단계 목록의 단일·범위 참조와 역방향 제한',()=>{
 for(const path of ['제1조 제1항 제1호 가목 제1세목','제1조 제1항 제1호 가목 제1세목부터 제2세목까지'])assert.equal(bundle(list+ref(path)).reusable,true,path);
 for(const path of ['제1조 제1항 제1호 나목 제1세목','제1조 제1항 제1호 가목 제3세목'])assert.equal(bundle(list+ref(path)).reusable,false,path);
 const limited=list+'\n제2조(특약)\n제1조 제1항 제1호 가목 제2세목은 적용하지 않는다.';
 assert.equal(S.evaluate(cp('ITSEC-12'),{coverage:'addressed'},{confirmed:true,documents:docs(limited)}).eligible,false);
});
const articles='제1조(기록)\n① 기록은 전자파일로 작성한다.\n② 기록 보존기간은 3년이다.\n제1조의2(추가)\n① 추가 기록을 작성한다.\n제2조(열람)\n① 기록은 서면으로 요청한다.\n② 기록은 7일 이내 제공한다.';
test('가지번호 포함 범위·복수 부모 항 경로의 표기 차이와 모든 중간 원문',()=>{
 for(const [a,b] of [['제1조 제1항부터 제2조 제2항까지','제1조 제1항 내지 제2조 제2항'],['제1조부터 제2조까지','제1조~제2조'],['제1조의2부터 제2조까지','제1조의2 내지 제2조']]){
  const source=bundle(articles+ref(a)),target=bundle(articles+ref(b));assert.equal(source.reusable,true,a);assert.equal(target.reusable,true,b);assert.equal(source.key,target.key);assert.ok(source.evidence.some(e=>e.text.includes('추가 기록')));
  assert.notEqual(source.key,bundle((articles+ref(a)).replace('7일','30일')).key);
 }
});
test('복수 부모 범위의 누락·중복·역순·다른 구역·외부 법령을 혼합하지 않음',()=>{
 const path='제1조 제1항부터 제2조 제2항까지';
 for(const text of [articles.replace('② 기록 보존기간은 3년이다.','③ 기록 보존기간은 3년이다.')+ref(path),articles.replace('제1조의2','제1조의4')+ref(path),articles.replace('제2조','제3조')+ref(path.replace('제2조','제3조')),articles+ref(path.replace('제2항','제3항')),articles+ref('제2조 제2항부터 제1조 제1항까지'),articles+ref('외부법 '+path)])assert.equal(bundle(text).reusable,false,text);
});
test('명시 항·호·목의 부모가 달라도 연속 범위를 검사',()=>{
 const two=list+'\n2. 다음 각 목의 사항을 이행할 것\n가. '+clauses[0].replace('수탁자는 ','')+'\n나. '+clauses[1].replace('수탁자는 ','');
 assert.equal(bundle(two+ref('제1조 제1항 제1호 가목부터 제2호 나목까지')).reusable,true);
 assert.equal(bundle(two+ref('제1조 제1항 제1호 가목부터 제2호 다목까지')).reusable,false);
 assert.equal(bundle(two+'\n비밀정보 관리방법은 제1항 제1호 가목부터 제2호 나목까지에 따른다.').reusable,true);
});
test('확인된 사람의 복합 경로 판단만 재사용하며 중간 조건 변경은 철회',()=>{
 const scope={type:'outsourcing',roles:['위탁자'],stance:'party'},source=articles+ref('제1조 제1항부터 제2조 제2항까지'),packet={id:'complex',documents:docs(source),context:scope,checks:[cp('CNS-SECRET')],verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const run=text=>P.lookup(cp('CNS-SECRET'),P.prepare({documents:docs(text),scope,review_packets:[packet]}));
 assert.equal(run(source.replace('부터 제2조 제2항까지','내지 제2조 제2항')).eligible,true);assert.equal(run(source.replace('7일','30일')).eligible,false);
});
