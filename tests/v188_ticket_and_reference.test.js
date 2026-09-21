'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register');
const policy=require('../knowledge/judgment_policies.json').checks.find(c=>c.id==='CMN-19');
const cp={id:policy.id,check:policy.question,meaning_revision:policy.meaning_revision},item={coverage:'quiet'};
const text='본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.';
test('별첨 검색 후보도 표시 문구가 아닌 ID와 판단 의미로 연결한다',()=>{
 const Core=require('../src/review_core'),segment=require('../src/segmenter').segmentContract;
 const question={...cp,check:'관할 지정 내용 확인',triggers:{keywords:[]},severity:'참고',sources:[]};
 const run=q=>Core.run(segment('제1조 목적\n물품을 납품한다.'),[{checkpoints:[q]}],{modules:[],stance:'party',partyRoles:[]},[{name:'별첨',text:'분쟁은 갑 본사 소재지 법원을 관할법원으로 한다.'}]);
 assert.equal(run(question).subCoverage[cp.id].source,'standard_pattern_candidate');
 assert.equal(run({...question,meaning_revision:'different'}).subCoverage[cp.id],undefined);
});
test('관할 수기 판정은 무관한 업무 모듈·부서·당사 호칭 변경에 의존하지 않음',()=>{
 const Core=require('../src/review_core'),docs=[{name:'본문',text}];
 assert.deepEqual(Core.manualDependency(cp,docs,{stance:'party',type:'outsourcing',modules:['X-PII'],party:{ourAliases:['갑']}}),Core.manualDependency(cp,docs,{stance:'party',type:'procurement',modules:['X-IP'],party:{ourAliases:['을']}}));
});
function input(){return {confirmed:true,current:true,documents:[{name:'본문',text}],scope:{}};}
test('동일 매핑 내용의 새 객체도 계산된 티켓을 소비한다',()=>{
 const i=input(),r=S.evaluate(cp,item,i);assert.equal(r.eligible,true);assert.ok(S.consume(S.ticketFromEvaluation(cp,{...item},i,r),cp.id));
});
test('캐시 결과 변조·원문 변경·현재입력 취소로 이전 티켓을 발급하지 않는다',()=>{
 for(const mutate of [(i,r)=>r.evidence[0].text='변조',(i,r)=>i.documents[0].text='관할은 추후 정한다.',(i,r)=>i.confirmed=false]){
  const i=input(),r=S.evaluate(cp,item,i);mutate(i,r);assert.equal(S.ticketFromEvaluation(cp,item,i,r),null);
 }
});
test('명시적 표준 편입은 유일한 판본을 연결하고 참고·적용 배제는 제외한다',()=>{
 const t=Register.process('분쟁해결약정서','2025.01.20',text,{type_ids:['outsourcing'],roles:[]},[cp]);
 const lib={format:L.VERSION,templates:[t]},docs=s=>[{name:'본문',text:s}];
 assert.equal(L.resolveDocuments(lib,docs('분쟁해결약정서 2025.01.20 개정판을 적용한다.')).documents.length,2);
 assert.equal(L.resolveDocuments(lib,docs('분쟁해결약정서를 적용한다.')).documents.length,2);
 for(const s of ['분쟁해결약정서를 참고한다.','분쟁해결약정서 2025.01.20 개정판은 적용하지 않는다.'])assert.equal(L.resolveDocuments(lib,docs(s)).documents.length,1,s);
 const i={...input(),documents:docs('분쟁해결약정서 2025.01.20 개정판을 적용한다.')};
 assert.equal(L.evaluate(lib,cp,item,i).eligible,true);
});
test('동명 동판본 원문이 여러 개면 임의 편입하지 않고 자료선택 필요를 반환한다',()=>{
 const t=Register.process('분쟁해결약정서','1',text,{type_ids:['outsourcing'],roles:[]},[cp]),other={...t,id:'other',text:text.replace('서울중앙','부산')};
 const r=L.resolveDocuments({templates:[t,other]},[{name:'본문',text:'분쟁해결약정서 1을 적용한다.'}]);
 assert.equal(r.documents.length,1);assert.ok(r.ambiguous.length);
});
test('표준 결과 캐시도 템플릿 중지·원문 변경 뒤 사용할 수 없다',()=>{
 for(const mutate of [t=>t.active=false,t=>t.text='관할을 정하지 않는다.']){
  const t=Register.process('분쟁해결약정서','1',text,{type_ids:['outsourcing'],roles:[]},[cp]),lib={format:L.VERSION,templates:[t]},i=input(),r=L.evaluate(lib,cp,item,i);
  assert.equal(r.eligible,true);mutate(t);assert.equal(L.ticketFromEvaluation(lib,cp,item,i,r),null);
 }
});
test('짧은 판본 숫자를 조문번호·다른 연도·다른 판본과 혼동하지 않는다',()=>{
 const t=Register.process('분쟁해결약정서','1',text,{type_ids:['outsourcing']},[cp]),lib={templates:[t]};
 assert.equal(L.resolveDocuments(lib,[{name:'본문',text:'제1조 분쟁해결약정서를 적용한다.'}]).documents.length,2);
 for(const s of ['분쟁해결약정서 1.1판을 적용한다.','분쟁해결약정서 10판을 적용한다.','분쟁해결약정서 2021년판을 적용한다.'])assert.equal(L.resolveDocuments(lib,[{name:'본문',text:s}]).documents.length,1,s);
 for(const s of ['분쟁해결약정서 1판을 적용한다.','분쟁해결약정서 v1을 적용한다.','분쟁해결약정서 (버전 1)을 적용한다.'])assert.equal(L.resolveDocuments(lib,[{name:'본문',text:s}]).documents.length,2,s);
});
test('표준의 무관한 페이지 추출 손상은 읽힌 관할 약정의 연결을 막지 않는다',()=>{
 const t=Register.process('분쟁해결약정서','1',text+'\n제2조(연락처)\n전화번호 �',{type_ids:['outsourcing']},[cp]);
 assert.ok(t.bindings.some(b=>b.check_id===cp.id));assert.ok(t.extraction_warnings.length);
 assert.equal(L.evaluate({templates:[t]},cp,item,input()).eligible,true);
});
test('표준 재평가도 표시 문구가 아닌 판단 의미 버전으로 수기 정답을 대응한다',()=>{
 const t=Register.process('분쟁해결약정서','1',text,{type_ids:['outsourcing']},[cp]),lib={templates:[t]};
 const packet={checks:[cp],items:[{cpId:cp.id}],documents:input().documents,verdicts:{[cp.id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}};
 const r=L.replay(lib,packet,[{...cp,check:'관할 지정 확인'}]);assert.equal(r.changed,0);assert.equal(r.rows.length,1);assert.equal(r.candidates,1);
 assert.equal(L.replay(lib,packet,[{...cp,meaning_revision:'new-meaning'}]).changed,1);
 assert.equal(L.replay(lib,packet,[{...cp,active:false}]).excluded,1);
});
