'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const V=require('../src/verdict'),Core=require('../src/review_core'),D=require('../src/document_structure');
const app=fs.readFileSync(require.resolve('../src/app'),'utf8');
function automatic(evidence){return {verdict:'이상없음',origin:'auto',comment:'질문별 요건 확인',auto_proof:{version:'test',evidence}};}
function cardContext(v,docs){let reads=0;const ctx={Verdict:V,ReviewCore:Core,TemplateLibrary:{VERSION:'template'},verdictStore:{A:v},_verdictEditPins:{},
  VERDICT_CLS:{이상없음:'vd-ok',검토의견:'vd-comment'},resultFor:()=>null,_cpById:()=>({id:'A'}),actionForResult:()=>null,
  esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),safetyDocuments:()=>{reads++;return docs;}};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function verdictControlHtml('),app.indexOf('function withVerdictAnchor(')),ctx);
  return {html:()=>ctx.verdictControlHtml('A',true),reads:()=>reads};
}
test('자동 근거 1,000개도 카드 버튼 하나만 만들고 원문 전량은 HTML에 넣지 않는다',()=>{
  const quote='계약기간 2026년 1월 1일부터 2026년 12월 31일까지',text=Array(1000).fill(quote).join('\n'),evidence=Array.from({length:1000},(_,i)=>({document:'본문',text:quote,start:i*(quote.length+1),end:i*(quote.length+1)+quote.length}));
  const c=cardContext(automatic(evidence),[{name:'본문',text}]),html=c.html();
  assert.equal((html.match(/class="ghost vd-evidence-open"/g)||[]).length,1);assert.equal(html.includes(quote),false);assert.equal(c.reads(),1);
  assert.equal(evidence.length,1000);
});
test('수기 카드와 미판정 카드에는 근거 재검증 비용이나 원문 버튼이 없다',()=>{
  for(const v of [{verdict:'검토의견',origin:'manual',comment:'검토자 의견'},{}]){const c=cardContext(v,[]);assert(!c.html().includes('vd-evidence-open'));assert.equal(c.reads(),0);}
});
test('좌표를 검증하지 못하면 근거 버튼을 생성하지 않는다',()=>{
  assert(!cardContext(automatic([{document:'본문',text:'없는 문구'}]),[{name:'본문',text:'실제 본문'}]).html().includes('vd-evidence-open'));
});
test('대표 근거는 첫 유효 위치만 반환하며 전량 조회 API와 내부 근거는 보존한다',()=>{
  const docs=[{name:'본문',text:'약정 A\n약정 B'}],v=automatic([{document:'본문',text:'없는 근거'},{document:'본문',text:'약정 A'},{document:'본문',text:'약정 B'}]);
  assert.equal(Core.completionLocations(v,docs,1)[0].text,'약정 A');assert.equal(Core.completionLocations(v,docs).length,2);assert.equal(v.auto_proof.evidence.length,3);
});
test('대량 조항 앵커는 미리 계산한 시작 위치를 재사용해 같은 ②열에 놓는다',()=>{
  const clauses=Array.from({length:1000},(_,i)=>({index:i,heading:'제'+(i+1)+'조',body:'본문 '+i})),text=clauses.map(c=>c.heading+'\n'+c.body).join('\n'),docs=[{name:'본문',text}],quote='본문 777',start=text.indexOf(quote),v=automatic([{document:'본문',text:quote,start,end:start+quote.length}]);
  assert.equal(Core.completionAnchor({},v,clauses,docs,D.clauseStarts(text,clauses)),777);
});
test('인증 티켓을 소비한 자동 메모만 짧게 만들고 모든 proof와 수기 원문은 보존한다',()=>{
  const quote='실제 계약기간 약정 '.repeat(500),proof={evidence:[{document:'본문',text:quote}],template_name:'표준서식',revision:'1'},ctx={require:require('node:module').createRequire(require.resolve('../src/verdict')),StandardAuto:{consume:()=>proof},TemplateLibrary:{consume:()=>proof}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../src/verdict'),'utf8'),ctx);
  for(const method of ['applyStandard','applyTemplate']){
    const v=ctx.Verdict[method]({},'A','today',{}).A;assert(v.comment.length<100);assert.equal(v.auto_proof.evidence[0].text,quote);
    const manual={A:{verdict:'검토의견',origin:'manual',comment:quote}};assert.equal(ctx.Verdict[method](manual,'A','today',{}),manual);
  }
});
function saveContext(){const data={},timers=new Map();let n=0,writes=0,archives=0;
  const ctx={Verdict:V,Loop:{judgmentTags:()=>({})},verdictHash:'h',verdictStore:{},_verdictSavedSnapshot:{},_verdictSaveTimer:null,
    localStorage:{getItem:k=>data[k]||null,setItem:(k,v)=>{writes++;data[k]=v;}},setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id),StandardAutoArchive:{schedule:()=>archives++}};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function saveVerdicts()'),app.indexOf('function findingKey(')),ctx);
  return {ctx,data,timers,writes:()=>writes,archives:()=>archives};
}
test('연속 메모 입력은 한 번으로 저장하고 마지막 글자는 강제 flush에서 남는다',()=>{
  const {ctx,timers,data,writes}=saveContext();
  for(const comment of ['메','메모','메모 끝']){ctx.verdictStore={A:{verdict:'검토의견',origin:'manual',comment}};ctx.scheduleVerdictNotes();}
  assert.equal(writes(),0);assert.equal(timers.size,1);ctx.flushVerdictNotes();assert.equal(writes(),1);assert.equal(timers.size,0);
  assert.equal(JSON.parse(data[V.verdictKey('h')]).A.comment,'메모 끝');ctx.flushVerdictNotes();assert.equal(writes(),1);
});
test('실제 저장내용이 같으면 localStorage 쓰기와 원문 평가자료 예약을 반복하지 않는다',()=>{
  const {ctx,writes,archives}=saveContext();ctx.verdictStore={A:{verdict:'검토의견',origin:'manual',comment:'동일 의견'}};
  ctx.saveVerdicts();ctx.saveVerdicts();assert.equal(writes(),1);assert.equal(archives(),1);
});
test('저장 지연 중 다른 탭이 수정한 수기 결과와 충돌은 덮지 않고 양쪽 의견을 남긴다',()=>{
  const {ctx,data}=saveContext();ctx.verdictStore={A:{verdict:'검토의견',origin:'manual',comment:'기준'}};ctx.saveVerdicts();
  ctx.verdictStore={A:{verdict:'검토의견',origin:'manual',comment:'로컬 마지막'}};ctx.scheduleVerdictNotes();
  data[V.verdictKey('h')]=JSON.stringify({A:{verdict:'검토의견',origin:'manual',comment:'다른 탭 마지막'}});ctx.flushVerdictNotes();
  assert.equal(ctx.verdictStore.A.comment,'로컬 마지막');assert.equal(ctx.verdictStore.A.concurrent_edits[0].comment,'다른 탭 마지막');assert.equal(ctx.verdictStore.A.needs_reconfirmation,true);
});
