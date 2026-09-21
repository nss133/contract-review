const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../src/report_layout.js');
test('report counts distinguish automatic and reviewer judgments without mutation', () => {
  const values = {a:{verdict:'이상없음',origin:'auto'}, b:{verdict:'검토의견',origin:'manual'}, c:{verdict:'이상없음'}, d:{verdict:'이상없음',origin:'auto',needs_reconfirmation:true}, e:{}, f:null};
  const before = JSON.stringify(values);
  assert.deepEqual(layout.counts(values), {automatic:1,reviewer:2});
  assert.equal(JSON.stringify(values), before);
});
test('empty report ledger is valid', () => assert.deepEqual(layout.counts(), {automatic:0,reviewer:0}));
test('dashboard includes automatic judgments excluded by the pending gate', () => {
  const values={a:{verdict:'이상없음',origin:'auto'},b:{verdict:'검토의견',origin:'manual'},c:{verdict:'이상없음',origin:'auto',needs_reconfirmation:true},extra:{verdict:'이상없음',origin:'auto'}};
  assert.deepEqual(layout.distribution(['c','missing','c'],values),{automatic:2,reviewer:1,pending:2,total:5});
});
test('empty denominator is not displayed as 100 percent safe', () => {
  assert.deepEqual(layout.distribution([],{}),{automatic:0,reviewer:0,pending:0,total:0});
});
test('fully automatic and fully pending partitions are valid', () => {
  assert.deepEqual(layout.distribution([],{a:{verdict:'이상없음',origin:'auto'}}),{automatic:1,reviewer:0,pending:0,total:1});
  assert.deepEqual(layout.distribution(['a'],{}),{automatic:0,reviewer:0,pending:1,total:1});
});
test('stale optional judgments are not counted as confirmed or required', () => {
  assert.deepEqual(layout.distribution([],{a:{verdict:'이상없음',needs_reconfirmation:true},b:{}}),{automatic:0,reviewer:0,pending:0,total:0});
});
