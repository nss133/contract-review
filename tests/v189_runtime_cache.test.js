'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../src/review_core'),Digest=require('../src/safety_digest'),D=require('../src/document_structure'),Hints=require('../src/judgment_hints');
const Sources=require('../src/judgment_sources'),Standard=require('../src/standard_auto'),Verdict=require('../src/verdict'),History=require('../src/history_assist');
const Library=require('../src/template_library'),inventory=require('../knowledge/checklist_inventory_v188.json').checks;
const app=fs.readFileSync(require.resolve('../src/app'),'utf8'),runtimeSource=fs.readFileSync(require.resolve('../src/safety_runtime'),'utf8');
const court='본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.';
test('on-demand tag references never run during verdicts/report; shared request and stale results are isolated',async()=>{
  const {ctx,counts}=runtime();ctx.AnalysisRuntime={};ctx.legalOpinionKnowledge=ctx.knowledge;
  let current=true,calls=0,resolve,cancels=0;
  ctx.SafetyRuntime.installReferences({rows:{},tag_rows:{},tag_status:'unqueried',stats:{}},()=>current,
    {load:()=>{calls++;return new Promise(r=>resolve=r);},cancel:()=>cancels++});
  ctx.verdictStore=ctx.SafetyRuntime.apply({});const before=JSON.stringify(ctx.verdictStore);
  assert.equal(ctx.SafetyRuntime.standardReport().tag_search.status,'unqueried');assert.equal(calls,0);
  const p=ctx.SafetyRuntime.requestReferences(),p2=ctx.SafetyRuntime.requestReferences();assert.equal(p,p2);assert.equal(calls,1);
  assert.equal(ctx.SafetyRuntime.standardReport().tag_search.status,'loading');
  resolve({tag_rows:{'CMN-19':[{title:'후보'}]}});await p;
  assert.equal(ctx.SafetyRuntime.standardReport().rows[0].tag_sources[0].title,'후보');
  assert.equal(ctx.SafetyRuntime.standardReport().tag_search.status,'ready');assert.equal(JSON.stringify(ctx.verdictStore),before);
  await ctx.SafetyRuntime.requestReferences();assert.equal(calls,1);assert.equal(counts.evaluated,1);
  current=false;assert.equal(ctx.SafetyRuntime.standardReport().tag_search.status,'stale');
  assert.equal(ctx.SafetyRuntime.standardReport().rows[0].tag_sources.length,0);
  await assert.rejects(ctx.SafetyRuntime.requestReferences(),/다시 분석/);
  ctx.SafetyRuntime.installReferences({rows:{},tag_rows:{},tag_status:'unqueried'},()=>true,{load:()=>new Promise(r=>resolve=r),cancel:()=>cancels++});
  const late=ctx.SafetyRuntime.requestReferences();ctx.SafetyRuntime.cancelReferences();resolve({tag_rows:{'CMN-19':[{title:'늦은 이전 결과'}]}});
  await assert.rejects(late,{name:'AbortError'});assert.equal(ctx.SafetyRuntime.standardReport().rows[0].tag_sources.length,0);assert.ok(cancels>0);
});
test('reference failure remains explicit and can retry without losing current automatic decisions',async()=>{
  const {ctx}=runtime();ctx.AnalysisRuntime={};ctx.legalOpinionKnowledge=ctx.knowledge;let calls=0;
  ctx.SafetyRuntime.installReferences({rows:{},tag_rows:{},tag_status:'unqueried'},()=>true,{load:()=>{if(++calls===1)return Promise.reject(Error('검색 실패'));return Promise.resolve({tag_rows:{}});}});
  ctx.verdictStore=ctx.SafetyRuntime.apply({});await assert.rejects(ctx.SafetyRuntime.requestReferences(),/검색 실패/);
  assert.equal(ctx.SafetyRuntime.standardReport().tag_search.status,'error');assert.equal(ctx.verdictStore['CMN-19'].verdict,'이상없음');
  await ctx.SafetyRuntime.requestReferences();assert.equal(ctx.SafetyRuntime.standardReport().tag_search.status,'ready');
});
test('source mutation during pending lookup rejects late candidates; installing a new analysis cannot accept old results',async()=>{
  const {ctx}=runtime();ctx.AnalysisRuntime={};ctx.legalOpinionKnowledge=ctx.knowledge;let valid=true,resolve;
  const value={rows:{},tag_rows:{},tag_status:'unqueried'};
  ctx.SafetyRuntime.installReferences(value,()=>valid,{load:()=>new Promise(r=>resolve=r)});
  const p=ctx.SafetyRuntime.requestReferences();valid=false;resolve({tag_rows:{'CMN-19':[{title:'stale'}]}});
  await assert.rejects(p,{name:'AbortError'});assert.equal(ctx.SafetyRuntime.standardReport().rows[0].tag_sources.length,0);
  valid=true;ctx.SafetyRuntime.installReferences(value,()=>true,{load:()=>new Promise(r=>resolve=r)});
  const previous=ctx.SafetyRuntime.requestReferences();ctx.SafetyRuntime.installReferences({...value,tag_status:'ready',tag_rows:{'CMN-19':[{title:'new'}]}},()=>true);
  resolve({tag_rows:{'CMN-19':[{title:'old'}]}});await assert.rejects(previous,{name:'AbortError'});
  assert.equal(ctx.SafetyRuntime.standardReport().rows[0].tag_sources[0].title,'new');
});
test('partial reassignment evaluates only the selected check, preserves unrelated proofs/manuals and respects contract-wide opt-out',()=>{
  const {ctx,counts,cp}=runtime(),price=check('CMN-05');ctx.CR.common.checks.push(price);
  ctx.state.result.checkpoints.push(price);ctx.state.result.results.push({cpId:price.id,coverage:'quiet'});
  ctx._cpById=id=>ctx.state.result.checkpoints.find(c=>c.id===id);ctx.resultFor=c=>ctx.state.result.results.find(r=>r.cpId===c.id);
  const unrelated={verdict:'이상없음',origin:'auto',auto_proof:{sentinel:'keep'}};
  let result=ctx.SafetyRuntime.applyChecks({[price.id]:unrelated},[cp.id]);assert.equal(counts.evaluated,1);assert.equal(result[price.id],unrelated);assert.equal(result[cp.id].verdict,'이상없음');
  ctx.state.result.results[0].opinionScope='contract';result=ctx.SafetyRuntime.applyChecks(result,[cp.id]);
  assert.equal(counts.evaluated,2);assert.notEqual(result[cp.id]?.verdict,'이상없음');assert.equal(result[price.id],unrelated);
  ctx.state.result.results[0].opinionScope=null;result[cp.id]={verdict:'검토의견',origin:'manual',comment:'당사자 협의 필요'};
  result=ctx.SafetyRuntime.applyChecks(result,[cp.id]);assert.equal(result[cp.id].comment,'당사자 협의 필요');assert.equal(result[cp.id].origin,'manual');assert.equal(result[price.id],unrelated);
});
test('Worker-enabled apply/report never rebuild imported hints on the page, and stale references are cleared',()=>{
  const {ctx}=runtime();let current=true;ctx.AnalysisRuntime={};ctx.legalOpinionKnowledge=ctx.knowledge;
  ctx.JudgmentHints={...Hints,index(){throw Error('main-thread corpus indexing is prohibited');}};
  ctx.JudgmentSources={compile(){throw Error('main-thread source compilation is prohibited');}};
  ctx.DecisionReferences={retrieve(){throw Error('main-thread reference indexing is prohibited');}};
  ctx.SafetyRuntime.installReferences({rows:{'CMN-19':[{source_id:'worker-hint'}]},tag_rows:{'CMN-19':[{source_id:'worker-tag'}]},stats:{raw_packets:19}},()=>current);
  const first=ctx.SafetyRuntime.apply({});assert.equal(first['CMN-19'].verdict,'이상없음');
  let report=ctx.SafetyRuntime.standardReport();assert.equal(report.source_connections.raw_packets,19);assert.equal(report.rows[0].hint_sources[0].source_id,'worker-hint');assert.equal(report.rows[0].tag_sources[0].source_id,'worker-tag');
  current=false;ctx.knowledge.documents.changed={evidence:[{sentence:'새 자료'}]};
  const second=ctx.SafetyRuntime.apply(first);assert.equal(second['CMN-19'].verdict,'이상없음','current document recognition continues independently');
  report=ctx.SafetyRuntime.standardReport();assert.equal(report.source_connections.preparing,true);assert.equal(report.rows[0].hint_sources.length,0);assert.equal(report.rows[0].tag_sources.length,0);
});
function check(id){const row=inventory.find(r=>r.id===id);return {id,check:row.question,meaning_revision:row.meaning_revision};}
function runtime(id='CMN-19',text=court){
  const cp=check(id),events={},counts={compiled:0,evaluated:0},inputs=[],ctx={
    ReviewCore:Core,SafetyDigest:Digest,DocumentStructure:D,JudgmentHints:Hints,Verdict,TextEncoder,
    SafetyWorkbench:{empty:()=>({rules:{},format:'test'}),sealed:()=>true},
    localStorage:{getItem:()=>null,setItem:()=>{}},MatcherConfig:{TAG_MATCH_MODE:'assist'},CR:{engine_fingerprint:'189',common:{checks:[cp]},types:[]},
    state:{typeId:'outsourcing',text,analyzedText:text,partyRoles:[],stance:'party',reassign:{},activeModules:[],clauses:[],result:{checkpoints:[cp],results:[{cpId:id,coverage:'quiet'}]}},
    verdictStore:{},verdictHash:'current',loopCorpus:{},knowledge:{latest:{},documents:{},tags:{}},rawDocuments:[{name:'본문',text}],packets:[],
    verdictToday:()=> '2026-09-18',scopeSourceDocs:()=>[],currentHistoryKnowledge:()=>ctx.knowledge,safetyDocuments:()=>ctx.rawDocuments,
    document:{getElementById:()=>({get value(){return ctx.state.text;},addEventListener:(name,fn)=>{(events[name]||(events[name]=[])).push(fn);}}),body:{classList:{contains:()=>false}}},
    window:{addEventListener:()=>{}},setInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{},
    _cpById:key=>key===id?cp:null,resultFor:()=>ctx.state.result.results[0],
    JudgmentSources:{compile:(...args)=>{counts.compiled++;return Sources.compile(...args);}},
    StandardAuto:{evaluate:(c,r,input)=>{counts.evaluated++;inputs.push(input);return Standard.evaluate(c,r,input);},ticketFromEvaluation:Standard.ticketFromEvaluation},
    TemplateLibraryRuntime:{packets:()=>ctx.packets,apply:value=>value},
    DecisionReferences:{retrieve:()=>[]},applyAutoVerdicts:()=>{},renderClauses:()=>{},renderReport:()=>{},saveVerdicts:()=>{}
  };
  vm.createContext(ctx);vm.runInContext(runtimeSource,ctx);return {ctx,cp,counts,inputs};
}

