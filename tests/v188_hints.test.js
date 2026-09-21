const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const J=require('../src/judgment_hints'),V=require('../src/verdict'),Core=require('../src/review_core');
const cp={id:'CMN-19',check:'관할 지정 여부',severity:'참고',triggers:{keywords:['관할','법원']}};
const phrase='갑 본사 소재지를 관할하는 법원';
function corpus(v){return {meta:{updated:'1'},judgment_ledger:{records:{contract:{snapshot:{meta:{title:'수기 검토 계약',department:'정보보호'},verdicts:{[cp.id]:v}}}}}};}
test('결과 태그와 현재 약정 내용 태그는 분리된다',()=>{
  const tagged=J.tagVerdict({verdict:'이상없음',reason:'반영되어 있음',comment:'관할을 확인함',origin:'manual'});
  assert.equal(tagged.result_tags.reason_kind,'satisfied');assert(tagged.content_tags.judgment_topics.includes('jurisdiction'));
  assert(!JSON.stringify(tagged.content_tags).includes('이상없음'));assert.equal(tagged.auto_approval,false);
  assert.deepEqual(J.tagVerdict({verdict:'이상없음',reason:'반영되어 있음',comment:'',origin:'manual'}).content_tags.judgment_topics,[]);
});
test('원문 없는 29건 집계도 실제 현재 표현이 있으면 검색 참고가 되지만 정답은 아니다',()=>{
  const idx=J.index({corpus:{byCheck:{[cp.id]:{comments:[{text:'“'+phrase+'”으로 정하여 이상없음',verdict:'이상없음',count:29}]}}}});
  const rows=J.retrieve(cp,[{name:'본문',text:phrase+'으로 정한다.'}],idx);
  assert.equal(rows.length,1);assert.equal(rows[0].raw_linked,false);assert.equal(rows[0].reference_only,true);assert.equal(rows[0].auto_approval,false);
  assert.equal(idx.rows[0].evaluable,false);assert.equal(idx.stats.aggregate,1);
  assert.deepEqual(J.retrieve(cp,[{name:'본문',text:'계약 이행에 필요한 사항은 협의한다.'}],idx),[]);
});
test('자동판정은 다시 사람 정답·표현사전으로 자기증식하지 않는다',()=>{
  const idx=J.index({corpus:corpus({verdict:'이상없음',origin:'auto',comment:'“'+phrase+'”'})});
  assert.equal(idx.rows.length,0);assert.equal(idx.stats.excluded_system,1);
});
test('유불리 의견과 법률검토 태그는 출처를 유지한 표현 참고이며 현재 결론을 거부하지 않는다',()=>{
  const v={verdict:'검토의견',comment:'“'+phrase+'” 부분의 유불리를 협상함',origin:'manual'};
  const knowledge={latest:{legal:'1'},documents:{1:{source_id:'law-1',source_kind:'legal_opinion',title:'법률검토',department:'법무',evidence:[{sentence:phrase+' 관련 질의'}]}},tags:{}};
  const idx=J.index({knowledge,corpus:corpus(v)}),rows=J.retrieve(cp,[{name:'본문',text:phrase+'으로 정한다.'}],idx);
  assert(rows.some(r=>r.kind==='corpus_judgment'&&r.result_tags.verdict==='검토의견'));
  assert(rows.some(r=>r.kind==='legal_opinion'));assert(rows.every(r=>r.auto_approval===false));
  assert.equal(idx.knowledge,knowledge);assert.deepEqual(idx.knowledge.tags,{});
});
test('자료 공동출현으로 합의/협의 또는 허용/금지 동의어를 만들지 않는다',()=>{
  const knowledge={tags:{topic:{label:'관할',aliases:['재판적']}}},idx=J.index({knowledge,corpus:corpus({verdict:'이상없음',origin:'manual',comment:'합의와 협의, 허용과 금지가 언급되어 있음'})});
  assert.equal(idx.knowledge,knowledge);assert.deepEqual(Object.keys(idx.knowledge.tags),['topic']);
  assert.deepEqual(idx.knowledge.tags.topic.aliases,['재판적']);
});
test('색인은 자료 버전마다 한 번, 본건 후보도 동일 입력에서 캐시한다',()=>{
  const c=corpus({verdict:'이상없음',origin:'manual',comment:'“'+phrase+'” 확인'}),options={corpus:c},start=J.buildCount(),a=J.index(options),b=J.index(options);
  assert.equal(a,b);assert.equal(J.buildCount(),start+1);
  const docs=[{name:'본문',text:phrase+'으로 정한다.'}];assert.equal(J.retrieve(cp,docs,a),J.retrieve(cp,docs,a));
  c.meta.updated='2';c.judgment_ledger.records.contract.snapshot.verdicts[cp.id].comment='“서울중앙지방법원” 확인';
  const changed=J.index(options);assert.notEqual(a,changed);assert.equal(J.buildCount(),start+2);
  assert.deepEqual(J.retrieve(cp,docs,changed),[]);
});
test('본문 실제 표현의 후보는 조항 좌표를 유지하고 자동 판정값을 만들지 않는다',()=>{
  const idx=J.index({corpus:corpus({verdict:'이상없음',origin:'manual',comment:'“'+phrase+'” 확인'})});
  const clauses=[{index:7,heading:'기타',body:phrase+'으로 정한다.'}];
  const rows=J.retrieve(cp,[{name:'본문',text:clauses[0].body}],idx,clauses);
  assert.equal(rows[0].current_evidence.clause_index,7);assert.equal(rows[0].verdict,undefined);
});
test('검색 점수 0의 기본 best가 있어도 실제 의견표현 후보를 검토 조항으로 연결한다',()=>{
  const check={id:'X-HINT',check:'특수 확인항목',severity:'참고',triggers:{keywords:['특수 확인항목']},sources:[]};
  const hints=J.index({corpus:{byCheck:{'X-HINT':{comments:[{text:'“서울 사무실 담당자에게 연락” 문구 반영되어 있음',verdict:'이상없음'}]}}}});
  const clauses=[{index:0,heading:'목적',body:'용역을 수행한다.'},{index:1,heading:'기타',body:'서울 사무실 담당자에게 연락하기로 정한다.'}];
  const result=Core.run(clauses,[{checkpoints:[check]}],{modules:[],stance:'party',partyRoles:[],judgmentHints:hints},[]).result.results[0];
  assert.equal(result.coverage,'verify');assert.equal(result.best.clauseIndex,1);assert.equal(result.judgment_hint_candidate,true);
  assert.equal(result.verdict,undefined);assert.equal(result.autoClear,null);assert.equal(result.best.score,0);
});
test('수기 저장 즉시 분리 태그를 생성하고 저장 정규화에도 보존한다',()=>{
  const source=fs.readFileSync(require.resolve('../src/app'),'utf8'),data={},ctx={JudgmentHints:J,Verdict:V,Loop:require('../src/loop'),verdictHash:'x',_verdictSavedSnapshot:{},
    verdictStore:{[cp.id]:{verdict:'이상없음',reason:'반영되어 있음',comment:'관할 지정 약정 확인',origin:'manual'}},localStorage:{getItem:k=>data[k]||null,setItem:(k,v)=>data[k]=v}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function saveVerdicts()'),source.indexOf('function findingKey(')),ctx);ctx.saveVerdicts();
  const saved=V.migrateStore(JSON.parse(data[V.verdictKey('x')]))[cp.id];
  assert(saved.judgment_content_tags.judgment_topics.includes('jurisdiction'));assert.equal(saved.judgment_result_tags.reason_kind,'satisfied');
  ctx.saveVerdicts();assert.equal(ctx.verdictStore[cp.id].needs_reconfirmation,undefined);
});
