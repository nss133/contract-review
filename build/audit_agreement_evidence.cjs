// 원문은 출력하지 않는다. 공개 표준서식 5개, 동일한 낙관적 매핑 조건으로 규칙만 비교한다.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),Module=require('node:module');
const current=require('../src/standard_auto');
const html=cp.execFileSync('unzip',['-p','dist/contract-review-v1.74.0.zip','contract-review.html'],{encoding:'utf8',maxBuffer:20e6});
const start=html.indexOf('var _StdHash='),marker="if(typeof module!=='undefined')module.exports=StandardAuto;",end=html.indexOf(marker,start);
if(start<0||end<0)throw Error('이전 배포본 엔진을 찾을 수 없음');
const mod=new Module(path.resolve('src/standard_auto_baseline.js'));mod.filename=path.resolve('src/standard_auto_baseline.js');mod.paths=module.paths;mod._compile(html.slice(start,end+marker.length),mod.filename);
const previous=mod.exports;
const checks=JSON.parse(cp.execFileSync('python3',['-c',`import yaml,json,pathlib
p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))`],{encoding:'utf8'}));
function run(engine,text){let statuses={},accepted=[],recognized=[];for(const c of checks){const r=engine.evaluate(c,{coverage:'addressed'},{confirmed:true,documents:[{name:'본문',text}]});statuses[r.status]=(statuses[r.status]||0)+1;if(r.eligible)accepted.push(c.id);if(r.recognition?.stage==='clause_found')recognized.push(c.id);}return {statuses,accepted,recognized};}
const rows=fs.readdirSync('testdata/standard_contracts/text').map(file=>{const text=fs.readFileSync('testdata/standard_contracts/text/'+file,'utf8');return {file,before:run(previous,text),after:run(current,text)};});
console.log(JSON.stringify({method:'공개 원본 그대로, 모든 항목의 매핑·입력 확인 조건을 통과시킨 엔진 비교. 정답지 없음. 정확도나 전체 앱 자동판정 비율 아님.',rows},null,2));
