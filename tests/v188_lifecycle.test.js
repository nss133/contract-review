const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const Core=require('../src/review_core'),Verdict=require('../src/verdict'),Digest=require('../src/safety_digest');
const runtimeSource=fs.readFileSync(require.resolve('../src/safety_runtime'),'utf8');
const appSource=fs.readFileSync(require.resolve('../src/app'),'utf8');
const cp={id:'CMN-19',check:'관할 약정이 있는가?',meaning_revision:'v188-presence-1',severity:'참고',triggers:{keywords:['관할','법원']}};
function automatic(evidence){return {origin:'auto',verdict:'이상없음',auto_proof:{evidence}};}
test('짧은 VAT 표기와 본문 내 별첨의 실제 위치를 완료 열에 연결한다',()=>{
  const text='제1조 대금\nVAT 별도\n별첨 1 보안약정\n제1조 관할\n서울중앙지방법원을 관할법원으로 한다.';
  const clauses=require('../src/segmenter').segmentContract(text),docs=[{name:'본문',text}];
  const v=automatic([{document:'본문',document_index:0,text:'VAT 별도',start:7,end:13}]);
  assert.equal(Core.completionAnchor({coverage:'quiet'},v,clauses,docs),clauses.find(c=>c.body.includes('VAT')).index);
  const quote='서울중앙지방법원을 관할법원으로 한다.',start=text.indexOf(quote);
  const annex=automatic([{document:'본문',document_index:0,text:quote,start,end:start+quote.length,section:'제1조 관할'}]);
  assert.equal(Core.completionAnchor({coverage:'consider'},annex,clauses,docs),clauses.find(c=>c.body.includes('서울중앙')).index);
});
test('외부 별첨 근거는 본문으로 오인하지 않고 별첨 원문 주소를 보존한다',()=>{
  const docs=[{name:'본문',text:'업무를 위탁한다.'},{name:'보안약정',text:'제10조 감독\n갑은 점검할 수 있다.'}],quote='갑은 점검할 수 있다.';
  const v=automatic([{document:'보안약정',document_index:1,text:quote,start:8,end:8+quote.length}]);
  const locations=Core.completionLocations(v,docs);
  assert.equal(locations[0].document,1);assert.equal(locations[0].text,quote);
  assert.equal(Core.completionAnchor({coverage:'quiet'},v,[{index:0,body:docs[0].text}],docs),null);
  assert.deepEqual(Core.completionLocations(automatic([{document:'보안약정',document_index:1,text:'없는 근거'}]),docs),[]);
});
test('명시적 원문 주소가 같은 짧은 인용의 중복을 구별한다',()=>{
  const text='제1조 대금\nVAT 별도\n제2조 대가\nVAT 별도',docs=[{name:'본문',text}],clauses=require('../src/segmenter').segmentContract(text);
  const start=text.lastIndexOf('VAT 별도'),v=automatic([{document:'본문',document_index:0,text:'VAT 별도',start,end:start+6}]);
  assert.equal(Core.completionAnchor({coverage:'quiet'},v,clauses,docs),1);
  assert.deepEqual(Core.completionLocations(automatic([{document:'본문',text:'VAT 별도'}]),docs),[]);
});
test('수기 의존은 관련 원문·의미 버전만 추적하고 무관 조항/표시 문구/DB는 제외한다',()=>{
  const docs=[{name:'본문',text:'제1조 관할\n서울중앙지방법원을 관할법원으로 한다.\n제2조 납품\n납품 장소는 서울이다.'}],scope={type:'service',roles:[],stance:'party'};
  const key=(c,d,s=scope)=>Digest.of(Core.manualDependency(c,d,s));
  const original=key(cp,docs);
  assert.equal(key({...cp,check:'관할 지정 내용 확인',label:'새 표시'},docs),original);
  assert.equal(key(cp,[{...docs[0],text:docs[0].text.replace('납품 장소는 서울이다.','납품 장소는 부산이다.')}]),original);
  assert.equal(key(cp,docs,{...scope,title:'새 제목',tag_mode:'new',reassign:{OTHER:3}}),original);
  assert.notEqual(key(cp,[{...docs[0],text:docs[0].text.replace('서울중앙지방법원','부산지방법원')}]),original);
  assert.notEqual(key({...cp,meaning_revision:'new-meaning'},docs),original);
});
test('수기 의미 지문과 동시 편집 의견은 저장 정규화·사유 변경에서 보존한다',()=>{
  const original={A:{verdict:'이상없음',origin:'manual',manual_context_v3:'meaning-key',concurrent_edits:[{verdict:'검토의견',comment:'다른 탭'}],needs_reconfirmation:true}};
  const normalized=Verdict.migrateStore(Verdict.setReason(original,'A','반영되어 있음'));
  assert.equal(normalized.A.manual_context_v3,'meaning-key');assert.equal(normalized.A.concurrent_edits[0].comment,'다른 탭');assert.equal(normalized.A.needs_reconfirmation,true);
});
test('새 유효 티켓 통과 후 과거 보류는 현재 완료를 막지 않고 별도 기록으로 보존된다',()=>{
  const quote='VAT 별도',context={require:require('node:module').createRequire(require.resolve('../src/verdict')),StandardAuto:{consume:()=>({evidence:[{document:'본문',text:quote}]})}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../src/verdict'),'utf8'),context);
  const V=context.Verdict,previous={A:{verdict:'이상없음',origin:'auto',comment:'이전 근거',date:'old'}},held=V.migrateStore(previous);
  const current=V.applyStandard(held,'A','today',{});
  assert.equal(current.A.verdict,'이상없음');assert.equal(current.A.safety_hold,undefined);assert.equal(current.A.previous_system_review.previous.comment,'이전 근거');
  assert.equal(Core.completionAnchor({coverage:'quiet'},current.A,[{index:0,body:quote}]),0);
  assert.equal(V.migrateStore(current).A.previous_system_review.previous.comment,'이전 근거');
});
function runtime(){
  const counters={prepared:0,compiled:0,evaluated:0,approved:0},events={},intervals=[],storage={};
  const ctx={ReviewCore:Core,SafetyDigest:Digest,TextEncoder,console,Map,Set,
    SafetyWorkbench:{empty:()=>({rules:{},format:'test'}),sealed:()=>true,ticket:()=>{counters.approved++;return {};}},
    localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v},
    MatcherConfig:{TAG_MATCH_MODE:'shadow'},CR:{engine_fingerprint:'188',common:{checks:[cp]},types:[]},
    state:{typeId:'service',text:'제1조 관할\n서울중앙지방법원을 관할법원으로 한다.',partyRoles:[],stance:'party',reassign:{},activeModules:[],clauses:[],result:{checkpoints:[cp],results:[{cpId:cp.id,coverage:'quiet'}]}},
    verdictStore:{},verdictHash:'contract',legalOpinionKnowledge:{},reviewHistory:{},loopCorpus:{},knowledge:{},
    verdictToday:()=> '2026-09-18',scopeSourceDocs:()=>[],currentHistoryKnowledge:()=>ctx.knowledge,
    safetyDocuments:()=>[{name:'본문',text:ctx.state.text}],
    document:{getElementById:()=>({get value(){return ctx.state.text;},addEventListener:()=>{}}),body:{classList:{contains:()=>false}}},
    window:{addEventListener:(name,fn)=>{(events[name]||(events[name]=[])).push(fn);}},setInterval:fn=>intervals.push(fn),
    _cpById:id=>ctx.state.result.checkpoints.find(c=>c.id===id),resultFor:c=>ctx.state.result.results.find(r=>r.cpId===c.id),
    HumanPrecedent:{prepare:p=>{counters.prepared++;return Object.assign(p,{judgment_sources:{stats:{}}});}},
    JudgmentSources:{compile:(packets,corpus,knowledge)=>{counters.compiled++;return require('../src/judgment_sources').compile(packets,corpus,knowledge);}},
    StandardAuto:{evaluate:(c,r,i)=>{counters.evaluated++;return {eligible:i.confirmed,check_id:c.id,status:'eligible',evidence:[{document:'본문',text:i.documents[0].text}]};},ticketFromEvaluation:(c,r,i,value)=>({id:c.id,proof:value}),},
    Verdict:{migrateStore:v=>JSON.parse(JSON.stringify(v)),applyStandard:(v,id,date,t)=>v[id]?.verdict&&v[id].origin!=='auto'?v:Object.assign({},v,{[id]:{verdict:'이상없음',origin:'auto',auto_proof:t.proof}})},
    DecisionReferences:{retrieve:()=>[]},applyAutoVerdicts:()=>{ctx.verdictStore=ctx.SafetyRuntime.apply(ctx.verdictStore);},renderClauses:()=>{},renderReport:()=>{},saveVerdicts:()=>{}
  };
  vm.createContext(ctx);vm.runInContext(runtimeSource,ctx);return {ctx,counters,intervals,storage,events};
}
test('같은 본건의 재렌더·리포트는 한 번의 검색/판정 결과를 재사용한다',()=>{
  const {ctx,counters,intervals}=runtime();
  ctx.SafetyRuntime.apply({});ctx.SafetyRuntime.apply({});ctx.SafetyRuntime.standardReport();
  assert.equal(counters.prepared,0);assert.equal(counters.compiled,1);assert.equal(counters.evaluated,1);
  intervals.forEach(fn=>fn());assert.equal(counters.compiled,1);assert.equal(counters.evaluated,1);
  ctx.knowledge={newRevision:true};ctx.SafetyRuntime.apply({});assert.equal(counters.compiled,2);
  ctx.state.text+='\n관할은 추후 변경할 수 있다.';ctx.SafetyRuntime.apply({});assert.equal(counters.compiled,2);assert.equal(counters.evaluated,3);
});
test('전체 이력의 판정 수집 없이 데이터셋별 출처·태그 색인만 생성하고 현재 문서 전환에 재사용한다',()=>{
  const {ctx,counters,intervals}=runtime(),packets=Array.from({length:250},(_,i)=>({id:'packet-'+i,review_id:'review-'+i,
    documents:[{name:'과거 계약',text:'제1조 관할\n부산지방법원을 관할법원으로 한다.'}],context:{type:'service'},checks:[cp],
    verdicts:{[cp.id]:{origin:'manual',verdict:'검토의견',comment:'과거 사람이 수정한 의견'}}}));
  let indexed=0;
  ctx.HumanPrecedent.prepare=()=>{throw Error('현재 판정에서 전체 과거판정 collect를 호출하면 안 됨');};
  ctx.TemplateLibraryRuntime={packets:()=>packets,apply:v=>v};
  ctx.JudgmentHints={index:()=>({revision:++indexed}),retrieve:()=>[]};
  const first=ctx.SafetyRuntime.standardReport();assert.equal(first.source_connections.raw_packets,250);assert.equal(indexed,1);
  for(let i=0;i<10;i++){ctx.state.text='제1조 관할\n서울중앙지방법원을 관할법원으로 한다.\n문서 '+i;ctx.state.docTitle='새 제목 '+i;ctx.verdictHash='new-'+i;ctx.SafetyRuntime.apply({});}
  intervals.forEach(fn=>fn());assert.equal(counters.compiled,1);assert.equal(indexed,1);assert.equal(counters.prepared,0);
  ctx.knowledge.revision=2;ctx.SafetyRuntime.apply({});assert.equal(counters.compiled,2);assert.equal(indexed,2);
  ctx.loopCorpus.judgment_ledger={records:{}};ctx.SafetyRuntime.apply({});assert.equal(counters.compiled,3);
  packets.push({...packets[0],id:'new-packet'});assert.equal(ctx.SafetyRuntime.standardReport().source_connections.raw_packets,251);assert.equal(counters.compiled,4);
});
test('Worker 없는 독립 런타임 어댑터는 같은 자료 버전의 태그 색인을 한 번만 생성한다',()=>{
  const {ctx,counters}=runtime(),J=require('../src/judgment_hints'),built=J.buildCount();
  ctx.JudgmentHints=J;
  // v1.90 UI mapping moved into the worker. This standalone adapter remains
  // supported for pure engine callers; worker boundary tests live in v190_*.
  const mappingIndex=()=>ctx.SafetyRuntime.judgmentHints();
  const first=mappingIndex();assert.equal(first,ctx.SafetyRuntime.judgmentHints());
  ctx.SafetyRuntime.apply({});ctx.SafetyRuntime.standardReport();assert.equal(mappingIndex(),first);
  assert.equal(J.buildCount()-built,1);assert.equal(counters.compiled,1);
  ctx.knowledge={revision:2,documents:{},latest:{}};
  const second=mappingIndex();assert.notEqual(second,first);ctx.SafetyRuntime.apply({});ctx.SafetyRuntime.standardReport();
  assert.equal(ctx.SafetyRuntime.judgmentHints(),second);assert.equal(J.buildCount()-built,2);assert.equal(counters.compiled,2);
  assert(J.index({knowledge:ctx.knowledge,corpus:ctx.loopCorpus}),'런타임 없는 단독 매핑의 기존 색인 경로도 유지');
});
test('화면·리포트 사유 편집은 캐시된 자동 근거와 다음 티켓·출처 통계를 변조하지 않는다',()=>{
  const {ctx,counters}=runtime(),manual={[cp.id]:{origin:'manual',verdict:'검토의견',comment:'직접 쓴 의견'}};
  ctx.SafetyRuntime.apply({});const quote=ctx.state.text;
  const row=ctx.state.result.results[0];row.standardEvidence.eligible=false;row.standardEvidence.evidence[0].text='화면에서 바꾼 문구';
  const report=ctx.SafetyRuntime.standardReport();report.rows[0].evidence[0].text='리포트에서 바꾼 문구';report.source_connections.raw_packets=999;
  const next=ctx.SafetyRuntime.apply(manual);assert.equal(next[cp.id].comment,'직접 쓴 의견');assert.equal(row.standardEvidence.evidence[0].text,quote);
  const automatic=ctx.SafetyRuntime.apply({});assert.equal(automatic[cp.id].auto_proof.evidence[0].text,quote);
  automatic[cp.id].auto_proof.evidence[0].text='저장 객체에서 바꾼 문구';assert.equal(ctx.SafetyRuntime.apply({})[cp.id].auto_proof.evidence[0].text,quote);
  assert.equal(ctx.SafetyRuntime.standardReport().source_connections.raw_packets,0);assert.equal(counters.evaluated,1);assert.equal(counters.compiled,1);
});
test('참고 DB 갱신·옛 의견·재연결은 수기 완료를 덮거나 자동판정을 일괄 차단하지 않는다',()=>{
  const {ctx,counters}=runtime(),key=ctx.SafetyRuntime.manualInputKeyV3(cp.id),fingerprint=ctx.SafetyRuntime.engineFingerprint();
  const manual={[cp.id]:{verdict:'검토의견',comment:'검토자 최종 의견',origin:'manual',manual_context_v3:key}};
  ctx.knowledge={updated:true};ctx.loopCorpus={updated:true};ctx.state.reassign[cp.id]=0;ctx.legacyIssue=()=>true;
  const next=ctx.SafetyRuntime.apply(manual);
  assert.equal(next[cp.id].verdict,'검토의견');assert.equal(next[cp.id].comment,'검토자 최종 의견');assert.equal(next[cp.id].needs_reconfirmation,undefined);
  assert.equal(ctx.SafetyRuntime.engineFingerprint(),fingerprint);assert.equal(counters.evaluated,1);
  assert.equal(ctx.SafetyRuntime.apply({})[cp.id].verdict,'이상없음');
});
test('입력 문구만 갱신되고 조항 재분석이 아직 끝나지 않으면 새 자동 완료를 만들지 않는다',()=>{
  const {ctx}=runtime();ctx.state.analyzedText=ctx.state.text;
  assert.equal(ctx.SafetyRuntime.apply({})[cp.id].verdict,'이상없음');
  ctx.state.text+='\n아직 분석하지 않은 새 문장';
  assert.equal(ctx.SafetyRuntime.apply({})[cp.id],undefined);
  assert.equal(ctx.SafetyRuntime.standardPacket(),null);
});
test('저장된 옛 승인 원장이 공통 엔진을 우회하여 판정하지 못한다',()=>{
  const {ctx,counters}=runtime();ctx.SafetyWorkbench.empty=()=>({rules:{old:{check_id:cp.id}}});
  ctx.SafetyRuntime.apply({});assert.equal(counters.approved,0);
  assert(!runtimeSource.includes('SafetyWorkbench.ticket('));
});
test('제외 ID·이행 전용·범위 밖 체크는 미결에서 제외하고 옛 의견 자체는 완료를 막지 않는다',()=>{
  const checks={live:{id:'live',severity:'참고'},old:{id:'old',active:false},execution:{id:'execution',review_scope:'execution_only'}};
  const ctx={ReviewCore:Core,_cpById:id=>checks[id],verdictStore:{},state:{},legacyIssue:()=>true,ActionRouter:{requiresDecision:()=>false},actionForResult:()=>({}),reviewRouteFor:()=>({route:'normal'})};
  vm.createContext(ctx);vm.runInContext(appSource.slice(appSource.indexOf('function _requiresDecision('),appSource.indexOf('// v1.69 별도')),ctx);
  for(const id of ['old','execution','missing'])assert.equal(ctx._requiresDecision({cpId:id,coverage:'consider'}),false);
  assert.equal(ctx._requiresDecision({cpId:'live',coverage:'quiet'}),false);
  assert.equal(ctx._requiresDecision({cpId:'live',coverage:'consider',roleGated:true}),false);
});
test('다른 탭의 최신 수기 저장은 보존하고 같은 항목의 충돌은 양쪽 의견을 남긴다',()=>{
  const data={},ctx={Verdict,Loop:{judgmentTags:()=>({})},verdictHash:'h',_verdictSavedSnapshot:{},verdictStore:{},localStorage:{getItem:k=>data[k]||null,setItem:(k,v)=>data[k]=v}};
  vm.createContext(ctx);vm.runInContext(appSource.slice(appSource.indexOf('function saveVerdicts()'),appSource.indexOf('function findingKey(')),ctx);
  data[Verdict.verdictKey('h')]=JSON.stringify({A:{verdict:'검토의견',origin:'manual',comment:'다른 탭'}});
  ctx.verdictStore={A:{verdict:'이상없음',origin:'auto'}};ctx.saveVerdicts();assert.equal(ctx.verdictStore.A.comment,'다른 탭');
  ctx.verdictStore.A=Verdict.setVerdict(ctx.verdictStore,'A','이상없음','현재 탭','today','반영되어 있음').A;
  data[Verdict.verdictKey('h')]=JSON.stringify({A:{verdict:'검토의견',origin:'manual',comment:'다른 탭 추가 수정'}});
  ctx.saveVerdicts();assert.equal(ctx.verdictStore.A.comment,'현재 탭');assert.equal(ctx.verdictStore.A.needs_reconfirmation,true);assert.equal(ctx.verdictStore.A.concurrent_edits[0].comment,'다른 탭 추가 수정');
  data[Verdict.verdictKey('h')]='{}';ctx.saveVerdicts();assert.equal(ctx.verdictStore.A,undefined);
});
test('승인·2인 검수 UI는 기본 업무에서 숨기고 자료의 원문 보기만 제공한다',()=>{
  const html=fs.readFileSync(require.resolve('../src/template.html'),'utf8');
  for(const id of ['ep-advanced','ap-panel','safety-workbench'])assert.match(html,new RegExp('<[^>]*id="'+id+'"[^>]*hidden'));
  assert.match(html,/id="auto-evidence-dialog"/);
});
test('표준 경로도 과거 의견/재연결로 막지 않으며 캐시를 재사용하고 매핑을 변조하지 않는다',()=>{
  const source=fs.readFileSync(require.resolve('../src/template_library_ui'),'utf8');
  const counters={prepare:0,evaluate:0,sources:0},lib={templates:[{active:true,registration:{mode:'automatic',version:16},bindings:[{check_id:cp.id,variants:[{source:{id:'prior'}}]}]}]};
  const ctx={SafetyDigest:Digest,ReviewCore:Core,Map,Set,loopCorpus:{},document:{getElementById:()=>({get value(){return ctx.state.text;}})},localStorage:{getItem:()=>JSON.stringify(lib)},
    TemplateLibrary:{empty:()=>({templates:[]}),validate:x=>x,prepare:p=>{counters.prepare++;return p;},evaluate:(l,c,r,p)=>{counters.evaluate++;return {eligible:true,evidence:[{document:'본문',text:p.documents[0].text}]};},ticketFromEvaluation:(l,c,r,p,v)=>v},TemplateRegister:{VERSION:16},
    TemplateAssist:{sourceStates:()=>{counters.sources++;return {prior:'source-hash'};}},
    SafetyRuntime:{allChecks:()=>[cp],templateScope:()=>({type:'service'})},
    state:{text:'관할 약정',reassign:{[cp.id]:0},result:{checkpoints:[cp],results:[{cpId:cp.id,coverage:'quiet',standardEvidence:{status:'historical_conflict'}}]}},
    CR:{types:[]},legacyIssue:()=>true,verdictToday:()=> 'today',
    safetyDocuments:()=>[{name:'본문',text:ctx.state.text}],resultFor:c=>ctx.state.result.results.find(r=>r.cpId===c.id),
    Verdict:{applyTemplate:(v,id,d,t)=>v[id]?.origin==='manual'?v:Object.assign({},v,{[id]:{verdict:'이상없음',origin:'auto',auto_proof:t}})}
  };
  vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('  function render()'))+'return {apply:apply,mapResult:mapResult};})();',ctx);
  assert.equal(ctx.TemplateLibraryRuntime.apply({})[cp.id].verdict,'이상없음');ctx.TemplateLibraryRuntime.apply({});
  assert.deepEqual(counters,{prepare:1,evaluate:1,sources:1});
  const row=ctx.state.result.results[0],before=JSON.stringify(row);ctx.TemplateLibraryRuntime.mapResult(row);assert.equal(JSON.stringify(row),before);
  const manual={[cp.id]:{verdict:'검토의견',origin:'manual',comment:'수기판정'}};
  assert.equal(ctx.TemplateLibraryRuntime.apply(manual)[cp.id].comment,'수기판정');
  ctx.SafetyRuntime.standardAllowed=()=>false;
  assert.equal(ctx.TemplateLibraryRuntime.apply({})[cp.id],undefined);
  assert.equal(ctx.state.result.results[0].templateEvidence.status,'stopped');
});
test('내부 평가의 불일치는 자동판정 전역 중지 설정을 변경하지 않는다',()=>{
  const archive=fs.readFileSync(require.resolve('../src/standard_auto_archive'),'utf8');
  assert(!archive.includes('SafetyRuntime.stopStandard('));
  assert.match(archive,/현재 판정·중지 설정은 변경하지 않았습니다/);
});
