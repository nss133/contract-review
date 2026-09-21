const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const D=require('../src/safety_digest');
test('SHA-256는 한글·긴 입력 및 키 순서의 지문을 재현한다',()=>{
  ['', 'abc', '계약서😀', 'x'.repeat(10000)].forEach(s=>assert.equal(D.sha256(s),crypto.createHash('sha256').update(s).digest('hex')));
  assert.equal(D.of({a:1,b:2}),D.of({b:2,a:1}));assert.notEqual(D.of({a:1}),D.of({a:2}));
});
