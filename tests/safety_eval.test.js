const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/safety_eval');
function pair() {
  const p = E.build({ runId: 'run1', contractHash: 'h', appVersion: '1', familyId: 'family',
    text: '본문', checkpoints: [{ id: 'A', check: '질문', severity: '참고' }, { id: 'B' }],
    clauses: [{ index: 0, heading: '제1조', body: '본문' }],
    results: [{ cpId: 'A', coverage: 'addressed', best: { clauseIndex: 0 }, ranked: [{ clauseIndex: 0 }] }] });
  const g = E.goldTemplate(p);
  g.reviewer = '검수자'; g.source_reviewed = true; g.independent = true;
  g.labels.forEach(l => { l.truth = 'safe'; l.note = '원본 대조'; l.evidence = '본문 제1조'; l.direct_clause_indices = [0]; });
  return { p, g };
}
test('전체 체크와 비노출 항목을 보존하며 블라인드 정답에는 예측이 없다', () => {
  const { p, g } = pair();
  assert.equal(p.items.length, 2);
  assert.equal(p.items[1].surfaced, false);
  assert.equal(JSON.stringify(g).includes('candidate'), false);
  assert.equal(JSON.stringify(g).includes('coverage'), false);
});
test('오자동 후보·판단불가·누락·매핑을 독립 분모로 측정한다', () => {
  const { p, g } = pair();
  g.labels[0].truth = 'issue'; g.labels[1].truth = 'issue';
  const m = E.score(p, g);
  assert.equal(m.shadow.candidates, 1);
  assert.equal(m.shadow.false_clear, 1);
  assert.equal(m.shadow.false_clear_rate, 1);
  assert.equal(m.issue_count, 2);
  assert.equal(m.unsurfaced_issues, 1);
  assert.equal(m.actual.candidates, 0);
  assert.equal(m.actual.false_clear_rate, null);
  assert.equal(m.mapping.top1_correct, 1);
  assert.equal(m.mapping.denominator, 2);
  assert.equal(m.safety_proven, false);
});
test('미입력은 안전으로 세지 않고 후보 검수완료율을 별도로 표시한다', () => {
  const { p, g } = pair(); g.labels[0].truth = '';
  const m = E.score(p, g);
  assert.equal(m.shadow.unreviewed, 1);
  assert.equal(m.shadow.zero_error_upper95_iid, null);
  g.labels[0].truth = 'unknown';
  assert.equal(E.score(p, g).shadow.unknown, 1);
});
test('원본확인·독립검수·동일 스냅샷 및 중복 없는 라벨을 요구한다', () => {
  const { p, g } = pair();
  const bads = [ { ...g, source_reviewed: false }, { ...g, independent: false },
    { ...g, reviewer: '' }, { ...g, run_id: 'other' }, { ...g, labels: [g.labels[0], g.labels[0]] } ];
  bads.forEach(bad => assert.throws(() => E.score(p, bad)));
  g.labels[0].direct_clause_indices = [999]; assert.throws(() => E.score(p, g));
});
test('0건 오류 통계는 참고값이고 표본 0은 null이다', () => {
  const { p, g } = pair(); const m = E.score(p, g);
  assert.ok(m.shadow.zero_error_upper95_iid > 0.9);
  assert.equal(m.actual.zero_error_upper95_iid, null);
  assert.equal(m.safety_proven, false);
});
