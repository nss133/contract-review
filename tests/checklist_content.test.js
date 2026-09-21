const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),path=require('node:path');
const checks=JSON.parse(execFileSync('python3',['-c',`import yaml,json,pathlib
p=pathlib.Path('knowledge');print(json.dumps([c for f in [p/'common.yaml',*sorted((p/'types').glob('*.yaml'))] for c in yaml.safe_load(f.read_text())['checks']],ensure_ascii=False))`],{cwd:path.join(__dirname,'..'),encoding:'utf8'}));
const cp=id=>checks.find(c=>c.id===id),M=require('../src/matcher'),S=require('../src/standard_auto');
const manifest=require('../knowledge/checklist_revisions.json');
function auto(id,text){return S.evaluate(cp(id),{coverage:'addressed'},{confirmed:true,documents:[{name:'본문',text}]});}
test('원질문 통합 계보를 보존하고 현재 활성·제외·승계 범위를 분리',()=>{
 assert.equal(checks.length,206);assert.equal(manifest.replacements.length,13);
 const retired=manifest.replacements.flatMap(r=>r.legacy_ids);assert.equal(retired.length,48);
 for(const id of retired)assert.ok(!cp(id)||cp(id).active===false,id);
 for(const r of manifest.replacements){const c=cp(r.id);assert.ok(c.check&&c.note);assert.equal(c.children,undefined);assert.ok(c.meaning_revision);}
 assert.equal(checks.filter(c=>c.active!==false&&c.review_scope!=='execution_only').length,manifest.after_count);
 for(const m of manifest.new_merges){assert.equal(cp(m.legacy_id).active,false);assert.ok(cp(m.id).active!==false);assert.equal(m.copy_old_pass,false);}
});
test('손해배상 질문은 주 조항에 연결되며 별도 지연이자 체크가 없음',()=>{
 const clauses=[{index:0,heading:'제3조(손해배상)',body:'당사자 일방은 자신의 귀책사유로 발생한 손해를 상대방에게 배상한다. 손해배상의 범위는 통상손해로 한다.'},
 {index:1,heading:'제4조(지체상금)',body:'납품이 지연되면 매일 계약금액의 0.3%를 지체상금으로 지급한다.'}];
 const r=M.analyze(clauses,[{checkpoints:[cp('CNS-DAMAGE')]}],{modules:[],stance:'party'}).results[0];
 assert.equal(r.best.clauseIndex,0);assert.equal(cp('CMN-05-2'),undefined);
 assert.equal(auto('CNS-DAMAGE','당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.').eligible,true);
 assert.equal(auto('CNS-DAMAGE','당사자 일방은 자신의 귀책사유로 본 계약을 위반하여 상대방에게 발생한 통상손해를 배상하여야 한다.\n손해배상 책임은 100만원으로 제한한다.').eligible,true);
});
test('정의만 있는 비밀유지 조항을 확장된 질문의 정답으로 자동 승계하지 않음',()=>{
 assert.equal(auto('CNS-SECRET','“비밀정보”란 본 계약의 수행 과정에서 상대방으로부터 제공받은 기술상 또는 경영상의 정보로서 비밀로 표시된 정보를 말한다.').eligible,false);
});
test('대금 질문은 대가 또는 산정기준을 확인하며 월말 정산은 강제하지 않음',()=>{
 const payment='위탁자는 수탁자의 청구서 수령일로부터 30일 이내에 대금을 수탁자의 지정 계좌로 지급한다.\n양 당사자는 매월 말일에 실제 수행 내역을 상호 확인하여 대금을 정산한다.';
 assert.equal(auto('CNS-PRICE',payment).eligible,false);
 assert.equal(auto('CNS-PRICE','대금은 1000000원으로 한다.\n'+payment).eligible,true);
});
test('해지 약정이 확인되면 고정된 30일 시정기간을 강제하지 않음',()=>{
 const t='당사자 일방이 본 계약상의 의무를 중대하게 위반한 경우 상대방은 30일의 기간을 정하여 서면으로 시정을 요구하고 그 기간 내에 시정하지 아니하면 서면 통지로 본 계약을 해지할 수 있다.';
 assert.equal(auto('CNS-END',t).eligible,true);assert.equal(auto('CNS-END',t.replace('30일','1일')).eligible,true);
});
test('개인정보 일반 조항을 재위탁 통제의 근거로 채택하지 않음',()=>{
 assert.equal(M.evidenceRequirementsMet({heading:'개인정보 보호',body:'개인정보 보호에 관하여 별첨 보안관리약정서를 체결한다.'},cp('CNS-PRIVSUB')),false);
});
