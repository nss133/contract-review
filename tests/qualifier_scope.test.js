const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/evidence_rules');
const rule={obligations:[{actors:['수탁자'],actions:['통지'],objects:['해지'],conditions:['서면']}]};
const main='수탁자는 해지 시 서면으로 통지하여야 한다.';
function blocked(extra){return E.blockingQualifiers(rule,[{text:main+'\n'+extra}]).length>0;}
test('판정과 무관하고 사용되지 않은 독립 정의문은 전역 보류하지 않음',()=>{
  assert.equal(blocked('“물품”이란 납품되는 장비를 말한다.'),false);
});
test('정의 용어가 다른 문장·별첨에서 사용되면 계속 범위 확인 필요',()=>{
  assert.equal(blocked('“물품”이란 납품되는 장비를 말한다.\n물품의 종류에 따라 절차가 변경된다.'),true);
  assert.equal(E.blockingQualifiers(rule,[{text:main+'\n“물품”이란 장비를 말한다.'},{text:'물품은 별도 절차를 따른다.'}]).length,1);
});
test('관련 정의·전역 제한·인접 단서·추출 불량은 여전히 보류',()=>{
  for(const text of ['“통지”란 구두 전달을 말한다.','다만 긴급한 경우 이를 생략한다.',
    '“물품”이란 이 계약의 모든 대상을 말한다.','“물품”이란 __를 말한다.',
    '“물품”이란 장비를 말한다. 다만 별도로 정한다.']) assert.equal(blocked(text),true,text);
});
