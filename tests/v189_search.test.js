"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const J=require('../src/judgment_hints'),H=require('../src/history_assist'),M=require('../src/matcher'),Sim=require('../src/sim');
const plain=value=>JSON.parse(JSON.stringify(value));
function oldHints(cp,documents,compiled,clauses){
  const tags=Object.assign({},J.tagVerdict({comment:cp.check}).content_tags,cp.tag_signature||{}),ids=[cp.id].concat(cp.legacy_check_ids||[]),now=J.current(documents,clauses),out=[],candidates=new Set();
  const topics=t=>(t.topics||[]).concat((t.judgment_topics||[]).map(x=>'judgment:'+x));
  const overlap=(a,b)=>['topics','judgment_topics','actions','objects'].flatMap(f=>(a[f]||[]).filter(t=>(b[f]||[]).includes(t)).map(t=>f+':'+t));
  ids.forEach(id=>(compiled.by_check[id]||[]).forEach(r=>candidates.add(r)));topics(tags).forEach(t=>(compiled.by_topic[t]||[]).forEach(r=>candidates.add(r)));
  Array.from(candidates).slice(0,200).forEach(row=>{const linked=ids.includes(row.check_id),hits=overlap(tags,row.content_tags);if(!linked&&!hits.some(t=>t.includes('topics:')))return;
    now.forEach(cl=>{const matches=row.phrases.filter(p=>cl.key.includes(p.key));if(!matches.length||!linked&&!overlap(cl.tags,row.content_tags).some(t=>t.includes('topics:')))return;
      matches.sort((a,b)=>b.key.length-a.key.length);const match=matches[0];out.push({source_id:row.id,kind:row.kind,title:row.title,department:row.department||'',check_id:cp.id,reference_only:true,auto_approval:false,raw_linked:row.raw_linked,
        result_tags:row.result_tags,content_tags:row.content_tags,matched_phrase:match.text,tag_hits:hits,current_evidence:{document:cl.document,document_index:cl.document_index,clause_index:cl.clause_index,heading:cl.heading,text:cl.text},score:(linked?1:0)+Math.min(.5,match.key.length/100)});
    });});return out.sort((a,b)=>b.score-a.score).slice(0,5);
}
function words(text){return Array.from(new Set(String(text||'').normalize('NFC').toLowerCase().match(/[가-힣a-z0-9]{2,}/g)||[])).filter(s=>!/^(계약|계약서|업무|검토|관련|사항|정보|회사|대한|위한|한다|있다)$/.test(s));}
function oldSearch(knowledge,input,department,opts={}){const query=words(input),out=[];if(!knowledge||!query.length)return out;
  Object.keys(knowledge.latest||{}).forEach(id=>{let doc=knowledge.documents[knowledge.latest[id]];if(!doc)return;const meta=(opts.familyMap||{})[doc.source_id];if(meta)doc=Object.assign({},doc,{family_id:meta.family_id,date:meta.date});
    if((opts.excludeSourceIds||[]).includes(doc.source_id)||doc.review_id&&(opts.excludeSourceIds||[]).includes(doc.review_id)||(opts.excludeFamilyIds||[]).includes(doc.family_id))return;
    if(opts.strictIsolation&&(!doc.family_id||!/^\d{4}-\d{2}-\d{2}/.test(doc.date||''))||opts.asOf&&(!doc.date||String(doc.date).slice(0,10)>opts.asOf))return;
    const content=words([doc.request_title||doc.title,doc.request_context,(doc.evidence||[]).map(e=>e.sentence).join(' '),(doc.tags||[]).filter(t=>!/부서|유형|결론|효과|department|case_type/.test(t.type)).map(t=>t.label).join(' ')].join(' '));
    const hits=query.filter(w=>content.indexOf(w)!==-1);if(hits.length<2)return;const semantic=hits.length/Math.sqrt(Math.max(1,query.length*content.length));out.push({doc,hits,score:semantic+(department&&department===doc.department?Math.min(.02,semantic*.05):0)});
  });return out.sort((a,b)=>b.score-a.score).slice(0,8);
}
function uncachedMatcher(){const path=require.resolve('../src/matcher'),ctx={require:createRequire(path),module:{exports:{}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path,'utf8')+'\nprepareMatching=function(){return undefined;};',ctx);return ctx.module.exports;}
const baseline=uncachedMatcher();
const phrase='갑 본사 소재지를 관할하는 법원',cp={id:'CMN-19',check:'관할 법원을 지정하였는가',triggers:{keywords:['관할','법원']}};
function corpus(comment=phrase){return {judgment_ledger:{records:{a:{snapshot:{meta:{title:'의견'},verdicts:{[cp.id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment}}}}}}};}

