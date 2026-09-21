/* Frozen synthetic agreement evaluation corpus; never reads review databases. */
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(root,'src/agreement_judgment.js'),'utf8');
const baseline=JSON.parse(fs.readFileSync(path.join(root,'contracts/fixtures/baseline-manifest.json')));
for(const row of baseline.source_files)if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,row.path))).digest('hex')!==row.sha256)throw Error('Baseline source changed: '+row.path);
const api=require(path.join(root,'src/agreement_judgment.js'));
function serialize(value){return JSON.stringify(value,(_,v)=>Object.prototype.toString.call(v)==='[object RegExp]'?{pattern:v.source,flags:v.flags}:v);}
fs.writeFileSync(path.join(root,'backend/app/data/judgment-rules.json'),JSON.stringify({source_hash:crypto.createHash('sha256').update(source).digest('hex'),profiles:JSON.parse(serialize(api.profiles)),deny_rules:[...source.matchAll(/if\(p\.(id|kind)==='([^']+)'\)return \/(.+?)\/([a-z]*)\.test\(s\);/g)].filter(m=>!m[3].includes('.test(')).map(m=>({field:m[1],value:m[2],pattern:m[3],flags:m[4]}))},null,2)+'\n');
const standard=require(path.join(root,'src/standard_auto.js')), standardRows=[], originalStandard=standard.evaluate;
standard.evaluate=function(...args){const before=JSON.parse(JSON.stringify(args));const result=originalStandard(...args);standardRows.push({args:before,result:JSON.parse(JSON.stringify(result))});return result;};
const rows=[];let recording=true;
for(const name of ['evaluate','recognize']){const fn=api[name];api[name]=function(...args){if(!recording)return fn(...args);const before=JSON.parse(JSON.stringify(args));recording=false;let result;try{result=fn(...args);}finally{recording=true;}rows.push({function:name,args:before,result:JSON.parse(JSON.stringify(result))});return result;};}
for(const name of fs.readdirSync(path.join(root,'tests')).filter(n=>n.endsWith('.test.js'))){
 const source=fs.readFileSync(path.join(root,'tests',name),'utf8');
 if(/require\(['"]\.\.\/src\/(?:agreement_judgment|standard_auto|clause_semantics)['"]\)/.test(source)&&!name.includes('cache'))require(path.join(root,'tests',name));
}
process.on('exit',code=>{if(code)return;const cases=[...new Map(rows.map(r=>[JSON.stringify(r),r])).values()];fs.writeFileSync(path.join(root,'contracts/fixtures/legacy-judgment.json'),JSON.stringify({synthetic_only:true,observed_calls:rows.length,cases},null,2)+'\n');fs.writeFileSync(path.join(root,'contracts/fixtures/legacy-standard-auto.json'),JSON.stringify({synthetic_only:true,cases:[...new Map(standardRows.map(r=>[JSON.stringify(r),r])).values()]},null,2)+'\n');console.log('Captured judgment:',rows.length,'unique:',cases.length);});

process.on('exit',code=>{if(code)return;for(const name of ['judgment','standard-auto']){const file=path.join(root,'contracts/fixtures/legacy-'+name+'.json');fs.writeFileSync(file+'.gz',require('zlib').gzipSync(fs.readFileSync(file)));fs.unlinkSync(file);}});
