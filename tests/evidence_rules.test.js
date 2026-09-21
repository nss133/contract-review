const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/evidence_rules');
const rule = { id:'R', check_id:'A', revision:'1', type_ids:['service'], party_roles:['customer'],
  rationale:'내부 검토 기준', obligations:[{ id:'notice', actors:['수탁자'], actions:['통지'], objects:['해지'],
    conditions:['서면'], polarity:'obligation', quantity:{unit:'일', min:30,max:30} }] };
const ctx = { type_id:'service', party_roles:['customer'] };
function run(text, extra=[]) { return E.evaluate(rule,[{name:'본문',text}].concat(extra),ctx); }
test('주체·행위·대상·조건·기간을 한 문장에서 모두 요구한다',()=>{
  assert.equal(run('수탁자는 해지 시 30일 전에 서면 통지하여야 한다.').status,'supported');
  assert.equal(run('위탁자는 해지 시 30일 전에 서면 통지하여야 한다.').status,'incomplete');
  assert.equal(run('수탁자는 해지 시 3일 전에 서면 통지하여야 한다.').status,'conflict');
  assert.equal(run('수탁자는 해지한다.\n30일 전에 서면 통지하여야 한다.').status,'incomplete');
});
test('반대 문구·단서·별첨 충돌은 첫 충족 문장을 뒤집는다',()=>{
  const text='수탁자는 해지 시 30일 전에 서면 통지하여야 한다.';
  const out=run(text,[{name:'별첨',text:'다만 수탁자는 통지 없이 즉시 해지할 수 있다.'}]);
  assert.equal(out.status,'conflict'); assert.equal(out.conflicts[0].document,'별첨');
  assert.equal(run(text+' 수탁자는 해지를 통지하지 않는다.').status,'conflict');
});
test('정보 부족·규칙 오류·유형 불일치·정의문을 성공으로 바꾸지 않는다',()=>{
  assert.equal(E.evaluate(rule,[],ctx).status,'unknown');
  assert.equal(E.evaluate(rule,[{text:'본문'}],{type_id:'lease',party_roles:['customer']}).status,'out_of_scope');
  assert.throws(()=>E.validate({...rule,obligations:[{actions:['통지']}]}));
  assert.notEqual(run('수탁자란 해지 시 30일 전에 서면 통지하여야 한다는 의미이다.').status,'supported');
});
test('같은 문서에서 명시적으로 이어지는 통지 조건을 결합한다',()=>{
 const out=run('수탁자는 해지 시 30일 전에 통지하여야 한다.\n이 통지는 서면으로 하여야 한다.');
 assert.equal(out.status,'supported');assert.deepEqual(out.evidence[0].linked_sentences,[0,1]);
 assert.notEqual(run('수탁자는 해지 시 30일 전에 통지하여야 한다.',[{name:'별첨',text:'이 통지는 서면으로 하여야 한다.'}]).status,'supported');
});
test('연결 문장의 면제·선택·조건부 표현을 첫 문장으로 덮지 않는다',()=>{
 const first='수탁자는 해지 시 30일 전에 서면 통지하여야 한다.\n';
 for(const tail of ['이 통지는 생략한다.','이 통지는 구두로 할 수 있다.','이 통지는 요청하는 경우에만 하여야 한다.'])
  assert.notEqual(run(first+tail).status,'supported');
});
test('서로 다른 명시 요건은 본문과 별첨에서 각각 충족할 수 있으나 충돌은 유지',()=>{
 const multi={...rule,obligations:[...rule.obligations,{id:'delete',actors:['수탁자'],actions:['파기'],objects:['자료'],conditions:[],polarity:'obligation'}]};
 const docs=[{name:'본문',text:'수탁자는 해지 시 30일 전에 서면 통지하여야 한다.'},{name:'별첨',text:'수탁자는 자료를 파기하여야 한다.'}];
 assert.equal(E.evaluate(multi,docs,ctx).status,'supported');
 docs.push({name:'특약',text:'수탁자는 자료를 파기하지 않는다.'});assert.equal(E.evaluate(multi,docs,ctx).status,'conflict');
});
test('양태 부정·주체 혼합·노력 의무를 확정 의무로 읽지 않는다',()=>{
  ['수탁자는 해지 시 30일 전에 서면 통지하여야 한다는 의무는 없다.',
   '수탁자는 해지를 요청하고 위탁자는 30일 전에 서면 통지하여야 한다.',
   '수탁자는 해지 시 30일 전에 서면 통지하도록 노력하여야 한다.',
   '수탁자는 해지 시 30일 전에 서면 통지하여야 한다. 해지 통지는 생략한다.'
  ].forEach(text=>assert.notEqual(run(text).status,'supported'));
});