test('다중 표현 검색은 후보 제한, 최장 구절, 중복 출처와 동점 순서를 그대로 보존',()=>{
  const c={byCheck:{[cp.id]:{comments:Array.from({length:230},(_,i)=>({text:'“'+phrase+'” '+(i%2?'관할하는 법원':'본사 소재지')+' 확인 '+i,verdict:'이상없음',count:i+1}))}}};
  const knowledge={latest:{a:'a'},documents:{a:{source_id:'legal',source_kind:'legal_review',title:'법률검토',evidence:[{sentence:'관할 법원은 '+phrase+'으로 정한다.'}]}}};
  const compiled=J.index({corpus:c,knowledge}),clauses=Array.from({length:25},(_,i)=>({index:i+4,heading:'기타',body:i%3?phrase+'으로 정한다.':'본사 소재지와 법원을 검토하였다.'}));
  const docs=[{name:'본문',text:clauses.map(c=>c.body).join('\n')},{name:'별첨',text:'관할 법원은 '+phrase+'으로 한다.'}];
  assert.deepEqual(plain(J.retrieve(cp,docs,compiled,clauses)),plain(oldHints(cp,docs,compiled,clauses)));
});
test('띄어쓰기/NFD/접미 중첩/부정이 든 표현도 기존 정확 부분검색과 같다',()=>{
  const c=corpus('“'+phrase+'” 또는 “책임을 지지 않는다” / “서울중앙지방법원” 확인'),compiled=J.index({corpus:c});
  for(const text of [phrase.normalize('NFD'),phrase.replace(/ /g,'\n'),'책임을 지지 않는다.','책임을 진다.','서울중앙지방법원과 서울법원','내용 없음']){
    const docs=[{name:'본문',text}];assert.deepEqual(plain(J.retrieve(cp,docs,compiled)),plain(oldHints(cp,docs,compiled)));
  }
});
test('버전표시가 없어도 코퍼스 수기내용/출처/자동판정 전환의 in-place 수정을 감지',()=>{
  const c=corpus(),options={corpus:c},docs=[{name:'본문',text:phrase}],first=J.index(options);assert.equal(J.index(options),first);
  c.judgment_ledger.records.a.snapshot.verdicts[cp.id].comment='서울중앙지방법원';let next=J.index(options);assert.notEqual(next,first);assert.deepEqual(J.retrieve(cp,docs,next),[]);
  c.judgment_ledger.records.a.snapshot.meta.title='수정 출처';const renamed=J.index(options);assert.notEqual(renamed,next);assert.equal(renamed.rows[0].title,'수정 출처');
  c.judgment_ledger.records.a.snapshot.verdicts[cp.id].origin='auto';assert.equal(J.index(options).rows.length,0);
});
test('같은 문서와 조항 배열의 내용/좌표 수정 및 태깅/패킷 추가를 감지',()=>{
  const compiled=J.index({corpus:corpus()}),docs=[{name:'본문',text:phrase}],clauses=[{index:0,heading:'기타',body:phrase}];assert.equal(J.retrieve(cp,docs,compiled,clauses).length,1);
  clauses[0].body='다른 내용';assert.deepEqual(J.retrieve(cp,docs,compiled,clauses),[]);clauses[0].body=phrase;clauses[0].index=8;assert.equal(J.retrieve(cp,docs,compiled,clauses)[0].current_evidence.clause_index,8);
  docs[0].text='다른 내용';assert.deepEqual(J.retrieve(cp,docs,compiled),[]);
  const knowledge={latest:{a:'a'},documents:{a:{source_id:'a',evidence:[]}}},packets=[],options={knowledge,packets};const empty=J.index(options);knowledge.documents.a.evidence.push({sentence:phrase,check_id:cp.id});assert.notEqual(J.index(options),empty);
  packets.push({id:'p',documents:[{name:'원문',text:phrase}],verdicts:{[cp.id]:{origin:'manual',comment:phrase,verdict:'이상없음'}}});assert.equal(J.index(options).rows.filter(r=>r.raw_linked).length,1);
});
test('긴 입력 검색의 결과/점수/정렬 및 격리 조건은 옛 배열 검색과 같다',()=>{
  const knowledge={latest:{},documents:{}};for(let i=0;i<120;i++){knowledge.latest[i]=i;knowledge.documents[i]={source_id:'s'+i,review_id:'r'+i,title:'서버 운영 '+i,request_context:'백업 복구와 접근권한',department:i%2?'IT':'보안',family_id:'f'+i%5,date:'2026-09-'+String(i%28+1).padStart(2,'0'),tags:[{type:'쟁점',label:i%3?'관할':'재위탁'},{type:'결론',label:'이상없음'}],evidence:[{sentence:'서버 장애 대응 복구 계획 '+i}]};}
  for(const options of [{},{strictIsolation:true,asOf:'2026-09-20',excludeSourceIds:['s0','r2'],excludeFamilyIds:['f3']},{familyMap:{s0:{date:'2030-01-01',family_id:'x'}},asOf:'2026-10-01'}]){
    const query='서버 운영 장애 복구 접근권한 백업 계획 관할 이상없음';assert.deepEqual(H.retrieve(knowledge,query,'IT',options),oldSearch(knowledge,query,'IT',options));
  }
});
test('검색 프로필은 새 뷰에서 재사용하되 같은 객체의 문장/태그/제목/부서 변경을 반영',()=>{
  const doc={source_id:'a',title:'서버 운영',department:'IT',evidence:[{sentence:'백업 복구'}],tags:[{type:'쟁점',label:'관할'}]},view=()=>({latest:{a:'a'},documents:{a:doc}});
  assert.deepEqual(H.retrieve(view(),'백업 복구','IT'),oldSearch(view(),'백업 복구','IT'));
  doc.evidence[0].sentence='접근 권한';assert.deepEqual(H.retrieve(view(),'백업 복구','IT'),[]);
  doc.tags[0].label='재위탁';doc.title='접근 권한';doc.department='법무';assert.deepEqual(H.retrieve(view(),'접근 권한 재위탁','법무'),oldSearch(view(),'접근 권한 재위탁','법무'));
});
test('combined는 원래 명시 태그 별칭을 보존하고 의결/합의 표현을 발명하지 않는다',()=>{
  const tags={t:{label:'관할',aliases:['재판적']}},knowledge={latest:{},documents:{},tags},combined=H.combined(knowledge,null);
  assert.equal(combined.tags,tags);tags.t.aliases.push('관할법원');assert.deepEqual(combined.tags.t.aliases,['재판적','관할법원']);assert.equal(combined.tags['협의'],undefined);
});
test('문장분해 캐시도 같은 조항/과거 근거의 주체·부정 수정에 즉시 반응',()=>{
  const check={id:'X',triggers:{keywords:['재위탁','동의']}},clause={body:'수탁자는 재위탁 전 사전 동의를 받는다.'},e={sentence:'수탁자는 재위탁 전 사전 동의를 받는다.'},related=[{doc:{source_id:'a',evidence:[e]}}];
  assert(H.clauseSupport(related,check,clause).bonus>0);e.sentence='위탁자는 재위탁 전 사전 동의를 받는다.';assert.equal(H.clauseSupport(related,check,clause).bonus,0);
  clause.body=e.sentence;assert(H.clauseSupport(related,check,clause).bonus>0);e.sentence='동의만 별도로 기재한다.';assert.equal(H.clauseSupport(related,check,clause).bonus,0);
});
function matchingFixture(){const clauses=Array.from({length:40},(_,i)=>({index:i,heading:'제'+(i+1)+'조('+['관할','재위탁','계약기간','기밀유지'][i%4]+')',body:['분쟁 소송의 관할 법원은 서울중앙지방법원으로 한다.','수탁자는 재위탁 전 사전 동의를 받아야 한다.','계약기간은 2026년 1월 1일부터 2027년 1월 1일까지이다.','상대방 기밀정보를 제삼자에게 공개하여서는 아니 된다.'][i%4]}));
  const checks=Array.from({length:12},(_,i)=>({id:'SEARCH-'+i,module:'M-CORE',check:['관할 법원 지정','재위탁 사전 동의','계약기간 시작 종료','비밀정보 공개 금지'][i%4],severity:'권장',norm_type:'실무',triggers:{keywords:['관할','사전 동의','계약기간','비밀정보']},sources:[]}));return {clauses,docs:[{meta:{type_id:'test'},checkpoints:checks}],options:{modules:['M-CORE'],stance:'party'}};}
