// Offline synthetic equivalence + timing. No private corpus or browser stores.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDiverseFixture} from './test_v190_performance.mjs';
const require=createRequire(import.meta.url),Sim=require('../src/sim'),D=require('../src/decision_evidence');
const old=JSON.parse(fs.readFileSync(new URL('../dist/contract-review-v1.90.1.crupdate',import.meta.url),'utf8')).html;
const start=old.indexOf('var DecisionReferences=(function(){'),end=old.indexOf("if(typeof module!=='undefined')module.exports=DecisionReferences;",start);
assert(start>=0&&end>start,'Baseline artifact must contain the exhaustive reference search');
const CR=JSON.parse(old.match(/<script id="cr-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
const data=createDiverseFixture(),knowledge=require('../src/history_assist').combined(data.knowledge,null,data.corpus);
const type=CR.types.find(t=>t.meta.type_id==='outsourcing'),checks=[...CR.common.checks,...type.checks],documents=[{name:'본문',text:data.text}];
const result={fixture:{documents:Object.keys(knowledge.documents).length,tag_evidence_rows:26000,checks:checks.length,characters:data.text.length},runs:[]};
let baseline;
for(const [label,code] of [['exhaustive_v1901',old.slice(start,end)],['indexed_current',fs.readFileSync(new URL('../src/decision_references.js',import.meta.url),'utf8')]]){
  let scored=0;const ctx={Sim:{...Sim,cosine(...args){scored++;return Sim.cosine(...args);}},DecisionEvidence:D};vm.createContext(ctx);vm.runInContext(code,ctx);
  for(let run=1;run<=2;run++){
    scored=0;const t=performance.now(),rows=checks.map(cp=>ctx.DecisionReferences.retrieve(cp,documents,knowledge,1)),ms=performance.now()-t;
    const serialized=JSON.stringify(rows);if(baseline===undefined)baseline=serialized;else assert.equal(serialized,baseline,'Exact same reference results, scores and ranking');
    result.runs.push({label,run,ms,scored_pairs:scored});
  }
}
result.exact_equivalence=true;console.log(JSON.stringify(result,null,2));
