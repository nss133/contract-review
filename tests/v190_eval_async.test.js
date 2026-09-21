'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
  const nodes={},builds=[];let resolve,reject;
  function node(id){return nodes[id]||(nodes[id]={value:id==='contract-text'?'본문':id==='safety-family'?'family':'',disabled:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});}
  const clauses=[{index:0,body:'본문'}],state={text:'본문',clauses,result:{results:[{cpId:'old'}]}};
  const ctx={document:{getElementById:node},state,CR:{common:{checks:[],meta:{}},types:[]},MatcherConfig:{TAG_MATCH_MODE:'assist'},
    verdictToday:()=> '2026-09-18',segmentContract:()=>clauses,hashText:()=> 'hash',safetyDocuments:()=>[],
    SafetyRuntime:{bundle:()=>({context:{}}),engineFingerprint:()=> 'engine',checksFingerprint:()=> 'checks',replay:s=>s},
    runAnalysis:()=>new Promise((ok,no)=>{resolve=ok;reject=no;}),
    SafetyEval:{build(input){builds.push(input);return {items:input.results,context:{},family_id:input.familyId};}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../src/safety_eval_ui'),'utf8'),ctx);
  return {node,state,builds,start:()=>node('safety-snapshot').listeners.click(),resolve:v=>resolve(v),reject:e=>reject(e)};
}
test('evaluation snapshot waits for the async mapping result, not previous result',async()=>{
  const h=harness(),pending=h.start();assert.equal(h.builds.length,0);assert(h.node('safety-snapshot').disabled);assert(h.node('safety-gold').disabled);
  h.state.result={results:[{cpId:'new'}]};h.resolve({status:'completed'});await pending;
  assert.equal(h.builds.length,1);assert.equal(h.builds[0].results[0].cpId,'new');assert.equal(h.node('safety-gold').disabled,false);assert.equal(h.node('safety-snapshot').disabled,false);
});
test('cancelled, failed and rejected analyses cannot create downloadable evaluation records',async()=>{
  for(const status of ['cancelled','error','rejected']){const h=harness(),pending=h.start();
    if(status==='rejected')h.reject(Error('worker failed'));else h.resolve({status,error:'analysis stopped'});await pending;
    assert.equal(h.builds.length,0);assert(h.node('safety-gold').disabled);assert(h.node('safety-observation').disabled);assert.equal(h.node('safety-snapshot').disabled,false);
  }
});