test('v1.89 참고 화면은 실제 검색 결과를 재사용하고 제자리 근거·태그 변경 시 다시 검색한다',()=>{
  const doc={source_id:'a',source_kind:'contract_review',title:'검토자료',evidence:[{sentence:'서버 백업 복구'}],tags:[]};
  const knowledge={latest:{a:'a'},documents:{a:doc}};let calls=0;
  const ctx={state:{text:'서버 백업 복구',docTitle:''},contractReferenceCache:null,currentHistoryKnowledge:()=>knowledge,document:{getElementById:()=>({value:''})},esc:x=>String(x??''),
    HistoryAssist:{retrieve:(...args)=>{calls++;return History.retrieve(...args);}}};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function contractReviewReferenceHtml()'),app.indexOf('\nfunction renderContractReviewReference()')),ctx);
  ctx.contractReviewReferenceHtml();assert.equal(ctx.contractReferenceCache.related.length,1);ctx.contractReviewReferenceHtml();assert.equal(calls,1);
  doc.evidence[0].sentence='관할 법원 지정';ctx.contractReviewReferenceHtml();assert.equal(calls,2);assert.equal(ctx.contractReferenceCache.related.length,0);
  doc.tags.push({type:'쟁점',label:'서버 백업'});ctx.contractReviewReferenceHtml();assert.equal(calls,3);assert.equal(ctx.contractReferenceCache.related.length,1);assert.equal(ctx.contractReferenceCache.tagged,1);
  doc.source_kind='legal_review';ctx.contractReviewReferenceHtml();assert.equal(ctx.contractReferenceCache.docs.length,0);assert.equal(ctx.contractReferenceCache.related.length,0);
});

