// Synthetic stage attribution. Does not access or modify user stores.
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createDiverseFixture} from './test_v190_performance.mjs';
const require=createRequire(import.meta.url);
const html=fs.readFileSync(new URL('../dist/contract-review.html',import.meta.url),'utf8');
const CR=JSON.parse(html.match(/<script id="cr-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
const data=createDiverseFixture(),count=Number(process.env.CR_PROFILE_DOCS||500);
const seeds=Object.values(data.knowledge.documents);data.knowledge.documents={};data.knowledge.latest={};
for(let i=0;i<count;i++){const d=structuredClone(seeds[i%seeds.length]),id='synthetic-'+i;d.source_id=id;d.evidence.forEach(e=>e.sentence+=' 합성 출처 '+i);data.knowledge.documents[id]=d;data.knowledge.latest[id]=id;}
const messages=[],timings={};
function watch(obj,key,label){const fn=obj[key];obj[key]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{const t=timings[label]||(timings[label]={calls:0,ms:0});t.calls++;t.ms+=performance.now()-start;}};}
const ctx={CR,self:{postMessage:m=>messages.push(m)},MatcherConfig:require('../src/matcher_config'),segmentContract:require('../src/segmenter').segmentContract};
for(const [name,file] of Object.entries({HistoryAssist:'history_assist',JudgmentHints:'judgment_hints',ReviewCore:'review_core',JudgmentSources:'judgment_sources',DecisionReferences:'decision_references',Integrity:'integrity',Formal:'formal',DocumentStructure:'document_structure'}))ctx[name]=require('../src/'+file);
for(const [name,keys] of Object.entries({HistoryAssist:['combined','retrieve'],JudgmentHints:['index','retrieve'],ReviewCore:['run'],JudgmentSources:['compile'],DecisionReferences:['retrieve'],Integrity:['analyze']}))for(const key of keys)watch(ctx[name],key,name+'.'+key);
const type=CR.types.find(t=>t.meta.type_id==='outsourcing');
const docs=[CR.common,type],modules=docs.flatMap(d=>d.meta.modules.map(m=>m.id));
const input={text:data.text,hash:'synthetic-current',options:{modules,stance:'party',docTitle:'합성 위탁계약'},docs:docs.map(d=>({checkpoints:d.checks})),subDocs:[],safetyDocuments:[{name:'본문',text:data.text}]};
const sources={legal:data.knowledge,history:null,corpus:data.corpus,packets:[]};
let worker=fs.readFileSync(new URL('../src/analysis_worker.js',import.meta.url),'utf8');
if(process.env.CR_PROFILE_BASELINE==='1'){
  const previous=JSON.parse(fs.readFileSync(new URL('../dist/contract-review-v1.90.1.crupdate',import.meta.url),'utf8'));
  const embedded=previous.html.match(/<script type="text\/plain" id="analysis-worker-src">([\s\S]*?)<\/script>/)[1];
  worker=embedded.slice(embedded.lastIndexOf('"use strict";\n/* Embedded in a Blob worker')).replaceAll('<\\/script','</script');
}
vm.createContext(ctx);vm.runInContext(worker,ctx);
for(let run=1;run<=2;run++){
  for(const key of Object.keys(timings))delete timings[key];messages.length=0;
  const start=performance.now();ctx.self.onmessage({data:{id:run,input,sourceVersion:1,...(run===1?{sources}:{})}});const total=performance.now()-start,result=messages.at(-1);
  if(result.type!=='result')throw Error(result.error);
  console.log(JSON.stringify({run,documents:count,evidence_rows:count*52,characters:data.text.length,checks:result.result.core.result.checkpoints.length,total_ms:total,timings}));
}
