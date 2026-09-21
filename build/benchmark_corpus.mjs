import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url),A=require('../src/history_assist'),L=require('../src/loop');
const history={latest:{},records:{}};
for(let i=0;i<1000;i++){history.latest[i]='r'+i;history.records['r'+i]={request:{contract_name:'서버 운영 용역 '+i},result:{review_text:'수탁자는 해지 시 서면 통지를 하여야 한다. 백업 복구 절차를 확인한다.',created_at:'2026-09-15'}};}
const started=performance.now(),indexed=A.combined(null,history),index_ms=performance.now()-started;
const uncached=JSON.parse(JSON.stringify(indexed));
function measure(fn,n=30){const values=[];for(let i=0;i<n+3;i++){const t=performance.now();fn();if(i>=3)values.push(performance.now()-t);}values.sort((a,b)=>a-b);return {p50_ms:+values[Math.floor(values.length*.5)].toFixed(3),p95_ms:+values[Math.floor(values.length*.95)].toFixed(3)};}
const query='서버 운영 해지 통지를 백업 복구';
const result={fixture:'synthetic only',documents:1000,node:process.version,index_ms:+index_ms.toFixed(3),
 uncached_search:measure(()=>A.retrieve(uncached,query,'')),indexed_search:measure(()=>A.retrieve(indexed,query,''))};
let corpus=L.emptyCorpus();
for(let i=0;i<100;i++)corpus=L.mergeIntoCorpus(corpus,{meta:{contract_hash:'H'+i,date:'2026-09-15'},verdicts:{A:{verdict:'이상없음',origin:'manual',comment:'확인'}}});
result.corpus_100_json_bytes=Buffer.byteLength(JSON.stringify(corpus));
result.replace_100=measure(()=>L.mergeIntoCorpus(corpus,{meta:{contract_hash:'H1',date:'2026-09-15'},verdicts:{A:{verdict:'검토의견',origin:'manual',comment:'변경'}}},{replaceCurrent:true}),10);
console.log(JSON.stringify(result,null,2));
