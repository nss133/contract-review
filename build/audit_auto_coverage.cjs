// 정적 지원 범위다. 전체 문구의 인식률·실제 자동판정률로 해석하지 않는다.
const {execFileSync}=require('node:child_process');
const R=require('../src/requirement_rules'),S=require('../src/standard_auto'),D=require('../src/decision_evidence'),P=require('../src/judgment_policy');
const checks=JSON.parse(execFileSync('python3',['-c',"import json,yaml,pathlib;p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))"],{encoding:'utf8'}));
const rows=checks.map(cp=>{const rule=R.catalog[cp.id]||S.catalog[cp.id];return {id:cp.id,question:cp.check,level:P.get(cp).level,direct_rule:!!rule&&rule.question===cp.check,related_precedent:!!D.topics[cp.id]};});
console.log(JSON.stringify({version:require('node:fs').readFileSync('VERSION','utf8').trim(),meaning:'현재 질문과 일치하는 유한 문언 규칙의 종류 수. 모든 표현의 판정이나 폐쇄망 실측 자동판정률이 아님.',total:rows.length,direct_questions:rows.filter(r=>r.direct_rule).length,related_precedent_questions:rows.filter(r=>r.related_precedent).length,presence_without_direct_rule:rows.filter(r=>r.level==='presence'&&!r.direct_rule),rows},null,2));
