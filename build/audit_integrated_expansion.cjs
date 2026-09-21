// 합성된 신규 지원 사례만 비교한다. 실계약 자동판정률·독립 정확도 평가가 아니다.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),Module=require('node:module');
const baseline='1.86.0',html=execFileSync('unzip',['-p','dist/contract-review-v'+baseline+'.zip','contract-review.html'],{encoding:'utf8',maxBuffer:20e6});
const names={safety_digest:'SafetyDigest',evidence_rules:'EvidenceRules',agreement_evidence:'AgreementEvidence',clause_semantics:'ClauseSemantics',decision_evidence:'DecisionEvidence',judgment_sources:'JudgmentSources',human_precedent:'HumanPrecedent',judgment_policy:'JudgmentPolicy',requirement_rules:'RequirementRules',standard_auto:'StandardAuto',clause_equivalence:'ClauseEquivalence',template_fields:'TemplateFields',registered_presence:'RegisteredPresence',template_library:'TemplateLibrary',template_register:'TemplateRegister',presence_profiles:'PresenceProfiles',document_structure:'DocumentStructure'},loaded={};
function old(id){if(loaded[id])return loaded[id].exports;const name=names[id],begin=id==='standard_auto'?html.indexOf('var _StdHash='):html.search(new RegExp('var\\s+'+name+'\\s*='));if(begin<0)throw Error(id);
 const end=html.slice(begin).match(new RegExp('if\\s*\\(typeof module\\s*!==?\\s*[\'\"]undefined[\'\"]\\)\\s*module\\.exports\\s*=\\s*'+name+';?'));if(!end)throw Error(id+' end');
 const filename=path.resolve('src',id+'.js'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));loaded[id]=mod;const normal=mod.require.bind(mod);mod.require=request=>request.startsWith('./')&&names[request.slice(2)]?old(request.slice(2)):normal(request);mod._compile(html.slice(begin,begin+end.index+end[0].length),filename);return mod.exports;}
