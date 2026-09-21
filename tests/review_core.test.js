const {test}=require('node:test'),assert=require('node:assert/strict'),Core=require('../src/review_core'),M=require('../src/matcher'),S=require('../src/segmenter');
test('실사용 공통 코어는 기존 매칭과 같고 실제 별첨 검색을 함께 보존',()=>{
 const cp={id:'A',check:'해지 서면 통지',triggers:{keywords:['해지','서면','통지']},severity:'참고',sources:[]};const docs=[{checkpoints:[cp]}],clauses=S.segmentContract('제1조 목적\n유지보수 업무를 수행한다.'),options={modules:[],stance:'party',partyRoles:[]},sub=[{name:'보안약정',text:'제1조 해지\n수탁자는 해지 시 30일 전에 서면 통지하여야 한다.'}];
 const before=JSON.stringify({docs,clauses,options,sub}),out=Core.run(clauses,docs,options,sub);assert.deepEqual(out.result,M.analyze(clauses,docs,options));assert.deepEqual(out.subCoverage,M.subDocCoverage([cp],sub.map(d=>({name:d.name,clauses:S.segmentContract(d.text)})),M.buildModel(docs,[], 'party')));assert.equal(JSON.stringify({docs,clauses,options,sub}),before);
});
test('낮은 매핑 점수의 자동 완료는 실제 본문 인용이 있는 조항에만 표시',()=>{
 const clauses=[{index:0,body:'인도 장소는 서울이다.'},{index:1,body:'수탁자는 신원조회를 실시하여야 한다.'}];
 const r={coverage:'quiet'},v={origin:'auto',verdict:'이상없음',auto_proof:{evidence:[{document:'본문',text:clauses[1].body}]}};
 const before=JSON.stringify([r,v,clauses]);assert.equal(Core.completionAnchor(r,v,clauses),1);assert.equal(JSON.stringify([r,v,clauses]),before);
 for(const extra of [{reassigned:true},{opinionScope:'contract'},{roleGated:true}])assert.equal(Core.completionAnchor({...r,...extra},v,clauses),null);
 assert.equal(Core.completionAnchor(r,{...v,origin:'manual'},clauses),null);
 assert.equal(Core.completionAnchor(r,{...v,safety_hold:true},clauses),null);
 assert.equal(Core.completionAnchor(r,{...v,auto_proof:{evidence:[{document:'별첨',text:clauses[1].body}]}},clauses),null);
 assert.equal(Core.completionAnchor(r,v,[...clauses,{index:2,body:clauses[1].body}]),null);
 assert.equal(Core.completionAnchor(r,v,[clauses[0]]),null);
});
