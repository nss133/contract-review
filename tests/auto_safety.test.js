const { test } = require('node:test');
const assert = require('node:assert/strict');
const Safety = require('../src/auto_safety');
const V = require('../src/verdict');
const Router = require('../src/action_router');

test('보류된 자동 후보는 전체 검토 완료에서도 재확인을 요구한다', () => {
  const cp = { id: 'A', contract_requirement: 'required_present' };
  const r = { coverage: 'addressed', autoSafety: { requires_review: true } };
  assert.equal(Router.route(cp, r).action, 'hold');
  assert.equal(Router.requiresDecision(Router.route(cp, r)), true);
  r.coverage = 'quiet';
  assert.equal(Router.route(cp, r).action, 'hold');
  assert.equal(Router.route({ contract_requirement: 'advisory' },
    { coverage: 'addressed', autoSafety: { requires_review: true } }).action, 'hold');
});

test('관찰 모드는 매칭·문장·회사관점 통과도 자동 확정하지 않는다', () => {
  const cp = { id: 'A', severity: '참고', auto_clear: { any_groups: [['해지']] } };
  const r = { coverage: 'addressed', autoClear: { ok: true, sentence: '해지한다.' }, perspective: { auto_pass: true } };
  assert.equal(Safety.evaluate(cp, r).candidate, true);
  assert.equal(V.canAutoPass(cp, r), false);
  assert.equal(Safety.evaluate(cp, r).allowed, false);
});

test('단서·상충 가능성은 다른 조항·별첨에서도 보류 신호로 기록한다', () => {
  const d = Safety.evaluate({ severity: '참고' }, { coverage: 'addressed' }, {
    documents: [{ name: '본문', text: '30일 전에 통지한다.' },
      { name: '별첨', text: '다만 통지 없이 즉시 해지할 수 있다.' }]
  });
  assert.ok(d.reasons.includes('exception_signal'));
  assert.equal(d.signals[0].document, '별첨');
  assert.equal(d.allowed, false);
});

test('기존 시스템 이상없음은 원문 이력을 보존한 미판정으로 이관한다', () => {
  const old = { verdict: '이상없음', origin: 'auto', comment: '원문 인용', date: 'd', reason: '반영되어 있음' };
  const held = V.migrateStore({ A: old });
  assert.equal(held.A.verdict, '');
  assert.equal(held.A.safety_hold.previous.comment, '원문 인용');
  assert.deepEqual(V.migrateStore(held), held);
  assert.equal(V.verdictSummary(held).total, 0);
  assert.equal(V.reviewColumn(held.A), 'needs');
  const manual = V.setVerdict(held, 'A', '이상없음', '직접 검토', 'd');
  assert.equal(manual.A.verdict, '이상없음');
  assert.deepEqual(manual.A.safety_hold, held.A.safety_hold);
  const clear = V.setVerdict(manual, 'A', '');
  assert.equal(clear.A.verdict, '');
  assert.deepEqual(clear.A.safety_hold, held.A.safety_hold);
  assert.deepEqual(V.revertAutoVerdicts(held, []).store, held);
  const bulk = V.bulkVerdict(held, ['A'], '이상없음', 'd').store;
  assert.deepEqual(bulk.A.safety_hold, held.A.safety_hold);
});

test('일반·표준약정·과거승계·LLM 초안 모든 생성 및 가져오기 경로를 보류한다', () => {
  ['auto', 'subdoc', 'prior_review', 'llm_draft'].forEach(origin => {
    const a = V.setVerdict({}, 'A', '이상없음', 'memo', 'd', '', origin);
    assert.equal(a.A.verdict, '', origin);
    assert.equal(V.importVerdicts({ verdicts: a }).A.verdict, '');
    const b = V.bulkVerdictComment({}, ['A'], '이상없음', 'memo', 'd', '', origin);
    assert.equal(b.store.A.verdict, '', origin);
  });
  ['manual', 'bulk', 'legacy'].forEach(origin => {
    assert.equal(V.migrateStore({ A: { verdict: '이상없음', origin } }).A.verdict, '이상없음');
  });
});
