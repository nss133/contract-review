'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const H=require('../src/safety_digest'),source=fs.readFileSync(require.resolve('../src/template_library_ui'),'utf8');
function runtime(){const records=new Map();let full=0,reads=0,refreshes=0;
  const ctx={reloadPromise:null,reloadAll:false,reloadIds:new Set(),packetDigests:new Map(),packetCache:[],SafetyDigest:H,verdictHash:'current',lib:{templates:[]},status:()=>{},refresh:()=>refreshes++,
    StandardAutoArchive:{backup:async()=>{full++;return {packets:[...records.values()].map(p=>JSON.parse(JSON.stringify(p)))};},get:async id=>{reads++;return records.has(id)?JSON.parse(JSON.stringify(records.get(id))):null;}}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function reloadSources('),source.indexOf("window.addEventListener('cr-evaluation-packet-changed'")),ctx);
  return {ctx,records,counts:()=>({full,reads,refreshes})};
}
test('초기 100건 로드 후 본건 메모 한 건은 getAll 없이 단건 조회하고 화면을 재생성하지 않는다',async()=>{
  const {ctx,records,counts}=runtime();for(let i=0;i<100;i++)records.set(String(i),{id:String(i),contract_hash:'old-'+i,verdicts:{}});
  await ctx.reloadSources();assert.deepEqual(counts(),{full:1,reads:0,refreshes:1});
  records.set('current',{id:'current',contract_hash:'current',verdicts:{A:{origin:'manual',comment:'마지막 메모'}}});
  await ctx.reloadSources({detail:{id:'current'}});assert.deepEqual(counts(),{full:1,reads:1,refreshes:1});assert.equal(ctx.packetCache.length,101);
  records.get('current').verdicts.A.comment='메모 갱신';await ctx.reloadSources({detail:{id:'current'}});
  assert.deepEqual(counts(),{full:1,reads:2,refreshes:1});assert.equal(ctx.packetCache.find(p=>p.id==='current').verdicts.A.comment,'메모 갱신');
});
test('과거 패킷 변경·삭제는 단건 반영 후 재검사하고 동일 알림은 재검사하지 않는다',async()=>{
  const {ctx,records,counts}=runtime();records.set('a',{id:'a',contract_hash:'old',verdicts:{}});await ctx.reloadSources();
  await ctx.reloadSources({detail:{id:'a'}});assert.equal(counts().refreshes,1);
  records.get('a').verdicts.A={origin:'manual',comment:'변경'};await ctx.reloadSources({detail:{id:'a'}});assert.equal(counts().refreshes,2);
  records.delete('a');await ctx.reloadSources({detail:{id:'a'}});assert.equal(counts().refreshes,3);assert.equal(ctx.packetCache.length,0);assert.equal(counts().full,1);
});
test('본건 패킷이라도 표준 표현 출처에 연결되면 수기 변경 뒤 즉시 재검사한다',async()=>{
  const {ctx,records,counts}=runtime();records.set('x',{id:'x',contract_hash:'current',verdicts:{}});
  ctx.lib.templates=[{bindings:[{variants:[{source:{id:'packet:x:A'}}]}]}];await ctx.reloadSources({detail:{id:'x'}});assert.equal(counts().refreshes,1);
  records.get('x').verdicts.A={origin:'manual',comment:'반대 의견'};await ctx.reloadSources({detail:{id:'x'}});assert.equal(counts().refreshes,2);
});
test('알림 경합은 후속 변경을 잃지 않고 최신 조회를 끝낸 뒤 한 번만 화면 갱신한다',async()=>{
  const {ctx,records,counts}=runtime();records.set('a',{id:'a',contract_hash:'old',verdicts:{}});
  let unblock;const backup=ctx.StandardAutoArchive.backup;ctx.StandardAutoArchive.backup=async()=>{const snapshot=await backup();await new Promise(ok=>unblock=ok);return snapshot;};
  const running=ctx.reloadSources();await Promise.resolve();await Promise.resolve();
  records.get('a').verdicts.A={origin:'manual',comment:'조회 중 마지막 수정'};ctx.reloadSources({detail:{id:'a'}});unblock();await running;
  assert.equal(ctx.packetCache[0].verdicts.A.comment,'조회 중 마지막 수정');assert.deepEqual(counts(),{full:1,reads:1,refreshes:1});
});