test('v1.89 런타임 상위 출처 캐시도 버전 변경 없는 수기 의견 수정·자동출력 전환을 감지한다',()=>{
  const {ctx,counts}=runtime(),v={origin:'manual',verdict:'이상없음',reason:'반영되어 있음',comment:'서울중앙지방법원을 관할법원으로 한다.'};
  ctx.loopCorpus={judgment_ledger:{records:{old:{snapshot:{meta:{title:'기존 의견'},verdicts:{'CMN-19':v}}}}}};
  const first=ctx.SafetyRuntime.judgmentHints();assert.equal(first.rows.length,1);assert.equal(ctx.SafetyRuntime.judgmentHints(),first);assert.equal(counts.compiled,1);
  ctx.SafetyRuntime.apply({});assert.equal(counts.evaluated,1);
  v.comment='부산지방법원을 관할법원으로 한다.';
  const changed=ctx.SafetyRuntime.judgmentHints();assert.notEqual(changed,first);assert.equal(changed.rows[0].text,v.comment);assert.equal(counts.compiled,2);
  ctx.SafetyRuntime.apply({});assert.equal(counts.evaluated,2);assert.equal(counts.compiled,2);
  v.origin='auto';assert.equal(ctx.SafetyRuntime.judgmentHints().rows.length,0);assert.equal(counts.compiled,3);
});

