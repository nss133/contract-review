const {test}=require('node:test');const assert=require('node:assert/strict');
const D=require('../src/document_structure'),I=require('../src/integrity'),S=require('../src/segmenter');
const main='용역계약서\n제1조(목적)\n별첨 1 제2조에 따라 업무를 한다.\n제2조(기간)\n1년으로 한다.';
const appendix='\n제1조(보안)\n권한을 제한한다.\n제2조(반환)\n본 계약 제2조의 기간 종료 시 반환한다.';
function run(t,opts){return I.analyze(t,S.segmentContract(t),opts);}
test('별첨 제목·대괄호·번호 없는 별첨에서 독립 조번호와 첨부 존재를 함께 인정',()=>{
  ['별첨 1 보안관리약정서','[별첨 1] 보안관리약정서','별첨 1','[별첨 1]'].forEach(b=>{
    const r=run(main+'\n'+b+appendix);assert.equal(r.structure.sections.length,2,b);
    assert.equal(r.assessment.status,'checked',b);assert.equal(r.items.filter(f=>['NUM-01','ATT-01','REF-01'].includes(f.rule_id)).length,0,b);
  });
});
test('실제 같은 구역 중복은 유지하고 번호 재시작만으로 구역을 만들지 않는다',()=>{
  const r=run(main+appendix);assert.equal(r.structure.sections.length,1);assert.equal(r.items.filter(x=>x.rule_id==='NUM-01').length,2);
});
test('별첨 두 개·동일 이름·부칙은 독립 ID, 명시 인용의 이름 중복은 보류',()=>{
  const t=main+'\n별첨 1 보안약정서'+appendix+'\n별첨 1 보안약정서'+appendix+'\n부칙\n제1조(시행)\n체결일부터 적용한다.';
  const r=run(t);assert.equal(r.structure.sections.length,4);assert.equal(new Set(r.structure.sections.map(s=>s.id)).size,4);
  assert.ok(!r.items.some(x=>x.rule_id==='NUM-01'));assert.ok(r.assessment.unresolved_reference_count>0);
});
test('인용문과 목차 목록은 별첨 구역 시작이 아니다',()=>{
  ['별첨 1에 따른다.','별첨 1의 내용','별첨 1 및 별첨 2','별첨 1을 첨부한다.'].forEach(t=>assert.equal(D.boundary(t),null,t));
  assert.equal(D.inspect('목차\n별첨 1\n별첨 2\n별첨 3\n본문',null,[]).sections.length,1);
});
test('1회 경계 보정·중첩 구역·선택 제외·원본 출처 변경 무효화',()=>{
  const t=main+'\n보안약정서'+appendix,n=main.split('\n').length;
  const x=D.fromBlocks('docx',[{text:t,source:{part:'word/document.xml',paragraph:0}}]);
  const r=run(x.text,{structure:x,boundaries:[{line:n,mode:'annex',label:'별첨 1 보안약정서',parent:'main'}]});
  assert.ok(!r.items.some(f=>f.rule_id==='NUM-01'));assert.equal(r.structure.source_valid,true);
  assert.equal(D.inspect(x.text+'수정',x,[]).source_valid,false);
  assert.ok(!run(t,{boundaries:[{line:n,mode:'skip',label:'인용 예시'}]}).items.some(f=>f.rule_id==='NUM-01'));
});
test('다른 구역에만 있는 조문을 내부 인용 정답으로 자동 승계하지 않는다',()=>{
  const t='제1조(목적)\n제3조에 따른다.\n제2조(기간)\n1년이다.\n별첨 1 보안약정서\n제3조(기간)\n2년이다.';
  const r=run(t);assert.ok(r.assessment.unresolved_reference_count>0);assert.ok(!r.items.some(f=>f.rule_id==='REF-01'));
});
test('번호 정의 미확인 구역의 경고만 제외하고 정상 본문 중복은 계속 검사',()=>{
  const x=D.fromBlocks('hwp',[{text:main+'\n제2조(오류)\n다른 계약기간.'},{text:'별첨 1 보안약정서'},{text:'제1조(보안)',numbering:{confirmed:false}},{text:'제1조(반환)\n내용을 반환한다.'}]);
  const r=run(x.text,{structure:x});assert.equal(r.items.filter(f=>f.rule_id==='NUM-01').length,1);
});
