/* Development-only capture of frozen legal rule data and synthetic grammar cases. */
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'contracts/fixtures/baseline-manifest.json')));
for(const row of manifest.source_files){if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,row.path))).digest('hex')!==row.sha256)throw Error('Baseline changed: '+row.path);}
const file=path.join(root,'src/clause_semantics.js'),source=fs.readFileSync(file,'utf8');
const anchor="  return {VERSION:'clause-semantics-v8'";
const context={module:{exports:{}},require:n=>require(path.join(root,'src',n)),capture:null};vm.createContext(context);
vm.runInContext(source.replace(anchor,"  securityFacts('');capture={knownRoles,role,frontConditions,restrictionTargets,questionTopics,securityRules:securityRules.map(r=>({...r,pattern:r.pattern.source})),financialPattern:financialPattern.source};\n"+anchor),context);
fs.writeFileSync(path.join(root,'backend/app/data/semantics-rules.json'),JSON.stringify({source_hash:crypto.createHash('sha256').update(source).digest('hex'),...context.capture},null,2)+'\n');
const api=require(file),rows=[];let recording=true;
for(const name of ['parse','parseAll','key','keys','aliases','aliasDefinition','roleText','literalScope','independentException','contexts']){
 const original=api[name];api[name]=function(...args){if(!recording)return original(...args);const inputs=JSON.parse(JSON.stringify(args));recording=false;let result;try{result=original(...args);}finally{recording=true;}rows.push({function:name,args:inputs,result:result===undefined?null:JSON.parse(JSON.stringify(result,(_,v)=>v instanceof Map?Object.fromEntries(v):v))});return result;};
}
for(const name of ['presence_completion','condition_expansion','phrase_expansion','scoped_standard','context_expansion','semantic_sources','complex_references','obligation_lists','nested_obligation_lists','security_reference_expansion','table_obligations'])require(path.join(root,'tests',name+'.test.js'));
process.on('exit',code=>{if(code)return;fs.writeFileSync(path.join(root,'contracts/fixtures/legacy-semantics.json'),JSON.stringify({synthetic_only:true,observed_calls:rows.length,cases:[...new Map(rows.map(r=>[JSON.stringify(r),r])).values()]},null,2)+'\n');console.log('Captured semantic cases:',rows.length);});

process.on('exit',code=>{if(code)return;for(const name of ['semantics']){const file=path.join(root,'contracts/fixtures/legacy-'+name+'.json');fs.writeFileSync(file+'.gz',require('zlib').gzipSync(fs.readFileSync(file)));fs.unlinkSync(file);}});
