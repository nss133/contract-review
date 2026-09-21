'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const inventory=require('../knowledge/checklist_inventory_v188.json');
const policies=require('../knowledge/judgment_policies.json');
const revisions=require('../knowledge/checklist_revisions.json');
const knowledge=JSON.parse(execFileSync('python3',['-c',
 'from build.validate import load_knowledge; import json; k=load_knowledge("knowledge"); print(json.dumps({"checks":[c for d in [k["common"],*k["types"]] for c in d["checks"]],"modules":k["common"]["meta"]["modules"]},ensure_ascii=False))'],
 {cwd:path.join(__dirname,'..'),encoding:'utf8'}));
const cp=id=>knowledge.checks.find(c=>c.id===id), row=id=>inventory.checks.find(c=>c.id===id);
test('v1.88 전수 기준표는 기존 206개와 비활성 이력까지 일대일로 보존한다',()=>{
 assert.equal(inventory.checks.length,206);
 for(const entries of [inventory.checks,policies.checks,knowledge.checks]){
  assert.equal(entries.length,206);assert.equal(new Set(entries.map(x=>x.id)).size,206);
  assert.deepEqual(entries.map(x=>x.id).sort(),inventory.checks.map(x=>x.id).sort());
 }
 for(const r of inventory.checks){
  const c=cp(r.id), p=policies.checks.find(x=>x.id===r.id);
  assert.equal(c.check,r.question,r.id);assert.equal(p.question,r.question,r.id);
  assert.equal(c.active,r.active,r.id);assert.equal(p.active,r.active,r.id);
  assert.equal(c.meaning_revision,r.meaning_revision,r.id);assert.equal(p.meaning_revision,r.meaning_revision,r.id);
  assert.equal(p.level,r.level,r.id);assert.equal(c.judgment_level,r.level,r.id);
  assert.ok(r.previous_question&&r.rationale&&r.source_file,r.id);
  assert.ok(['keep','reword','merge','retire'].includes(r.disposition),r.id);
  assert.equal(r.migration.preserve_history,true,r.id);
 }
});
test('제외·통합·실제 이행은 활성 및 완료 집계에서 제외한다',()=>{
 const expectedInactive=['SH-ANT-01','SH-ANT-02','CRS-03','SOL-03','FIN-SEC-01','FIN-SEC-05','SP-DEL-04','SP-DEL-07','ITDL-08',
  'ITCL-04','SOL-01','PRIV-18','REL-02','REL-09','INV-FUND-03','CORE-05','FIN-ASSET-04','REL-03',
  'CORE-13','PRIV-08','NDA-15','SP-DEL-06'];
 assert.deepEqual(inventory.checks.filter(r=>!r.active).map(r=>r.id).sort(),expectedInactive.sort());
 assert.equal(inventory.counts.active,184);assert.equal(inventory.counts.inactive,22);
 assert.equal(revisions.active_count,184);assert.equal(revisions.stored_count,206);
 for(const id of expectedInactive){assert.equal(cp(id).active,false,id);assert.equal(row(id).migration.active_counted,false,id);}
 for(const id of ['SP-DEL-08-2','RISK-02','CMN-05-2'])assert.equal(cp(id),undefined,id);
});
test('의미 통합은 구 판정 복사 없이 실제 적용 의무를 추적한다',()=>{
 for(const [old,next] of [['CORE-13','CORE-10'],['PRIV-08','CNS-DAMAGE'],['NDA-15','CNS-DAMAGE'],['SP-DEL-06','CNS-DAMAGE']]){
  assert.equal(row(old).successor,next);assert.equal(row(old).migration.copy_old_pass,false);
  assert.equal(cp(next).active,true);assert.ok(cp(next).legacy_check_ids.includes(old));
 }
 assert.deepEqual(cp('CNS-DAMAGE').conditional_obligations.map(x=>x.id).sort(),['NDA-15','PRIV-08','SP-DEL-06']);
 for(const r of cp('CNS-DAMAGE').conditional_obligations){assert.equal(r.general_liability_may_cover,true);assert.equal(r.exclusion_blocks,true);assert.ok(r.scope&&r.question);}
 for(const id of ['CORE-09','SOL-04','CH-03'])assert.equal(cp(id).active,true,id);
});
test('모든 활성 존재 질문은 범위·대체/필수요소·반례·구체적인 지원 상태를 가진다',()=>{
 const presence=inventory.checks.filter(r=>r.active&&r.level==='presence');assert.equal(presence.length,62);
 for(const r of presence){
  assert.ok(r.requirements.any_of.length+r.requirements.all_of.length>0,r.id);
  assert.ok(Array.isArray(r.requirements.conditional),r.id);
  assert.ok(r.examples.positive&&r.examples.negative,r.id);
  assert.ok(r.auto_support.reason&&['required','supported'].includes(r.auto_support.status),r.id);
  assert.equal(r.blockers.includes('B6'),false,r.id);
  assert.equal(r.applicability.department_is_gate,false,r.id);
 }
 for(const r of inventory.checks.filter(r=>r.active&&r.level!=='presence')){
  assert.equal(r.auto_support.status,'manual',r.id);assert.ok(r.blockers.includes('B6'),r.id);
 }
});
test('공통 질문과 합의는 승인된 약정 확인 범위를 벗어나지 않는다',()=>{
 assert.equal(row('CMN-21').question,'합의에 따른 서면 변경 방식이 정해져 있는가');
 assert.deepEqual(row('CMN-21').requirements.all_of,['계약 변경에 대한 합의','서면·문서 방식']);
 assert.equal(cp('CMN-21').auto_clear,undefined);
 assert.equal(cp('CMN-21').triggers.keywords.includes('완전합의'),false);
 assert.equal(row('CNS-SECRET').level,'presence');assert.equal(row('CNS-IP').level,'presence');
 assert.ok(row('CNS-IP').requirements.any_of.some(x=>x.includes('사용권')));
 assert.ok(row('CNS-PRICE').requirements.any_of.some(x=>x.includes('개별발주서')));
 assert.ok(!row('CNS-END').requirements.all_of.some(x=>x.includes('30일')));
 for(const id of ['ITCL-05','ITSEC-09','ITSEC-10'])assert.doesNotMatch(row(id).question,/3개월|연 1회/);
});
test('클라우드·전자금융 외주·재위탁 범위를 구별하고 부서를 단독 게이트로 쓰지 않는다',()=>{
 for(const r of inventory.checks.filter(r=>r.id.startsWith('ITCL-')))assert.equal(r.applicability.scope,'cloud_service');
 for(const r of inventory.checks.filter(r=>r.id.startsWith('ITSEC-')))assert.equal(r.applicability.scope,'electronic_finance_outsourcing');
 for(const id of ['ITSEC-14','ITSEC-15'])assert.ok(row(id).applicability.requires.includes('reoutsourcing'));
 const cloud=knowledge.modules.find(x=>x.id==='X-CLOUD');assert.equal(cloud.name,'클라우드 이용');
 assert.equal(cloud.suggest_keywords.includes('국외'),false);
 const competition=knowledge.modules.find(x=>x.id==='X-COMP');assert.equal(competition.suggest_keywords.includes('기업결합'),false);
 for(const r of inventory.checks)assert.equal(r.applicability.department_is_gate,false,r.id);
});
test('표준 제10조와 감독기관 조항의 커버 범위를 기록하되 클라우드 누락을 만들지 않는다',()=>{
 assert.deepEqual(row('CORE-10').standard_evidence,{general:[10],ga:[10],reconsignment:[10]});
 assert.deepEqual(row('CORE-14').standard_evidence,{general:[14],ga:[16],reconsignment:[14]});
 for(const id of ['ITCL-01','ITCL-02','ITCL-05','ITSEC-02','ITSEC-06','ITSEC-08'])assert.deepEqual(row(id).standard_evidence,{},id);
});
