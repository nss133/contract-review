const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/app.js'),'utf8');
const template=fs.readFileSync(require.resolve('../src/template.html'),'utf8');
const ReviewCore=require('../src/review_core');
const Verdict=require('../src/verdict');
const DocumentStructure=require('../src/document_structure');
function context(extra={}){
  const ctx={state:{clauses:[{index:0,heading:'제1조',body:'본문 내용'}],subDocCov:{},refCov:{}},
    verdictStore:{},_verdictEditPins:{},_reviewPlacementById:{},ReviewCore,Verdict,DocumentStructure,
    _requiresDecision:()=>true,_cpById:id=>({id}),esc:s=>String(s||''),
    renderConsiderItem:r=>'<article data-check="'+r.cpId+'">'+r.cpId+'</article>',...extra};
  vm.createContext(ctx);
  const begin=source.indexOf('function reviewSourceLocation(');
  assert.notEqual(begin,-1,'unified source placement helpers must exist');
  vm.runInContext(source.slice(begin,source.indexOf('function renderClauses()',begin)),ctx);
  return ctx;
}
test('separate action queue panel and ambiguous title-only annex badge are absent',()=>{
  assert.doesNotMatch(template,/id="action-queue-block"|id="action-anchor"/);
  assert.doesNotMatch(source,/본문·부속서류 근거의 검토항목|◇ 별첨 참조:/);
});
test('historical common-phrase matches remain internal, not card evidence',()=>{
  const body=source.slice(source.indexOf('function verdictControlHtml('),source.indexOf('function bindVerdictControls('));
  assert.doesNotMatch(body,/표현 검색 참고|judgmentHints/);
});
test('real mapped clauses stay in their existing row even for verify_elsewhere checks',()=>{
  const ctx=context();
  const r={cpId:'PRIV-07',coverage:'verify',best:{clauseIndex:0}};
  const placed=ctx.reviewPlacement(r,[{name:'본문',text:'본문 내용'}],[]);
  assert.equal(placed.kind,'clause');assert.equal(placed.index,0);
});
test('annex automatic completion uses actual source in the ordinary three-column row',()=>{
  const quote='갑은 개인정보 관리 현황을 점검할 수 있고 을은 협조한다.';
  const docs=[{name:'본문',text:'본문 내용'},{name:'보안관리약정서',text:quote}];
  const ctx=context({verdictStore:{'PRIV-07':{verdict:'이상없음',origin:'auto',auto_proof:{evidence:[{document:docs[1].name,document_index:1,text:quote,start:0,end:quote.length,section:'제10조'}]}}}});
  const r={cpId:'PRIV-07',coverage:'consider',best:null};
  const placement=ctx.reviewPlacement(r,docs,[]);
  assert.equal(placement.kind,'source');assert.equal(placement.location.name,docs[1].name);
  const html=ctx.reviewSourceRowHtml({id:'source-0',location:placement.location,items:[r]});
  assert.match(html,/cr-src[\s\S]*보안관리약정서[\s\S]*제10조/);
  assert.match(html,/cr-reviewed[^]*data-check="PRIV-07"[^]*cr-opinions/);
});
test('pending annex clauses use column three without losing source or confirming them',()=>{
  const text='을은 재위탁할 수 없다. 다만 갑의 승낙을 받아 허용한다.';
  const ctx=context();ctx.state.subDocCov['PRIV-21']={docName:'보안관리약정서',heading:'제5조',quote:text};
  const r={cpId:'PRIV-21',coverage:'consider'};
  const p=ctx.reviewPlacement(r,[{name:'본문',text:''},{name:'보안관리약정서',text}],[]);
  assert.equal(p.kind,'source');
  const html=ctx.reviewSourceRowHtml({id:'source-0',location:p.location,items:[r]});
  assert.match(html,/cr-reviewed[^]*cr-opinions[^]*data-check="PRIV-21"/);
  assert.equal(ctx.verdictStore['PRIV-21'],undefined);
});
test('document name alone is never a source; unlinked manual completion still moves to column two',()=>{
  const ctx=context();ctx.state.refCov.A={title:'보안관리약정서'};
  const r={cpId:'A',coverage:'consider'};
  const p=ctx.reviewPlacement(r,[{name:'본문',text:'보안관리약정서를 별첨한다.'}],[]);
  assert.equal(p.kind,'unlinked');
  ctx.verdictStore.A={verdict:'이상없음',origin:'manual',comment:'기존 검토 메모'};
  const html=ctx.reviewSourceRowHtml({id:'unlinked',items:[r]});
  assert.match(html,/cr-reviewed[^]*data-check="A"[^]*cr-opinions/);
  assert.equal(ctx.verdictStore.A.comment,'기존 검토 메모');
});
test('manual reassignment and contract-wide scope take precedence over automatic annex evidence',()=>{
  const ctx=context();
  assert.equal(ctx.reviewPlacement({cpId:'A',coverage:'verify',best:{clauseIndex:0},reassigned:true},[],[]).index,0);
  assert.equal(ctx.reviewPlacement({cpId:'A',coverage:'verify',best:{clauseIndex:0},opinionScope:'contract'},[],[]).kind,'contract');
});
test('automatic annex evidence outranks lexical body mapping, but never manual reassignment',()=>{
  const text='갑은 관리 감독을 할 수 있다.',docs=[{name:'본문',text:'본문 내용'},{name:'별첨',text}];
  const ctx=context({verdictStore:{A:{verdict:'이상없음',origin:'auto',auto_proof:{evidence:[{document:'별첨',document_index:1,text}]}}}});
  const r={cpId:'A',coverage:'verify',best:{clauseIndex:0}};
  assert.equal(ctx.reviewPlacement(r,docs,[]).kind,'source');
  r.reassigned=true;assert.equal(ctx.reviewPlacement(r,docs,[]).kind,'clause');
});
test('quiet non-review items do not become extra work just because an annex phrase exists',()=>{
  const ctx=context({_requiresDecision:()=>false});ctx.state.subDocCov.A={docName:'별첨',quote:'관리 감독'};
  assert.equal(ctx.reviewPlacement({cpId:'A',coverage:'quiet'},[{name:'별첨',text:'관리 감독'}],[]).kind,'hidden');
});
test('validated source does not ask the reviewer to confirm a missing target again',()=>{
  const ctx=context();ctx._reviewPlacementById.A={kind:'source',location:{document:1}};
  assert.equal(ctx.reviewPlacementLabel({cpId:'A'}),'별첨 원문에 연결됨');
  assert.equal(ctx.reviewPlacementLabel({cpId:'B'}),'관련 조항 미연결');
});
test('reconfirmed and opinion entries stay column three; duplicate unrelated hint does not affect placement',()=>{
  const ctx=context({verdictStore:{A:{verdict:'이상없음',needs_reconfirmation:true},B:{verdict:'검토의견'}}});
  const html=ctx.reviewSourceRowHtml({id:'unlinked',items:[{cpId:'A'},{cpId:'B'}]});
  assert.match(html,/cr-opinions[^]*data-check="A"[^]*data-check="B"/);
});
