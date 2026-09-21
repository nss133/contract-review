'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../src/template_library');
const standard=(name='개인신용정보 보안관리약정서(일반)',revision='2025.01',id='general')=>({id,name,revision,active:true,text:'제1조 관리 감독\n위탁자는 처리 현황을 점검하고 수탁자는 이에 협조한다.',bindings:[]});
const docs=text=>[{name:'본문',text}];
test('별첨 명칭의 괄호·띄어쓰기 및 일반형 별칭은 유일한 등록 원문과 연결한다',()=>{
 for(const name of ['개인신용정보 보안관리약정서(일반)','개인신용정보_보안관리약정서(일반)_개정_입력항목(파란색)_202501.hwpx']){
  const lib={templates:[standard(name)]},source=docs('제3조 부속서류\n개인(신용)정보 보안관리약정서를 별첨한다.');
  const r=L.resolveDocuments(lib,source);assert.equal(r.documents.length,2);assert.equal(r.references[0].template_id,'general');
  const ref=r.references[0];assert.equal(source[ref.document_index].text.slice(ref.start,ref.end),ref.text);
 }
});
test('명시적 편입은 유일한 판본이면 개정판 숫자 없이 연결하며 숫자 불일치는 거절한다',()=>{
 const lib={templates:[standard('분쟁해결약정서','1')]};
 for(const s of ['제1조 분쟁해결약정서를 적용한다.','분쟁해결약정서를 첨부한다.'])assert.equal(L.resolveDocuments(lib,docs(s)).documents.length,2,s);
 for(const s of ['분쟁해결약정서 1.1판을 적용한다.','분쟁해결약정서 10판을 적용한다.','분쟁해결약정서 2021년판을 적용한다.'])assert.equal(L.resolveDocuments(lib,docs(s)).documents.length,1,s);
});
test('적용 배제·참고·예시·향후 예정은 본건 약정으로 편입하지 않는다',()=>{
 const lib={templates:[standard()]};
 for(const s of ['개인(신용)정보 보안관리약정서는 적용하지 않는다.','개인(신용)정보 보안관리약정서는 첨부하지 않는다.','개인(신용)정보 보안관리약정서를 참고하여 적용한다.','개인(신용)정보 보안관리약정서를 추후 별첨한다.','개인(신용)정보 보안관리약정서는 첨부 예정이다.','개인(신용)정보 보안관리약정서를 예시로 첨부한다.'])assert.equal(L.resolveDocuments(lib,docs(s)).documents.length,1,s);
});
test('복수 판본은 임의 최신 선택 없이 모호성을 반환하고 명시 판본만 연결한다',()=>{
 const lib={templates:[standard(),standard(undefined,'2026.01','next')]};
 const r=L.resolveDocuments(lib,docs('개인(신용)정보 보안관리약정서를 별첨한다.'));assert.equal(r.documents.length,1);assert.equal(r.ambiguous.length,1);
 assert.equal(L.resolveDocuments(lib,docs('개인(신용)정보 보안관리약정서(2026.01)를 별첨한다.')).references[0].template_id,'next');
 assert.equal(L.resolveDocuments(lib,docs('개인(신용)정보 보안관리약정서(2024.01)를 별첨한다.')).documents.length,1);
});
test('개인정보·개인신용정보·재위탁형 표준은 같은 이름으로 뭉개지 않는다',()=>{
 const lib={templates:[standard()]};
 for(const s of ['개인정보 보안관리약정서를 별첨한다.','개인신용정보 보안관리약정서(재위탁)를 별첨한다.'])assert.equal(L.resolveDocuments(lib,docs(s)).documents.length,1,s);
 const other={templates:[standard('개인신용정보 보안관리약정서(재위탁)')]};
 assert.equal(L.resolveDocuments(other,docs('개인(신용)정보 보안관리약정서를 별첨한다.')).documents.length,1);
});
test('본건에 제출된 같은 약정서는 수정된 원문을 우선하며 표준 원문을 추가하지 않는다',()=>{
 const lib={templates:[standard()]},source=docs('개인(신용)정보 보안관리약정서를 별첨한다.');
 source.push({name:'개인(신용)정보 보안관리약정서.hwpx',text:'제1조 관리 감독\n위탁자의 점검을 허용하지 않는다.'});
 const r=L.resolveDocuments(lib,source);assert.equal(r.documents.length,2);assert.equal(r.documents[1].text,source[1].text);assert.equal(r.references[0].binding_kind,'current_document');assert.equal(r.references[0].target_document_index,1);
});
test('원문 내 별첨 제목으로 포함된 수정 약정서도 등록 표준으로 덮어쓰지 않는다',()=>{
 const lib={templates:[standard()]},source=docs('개인(신용)정보 보안관리약정서를 별첨한다.\n\n[별첨 1] 개인(신용)정보 보안관리약정서\n제1조 관리 감독\n위탁자의 점검을 허용하지 않는다.');
 assert.equal(L.resolveDocuments(lib,source).documents.length,1);
});
test('연결 캐시는 원문·활성화·명칭 변경을 추적하고 외부 결과 수정에 오염되지 않는다',()=>{
 const t=standard(),lib={templates:[t]},source=docs('개인(신용)정보 보안관리약정서를 별첨한다.');
 const first=L.resolveDocuments(lib,source);assert.equal(first.documents.length,2);assert.equal(L.resolveDocuments(lib,source),first);
 assert.throws(()=>first.documents.push({text:'변조'}),TypeError);
 t.active=false;assert.equal(L.resolveDocuments(lib,source).documents.length,1);t.active=true;
 t.name='다른약정서';assert.equal(L.resolveDocuments(lib,source).documents.length,1);t.name='개인신용정보 보안관리약정서(일반)';
 source.push({name:'개인신용정보 보안관리약정서',text:'변경 원문'});assert.equal(L.resolveDocuments(lib,source).documents.length,2);
 source[1].name='다른 별첨';assert.equal(L.resolveDocuments(lib,source).documents.length,3);
});
test('판본 1.1과 11, 문자 접미 판본 및 제1조 번호를 구별한다',()=>{
 const t=standard('분쟁해결약정서','11'),lib={templates:[t]};
 assert.equal(L.resolveDocuments(lib,docs('분쟁해결약정서 1.1판을 적용한다.')).documents.length,1);
 t.revision='1';assert.equal(L.resolveDocuments(lib,docs('분쟁해결약정서 v1a를 적용한다.')).documents.length,1);
 lib.templates.push({...t,id:'second',revision:'2'});
 assert.equal(L.resolveDocuments(lib,docs('제1조 분쟁해결약정서를 적용한다.')).documents.length,1);
});
test('날짜 판본의 파일형식 차이는 정규화하지만 실제 다른 날짜는 거절한다',()=>{
 const lib={templates:[standard()]};
 assert.equal(L.resolveDocuments(lib,docs('개인(신용)정보 보안관리약정서(202501)를 별첨한다.')).documents.length,2);
 assert.equal(L.resolveDocuments(lib,docs('개인(신용)정보 보안관리약정서(202502)를 별첨한다.')).documents.length,1);
});
test('캐시는 현재 문서의 출처 메타데이터 수정도 반영하고 원본을 동결하지 않는다',()=>{
 const lib={templates:[standard()]},source=docs('개인(신용)정보 보안관리약정서를 별첨한다.');source[0].source={id:'a'};
 const a=L.resolveDocuments(lib,source);source[0].source.id='b';const b=L.resolveDocuments(lib,source);
 assert.notEqual(a,b);assert.equal(b.documents[0].source.id,'b');assert.equal(a.documents[0].source.id,'a');assert.equal(Object.isFrozen(source[0]),false);
});
test('제출된 약정서 파일명의 판본 접미사도 현재 수정 원문 우선으로 처리한다',()=>{
 const lib={templates:[standard()]},source=docs('개인(신용)정보 보안관리약정서를 별첨한다.');
 source.push({name:'개인(신용)정보 보안관리약정서(2025.01).hwpx',text:'제1조 관리 감독\n점검을 허용하지 않는다.'});
 assert.equal(L.resolveDocuments(lib,source).documents.length,2);
});
test('별첨하더라도 적용되지 않거나 적용을 배제한 문구는 등록 원문을 편입하지 않는다',()=>{
 const lib={templates:[standard()]};
 for(const text of ['개인(신용)정보 보안관리약정서를 별첨한다. 다만 본 계약에 적용되지 않는다.','개인(신용)정보 보안관리약정서를 별첨한다. 다만 적용을 배제한다.'])assert.equal(L.resolveDocuments(lib,docs(text)).documents.length,1);
});
test('작성예시·검토의견 표제 다음 문장은 실제 약정의 편입 지시가 아니다',()=>{
 const lib={templates:[standard('분쟁해결약정서','1')]};
 for(const heading of ['작성예시:','검토의견:','검토 메모:'])assert.equal(L.resolveDocuments(lib,docs(heading+'\n분쟁해결약정서를 별첨한다.')).documents.length,1,heading);
});
test('편입 문구를 삭제하라는 지시는 현재 약정에 표준을 추가하지 않는다',()=>{
 const lib={templates:[standard('분쟁해결약정서','1')]};
 for(const text of ['분쟁해결약정서를 별첨한다는 문구를 삭제한다.','분쟁해결약정서를 적용한다는 조항을 삭제한다.','분쟁해결약정서에 따른다는 표현을 삭제한다.'])assert.equal(L.resolveDocuments(lib,docs(text)).documents.length,1,text);
});
