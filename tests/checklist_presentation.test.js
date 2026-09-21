'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../src/checklist_presentation');
const revisions=require('../knowledge/checklist_revisions.json');
const policies=require('../knowledge/judgment_policies.json');
const J=require('../src/agreement_judgment');
test('통합 13개 모두 질문·설명과 실제 자동 지원 범위를 갖는다',()=>{
  for(const row of revisions.replacements){
    const copy=P.get({id:row.id});assert.ok(copy,row.id);
    assert.ok(copy.title&&copy.question.endsWith('?')&&copy.description,row.id);
    assert.doesNotMatch(copy.description,/CNS-|CORE-|PRIV-|quiet|코퍼스|내부 추적|content-v/);
    assert.equal(copy.automatic,!!J.profiles[row.id],row.id);
  }
});
test('표시 문구는 원 체크와 정책/매핑 입력을 수정하지 않는다',()=>{
  for(const row of policies.checks){const before=JSON.stringify(row);P.get(row);assert.equal(JSON.stringify(row),before);}
  assert.doesNotMatch(P.get({id:'CNS-DAMAGE'}).question,/합리|적정|문제가 없는/);
});
test('실제 자동판정 proof 요소만 표시하고 일반 설명을 확인 결과로 복사하지 않는다',()=>{
  const v={verdict:'이상없음',origin:'auto',auto_proof:{evidence:[{element:'책임 배분 약정',text:'원문 A'},{element:'책임 배분 약정',text:'원문 B'}]}};
  assert.deepEqual(P.confirmedPoints(v),['책임 배분 약정']);
  assert.deepEqual(P.confirmedPoints({verdict:'검토의견',origin:'manual',auto_proof:v.auto_proof}),[]);
  assert.deepEqual(P.confirmedPoints({...v,needs_reconfirmation:true}),[]);
  assert.deepEqual(P.confirmedPoints({...v,auto_proof:{evidence:[{text:'손해배상'}]}}),[]);
});
test('근거가 수천 건이어도 문장 본문을 복제하지 않고 확인 포인트 3개까지만 표시',()=>{
  let reads=0;const evidence=Array.from({length:10000},()=>({get element(){reads++;return '책임 배분 약정';},get text(){throw Error('원문을 읽지 않음');}}));
  assert.deepEqual(P.confirmedPoints({verdict:'이상없음',origin:'auto',auto_proof:{evidence}}),['책임 배분 약정']);assert.ok(reads<=32);
});
test('재사용 판정과 원문 직접 판정의 표시를 구별한다',()=>{
  assert.deepEqual(P.confirmedPoints({verdict:'이상없음',origin:'auto',auto_proof:{kind:'reused',evidence:[{element:'책임 배분 약정'}]}}),[]);
});
