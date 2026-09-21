/* Development-only: freeze public rule data and observed synthetic unit-test calls. */
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
function digest(p){return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');}
const baseline=JSON.parse(fs.readFileSync(path.join(root,'contracts/fixtures/baseline-manifest.json'),'utf8'));
for(const item of baseline.source_files){if(digest(item.path)!==item.sha256)throw Error('Baseline source changed: '+item.path);}
// Capture only reviewed repository code, never browser state or runtime databases.
function dataModule(name,anchor,injected){
 const code=fs.readFileSync(path.join(root,name),'utf8');
 if(!code.includes(anchor))throw Error('Rule export anchor changed: '+name);
 const ctx={module:{exports:{}},capture:null,ContractTags:{},HistoryAssist:{}};vm.createContext(ctx);
 vm.runInContext(code.replace(anchor,injected+'\n'+anchor),ctx);
 return ctx.capture;
}
const sim=dataModule('src/sim.js','  var API = {','capture={stopwords:STOPWORDS,phrase_endings:PHRASE_ENDINGS,synonyms:SYN_DEFAULT};');
const tags=dataModule('vendor/contract-tag-engine.js','  return __toCommonJS(contract_tag_profile_exports);',
 'capture={profileVersion:CONTRACT_TAG_PROFILE_VERSION,weights:SOURCE_WEIGHTS,rules:Object.fromEntries(Object.entries(RULES).map(([k,v])=>[k,v.map(([id,label,re])=>({id,label,pattern:re.source,flags:re.flags}))])),conflicts:Object.fromEntries(Object.entries(CONFLICTS).map(([k,v])=>[k,[...v]]))};');
const matcher=dataModule('src/matcher.js','if (typeof module !== \"undefined\")\n  module.exports = {', 'capture={PRIVATE_FUND_SIGNALS,PUBLIC_FUND_SIGNALS,COMPLETION_SIGNALS,MANDATE_SIGNALS,BENEFICIARY_SIGNALS,PARTY_SIGNALS,OUR_NAMES,ROLE_TERMS,NORM_MAP};');
matcher.config=require(path.join(root,'src/matcher_config.js'));
const presence=dataModule('src/presence_profiles.js',"  return {VERSION:'presence-profiles-v1'", "capture={roles:roles,profiles:profiles,rules:rules.map(r=>({...r,pattern:r.pattern.source,flags:r.pattern.flags}))};");
const rules={matcher,presence,source_hashes:Object.fromEntries(['src/sim.js','vendor/contract-tag-engine.js','src/matcher.js','src/matcher_config.js','src/presence_profiles.js'].map(p=>[p,digest(p)])),sim,tags};
fs.writeFileSync(path.join(root,'backend/app/data/domain-rules.json'),JSON.stringify(rules,null,2)+'\n');
const names=['segmenter','document_structure','sentence','sim','clause_role','formal','scope_assessment','legal_constraints','contract_tags','matcher','evidence_rules','history_assist','presence_profiles','agreement_evidence'];
const rows=[];let recording=true;
function clone(v){return JSON.parse(JSON.stringify(v));}
for(const name of names){
 const mod=require(path.join(root,'src',name+'.js'));
 for(const key of Object.keys(mod)){
  const fn=mod[key];if(typeof fn!=='function'||key==='revisionToken')continue;
  mod[key]=function(...args){
   if(!recording)return fn.apply(this,args);
   const before=clone(args.slice(0,fn.length)),config=clone(require(path.join(root,'src/matcher_config.js')));recording=false;
   const callbacks=[];
   if(name==='history_assist'&&key==='rankTypes'){
    const classify=args[3];args[3]=function(...input){const value=classify(...input);callbacks.push({args:clone(input),result:clone(value)});return value;};
   }
   let result;
   try{result=fn.apply(this,args);}finally{recording=true;}
   rows.push({module:name,function:key,args:before,config,...(callbacks.length?{callbacks}:{}),result:result===undefined?null:clone(result)});
   return result;
  };
 }
}
// presence_profiles has no standalone legacy test file; agreement tests exercise it.
for(const name of names)if(name!=='presence_profiles')require(path.join(root,'tests',name+'.test.js'));
process.on('exit',code=>{
 if(code!==0)return;
 const payload={synthetic_only:true,source_hashes:Object.fromEntries(names.map(n=>['src/'+n+'.js',digest('src/'+n+'.js')])),cases:rows};
 fs.writeFileSync(path.join(root,'contracts/fixtures/legacy-domain.json'),JSON.stringify(payload,null,2)+'\n');
 console.log('Captured domain calls:',rows.length);
});
