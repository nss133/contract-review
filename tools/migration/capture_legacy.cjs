/* Deterministic synthetic evidence. Never calls private-file functions. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'contracts/fixtures');
const html=fs.readFileSync(path.join(root,'dist/contract-review.html'),'utf8');
assert.equal(crypto.createHash('sha256').update(html).digest('hex'),'774f97531ce146fd4a6347655cc6e9ea21f61909aa753a1e2c96513244a52824');
const data=JSON.parse(html.match(/<script id="cr-data"[^>]*>(.*?)<\/script>/s)[1]);
assert.equal(data.curated_corpus,null);
const checks=data.common.checks.concat(data.types.flatMap(t=>t.checks));
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8'),ctx={};
vm.runInNewContext(app.slice(app.indexOf('function hashText('),app.indexOf('var SEV_RANK')),ctx);
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(output,{recursive:true});
write('legacy-compat.json',{source:'src/app.js hashText',normalization:'none',offset_unit:'utf16',cases:['','가나다','😀계약','가','가\r\n나','𐐀'].map(text=>({text,hash:ctx.hashText(text),length:text.length}))});
const S=require(path.join(root,'src/standard_auto')),V=require(path.join(root,'src/verdict'));
const F=require(path.join(root,'build/audit_v188_acceptance.cjs'));
const segment=require(path.join(root,'src/segmenter')).segmentContract;
function capture(){return F.syntheticCases.map(c=>{
 const cp=checks.find(x=>x.id===c.id);assert(cp,c.id);
 const input=Object.assign({confirmed:true,documents:c.documents,scope:F.SCOPE},c.input||{});
 const evaluation=S.evaluate(cp,F.ITEM,input);
 assert.equal(!!evaluation.eligible,c.expected,c.key+' differs from existing acceptance expectation');
 const ticket=S.ticketFromEvaluation(cp,evaluation,input,F.ITEM);
 const manual={verdict:'검토의견',comment:'합성 수기 의견',origin:'manual',date:'2026-09-21'};
 const record={key:c.key,check_id:c.id,input,item:F.ITEM,expected_from_existing_suite:c.expected,
   clauses:c.documents.map(d=>({name:d.name,clauses:segment(d.text)})),evaluation,ticket,
   manual_normalized:V.migrateStore({[c.id]:manual})[c.id]};
 return JSON.parse(JSON.stringify(record));
});}
const first=capture(),second=capture();assert.deepEqual(first,second,'Legacy capture must be deterministic');
write('legacy-presence.json',{source:'v1.90.8 synthetic acceptance fixtures',private_data:false,cases:first});
const workerSource=html.match(/<script type="text\/plain" id="analysis-worker-src">(.*?)<\/script>/s)[1].replaceAll('<\\/script','</script');
const selected=checks.filter(c=>['CMN-05','CMN-19','CNS-TERM','CNS-PRICE','CNS-END','CNS-DAMAGE','PRIV-07','PRIV-21'].includes(c.id));
const texts=[
 '합성 유지보수 계약서\n제1조(목적)\n시스템 유지보수 업무를 위탁한다.\n제2조(대금)\n계약대금은 100만원이며 부가세 별도이다.\n제3조(관할)\n서울중앙지방법원을 전속적 합의관할로 한다.',
 '합성 계약서\n제1조(업무)\n자료 정리 업무를 수행한다.\n제2조(특약)\n별첨 관할약정을 적용한다.',
 '합성 계약서\n제1조(개인정보)\n① 수탁자는 개인정보를 위탁 목적 외로 이용하여서는 아니 된다.\n1. 재위탁은 사전 서면 동의 없이 할 수 없다.\n2. 법령상 금지된 업무의 재위탁은 허용하지 않는다.\n제2조의2(예시)\n관할 법원은 추후 협의한다.'
];
function captureWorker(){return texts.map((text,index)=>{
 const messages=[],context={self:{postMessage:m=>messages.push(JSON.parse(JSON.stringify(m)))},console,TextEncoder,TextDecoder};
 vm.createContext(context);vm.runInContext(workerSource,context,{timeout:10000});
 const subDocs=index===1?[{name:'별첨 관할약정',text:'제1조(관할)\n서울중앙지방법원을 관할법원으로 한다.'}]:[];
 const input={text,hash:ctx.hashText(text),options:{modules:['M-COMMON','X-PII'],stance:'party',docTitle:'합성'},docs:[{checkpoints:selected}],subDocs,safetyDocuments:[{name:'본문',text}].concat(subDocs)};
 const sources={legal:null,history:null,corpus:{byCheck:{}},packets:[]};
 context.self.onmessage({data:{id:1,input,sourceVersion:1,sources}});
 const result=messages.at(-1);assert.equal(result.type,'result',result.error);
 return {key:'synthetic-worker-'+index,input,sources,result:result.result,progress:messages.filter(m=>m.type==='progress').map(m=>m.step)};
});}
const workers=captureWorker();assert.deepEqual(workers,captureWorker());
write('legacy-worker.json',{private_data:false,scope:'8 selected checks, three synthetic contract structures; not full UI lifecycle',cases:workers});
console.log(JSON.stringify({compat_cases:6,presence_cases:first.length,worker_cases:workers.length,deterministic:true}));
