'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/app'),'utf8');
function harness(){
  const events={},calls=[],select={value:'1',dataset:{optionsReady:'true'},getAttribute:()=> 'A',addEventListener:(n,f)=>events[n]=f};
  const ctx={state:{reassign:{},matchConfirm:{},result:{},clauses:[{},{}]},window:{scrollY:12,scrollTo(){}},document:{},
    REASSIGN_CONFIRM:'__confirm__',REASSIGN_CONTRACT:'__contract__',saveReassign:()=>calls.push('save-placement'),saveMatchConfirm(){},
    canUpdateCheck:()=>true,updateCheckPlacement:id=>calls.push(['partial',id]),runAnalysis:()=>calls.push('full')};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function bindReassign('),source.indexOf('\nfunction renderClauses()')),ctx);
  ctx.bindReassign({querySelectorAll:()=>[select]});return {ctx,events,calls,select};
}
test('reassignment, restore, confirm and contract-wide placement update one check without remapping',()=>{
  for(const value of ['1','','__confirm__','__contract__']){const h=harness();h.select.value=value;h.events.change();
    assert.deepEqual(h.calls,['save-placement',['partial','A']]);
    if(value==='__confirm__')assert.equal(h.ctx.state.matchConfirm.A,true);
    else assert.equal(h.ctx.state.reassign.A,value===''?undefined:value==='1'?1:value);
  }
});
test('changed source/document/scope must retain the full-analysis route',()=>{
  const h=harness();h.ctx.canUpdateCheck=()=>false;h.events.change();assert.deepEqual(h.calls,['save-placement','full']);
});
test('dependency guard excludes only own unreferenced archives; source, template, scope and date changes invalidate',()=>{
  const Runtime=require('../src/analysis_runtime'),template=fs.readFileSync(require.resolve('../src/template_library_ui'),'utf8');
  const lib={templates:[]},tctx={lib};vm.createContext(tctx);vm.runInContext(template.slice(template.indexOf('  function analysisPackets('),template.indexOf('  return {apply:apply,mapResult:mapResult')),tctx);
  let sources={legal:{documents:{}},history:{},corpus:{},packets:[]},input='current';
  const ctx={AnalysisRuntime:Runtime,TemplateLibraryRuntime:{analysisPackets:tctx.analysisPackets},analysisSources:()=>sources,analysisInputSnapshot:()=>[input],analysisIsRunning:()=>false,state:{result:{}},Date};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function analysisSourceDependencies('),source.indexOf('function tagReferenceLoader(')),ctx);
  function baseline(){ctx._analysisBaseline={input:[input],sourceDependencies:ctx.analysisSourceDependencies(sources,'current'),contractHash:'current',result:ctx.state.result,day:new Date().toDateString()};}
  baseline();assert.equal(ctx.canUpdateCheck(),true);sources.packets=[{id:'own',contract_hash:'current',verdicts:{A:{comment:'memo'}}}];assert.equal(ctx.canUpdateCheck(),true);
  sources.packets[0].verdicts.A.comment='new memo';assert.equal(ctx.canUpdateCheck(),true);
  lib.templates=[{bindings:[{variants:[{source:{id:'packet:own:A'}}]}]}];assert.equal(ctx.canUpdateCheck(),false);
  baseline();sources.packets[0].verdicts.A.comment='source change';assert.equal(ctx.canUpdateCheck(),false);
  lib.templates=[];baseline();sources.packets.push({id:'other',contract_hash:'other'});assert.equal(ctx.canUpdateCheck(),false);
  baseline();sources.legal.documents.new={evidence:['new']};assert.equal(ctx.canUpdateCheck(),false);
  baseline();input='changed body or scope';assert.equal(ctx.canUpdateCheck(),false);
  baseline();ctx._analysisBaseline.day='yesterday';assert.equal(ctx.canUpdateCheck(),false);
});
