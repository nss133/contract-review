"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const J=require('../src/judgment_hints');
const plain=value=>JSON.parse(JSON.stringify(value));
const compact=value=>String(value||'').normalize('NFC').replace(/\s+/g,'').toLowerCase();
// v1.89의 후보·구절·정렬 산식. 성능용 자료구조를 공유하지 않는 독립 비교 기준이다.
function oldPhrases(text){const out=[],seen=new Set();function add(s){s=String(s||'').trim();const key=compact(s);if(key.length<6||key.length>300||seen.has(key)||/^(?:이상없음|특이사항없음|문제없음|반영되어있음|검토의견없음|확인하였음|계약서확인함)$/.test(key))return;seen.add(key);out.push({text:s,key});}
  String(text||'').replace(/[“「"‘']([^”」"’'\n]{6,500})[”」"’']/g,(_,q)=>{add(q);return _;});
  String(text||'').split(/[\n;。]+/).forEach(s=>{add(s);const tokens=s.split(/\s+/).filter(Boolean);if(tokens.length>2)for(let n=2;n<=Math.min(5,tokens.length);n++)for(let i=0;i+n<=tokens.length;i++)add(tokens.slice(i,i+n).join(' '));});return out.slice(0,100);
}
function oldHints(cp,documents,compiled,clauses){
  if(!cp||!compiled||cp.active===false)return [];
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
const cp={id:'TEST-JH',check:'관할 법원, 개인정보 보호 및 재위탁 조건 확인'},phrase='갑 본사 소재지를 관할하는 법원';
function corpus(texts,id=cp.id){return {byCheck:{[id]:{comments:texts.map(text=>({text,verdict:'이상없음'}))}}};}
function compare(check,docs,compiled,clauses){assert.deepEqual(plain(J.retrieve(check,docs,compiled,clauses)),plain(oldHints(check,docs,compiled,clauses)));}

test('구절 100개 조기 종료는 기존 전체 생성 후 절단과 정확히 같다',()=>{
  const cases=[Array.from({length:140},(_,i)=>'“인용문 순서'+i+' 조건”').join(' '),Array.from({length:500},(_,i)=>'합성단어'+i).join(' '),
    Array.from({length:130},(_,i)=>i%3?'반복되는 문장 유지 확인':'독립문장'+i+' 제한 확인').join(';'),
    '이상없음\n특이사항없음\n“'+phrase+'”\n'+phrase+'\n책임을 지지 않는다.\n'+phrase.normalize('NFD'),
    '가'.repeat(700)+'\n짧은 말\n“여섯자이상인용문”\n'+'한글'.repeat(150)];
  cases.forEach(text=>{const row=J.index({corpus:corpus([text])}).rows[0];assert.deepEqual(row.phrases,oldPhrases(text));});
});

test('다양한 의견·복수 주제·구 ID·부속서류와 동점 순서가 이전 검색과 같다',()=>{
  const c=corpus(Array.from({length:260},(_,i)=>['“'+phrase+'” '+i+' 관할 확인','“수탁자는 재위탁 전 사전 서면 동의를 받는다” '+i,'개인정보 보호를 위한 접근 권한을 제한한다 '+i][i%3]));
  c.byCheck.OLD={comments:Array.from({length:15},(_,i)=>({text:'“서울중앙지방법원을 관할법원으로 한다” '+i,verdict:'검토의견'}))};
  const knowledge={documents:{a:{source_id:'a',source_kind:'legal_review',title:'합성 법률의견',department:'법무',evidence:[{sentence:phrase+'으로 정한다.'}]}}};
  const compiled=J.index({corpus:c,knowledge}),clauses=Array.from({length:30},(_,i)=>({index:i+8,heading:'소제목 '+i,body:i%2?phrase+' 및 서울중앙지방법원을 관할법원으로 한다.':'수탁자는 재위탁 전 사전 서면 동의를 받는다. 개인정보 보호를 위한 접근 권한을 제한한다.'}));
  const docs=[{name:'합성 본문',text:clauses.map(c=>c.body).join('\n')},{name:'개인정보 별첨',text:'개인정보 보호를 위한 접근 권한을 제한한다.'}];
  for(const check of [cp,{...cp,id:'OTHER',legacy_check_ids:['OLD',cp.id]},{...cp,id:'OTHER',check:'개인정보 보호'}, {...cp,active:false}])compare(check,docs,compiled,clauses);
});

test('선택 후보 200개 뒤의 구절과 전체 rows는 최초·반복 검색에서 읽지 않는다',()=>{
  const compiled=J.index({corpus:corpus(Array.from({length:600},(_,i)=>'“'+phrase+'” 검토 '+i))});let reads=0;
  compiled.rows.forEach((row,i)=>{const descriptor=Object.getOwnPropertyDescriptor(row,'phrases');Object.defineProperty(row,'phrases',{get(){assert(i<200,'후보 제한 밖의 구절을 읽었다');reads++;return descriptor.get();}});});
  Object.defineProperty(compiled,'rows',{get(){throw Error('retrieve가 전 DB rows를 순회했다');}});
  const docs=[{name:'본문',text:phrase}];const result=J.retrieve(cp,docs,compiled);assert(result.length>0);assert.equal(reads,200);
  assert.equal(J.retrieve(cp,docs,compiled),result);assert.equal(reads,400);
});

test('검색 후보 없는 질문은 구절 생성 자체를 하지 않는다',()=>{
  const compiled=J.index({corpus:corpus(['“'+phrase+'” 확인'])});compiled.rows.forEach(row=>Object.defineProperty(row,'phrases',{get(){throw Error('무관한 의견의 구절을 생성했다');}}));
  assert.deepEqual(J.retrieve({id:'NO-HINT',check:'제품 색상'},[{name:'본문',text:phrase}],compiled),[]);
});

test('부분 구절의 접미·반복·NFD·부정·동일 길이 우선순위는 정확 부분검색과 같다',()=>{
  const compiled=J.index({corpus:corpus(['“가나다라마바사” “나다라마바사” “책임을 지지 않는다” “서울중앙지방법원”'])});
  for(const text of ['가나다라마바사가나다라마바사','나다라마바사','책임을 지지 않는다.','책임을 진다.','서울중앙지방법원'.normalize('NFD'),'서울 중 앙 지 방법원','서초지원만 지정한다.'])compare(cp,[{name:'본문',text}],compiled);
  // 키가 같아도 원래 먼저 기재된 표시 구절이 우선이다.
  compiled.rows[0].phrases=[{key:'동일정규화문자열',text:'첫 표시'},{key:'동일정규화문자열',text:'두 번째 표시'}];
  compare(cp,[{name:'본문',text:'동일정규화문자열'}],compiled);
});

test('선택된 구절의 제자리 키·표시·추가·배열 대체가 검색 캐시를 무효화한다',()=>{
  const compiled=J.index({corpus:corpus(['“'+phrase+'” 확인'])}),row=compiled.rows[0],docs=[{name:'본문',text:phrase}];
  row.phrases=[{text:phrase,key:compact(phrase)}];compare(cp,docs,compiled);assert.equal(J.retrieve(cp,docs,compiled).length,1);
  row.phrases[0].key='존재하지않는새구절';compare(cp,docs,compiled);assert.equal(J.retrieve(cp,docs,compiled).length,0);
  row.phrases[0].key=compact(phrase);row.phrases[0].text='수정된 표시';compare(cp,docs,compiled);assert.equal(J.retrieve(cp,docs,compiled)[0].matched_phrase,'수정된 표시');
  row.phrases.push({key:'본사소재지',text:'짧은 표시'});compare(cp,docs,compiled);row.phrases=[];compare(cp,docs,compiled);
});

test('같은 구절의 내부 스냅샷을 공유해도 한 출처 변경이 다른 출처로 전파되지 않는다',()=>{
  const compiled=J.index({corpus:corpus(['“'+phrase+'” 확인','“'+phrase+'” 확인'])}),docs=[{name:'본문',text:phrase}];
  const a=compiled.rows[0],b=compiled.rows[1];assert.equal(J.retrieve(cp,docs,compiled).length,2);
  a.phrases[0].key='전혀다른문자열';a.phrases[0].text='수정 표시';compare(cp,docs,compiled);
  assert.equal(b.phrases[0].key,compact(phrase));assert.equal(b.phrases[0].text,phrase);
  a.phrases.length=0;compare(cp,docs,compiled);assert.equal(J.retrieve(cp,docs,compiled).length,1);
  assert.equal(J.retrieve(cp,docs,compiled)[0].source_id,b.id);
});

test('지연 행의 본문·제목·태그·후보 순서 및 질문 자체 수정은 바로 반영한다',()=>{
  const compiled=J.index({corpus:corpus(['“'+phrase+'” 확인','“서울중앙지방법원” 확인'])}),docs=[{name:'본문',text:phrase}],row=compiled.rows[0];
  compare(cp,docs,compiled);row.text='서울중앙지방법원을 관할법원으로 정한다';compare(cp,docs,compiled);assert.equal(J.retrieve(cp,docs,compiled).length,0);
  row.text='“'+phrase+'” 확인';row.title='수정 출처';row.department='정보보호';row.content_tags.topics.push('추가주제');compare(cp,docs,compiled);
  const check={...cp};check.legacy_check_ids=['OLD'];compare(check,docs,compiled);check.check='변경 질문';compare(check,docs,compiled);
  compiled.by_check[cp.id].reverse();docs[0].text=phrase+' 및 서울중앙지방법원';compare(check,docs,compiled);
});

test('원본 자료는 동결하지 않으며 사용자/태깅 근거 제자리 수정·추가는 새 색인에 반영',()=>{
  const knowledge={latest:{a:'a'},documents:{a:{source_id:'a',title:'이전 제목',evidence:[{check_id:cp.id,sentence:phrase}]}}},options={knowledge},docs=[{name:'본문',text:phrase}];
  const first=J.index(options);assert(!Object.isFrozen(knowledge.documents.a));assert(!Object.isFrozen(knowledge.documents.a.evidence));compare(cp,docs,first);
  knowledge.documents.a.title='수정 제목';knowledge.documents.a.evidence[0].sentence='서울중앙지방법원';assert.equal(J.isCurrent(first,options),false);const second=J.index(options);assert.notEqual(first,second);assert.deepEqual(J.retrieve(cp,docs,second),[]);
  knowledge.documents.a.evidence.push({sentence:phrase,check_id:cp.id});const third=J.index(options);assert.notEqual(second,third);assert.equal(J.retrieve(cp,docs,third)[0].title,'수정 제목');
});

test('결론 태그만으로 현재 증거를 만들지 않으며 자동·초안은 재학습하지 않는다',()=>{
  const record={snapshot:{meta:{title:'검토'},verdicts:{A:{origin:'auto',comment:phrase},B:{origin:'llm_draft',comment:phrase},[cp.id]:{origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'이상없음'}}}};
  const compiled=J.index({corpus:{judgment_ledger:{records:{x:record}}}});assert.equal(compiled.stats.excluded_system,2);assert.deepEqual(J.retrieve(cp,[{name:'본문',text:phrase}],compiled),[]);
  const next=J.index({corpus:corpus(['“'+phrase+'” 확인'])}),hints=J.retrieve(cp,[{name:'본문',text:phrase}],next);assert(hints.every(h=>h.reference_only&&!h.auto_approval&&h.verdict===undefined));
});

test('1400조항·14종 반복 표현에서도 최장 구절·동점·상위 5개가 같다',()=>{
  const texts=Array.from({length:14},(_,i)=>'“수탁자는 개인정보 처리 목적 '+i+'에 따른 접근 권한을 제한한다” 확인');
  const compiled=J.index({corpus:corpus(Array.from({length:240},(_,i)=>texts[i%14]))}),clauses=Array.from({length:1400},(_,i)=>({index:i,heading:'제'+(i+1)+'조',body:'수탁자는 개인정보 처리 목적 '+i%14+'에 따른 접근 권한을 제한한다.'}));
  const docs=[{name:'긴 합성 계약',text:clauses.map(c=>c.body).join('\n')}];compare(cp,docs,compiled,clauses);assert.equal(J.retrieve(cp,docs,compiled,clauses),J.retrieve(cp,docs,compiled,clauses));
});
