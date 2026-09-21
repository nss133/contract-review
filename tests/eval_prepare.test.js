const {test}=require('node:test'),assert=require('node:assert/strict'),P=require('../src/eval_prepare');
const history={latest:{a:'r'},records:{r:{fingerprint:'1',request:{contract_name:'유지보수'},result:{review_text:'손해배상 상한이 과도하므로 수정 필요.\n해지 조항은 이상없음.'}}}};
test('과거 의견을 원문 인용과 출처가 있는 미확정 초안으로 만든다',()=>{
 const s=P.prepare(P.empty(),history,null),c=s.cases[s.active[0]];
 assert.equal(c.items.length,2);assert.equal(c.items[0].suggestion,'issue');assert.equal(c.items[1].suggestion,'safe');
 assert.equal(c.items[0].truth,'');assert.equal(c.source.id,'contract:a');assert.equal(c.version,'unknown');
 assert.equal(P.prepare(s,history,null).active[0],s.active[0]);
});
test('조건·부정·혼합은 정답을 추정하지 않고 자료 없으면 빈 초안',()=>{
 for(const s of ['수정 필요 여부 확인','문제가 없지 않다','문제없다고 볼 수 없음','문제없음. 다만 수정 필요'])assert.equal(P.splitOpinion(s,'x')[0].suggestion,'unknown');
 assert.deepEqual(P.splitOpinion('','x'),[]);
});
test('법률검토 근거는 계약 정답으로 복사하지 않으며 명시적 ID만 병합',()=>{
 const k={latest:{x:'x',y:'y'},documents:{x:{title:'법률 검토',fingerprint:'1',evidence:[{sentence:'문제없음'}]},y:{title:'태그 계약',original:{review_id:'a'},tags:[{label:'태그'}]}}};
 const s=P.prepare(P.empty(),history,k);assert.equal(s.active.length,2);
 const law=Object.values(s.cases).find(c=>c.source.kind==='legal');assert.equal(law.items.length,0);assert.equal(law.source.support.length,1);
});
test('원문·버전·출처 대조 없으면 확정을 막고 확인도 독립 정답이 아니다',()=>{
 const s=P.prepare(P.empty(),history,null),c=s.cases[s.active[0]],i=c.items[0];
 const a={truth:'issue',check_id:'CMN',reviewer:'검수자',reason:'상한 수정',evidence:'본문 3조',source_confirmed:true};
 assert.throws(()=>P.confirm(c,i,a));c.documents=[{name:'a',text:'본문',role:'main'}];assert.throws(()=>P.confirm(c,i,a));
 c.version='before';P.confirm(c,i,a);assert.equal(i.status,'reviewed_draft');assert.equal(i.independent,false);
 P.invalidate(c);assert.equal(i.status,'recheck');
});
test('원천 변경은 이전 초안을 보존하고 새 초안을 만든다; 복구는 덮어쓰지 않는다',()=>{
 const s=P.prepare(P.empty(),history,null),h=JSON.parse(JSON.stringify(history));h.records.r.fingerprint='2';
 const n=P.prepare(s,h,null);assert.equal(Object.keys(n.cases).length,2);assert.equal(n.active.length,1);
 const restored=P.restore(P.empty(),s);assert.equal(restored.active.length,1);
 assert.deepEqual(P.restore(s,s),s);assert.throws(()=>P.restore(s,{format:'wrong'}));
});
