'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('v1.90 recurrence fixture retains exact diagnostic workload and distinct raw evidence',async()=>{
  const {createDiverseFixture,fixtureScale}=await import('../build/test_v190_performance.mjs');
  const payload=createDiverseFixture(),docs=Object.values(payload.knowledge.documents),scale=fixtureScale(payload);
  assert.equal(payload.text.length,2821);assert.equal(docs.length,500);assert.equal(payload.corpus.meta.contract_count,29);
  assert(docs.every(d=>d.evidence.length===52&&d.tags.length===52));
  const sentences=docs.flatMap(d=>d.evidence.map(e=>e.sentence));assert.equal(new Set(sentences).size,26000);
  assert.equal(Object.keys(payload.knowledge.tags).length,14);assert.equal(scale.unique_tag_definitions,14);
  assert.match(sentences[0],/합성 검토번호 0-0와 개별 업무범위 가가/);
  assert.match(sentences.at(-1),/합성 검토번호 499-51와 개별 업무범위/);
  assert.equal(scale.evidence_rows,26000);assert.equal(scale.evidence_per_document,52);
});
