'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Sim=require('../src/sim'),Evidence=require('../src/decision_evidence');
function exhaustive(cp,documents,knowledge,D=Evidence){
  const rows=Object.values(knowledge.documents||{}).map(doc=>{const evidence=doc.evidence||[],text=[doc.title,doc.request_context,evidence.map(e=>e.sentence||'').join(' '),(doc.tags||[]).map(t=>t.label||'').join(' ')].filter(Boolean).join(' ');return {doc,text,tags:D.tags(text),check_ids:evidence.map(e=>e.check_id).filter(Boolean)};});
  if(!rows.length)return [];
  const idf=Sim.buildIdf(rows.map(r=>r.text));rows.forEach(r=>r.vector=Sim.tfidfVec(r.text,idf));
  const b=D.bundle(cp,documents),text=cp.check+' '+b.evidence.map(e=>e.text).join(' '),tags=D.tags(text),vector=Sim.tfidfVec(text,idf);
  return rows.map(r=>{const hits=[];['topics','actions','objects','conditions'].forEach(f=>(tags[f]||[]).forEach(t=>{if((r.tags[f]||[]).includes(t))hits.push(f+':'+t);}));
    const linked=r.check_ids.includes(cp.id),score=Sim.cosine(vector,r.vector)+Sim.jaccard(text,r.text)*0.25+Math.min(0.25,hits.length*0.025)+(linked?1:0);
    return {source_id:r.doc.source_id,review_id:r.doc.review_id||'',kind:r.doc.source_kind||'tag_reference',title:r.doc.title||'',score,tag_hits:hits,linked_question:linked,reference_only:true,excerpts:(r.doc.evidence||[]).filter(e=>!e.check_id||e.check_id===cp.id).slice(0,2).map(e=>e.sentence)};
  }).filter(r=>r.linked_question||r.tag_hits.length>=2&&r.score>0.1).sort((a,b)=>b.score-a.score).slice(0,5);
}
function load(D=Evidence){const calls={cosine:0,keywords:0},S={...Sim,cosine(...a){calls.cosine++;return Sim.cosine(...a);},keywords(...a){calls.keywords++;return Sim.keywords(...a);}},ctx={Sim:S,DecisionEvidence:D};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../src/decision_references'),'utf8'),ctx);return {api:ctx.DecisionReferences,calls};}
const plain=x=>JSON.parse(JSON.stringify(x));
const words=['손해 배상 책임 위반','비밀정보 목적 외 사용 공개 금지','계약기간 종료 갱신 연장','대금 청구 지급 정산','법원 관할 소송 분쟁','개인정보 보호 안전성 암호화','계약 양도 이전 담보','저작권 지식재산 산출물 사용권','xyz 123'];
function fixture(n=80){return {documents:Object.fromEntries(Array.from({length:n},(_,i)=>['d'+i,{source_id:'s'+i,review_id:i%4?'':'r'+i,title:words[i%words.length],request_context:words[(i*7)%words.length],tags:[{label:words[(i*3)%words.length]}],evidence:[{sentence:words[(i*11)%words.length],check_id:i%7===0?'CMN-19':i%13===0?'CNS-DAMAGE':''},{sentence:'검토의견 '+i}]}]))};}
test('candidate search exactly matches exhaustive scores, order and excerpts across varied real tags',()=>{
  const {api}=load(),knowledge=fixture();
  for(const id of ['CMN-19','CNS-DAMAGE','CNS-SECRET','CNS-TERM','CMN-20','unsupported'])for(const text of words){
    const cp={id,check:text},documents=[{name:'본문',text:'제1조(약정)\n'+text+' 한다.'}];assert.deepEqual(plain(api.retrieve(cp,documents,knowledge)),plain(exhaustive(cp,documents,knowledge)),id+':'+text);
  }
});
test('duplicate query tags count separately; linked zero-similarity rows and stable ties remain',()=>{
  const D={bundle:()=>({evidence:[]}),tags:text=>text.startsWith('query')?{topics:['x','x'],actions:['x']}:{topics:['x'],actions:['x','x']}};
  const {api}=load(D),knowledge={documents:Object.fromEntries(Array.from({length:10},(_,i)=>[i,{source_id:i,title:i<8?'same':'',evidence:[{check_id:i===9?'X':'',sentence:''}]}]))},cp={id:'X',check:'query same'};
  assert.deepEqual(plain(api.retrieve(cp,[],knowledge)),exhaustive(cp,[],knowledge,D));
  assert.deepEqual(plain(api.retrieve(cp,[],knowledge)[1].tag_hits),['topics:x','topics:x','actions:x']);
  assert.deepEqual(plain(api.retrieve(cp,[],knowledge).map(r=>r.source_id)),[0,1,2,3,4]);
  assert.equal(api.retrieve({id:'X',check:'query'},[],knowledge)[0].source_id,9,'zero similarity remains eligible when explicitly linked');
});
test('unrelated rows are never scored; repeated query reuses scoring and cannot be poisoned by caller',()=>{
  const D={bundle:()=>({evidence:[]}),tags:t=>({topics:t.includes('related')?['a','b']:['other']})}, {api,calls}=load(D);
  const knowledge={documents:Object.fromEntries(Array.from({length:1000},(_,i)=>[i,{source_id:i,title:i<3?'related':'irrelevant',evidence:i===999?[{check_id:'X',sentence:'linked'}]:[]}]))},cp={id:'X',check:'related'};
  const expected=exhaustive(cp,[],knowledge,D),first=api.retrieve(cp,[],knowledge);
  assert.deepEqual(plain(first),expected);assert.equal(calls.cosine,4,'only 3 tag candidates + 1 linked candidate');
  assert.equal(calls.keywords,1001,'document keyword sets once and query once');
  first[0].title='poison';first[0].tag_hits.push('poison');first[0].excerpts.push('poison');first.push({});
  assert.deepEqual(plain(api.retrieve(cp,[],knowledge)),expected);assert.equal(calls.cosine,4);assert.equal(calls.keywords,1001);
});
test('contract query text, source identity, documents identity, explicit revision and invalidation refresh cache',()=>{
  const D={bundle:(cp,docs)=>({evidence:docs.map(text=>({text}))}),tags:()=>({})}, {api}=load(D),cp={id:'X',check:'question'},knowledge={documents:{a:{source_id:'a',evidence:[{check_id:'X',sentence:'처음'}]}}};
  const first=api.retrieve(cp,['처음'],knowledge,1);assert.deepEqual(plain(first),exhaustive(cp,['처음'],knowledge,D));
  assert.deepEqual(plain(api.retrieve(cp,['변경'],knowledge,1)),exhaustive(cp,['변경'],knowledge,D));
  knowledge.documents.a.evidence[0].sentence='수정된 자료';
  assert.deepEqual(plain(api.retrieve(cp,[],knowledge,2)),exhaustive(cp,[],knowledge,D));
  knowledge.documents.a.evidence[0].sentence='명시적 무효화';api.invalidate(knowledge);
  assert.deepEqual(plain(api.retrieve(cp,[],knowledge,2)),exhaustive(cp,[],knowledge,D));
  knowledge.documents={b:{source_id:'b',evidence:[{check_id:'X',sentence:'교체'}]}};
  assert.deepEqual(plain(api.retrieve(cp,[],knowledge,2)),exhaustive(cp,[],knowledge,D));
  assert.deepEqual(plain(api.retrieve(cp,[],structuredClone(knowledge),2)),exhaustive(cp,[],knowledge,D));
});
test('bounded result cache evicts old queries and does not retain oversized query text',()=>{
  const D={bundle:()=>({evidence:[]}),tags:()=>({})}, {api,calls}=load(D),knowledge={documents:{a:{source_id:'a',title:'참고',evidence:[{check_id:'X',sentence:'내용'}]}}};
  for(let i=0;i<200;i++)api.retrieve({id:'X',check:'query '+i},[],knowledge);
  const n=calls.cosine;api.retrieve({id:'X',check:'query 0'},[],knowledge);assert.equal(calls.cosine,n+1);
  const cp={id:'X',check:'x'.repeat(300000)};api.retrieve(cp,[],knowledge);const large=calls.cosine;api.retrieve(cp,[],knowledge);assert.equal(calls.cosine,large+1);
});
