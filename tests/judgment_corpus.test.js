const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../src/loop');
function exp(hash, verdict='이상없음', date='2026-09-15') {
  return {meta:{contract_hash:hash,date,reviewer:'검토자'},verdicts:{A:{verdict,origin:'manual',comment:'확인'}}};
}
test('현재 계약 판정 수정은 과거 기여분을 교체하고 이력을 보존',()=>{
  const a=L.mergeIntoCorpus(L.emptyCorpus(),exp('a'));
  const b=L.mergeIntoCorpus(a,exp('a','검토의견'),{replaceCurrent:true});
  assert.equal(b.meta.contract_count,1);
  assert.equal(b.byCheck.A.counts['이상없음'],0);
  assert.equal(b.byCheck.A.counts['검토의견'],1);
  assert.equal(b.judgment_ledger.records.a.revisions.length,1);
  assert.equal(a.byCheck.A.counts['이상없음'],1);
  assert.deepEqual(L.mergeIntoCorpus(b,exp('a','검토의견')),b);
});
test('판정 삭제도 최신 집계에서 제거되며 원본 이력은 남음',()=>{
  const a=L.mergeIntoCorpus(L.emptyCorpus(),exp('a'));
  const empty=exp('a');empty.verdicts={};
  const b=L.mergeIntoCorpus(a,empty,{replaceCurrent:true});
  assert.equal(b.byCheck.A,undefined);
  assert.equal(b.judgment_ledger.records.a.revisions[0].verdicts.A.verdict,'이상없음');
});
test('옛 집계에 포함된 계약은 수정 기록을 보존하되 중복 합산하지 않음',()=>{
  const old={meta:{schema_version:2,hashes:['a'],contract_count:1},byCheck:{A:{counts:{'이상없음':1,'검토의견':0,'해당없음':0},comments:[]}}};
  const b=L.mergeIntoCorpus(old,exp('a','검토의견'),{replaceCurrent:true});
  assert.equal(b.byCheck.A.counts['이상없음'],1);
  assert.equal(b.byCheck.A.counts['검토의견'],0);
  assert.equal(b.judgment_ledger.records.a.tags.A.verdict,'검토의견');
  assert.equal(L.judgmentSummary(b).legacy_overlap,1);
});
test('같은 날 상충하는 가져오기와 오래된 파일은 최신 판정을 덮지 않음',()=>{
  const a=L.mergeIntoCorpus(L.emptyCorpus(),exp('a'));
  for(const date of ['2026-09-15','2026-09-14']) {
    const b=L.mergeIntoCorpus(a,exp('a','검토의견',date));
    assert.equal(b.byCheck.A.counts['이상없음'],1);
    assert.equal(L.judgmentSummary(b).pending,1);
  }
  const b=L.mergeIntoCorpus(a,exp('a','검토의견','2026-09-16'));
  assert.equal(b.byCheck.A.counts['검토의견'],1);
});
test('서로 다른 신규 원장이 있는 백업 병합 후 수정에도 상대 집계가 유지',()=>{
  const a=L.mergeIntoCorpus(L.emptyCorpus(),exp('a'));
  const b=L.mergeIntoCorpus(L.emptyCorpus(),exp('b'));
  const c=L.mergeCorpusBackup(a,b);
  const d=L.mergeIntoCorpus(c,exp('a','검토의견'),{replaceCurrent:true});
  assert.equal(d.meta.contract_count,2);
  assert.equal(d.byCheck.A.counts['이상없음'],1);
  assert.equal(d.byCheck.A.counts['검토의견'],1);
  assert.equal(L.judgmentSummary(d).contracts,2);
  assert.deepEqual(L.mergeCorpusBackup(d,b),d);
});
test('신규 원장에 구 백업을 병합해도 이후 수정에서 구자료가 사라지지 않음',()=>{
  const a=L.mergeIntoCorpus(L.emptyCorpus(),exp('a'));
  const old={meta:{schema_version:2,hashes:['b'],contract_count:1},byCheck:{B:{counts:{'이상없음':3},comments:[]}}};
  const c=L.mergeCorpusBackup(a,old);
  const d=L.mergeIntoCorpus(c,exp('a','검토의견'),{replaceCurrent:true});
  assert.equal(d.byCheck.B.counts['이상없음'],3);
  assert.equal(d.byCheck.A.counts['검토의견'],1);
});
test('이유 없는 이상없음은 근거·매핑 정답·자동승인을 생성하지 않음',()=>{
  const t=L.judgmentTags({verdict:'이상없음',origin:'manual'});
  assert.equal(t.reason_kind,'unknown');assert.equal(t.route,'unknown');
  assert.equal(t.mapping_confirmed,false);assert.equal(t.auto_approval,false);
});
test('위험수용과 명시적인 충족, 시스템 판정의 출처 구분',()=>{
  assert.equal(L.judgmentTags({verdict:'이상없음',reason:'수용 가능한 위험'}).reason_kind,'risk_accepted');
  assert.equal(L.judgmentTags({verdict:'이상없음',reason:'반영되어 있음'}).reason_kind,'satisfied');
  assert.equal(L.judgmentTags({verdict:'이상없음',origin:'auto'}).human_confirmed,false);
  assert.equal(L.judgmentTags({verdict:'이상없음',origin:'subdoc'}).human_confirmed,false);
  for(const comment of ['위험을 수용하지 않음','위험 수용 여부 검토','위험을 수용한다면'])
    assert.equal(L.judgmentTags({verdict:'이상없음',comment}).reason_kind,'unknown');
  assert.equal(L.judgmentTags({verdict:'검토의견',comment:'위험 수용'}).reason_kind,'issue');
});
test('별첨 긍정·부정·조건부는 구분하고 원문 인용 보존',()=>{
  const good='보안관리약정서에 반영되어 있음';
  assert.equal(L.judgmentTags({comment:good}).route,'annex');
  assert.equal(L.judgmentTags({comment:good}).quote,good);
  for(const comment of ['보안약정서에 반영되지 않음','별첨에 규정할 필요가 있음','별첨에 규정되어 있다면 이상없음'])
    assert.equal(L.judgmentTags({comment}).route,'unknown');
});
test('집계 의견 태그는 원문 연결된 시험 사례로 표시하지 않음',()=>{
  const c=L.mergeIntoCorpus(L.emptyCorpus(),exp('a'));
  const s=L.judgmentSummary(c);
  assert.equal(s.patterns[0].evaluable,false);
  assert.equal(s.human,1);
});
