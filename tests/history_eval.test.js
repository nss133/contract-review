const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/history_eval');
test('이력 후보는 최신 리비전만 읽고 과거 정답을 복사하지 않는다',()=>{
  const h={latest:{A:'new'},records:{old:{},new:{fingerprint:'f',request:{contract_name:'계약',department:'정보보호'},result:{review_text:'이상없음'},tags:[{label:'임대'}]}}};
  const before=JSON.stringify(h),r=E.candidates(h);
  assert.equal(r.length,1);assert.equal(r[0].has_opinion,true);assert.equal(r[0].department,'정보보호');
  assert.deepEqual(r[0].tags,['임대']);assert.equal(r[0].truth,undefined);assert.equal(r[0].review_text,undefined);assert.equal(JSON.stringify(h),before);
});
test('버전 불명·대조 미확인·미분석·본문 변경은 생성 보류',()=>{
  const d={family:'family',date:'2026-09-15',version:'before',confirmed:true},c={analyzed:true,text:'원문',live:'원문'};
  assert.equal(E.validate({},d,c),true);
  for(const patch of [{family:''},{date:'2026-02-30'},{version:'unknown'},{confirmed:false}])assert.throws(()=>E.validate({}, {...d,...patch},c));
  assert.throws(()=>E.validate({},d,{...c,live:'수정'}));assert.throws(()=>E.validate({},d,{...c,analyzed:false}));
});
