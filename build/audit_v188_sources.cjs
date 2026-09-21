'use strict';
/* Source ablation on fixed synthetic controls. No private file is read. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const F=require('./audit_v188_acceptance.cjs'),S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register');
const J=require('../src/judgment_hints'),Core=require('../src/review_core'),segment=require('../src/segmenter').segmentContract;
const checks=F.loadChecks(),cp=id=>checks.find(c=>c.id===id),scope={type:'outsourcing',stance:'party',roles:[]},item={coverage:'consider'};
const court='본 계약의 분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.';
const consent='수탁자는 위탁자의 사전 서면 동의 없이 재위탁할 수 없다.';
const lexicalGap='외부 사업자에게 다시 맡기는 경우에는 먼저 문서로 승낙을 얻어야 한다.';
const standard=Register.process('합성 분쟁·재위탁약정서','2026.01',
  '제1조(관할)\n'+court+'\n제2조(재위탁)\n'+consent,{type_ids:['outsourcing'],roles:[],stance:'party'},[cp('CMN-19'),cp('CORE-07')]);
assert.equal(standard.bindings.length,2,'Synthetic standard must cover both authored questions');
const examples=[
  {key:'direct-court',group:'direct_positive',id:'CMN-19',text:'제1조(분쟁)\n'+court,expected:()=>true},
  {key:'direct-vat',group:'direct_positive',id:'CMN-05',text:'제1조(대금)\n계약대금 1000000원(부가세 별도).',expected:()=>true},
  {key:'noun-alias',group:'tag_alias',id:'PRIV-19',text:'제1조(보호)\n수탁자는 개인정보를 비가독화처리하여 저장한다.',expected:c=>c.tags},
  {key:'tags-only',group:'negative_control',id:'PRIV-19',text:'표시용 해시태그: 개인정보 비가독화처리 이상없음',expected:()=>false},
  {key:'alias-negative',group:'negative_control',id:'PRIV-19',text:'제1조(보호)\n수탁자는 개인정보를 비가독화처리하지 않는다.',expected:()=>false},
  {key:'past-verdict-only',group:'negative_control',id:'CMN-19',text:'검토결과: 이상없음',expected:()=>false},
  {key:'standard-incorporated',group:'standard_incorporation',id:'CMN-19',text:'제1조(편입)\n합성 분쟁·재위탁약정서 2026.01 개정판을 적용한다.',expected:c=>c.standard},
  {key:'standard-equivalent',group:'standard_equivalence',id:'CORE-07',text:'제1조(재위탁)\n수탁자가 업무를 재위탁하려면 위탁자의 서면 동의를 미리 받아야 한다.',expected:()=>true},
  {key:'library-only',group:'negative_control',id:'CMN-19',text:'제1조(인도)\n물품은 서울 사무소로 인도한다.',expected:()=>false},
  // This is a mapping probe, not a claim that the wording is legally deficient.
  // Its automatic decision must remain identical with/without historical hints.
  {key:'mapping-lexical-gap',group:'mapping_probe',id:'CORE-07',text:'제1조(목적)\n용역을 수행한다.\n제2조(별도 약정)\n'+lexicalGap}
];
const configurations=[
  {name:'all_off',standard:false,tags:false,corpus:false,legal:false},
  {name:'all_on',standard:true,tags:true,corpus:true,legal:true},
  {name:'without_standard',standard:false,tags:true,corpus:true,legal:true},
  {name:'without_tags',standard:true,tags:false,corpus:true,legal:true},
  {name:'without_corpus',standard:true,tags:true,corpus:false,legal:true},
  {name:'without_legal',standard:true,tags:true,corpus:true,legal:false},
  {name:'without_history',standard:true,tags:true,corpus:false,legal:false}
];
function sources(c){
  const knowledge={meta:{updated_at:'synthetic-v1'},tags:c.tags?{encryption:{type:'content',label:'암호화',aliases:['비가독화처리']}}:{},latest:{},documents:{}};
  if(c.legal){knowledge.latest.legal='legal';knowledge.documents.legal={source_id:'synthetic-legal',source_kind:'legal_review',title:'합성 법률검토 표현 참고',department:'합성 법무부서',
    evidence:[{check_id:'CMN-19',sentence:court},{check_id:'CORE-07',sentence:lexicalGap}]};}
  const corpus=c.corpus?{meta:{updated:'synthetic-v1'},byCheck:{
    'CMN-19':{comments:[{text:'“'+court+'” 문구를 확인한 과거 이상없음 의견',verdict:'이상없음',count:1}]},
    'CORE-07':{comments:[{text:'“'+lexicalGap+'”의 조건을 검토한 과거 의견',verdict:'검토의견',count:1}]}
  }}:null;
  const lib=c.standard?{format:L.VERSION,templates:[structuredClone(standard)]}:L.empty();
  return {knowledge,corpus,lib,hints:J.index({knowledge,corpus})};
}
function evidenceCoordinates(rows,documents){
  let valid=0,incorporated=0;
  for(const e of rows){const d=documents[e.document_index];
    assert(d,'Evidence document index must resolve');
    assert.equal(d.name,e.document,'Evidence document name must resolve');
    assert(Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=0&&e.end>e.start,'Evidence must carry actual offsets');
    assert.equal(d.text.slice(e.start,e.end),e.text,'Citation offsets must reproduce the exact current text');valid++;if(d.registered_reference)incorporated++;
  }
  return {checked:rows.length,valid,incorporated_standard:incorporated};
}
function hintCoordinates(rows,documents,clauses){
  for(const row of rows){const e=row.current_evidence,d=documents[e.document_index];assert(d);assert.equal(d.name,e.document);
    const cl=(e.document_index===0?clauses:segment(d.text)).find(c=>c.index===e.clause_index);assert(cl,'Hint clause index must resolve');
    assert.equal(cl.body,e.text);assert(d.text.includes(e.text));assert.equal(row.reference_only,true);assert.equal(row.auto_approval,false);assert.equal(row.verdict,undefined);
  }return {checked:rows.length,valid:rows.length};
}
function run(){
  const runs=[];const coordinates={current_evidence:{checked:0,valid:0,incorporated_standard:0},hint_clause_links:{checked:0,valid:0},mapping_targets:{checked:0,valid:0}};
  for(const config of configurations){const src=sources(config),rows=[];
    for(const sample of examples){
      const documents=[{name:'본문',text:sample.text}],clauses=segment(sample.text),resolved=L.resolveDocuments(src.lib,documents);
      // Only the dedicated TemplateLibrary.prepare API is used for its snapshot.
      const input=L.prepare({current:true,confirmed:true,documents,scope,knowledge:src.knowledge});
      const direct=S.evaluate(cp(sample.id),item,{confirmed:true,documents:resolved.documents,scope,knowledge:src.knowledge,corpus:src.corpus,hints:src.hints});
      const template=L.evaluate(src.lib,cp(sample.id),item,input),automatic=direct.eligible||template.eligible;
      if(sample.expected)assert.equal(automatic,sample.expected(config),config.name+': '+sample.key);
      for(const result of [direct,template]){const metric=evidenceCoordinates(result.evidence||[],resolved.documents);for(const k of Object.keys(metric))coordinates.current_evidence[k]+=metric[k];}
      const hints=J.retrieve(cp(sample.id),documents,src.hints,clauses),hintMetric=hintCoordinates(hints,documents,clauses);
      for(const k of Object.keys(hintMetric))coordinates.hint_clause_links[k]+=hintMetric[k];
      const result=Core.run(clauses,[{checkpoints:[cp(sample.id)]}],{modules:['X-PII','X-FINOUT'],stance:'party',partyRoles:[],judgmentHints:src.hints},[]).result.results[0];
      assert(result,'Mapping probe must use the actual active question: '+sample.id);
      let mappingTarget=null;
      if(sample.group==='mapping_probe'){
        mappingTarget=result.best?.clauseIndex??null;
        if(config.corpus||config.legal){assert.equal(result.judgment_hint_candidate,true);assert.equal(result.coverage,'verify');assert.equal(mappingTarget,1);
          assert.equal(clauses.find(c=>c.index===mappingTarget).body,lexicalGap);assert.equal(result.autoClear,null);assert.equal(result.verdict,undefined);coordinates.mapping_targets.checked++;coordinates.mapping_targets.valid++;
        }else assert.notEqual(result.judgment_hint_candidate,true);
      }
      rows.push({key:sample.key,group:sample.group,check_id:sample.id,automatic,template_match:template.eligible,
        noun_alias_evidence:(direct.tag_evidence||[]).filter(e=>e.method==='current_text_tag_alias').length,
        corpus_hints:hints.filter(h=>h.kind==='aggregate_comment').length,legal_hints:hints.filter(h=>h.kind==='legal_review').length,
        mapping_hint_candidate:result.judgment_hint_candidate===true,mapping_target:mappingTarget,incorporated_documents:resolved.documents.filter(d=>d.registered_reference).length});
    }
    const count=(group,field)=>rows.filter(r=>r.group===group&&r[field]).length;
    runs.push({configuration:config,summary:{direct_positive_auto:count('direct_positive','automatic'),noun_alias_auto:count('tag_alias','automatic'),
      negative_control_auto:count('negative_control','automatic'),incorporation_auto:count('standard_incorporation','automatic'),equivalent_current_auto:count('standard_equivalence','automatic'),equivalent_standard_match:count('standard_equivalence','template_match'),
      corpus_hint_case_count:rows.filter(r=>r.corpus_hints).length,legal_hint_case_count:rows.filter(r=>r.legal_hints).length,mapping_probe_promoted:count('mapping_probe','mapping_hint_candidate')},rows});
  }
  const baseline=runs[0].rows.find(r=>r.group==='mapping_probe').automatic;
  for(const r of runs)assert.equal(r.rows.find(x=>x.group==='mapping_probe').automatic,baseline,'History must not change the automatic conclusion of the mapping probe');
  return {artifact:'v1.88-source-ablation',app_version:fs.readFileSync(path.join(F.ROOT,'VERSION'),'utf8').trim(),engine_version:S.VERSION,recognition_version:require('../src/agreement_judgment').VERSION,
    synthetic_only:true,private_sources_read:false,fixture_sha256:crypto.createHash('sha256').update(JSON.stringify({examples:examples.map(({expected,...e})=>e),standard:{name:standard.name,revision:standard.revision,text:standard.text},alias:{label:'암호화',value:'비가독화처리'},hint_expressions:[court,lexicalGap]})).digest('hex'),
    denominators:{configurations:7,fixed_cases_per_configuration:10,direct_positive:2,noun_alias:1,negative_control:4,standard_incorporation:1,standard_equivalence:1,mapping_probe:1,
      corpus_comment_expressions:2,legal_documents:1,legal_evidence_expressions:2,noun_alias_definitions:1,registered_standards:1},runs,coordinate_validation:coordinates,all_assertions_passed:true,
    limitations:['통제된 합성 기능 사례이며 폐쇄망 계약의 자동판정률·정확도 추정이 아님.','코퍼스/법률검토 참고 건수는 같은 본건 표현을 찾은 출처 수이며 정답이나 자동판정 증가가 아님.','매핑 전환은 고정된 표현 차이 탐침 1건이다. 전체 체크 매핑 정확도 개선률을 의미하지 않음.','좌표 검증 분모는 각 설정/경로의 검증 호출 수이며 독립 계약 건수가 아님. 편입 표준 원문 인용은 본문 직접 인용과 구분함.']};
}
if(require.main===module)console.log(JSON.stringify(run(),null,2));
module.exports={run};