test('v1.89 런타임 불변 문서 스냅샷은 원본을 얼리지 않고 같은 추출객체의 중첩 변경을 무효화한다',()=>{
  const {ctx,counts,inputs}=runtime(),extraction=D.fromBlocks('docx',[{text:court,source:{paragraph:0}}],[]);
  ctx.rawDocuments=[D.document('본문',extraction.text,extraction)];ctx.state.text=ctx.state.analyzedText=extraction.text;
  ctx.SafetyRuntime.apply({});const first=inputs[0].documents;
  assert.equal(Object.isFrozen(first),true);assert.equal(Object.isFrozen(first[0].extraction.blocks[0].source),true);
  assert.equal(Object.isFrozen(ctx.rawDocuments),false);assert.equal(Object.isFrozen(extraction.blocks[0].source),false);
  assert.notEqual(first[0].extraction,extraction);ctx.SafetyRuntime.apply({});assert.equal(counts.evaluated,1);
  extraction.blocks[0].source.paragraph=77;ctx.SafetyRuntime.apply({});assert.equal(counts.evaluated,2);
  const second=inputs[1].documents;assert.notEqual(second,first);assert.equal(first[0].extraction.blocks[0].source.paragraph,0);assert.equal(second[0].extraction.blocks[0].source.paragraph,77);
  extraction.blocks[0].source.part='추가 출처';ctx.SafetyRuntime.apply({});assert.equal(counts.evaluated,3);assert.equal(inputs[2].documents[0].extraction.blocks[0].source.part,'추가 출처');
});

test('v1.89 태그 별칭 제자리 변경은 상위 prepared/decision 캐시를 갱신하여 과거 통과를 재사용하지 않는다',()=>{
  const {ctx,cp,counts,inputs}=runtime('PRIV-19','수탁자는 개인정보를 비가독화처리하여 저장한다.');
  ctx.knowledge.tags={encryption:{type:'content',label:'암호화',aliases:['비가독화처리']}};
  let result=ctx.SafetyRuntime.apply({});assert.equal(result[cp.id].verdict,'이상없음');const first=inputs[0];ctx.SafetyRuntime.apply({});assert.equal(counts.evaluated,1);
  ctx.knowledge.tags.encryption.aliases[0]='다른 표현';result=ctx.SafetyRuntime.apply(result);
  assert.notEqual(inputs[1],first);assert.equal(counts.evaluated,2);assert.notEqual(result[cp.id]?.verdict,'이상없음');assert.equal(ctx.state.result.results[0].standardEvidence.eligible,false);
  ctx.knowledge.tags.encryption.aliases.push('비가독화처리');result=ctx.SafetyRuntime.apply(result);assert.equal(counts.evaluated,3);assert.equal(result[cp.id].verdict,'이상없음');
});

test('v1.89 표준 UI input 캐시는 동일 extraction 객체의 중첩 변경 때 불변 prepare를 새로 생성한다',()=>{
  const cp=check('CMN-19'),source=fs.readFileSync(require.resolve('../src/template_library_ui'),'utf8'),extraction=D.fromBlocks('docx',[{text:court,source:{paragraph:0}}],[]);
  const lib={templates:[{active:true,registration:{mode:'automatic',version:16},bindings:[{check_id:cp.id}]}]},counts={prepare:0,evaluate:0},inputs=[];
  const ctx={SafetyDigest:Digest,DocumentStructure:D,ReviewCore:Core,loopCorpus:{},state:{text:extraction.text,result:{checkpoints:[cp]}},
    localStorage:{getItem:()=>JSON.stringify(lib)},document:{getElementById:()=>({value:extraction.text})},TemplateRegister:{VERSION:16},
    TemplateLibrary:{empty:Library.empty,validate:x=>x,prepare:p=>{counts.prepare++;return Library.prepare(p);},evaluate:(l,c,r,p)=>{counts.evaluate++;inputs.push(p);return {eligible:false,evidence:[]};}},
    SafetyRuntime:{allChecks:()=>[cp],templateScope:()=>({type:'outsourcing'})},TemplateAssist:{sourceStates:()=>({})},
    safetyDocuments:()=>[{name:'본문',text:extraction.text,extraction}],resultFor:()=>({cpId:cp.id,coverage:'quiet'}),CR:{types:[]},verdictToday:()=> '2026-09-18'};
  vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('  function render()'))+'return {apply:apply};})();',ctx);
  ctx.TemplateLibraryRuntime.apply({});ctx.TemplateLibraryRuntime.apply({});assert.deepEqual(counts,{prepare:1,evaluate:1});
  const first=inputs[0];assert.equal(Object.isFrozen(first.documents[0].extraction.blocks[0].source),true);assert.equal(Object.isFrozen(extraction),false);
  extraction.blocks[0].source.paragraph=88;ctx.TemplateLibraryRuntime.apply({});assert.deepEqual(counts,{prepare:2,evaluate:2});assert.notEqual(inputs[1],first);
  assert.equal(first.documents[0].extraction.blocks[0].source.paragraph,0);assert.equal(inputs[1].documents[0].extraction.blocks[0].source.paragraph,88);
});