const Structure=require('../src/document_structure'),checks=require('../knowledge/judgment_policies.json').checks.map(p=>({id:p.id,check:p.question})),cp=id=>checks.find(c=>c.id===id),docs=text=>[{name:'본문',text}],scope={type:'outsourcing',roles:['위탁자'],stance:'party',modules:[]},cases=[];
function add(group,id,text,bad){cases.push({group,id,documents:docs(text),negative:docs(bad)});}
for(const [id,object,action] of [['PRIV-03','개인정보','기술적·관리적 보호조치를 취하여야 한다.'],['PRIV-19','제공받은 개인신용정보의 식별정보를','암호화하여야 한다.']]){
 const grid=[['주체','대상','의무'],['수탁자',object,action]],x=Structure.fromBlocks('docx',grid.flatMap((row,r)=>row.map((text,col)=>({text,source:{cell:r+':'+col,table:{id:'t',row:r,col,rowspan:1,colspan:1}}})))),negative=JSON.parse(JSON.stringify(x));negative.blocks[3].source.table.invalid=true;
 cases.push({group:'table',id,documents:[Structure.document('본문',x.text,x)],negative:[Structure.document('본문',negative.text,negative)]});
}
for(const [id,text] of [['PRIV-03','수탁자는 개인정보 기술적·관리적 보호조치를 이행하여야 한다.'],['PRIV-03','수탁자는 개인정보 기술적·관리적 보호조치를 실시하도록 한다.'],['PRIV-03','개인정보 기술적·관리적 보호조치를 수탁자는 실시하여야 한다.'],['PRIV-19','수탁자는 제공받은 개인신용정보의 식별정보를 암호화 처리하여야 한다.'],['PRIV-19','수탁자는 제공받은 개인신용정보의 식별정보를 암호화하여야 할 것이다.'],['PRIV-19','제공받은 개인신용정보의 식별정보를 수탁자는 암호화하여야 한다.'],['PRIV-07','수탁자는 위탁자의 개인정보 처리 현황 점검에 협력하여야 한다.'],['PRIV-07','위탁자의 개인정보 처리 현황 점검에 수탁자는 협조하여야 한다.']])add('phrases',id,text,text.replace('수탁자','위탁자'));
const first='수탁자는 개인정보 기술적·관리적 보호조치를 취하여야 한다.';
add('phrases','PRIV-06',first+'\n또한 위 개인정보에 대한 접근권한을 업무수행에 필요한 최소한의 범위로 제한하여야 한다.',first+'\n또한 위 개인정보에 대한 접근권한을 업무수행에 필요한 최소한의 범위로 제한할 수 있다.');
const screen='수탁자는 업무수행인력에 대하여 업무 투입 전에 신원조회를 실시하여야 한다.',handover='수탁자는 업무수행인력이 변경되는 경우 인수인계를 실시하여야 한다.';
const nested='제1조(인력)\n수탁자는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n가. 다음 각 세목의 사항을 이행할 것\n(1) '+screen.replace('수탁자는 ','')+'\n(2) '+handover.replace('수탁자는 ','');add('references','ITSEC-12',nested,nested.replace('(2)','(3)'));
const articles='제1조(기록)\n① 기록은 전자파일로 작성한다.\n② 기록은 5년 보존한다.\n제1조의2(추가)\n① 추가 기록을 작성한다.\n제2조(열람)\n① 기록은 서면으로 요청한다.\n② 기록은 7일 이내 제공한다.';
for(const [a,b] of [['제1조부터 제2조까지','제1조 내지 제2조'],['제1조 제1항부터 제2조 제2항까지','제1조 제1항 내지 제2조 제2항']]){
 const source=articles+'\n제9조(비밀)\n비밀정보 관리방법은 '+a+'에 따른다.',text=source.replace(a,b);cases.push({group:'references',id:'CNS-SECRET',documents:docs(text),negative:docs(text.replace('7일','30일')),packet:{id:'audit-'+cases.length,documents:docs(source),context:scope,checks:[cp('CNS-SECRET')],verdicts:{'CNS-SECRET':{origin:'manual',verdict:'이상없음',reason:'반영되어 있음'}}}});
}
const conditional='제1조(인력)\n'+screen+'\n제2조(인수인계)\n수탁자는 업무수행인력이 변경되는 경우 다음의 의무를 이행하여야 한다.\n수탁자는 인수인계를 실시하여야 한다.';
add('conditions','ITSEC-12',conditional,conditional.replace('변경되는 경우','변경되는 경우에만'));
const exception='수탁자는 신용정보 처리 업무를 재위탁하여서는 아니 된다.\n다만, 금융위원회가 인정한 경우에는 그러하지 아니하다.';add('conditions','PRIV-21',exception,exception.replace('금융위원회','위탁자'));
const independent='제1조(보호)\n'+first+'\n수탁자는 위탁자의 개인정보 처리 현황 점검에 협조하여야 한다.\n다만, 수탁자의 개인정보처리현황점검 의무는 긴급한 경우에는 적용하지 아니한다.';
add('conditions','PRIV-03',independent,independent.replace('개인정보처리현황점검 의무는','개인정보기술적·관리적보호조치 의무는'));
function evaluate(engine,precedent,c,negative=false){return engine.evaluate(cp(c.id),{coverage:'addressed'},precedent.prepare({confirmed:true,documents:negative?c.negative:c.documents,scope,review_packets:c.packet?[c.packet]:[]})).eligible;}
const before=old('standard_auto'),beforeP=old('human_precedent'),after=require('../src/standard_auto'),afterP=require('../src/human_precedent'),results=cases.map(c=>({group:c.group,id:c.id,before:evaluate(before,beforeP,c),after:evaluate(after,afterP,c),negative_after:evaluate(after,afterP,c,true)}));
if(results.some(r=>!r.after||r.negative_after))throw Error(JSON.stringify(results));
const groups={};for(const r of results){const g=groups[r.group]||(groups[r.group]={cases:0,before:0,after:0,negative_accepted:0});g.cases++;g.before+=+r.before;g.after+=+r.after;g.negative_accepted+=+r.negative_after;}
console.log(JSON.stringify({baseline,method:'신규 지원 기능에 맞춰 만든 합성 사례와 각 1개 반례. 입력·적용 조건을 통과시킨 엔진 시험이며 실제 자동판정률이 아님.',groups,results},null,2));
