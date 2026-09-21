const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Verdict = require('../src/verdict');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
test('사유 변경은 문서 지문과 재확인 상태를 보존한다', () => {
  const store = {A:{verdict:'이상없음',origin:'manual',manual_context:'original',manual_context_v2:'scoped',needs_reconfirmation:true}};
  const changed = Verdict.setReason(store,'A','반영되어 있음');
  assert.equal(changed.A.manual_context,'original');
  assert.equal(Verdict.migrateStore(changed).A.manual_context_v2,'scoped');
  assert.equal(changed.A.needs_reconfirmation,true);
  const confirmed = Verdict.setVerdict(changed,'A','이상없음','','today','반영되어 있음');
  assert.equal(confirmed.A.needs_reconfirmation,undefined);
});
test('완료 집계와 잔여 목록은 같은 집합이며 재확인을 포함하고 완결성 경고는 제외한다', () => {
  const context = {state:{result:{results:[{cpId:'A'},{cpId:'B'},{cpId:'C'},{cpId:'C'}]},
    subDocCov:{A:{docName:'보안관리약정서'}},integrityFindings:[{id:'F',title:'중복',confidence:'high'}]},
    verdictStore:{B:{verdict:'이상없음'},C:{verdict:'이상없음',needs_reconfirmation:true}},
    _requiresDecision:()=>true, _cpById:id=>({id}),cpLabel:cp=>cp.id};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function pendingReviewCount()'),source.indexOf('// 부재 알람의 판정 여부')),context);
  assert.equal(context.pendingReviewCount(),2);
  assert.deepEqual(Array.from(context.pendingReviewItems(),x=>x.id),['A','C']);
  assert.match(context.pendingReviewItems()[0].reason,/보안관리약정서/);
});
test('동일 판정 재클릭은 취소하지 않고 메모를 유지한다', () => {
  const listeners = {};
  const button = {getAttribute:key=>key==='data-vcp'?'A':'이상없음', addEventListener:(event,fn)=>listeners[event]=fn};
  let saved;
  const context = {verdictStore:{A:{verdict:'이상없음',comment:'메모',reason:'반영되어 있음'}},
    _verdictEditPins:{},applyVerdict:(...args)=>saved=args,requestAnimationFrame:()=>{},
    document:{querySelectorAll:()=>[]}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function bindVerdictControls('),source.indexOf('// 검토의견 내보내기/불러오기')),context);
  context.bindVerdictControls({querySelectorAll:selector=>selector==='.vd-btn'?[button]:[]},()=>{});
  listeners.click();
  assert.deepEqual(saved,['A','이상없음','메모','반영되어 있음']);
});
