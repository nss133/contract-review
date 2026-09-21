// 이전 ZIP의 의존 모듈도 함께 로드한다. 이전 엔진에 새 규칙을 섞지 않는다.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),Module=require('node:module');
const baseline=process.env.CR_AUDIT_BASELINE||'1.78.0',newContext=process.env.CR_AUDIT_CONTEXT==='unrelated_clause';
if(!/^1\.\d+\.\d+$/.test(baseline))throw Error('unsupported baseline version');
const html=execFileSync('unzip',['-p','dist/contract-review-v'+baseline+'.zip','contract-review.html'],{encoding:'utf8',maxBuffer:20e6});
const names={safety_digest:'SafetyDigest',evidence_rules:'EvidenceRules',agreement_evidence:'AgreementEvidence',clause_semantics:'ClauseSemantics',decision_evidence:'DecisionEvidence',judgment_sources:'JudgmentSources',human_precedent:'HumanPrecedent',judgment_policy:'JudgmentPolicy',requirement_rules:'RequirementRules',standard_auto:'StandardAuto',clause_equivalence:'ClauseEquivalence',template_fields:'TemplateFields',registered_presence:'RegisteredPresence',template_library:'TemplateLibrary',template_register:'TemplateRegister'};
const loaded={};
Object.assign(names,{presence_profiles:'PresenceProfiles',document_structure:'DocumentStructure'});
function old(id){if(loaded[id])return loaded[id].exports;const name=names[id],begin=id==='standard_auto'?html.indexOf('var _StdHash='):html.search(new RegExp('var\\s+'+name+'\\s*='));
 if(begin<0)throw Error('baseline module not found '+id);
 const end=html.slice(begin).match(new RegExp('if\\s*\\(typeof module\\s*!==?\\s*[\'\"]undefined[\'\"]\\)\\s*module\\.exports\\s*=\\s*'+name+';?'));
 if(!end)throw Error('baseline module end not found '+id);
 const filename=path.resolve('src',id+'.js'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));loaded[id]=mod;
 const normal=mod.require.bind(mod);mod.require=request=>request.startsWith('./')&&names[request.slice(2)]?old(request.slice(2)):normal(request);
 mod._compile(html.slice(begin,begin+end.index+end[0].length),filename);return mod.exports;
}
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const nowRegister=require('../src/template_register'),nowLibrary=require('../src/template_library'),beforeRegister=old('template_register'),beforeLibrary=old('template_library');
function run(register,library,text){const start=performance.now(),t=register.process('시험 표준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'},checks),lib={format:library.VERSION,templates:[t]};
const current=newContext?'신규 위탁 계약서\n제99조(운송)\n인도 장소는 부산이다.\n'+text:text;
 const accepted=t.bindings.filter(b=>library.evaluate(lib,checks.find(c=>c.id===b.check_id),{coverage:'addressed'},{current:true,scope:{type:'outsourcing',roles:['위탁자'],stance:'party'},documents:[{name:'본문',text:current}]}).eligible).map(b=>b.check_id);
 return {bindings:t.bindings.map(b=>b.check_id),accepted,elapsed_ms:Math.round(performance.now()-start)};
}
const dir='samples/internal-standards/extracted';
const rows=fs.readdirSync(dir).filter(f=>f.startsWith('pii-agreements_')).map(file=>{const text=fs.readFileSync(path.join(dir,file),'utf8');return {file,before:run(beforeRegister,beforeLibrary,text),after:run(nowRegister,nowLibrary,text)};});
console.log(JSON.stringify({baseline,method:(newContext?'등록한 표준 원문에 새 제목·무관한 조항을 붙인 본건과 비교.':'등록한 표준 원문 자체를 본건으로 비교.')+' 적용·매핑 조건을 충족시킨 등록 경로 시험이며, 독립 정확도 또는 전체 앱 자동판정률이 아님.',rows},null,2));
