/* Independent v1.88 acceptance expectations from the approved 2026-09-18 plan.
 * Fixtures below are synthetic. Private source files are read locally, never copied
 * into reports. Run directly for aggregate diagnostics; require() for test data.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const ITEM={coverage:'addressed'};
const SCOPE={type:'outsourcing',stance:'party',roles:['위탁자'],party:'갑'};
const doc=text=>[{name:'본문',text}];
const court='본 계약과 관련하여 발생하는 분쟁은 갑의 본사 소재지를 관할하는 법원을 관할법원으로 한다.';
const namedCourt='본 계약과 관련하여 발생하는 분쟁에 관한 소송은 서울중앙지방법원을 전속관할 법원으로 한다.';
const syntheticCases=[];
function fixture(key,id,expected,text,extra={}){syntheticCases.push({key,id,expected,family:'synthetic-'+id,source_kind:'approved-plan-regression',documents:typeof text==='string'?doc(text):text,...extra});}

fixture('court-relative','CMN-19',true,'제1조(관할)\n'+court);
fixture('court-named','CMN-19',true,'제1조(관할)\n'+namedCourt);
fixture('court-metadata-before-title','CMN-19',true,'2026년 9월 18일\n용역계약서\n제1조(관할)\n'+court);
fixture('court-unrelated-despite','CMN-19',true,'제1조(관할)\n'+court+'\n제2조(하자보수)\n전항에도 불구하고 검수 후 12개월이 지난 하자는 유상으로 보수할 수 있다.');
fixture('court-empty-unrelated-annex','CMN-19',true,[...doc('제1조(관할)\n'+court),{name:'참고용 소개서',text:''}]);
fixture('court-annex-restarts-numbering','CMN-19',true,[...doc('제1조(용역)\n수급인은 자료 정리 업무를 수행한다.'),{name:'별첨 1 관할약정',text:'제1조(관할)\n'+court}]);
fixture('court-heading-only','CMN-19',false,'제1조(관할)');
fixture('court-toc-only','CMN-19',false,'목차\n제1조 목적 1\n제2조 관할 법원 3');
fixture('court-example-only','CMN-19',false,'작성 예시(본 계약에 적용하지 않음)\n'+court);
fixture('court-future-agreement','CMN-19',false,'제1조(관할)\n본 계약의 관할 법원은 추후 협의하여 정한다.');
fixture('court-blank','CMN-19',false,'제1조(관할)\n관할법원: __________');
fixture('court-conflicting-same-dispute','CMN-19',false,'제1조(관할)\n'+namedCourt+'\n제2조(관할)\n본 계약과 관련하여 발생하는 분쟁에 관한 소송은 부산지방법원을 전속관할 법원으로 한다.');
fixture('court-explicit-exclusion','CMN-19',false,'제1조(관할)\n'+court+'\n제2조(특약)\n제1조의 관할 법원 지정은 적용하지 않는다.');
fixture('court-unreadable-controlling-annex','CMN-19',false,[...doc('제1조(관할)\n'+court+'\n소송의 관할은 별첨 관할특약의 변경 내용이 우선한다.'),{name:'관할특약',text:''}]);
fixture('court-tags-only','CMN-19',false,'제1조(배송)\n배송지는 서울이다.',{input:{tags:['관할 지정 있음','이상없음'],content_tags:['jurisdiction'],history_tags:['관할 지정']}});

fixture('term-date-table-no-colon','CNS-TERM',true,'계약기간 2026년 5월 11일 ~ 2026년 10월 30일');
fixture('term-flat-table','CNS-TERM',true,'계약명 자료정리 용역 계약기간 2026년 5월 11일 ~ 2026년 10월 30일 계약금액 12000000원(부가세 포함)');
fixture('term-execution-year','CNS-TERM',true,'제1조(기간)\n본 계약은 체결일부터 1년간 유효하다.');
fixture('term-until-completion','CNS-TERM',true,'제1조(기간)\n계약기간은 계약 체결일부터 위탁업무 완료 시까지로 한다.');
fixture('term-payment-date-only','CNS-TERM',false,'제1조(대금)\n대금은 2026년 10월 30일까지 지급한다.');
fixture('term-reversed-dates','CNS-TERM',false,'계약기간 2026년 12월 31일 ~ 2026년 1월 1일');
fixture('term-invalid-date','CNS-TERM',false,'계약기간 2026년 2월 30일 ~ 2026년 12월 31일');
fixture('term-blank','CNS-TERM',false,'계약기간: ____년 __월 __일 ~ ____년 __월 __일');

fixture('vat-short-table','CMN-05',true,'대금 | 1000000원\nVAT 별도');
fixture('vat-parentheses','CMN-05',true,'계약금액 12000000원(부가세포함)');
fixture('vat-not-included','CMN-05',true,'계약대금: 1000000원(부가가치세 미포함)');
fixture('vat-distinct-price-buckets','CMN-05',true,'개발대금 1000000원(부가세 별도)\n유지보수대금 110000원(부가세 포함)');
fixture('vat-same-price-conflict','CMN-05',false,'본 계약대금 1000000원은 부가세 포함이다.\n본 계약대금 1000000원은 부가세 별도이다.');
fixture('vat-other-cost-included','CMN-05',false,'계약대금에는 출장비 및 교통비가 포함된다.');
fixture('vat-future-agreement','CMN-05',false,'부가세 포함 여부는 추후 협의한다.');

fixture('price-per-order-unit','CNS-PRICE',true,'제6조(대금의 지급)\n갑은 본 계약에 따른 대금을 발주 건별로 계약한 단가에 따라 정산하여 을에게 지급한다.');
fixture('price-flat-amount','CNS-PRICE',true,'제1조(대금)\n계약대금은 1000000원이다.');
fixture('price-commission-rate','CNS-PRICE',true,'제1조(수수료)\n수수료는 월 매출액의 3%로 산정한다.');
fixture('price-individual-order','CNS-PRICE',true,'제1조(대금)\n각 발주 건의 대금은 개별발주서에 정한 금액으로 한다.');
fixture('price-blank','CNS-PRICE',false,'제1조(대금)\n계약금액: ______원\n산정방식: ______');
fixture('price-same-price-conflict','CNS-PRICE',false,'제1조(대금)\n계약금액은 1000000원으로 한다.\n계약금액은 2000000원으로 한다.');
fixture('price-unilateral-change','CNS-PRICE',false,'제1조(대금)\n계약금액은 1000000원으로 한다.\n을은 갑의 동의 없이 계약금액을 일방적으로 증액할 수 있다.');

fixture('termination-company-only','CNS-END',true,'제1조(해지)\n을이 본 계약상 의무를 위반하면 갑은 계약을 해지할 수 있다.');
fixture('termination-seven-day-cure','CNS-END',true,'제1조(해지)\n당사자 일방이 계약을 위반한 경우 상대방은 7일의 시정기간을 부여하고 시정되지 않으면 계약을 해지할 수 있다.');
fixture('termination-unrelated-survival','CNS-END',true,'제1조(해지)\n을이 계약을 위반하면 갑은 계약을 해지할 수 있다.\n제2조(비밀유지)\n비밀정보의 공개는 금지되며 이 의무는 계약 종료 후 3년간 존속한다.');
fixture('termination-survival-only','CNS-END',false,'제1조(비밀유지)\n비밀유지 의무는 계약 종료 후 3년간 존속한다.');
fixture('termination-one-sided-actual-risk','CNS-END',false,'제1조(해지)\n을만 아무런 사유 없이 즉시 계약을 해지할 수 있으며 갑은 계약을 해지할 수 없다.');

fixture('damages-counterparty-liability','CNS-DAMAGE',true,'제11조(손해배상)\n을은 고의 또는 과실로 갑 또는 제3자에게 가한 손해를 배상하여야 한다.');
fixture('damages-delay-penalty','CNS-DAMAGE',true,'제1조(지체상금)\n을은 납품 지연 시 지체일수 1일에 대하여 계약금액의 0.1%를 지체상금으로 갑에게 지급한다.');
fixture('damages-force-majeure-exemption','CNS-DAMAGE',true,'제1조(면책)\n당사자는 천재지변 등 불가항력으로 발생한 손해에 대해서는 책임을 지지 않는다.');
fixture('damages-gross-fault-exemption','CNS-DAMAGE',false,'제1조(손해배상)\n을은 고의 또는 중과실로 갑에게 발생시킨 손해에 대해서도 일체의 책임을 지지 않는다.');
fixture('damages-company-all-faultless','CNS-DAMAGE',false,'제1조(손해배상)\n갑만 귀책사유와 관계없이 을에게 발생한 모든 손해를 배상하며 을은 어떠한 책임도 부담하지 않는다.');
fixture('damages-heading-only','CNS-DAMAGE',false,'제1조(손해배상 및 책임한도)');

fixture('amendment-written-agreement','CMN-21',true,'제1조(계약 변경)\n본 계약은 서면 합의에 따라 변경할 수 있다.');
fixture('amendment-agreement-two-sentences','CMN-21',true,'제1조(계약 변경)\n본 계약의 내용은 합의하여 변경한다. 변경 사항은 문서로 작성한다.');
fixture('amendment-consultation-only','CMN-21',false,'제1조(계약 변경)\n계약 변경은 추후 협의할 수 있다.');
fixture('amendment-agreement-no-writing','CMN-21',false,'제1조(계약 변경)\n본 계약의 내용은 합의하여 변경한다.');
fixture('amendment-unilateral','CMN-21',false,'제1조(계약 변경)\n을은 갑의 동의 없이 계약 내용을 서면 통지로 변경할 수 있다.');

fixture('inspection-plain-cooperation','CORE-10',true,'제1조(점검 및 시정)\n갑은 고객정보 관리 현황을 점검하고 시정을 요구할 수 있으며 을은 이에 협조한다.');
fixture('inspection-express-denial','CORE-10',false,'제1조(점검 및 시정)\n갑은 고객정보 관리 현황을 점검하고 시정을 요구할 수 있다. 다만 을은 모든 점검 및 시정 요구를 거부할 수 있다.');
fixture('purpose-limited-use','ALL-PII-03',true,'제1조(정보 이용)\n수령한 개인정보는 위탁업무 수행 목적에 한하여 사용한다.');
fixture('purpose-free-external-use','ALL-PII-03',false,'제1조(정보 이용)\n수령한 개인정보를 위탁업무 목적 외에도 자유롭게 이용할 수 있다.');
fixture('repair-short-phrase','SP-DEL-05',true,'제1조(하자보수)\n검수 후 1년간 무상 하자보수.');
fixture('repair-excluded','SP-DEL-05',false,'제1조(하자보수)\n을은 하자보수 책임을 부담하지 않는다.');
fixture('access-plain-restriction','PRIV-06',true,'제1조(접근 통제)\n개인정보 취급자의 접근 권한을 제한한다.');
fixture('access-express-exclusion','PRIV-06',false,'제1조(접근 통제)\n개인정보에 대한 접근 권한은 제한하지 않는다.');

const standardCoverage=['CORE-10','CORE-14','PRIV-03','PRIV-06','PRIV-07','CNS-DAMAGE','PRIV-13','PRIV-19','PRIV-20','ALL-PII-03','CMN-19','ITSEC-04','ITSEC-13'];
const standardNonCoverage=['ITCL-01','ITCL-02','ITCL-05','ITSEC-02','ITSEC-06','ITSEC-07','ITSEC-08','ITSEC-09','ITSEC-10','ITSEC-12','ITSEC-14','ITSEC-15'];

function loadChecks(){return JSON.parse(execFileSync('python3',['-c',
  "import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{cwd:ROOT,encoding:'utf8'}));}
function standardFiles(){const dir=process.env.CR_PRIVATE_STANDARDS_DIR||path.join(ROOT,'samples/internal-standards/extracted');
  if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(n=>n.normalize('NFC').startsWith('pii-agreements_')&&n.endsWith('.txt')).sort().map(n=>path.join(dir,n));}
function defaultCorpusPath(){const dir='/Users/nsss/Downloads';if(!fs.existsSync(dir))return null;
  const file=fs.readdirSync(dir).find(n=>n.normalize('NFC')==='contract-review-corpus-backup_2026-09-15_29건.json');return file?path.join(dir,file):null;}
function sumMap(rows,key){const out={};for(const row of rows)for(const [name,value]of Object.entries(row[key]||{}))if(typeof value==='number')out[name]=(out[name]||0)+value;return out;}
function total(map){return Object.values(map).reduce((n,v)=>n+v,0);}
function corpusSummary(file){
  if(!file||!fs.existsSync(file))return {available:false,replayable_source_families:null};
  const raw=fs.readFileSync(file),data=JSON.parse(raw),checks=Object.values(data.byCheck||{}),contracts=Object.values(data.contracts||{}),comments=checks.flatMap(c=>c.comments||[]);
  const documentSets=[];
  function visit(value){if(!value||typeof value!=='object')return;if(Array.isArray(value.documents)&&value.documents.some(d=>typeof d.text==='string'&&d.text.trim()))documentSets.push(value.documents);
    for(const [key,child]of Object.entries(value))if(key!=='documents')visit(child);}
  visit(data);
  const families=new Set(documentSets.map(ds=>crypto.createHash('sha256').update(ds.map(d=>String(d.text||'').normalize('NFC').replace(/\s+/g,' ')).join('\n')).digest('hex')));
  const verdicts=sumMap(checks,'counts'),reasons=sumMap(checks,'reason_counts'),origins=sumMap(checks,'origin_counts');
  return {available:true,sha256:crypto.createHash('sha256').update(raw).digest('hex'),format:data.meta?.format,
    reported_contract_count:data.meta?.contract_count||0,reported_distinct_contract_hashes:new Set(data.meta?.hashes||[]).size,
    contract_metadata_records:contracts.length,legacy_matching_excluded:data.meta?.legacy_matching_excluded||0,
    aggregated_check_ids:checks.length,verdict_counts:verdicts,total_aggregated_verdicts:total(verdicts),origin_counts:origins,
    reason_counts:reasons,total_reason_observations:total(reasons),check_ids_with_reason_observations:checks.filter(c=>total(c.reason_counts||{})>0).length,
    check_ids_without_reason_observations:checks.filter(c=>total(c.reason_counts||{})===0).length,
    comment_rows:comments.length,comment_observations:comments.reduce((n,c)=>n+(Number(c.count)||0),0),
    check_ids_with_comments:checks.filter(c=>(c.comments||[]).some(x=>String(x.text||'').trim())).length,
    check_ids_without_comments:checks.filter(c=>!(c.comments||[]).some(x=>String(x.text||'').trim())).length,
    snapshot_document_sets:documentSets.length,replayable_source_families:families.size,
    individual_manual_verdicts_with_reasons:null,individual_manual_verdicts_without_reasons:null,
    original_contract_automatic_pass_rate:null,
    limitations:['판정·사유·출처 집계는 개별 판정끼리 연결되지 않으므로 수기 판정 중 사유 유무를 정확히 분리할 수 없음.','집계 의견은 약정 원문이 아님. 원문·체크·수기정답 연결 없이 과거 계약 자동판정률을 재실행할 수 없음.','동일 원문 지문 수는 확인 가능한 최소 계열 수일 뿐 수정본·표준 파생 관계를 모두 증명하지 않음.']};
}
function evaluateSynthetic(S,checks){return syntheticCases.map(c=>{const cp=checks.find(x=>x.id===c.id);if(!cp)return {key:c.key,id:c.id,expected:c.expected,actual:false,pass:false,status:'check_missing'};
  const r=S.evaluate(cp,ITEM,{confirmed:true,scope:SCOPE,documents:c.documents,...c.input});
  return {key:c.key,id:c.id,expected:c.expected,actual:!!r.eligible,pass:!!r.eligible===c.expected,status:r.status,blocker_codes:(r.blockers||[]).map(b=>b.code||b.kind||'unspecified')};});}
function summariseRows(rows){const positives=rows.filter(r=>r.expected),negatives=rows.filter(r=>!r.expected);return {total:rows.length,positive_total:positives.length,positive_passed:positives.filter(r=>r.actual).length,negative_total:negatives.length,false_safe:negatives.filter(r=>r.actual).length,all_expectations_met:rows.every(r=>r.pass)};}
function runAudit(){const S=require('../src/standard_auto'),checks=loadChecks(),rows=evaluateSynthetic(S,checks);
  const report={artifact:'v1.88-independent-acceptance',engine_version:S.VERSION,app_version:fs.readFileSync(path.join(ROOT,'VERSION'),'utf8').trim(),
    meaning:'승인계획 기준의 고정 합성 수용시험. 실제 계약 정확도·폐쇄망 자동판정률이 아님.',synthetic:summariseRows(rows),rows,
    private_sources:{standard_file_count:standardFiles().length,corpus:corpusSummary(process.env.CR_PRIVATE_CORPUS||defaultCorpusPath())}};
  console.log(JSON.stringify(report,null,2));if(process.argv.includes('--assert')&&!report.synthetic.all_expectations_met)process.exitCode=1;
  if(process.argv.includes('--require-private')&&(report.private_sources.standard_file_count!==3||!report.private_sources.corpus.available))process.exitCode=1;return report;}
module.exports={ROOT,ITEM,SCOPE,doc,syntheticCases,standardCoverage,standardNonCoverage,loadChecks,standardFiles,corpusSummary,defaultCorpusPath,evaluateSynthetic,summariseRows};
if(require.main===module)runAudit();