test('매핑 선계산은 모든 점수/정렬/부속서류 결과를 비캐시 산식과 동일하게 유지',()=>{
  const {clauses,docs,options}=matchingFixture();assert.deepEqual(plain(M.analyze(clauses,docs,options)),plain(baseline.analyze(clauses,docs,options)));
  const model=M.buildModel(docs,options.modules,'party');assert.deepEqual(plain(M.subDocCoverage(docs[0].checkpoints,[{name:'별첨',clauses}],model)),plain(baseline.subDocCoverage(docs[0].checkpoints,[{name:'별첨',clauses}],model)));
});
test('매핑 벡터는 조항×체크의 두 배 대신 조항수+체크수만 계산',()=>{
  const {clauses,docs,options}=matchingFixture(),old=Sim.tfidfVec;let calls=0;Sim.tfidfVec=function(...args){calls++;return old(...args);};
  try{M.analyze(clauses,docs,options);assert.equal(calls,clauses.length+docs[0].checkpoints.length);}finally{Sim.tfidfVec=old;}
});
test('재분석 때 같은 본문/질문/키워드 및 IDF 객체의 in-place 수정도 옛 산식과 같다',()=>{
  const {clauses,docs,options}=matchingFixture();M.analyze(clauses,docs,options);clauses[0].heading='지급';clauses[0].body='대금은 매월 말일 지급한다.';docs[0].checkpoints[0].check='대금 지급';docs[0].checkpoints[0].triggers.keywords.push('지급');
  assert.deepEqual(plain(M.analyze(clauses,docs,options)),plain(baseline.analyze(clauses,docs,options)));
  const model=M.buildModel(docs,options.modules,'party'),entry=model.checks[0];M.scoreClauseCheck(clauses[0],entry,model);for(const k of Object.keys(model.idf.idf))model.idf.idf[k]=k.includes('지')?5:.5;
  assert.deepEqual(plain(M.scoreClauseCheck(clauses[0],entry,model)),plain(baseline.scoreClauseCheck(clauses[0],entry,model)));
});
