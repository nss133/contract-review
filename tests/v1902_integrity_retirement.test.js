'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Findings=require('../src/findings'),app=fs.readFileSync(require.resolve('../src/app'),'utf8');
test('retired automatic warnings are absent; orphaned reviewer decisions and comments remain available',()=>{
  const store={manual:{M:{title:'직접 의견',comment:'본건 메모'}},decisions:{A:{decision:'opinion',comment:'별첨 보완 필요',reviewer:'검토자',date:'2026-09-17'},B:{decision:'dismissed',comment:'다른 약정 인용'},C:{decision:'no_issue',comment:''}}};
  const rows=Findings.reviewedProject(store,[{id:'new',title:'새 자동 경고',confidence:'high'}]);
  assert.equal(rows.length,4);assert(!rows.some(r=>r.decision==='pending'));
  assert.equal(rows.find(r=>r.id==='A').decision_comment,'별첨 보완 필요');
  assert.equal(rows.find(r=>r.id==='A').reviewer,'검토자');
  assert.equal(rows.find(r=>r.id==='B').decision,'dismissed');
  assert.equal(rows.find(r=>r.id==='C').decision,'no_issue');
  assert.equal(Object.keys(store.decisions).length,3);
});
test('legacy finding context survives normalization and a reanalysis without integrity items',()=>{
  const store={manual:{},decisions:{A:{decision:'opinion',comment:'',date:'2026-09-17'}}};
  const retained=Findings.preserveDecisionContext(store,[{id:'A',title:'기존 검토 제목',detail:'사람이 채택한 기존 의견',clause_index:2,heading:'제3조',severity:'중요'}]);
  const saved=Findings.normalizeStore(JSON.parse(JSON.stringify(retained)));
  const row=Findings.reviewedProject(saved,[])[0];
  assert.equal(row.title,'기존 검토 제목');assert.equal(row.detail,'사람이 채택한 기존 의견');
  assert.equal(row.clause_index,2);assert.equal(row.decision,'opinion');
  assert.equal(row.anchors[0].clause_index,2);
  assert.equal(store.decisions.A.context,undefined,'does not mutate original state before commit');
});
test('document review panel offers direct opinions only and does not render integrity or structure warnings',()=>{
  const block={innerHTML:''},ctx={document:{getElementById:()=>block},esc:String,_manualFindings:()=>[],_findingEditorHtml:()=>'',bindFindingControls(){},
    StructureReview:{html(){throw Error('retired structure editor rendered');},bind(){throw Error('retired structure editor bound');}},state:{integrityFindings:[{id:'W',confidence:'high'}]}};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function renderDocumentReviewBlock()'),app.indexOf('function refreshDocumentIntegrity()')),ctx);
  ctx.renderDocumentReviewBlock();assert.match(block.innerHTML,/계약 전반 의견/);assert.doesNotMatch(block.innerHTML,/완결성|점검 범위|document-integrity|integrity-fold/);
});
test('refresh retains document boundaries without running the retired integrity analyzer',()=>{
  const boundaries=[{line:2,mode:'annex',label:'보안약정'}],ctx={state:{text:'본문\n\n별첨',extractedDocument:{blocks:[]},integrityFindings:[],findingStore:Findings.emptyStore()},Findings,
    Integrity:{analyze(){throw Error('retired automatic check ran');}},StructureReview:{boundaries:()=>boundaries},DocumentStructure:{inspect(text,extraction,overrides){assert.equal(text,'본문\n\n별첨');assert.equal(overrides,boundaries);return {sections:[{id:'main'}]};}}};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function refreshDocumentIntegrity()'),app.indexOf('/* ---------- 종합 리포트')),ctx);ctx.refreshDocumentIntegrity();
  assert.equal(ctx.state.documentStructure.sections[0].id,'main');assert.equal(ctx.state.integrityFindings.length,0);assert.equal(ctx.state.integrityAssessment,null);
});
test('report has no retired warnings or completion counts but displays previous human decisions',()=>{
  const report=app.slice(app.indexOf('function renderReport()'),app.indexOf('function renderReport()')+60000);
  assert.doesNotMatch(report,/rpt-sec-integrity|integrityPending|점검 내 경고 없음|문서 완결성 검토의견/);
  assert.match(report,/Findings\.reviewedProject/);assert.match(report,/기존 검토의견·메모/);
});
