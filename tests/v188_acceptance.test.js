'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const S=require('../src/standard_auto'),L=require('../src/template_library'),Register=require('../src/template_register'),V=require('../src/verdict');
const F=require('../build/audit_v188_acceptance.cjs');
const checks=F.loadChecks(),cp=id=>{const c=checks.find(c=>c.id===id);assert.ok(c,'active question exists: '+id);return c;};

// Expected booleans are specified in the approved plan, not copied from the engine.
for(const c of F.syntheticCases)test('v1.88 수용: '+c.key,()=>{
  const input={confirmed:true,scope:F.SCOPE,documents:c.documents,...c.input};
  const result=S.evaluate(cp(c.id),F.ITEM,input);
  assert.equal(!!result.eligible,c.expected,c.key+' / '+c.id+' / '+result.status);
  if(c.expected){
    assert.ok(result.evidence?.length,'current evidence required');
    assert.ok(result.evidence.some(e=>e.text&&c.documents.some(d=>d.text.includes(e.text))),'evidence must occur in a current document');
    const ticket=S.ticket(cp(c.id),F.ITEM,input),verdicts=V.applyStandard({},c.id,'2026-09-18',ticket);
    assert.equal(verdicts[c.id]?.origin,'auto');assert.equal(verdicts[c.id]?.verdict,'이상없음');
    assert.deepEqual(V.applyStandard({},c.id,'2026-09-18',ticket),{},'ticket is not reusable');
  }
});

test('v1.88 수용: 제목뿐인 관할을 표준 등록·적용 경로도 통과시키지 않음',()=>{
  for(const text of ['제1조(관할)','제1조(배송)\n배송지는 서울이다.','목차\n제1조 관할 법원 3']){
    const t=Register.process('합성 표준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'},[cp('CMN-19')]);
    const library={format:L.VERSION,templates:[t]},input={current:true,scope:F.SCOPE,documents:F.doc(text)};
    assert.equal(t.bindings.some(b=>b.check_id==='CMN-19'),false,'heading must not be registered as a clause');
    assert.equal(L.evaluate(library,cp('CMN-19'),F.ITEM,input).eligible,false);
    assert.deepEqual(V.applyTemplate({},'CMN-19','2026-09-18',L.ticket(library,cp('CMN-19'),F.ITEM,input)),{});
  }
});

test('v1.88 수용: 자료실 표준만 등록되어 있어도 본건 적용 근거 없이 통과시키지 않음',()=>{
  const text=F.syntheticCases.find(c=>c.key==='court-relative').documents[0].text;
  const t=Register.process('합성 표준','1',text,{type_ids:['outsourcing'],roles:[],stance:'party'},[cp('CMN-19')]);
  assert.equal(L.evaluate({format:L.VERSION,templates:[t]},cp('CMN-19'),F.ITEM,{current:true,scope:F.SCOPE,documents:F.doc('제1조(납품)\n물품은 서울에 납품한다.')}).eligible,false);
});

test('v1.88 수용: 본건 자동 근거가 있어도 최신 수기 판정을 덮어쓰지 않음',()=>{
  const c=F.syntheticCases.find(c=>c.key==='court-relative'),old={'CMN-19':{origin:'manual',verdict:'검토의견',comment:'직접 확인한 개별 의견'}};
  const input={confirmed:true,scope:F.SCOPE,documents:c.documents};
  assert.equal(V.applyStandard(old,c.id,'2026-09-18',S.ticket(cp(c.id),F.ITEM,input)),old);
});

const files=F.standardFiles(),required=process.env.CR_REQUIRED_PRIVATE==='1';
test('v1.88 실제 표준 입력 3종 확보',{skip:!files.length&&!required},()=>assert.equal(files.length,3));
for(const [index,file]of files.entries()){
  const text=fs.readFileSync(file,'utf8'),t=Register.process('로컬 보안약정 '+(index+1),'2025.01',text,{type_ids:['outsourcing'],roles:[],stance:'party'},checks);
  const library={format:L.VERSION,templates:[t]};
  for(const id of F.standardCoverage)test('v1.88 실제 보안약정 '+(index+1)+' 커버 '+id,()=>{
    const input={confirmed:true,current:true,scope:F.SCOPE,documents:F.doc(text)};
    assert.equal(S.evaluate(cp(id),F.ITEM,input).eligible,true,'본건 동일 약정의 직접 판정: '+id);
    assert.ok(t.bindings.some(b=>b.check_id===id),'등록 시 자료 승인 없이 연결: '+id);
    assert.equal(L.evaluate(library,cp(id),F.ITEM,input).eligible,true,'표준 경로: '+id);
  });
  for(const id of F.standardNonCoverage)test('v1.88 실제 보안약정 '+(index+1)+' 미포함 '+id,()=>{
    const input={confirmed:true,current:true,scope:F.SCOPE,documents:F.doc(text)};
    assert.equal(S.evaluate(cp(id),F.ITEM,input).eligible,false,'일반 보안약정만으로 특수 요건을 확인했다고 처리하지 않음');
    assert.equal(L.evaluate(library,cp(id),F.ITEM,input).eligible,false);
  });
  test('v1.88 실제 보안약정 '+(index+1)+' 본문·별첨 제1조 재시작에도 CORE-10 판정',()=>{
    const documents=[...F.doc('제1조(업무)\n고객정보 처리와 보안은 별첨 보안관리약정서에 따른다.'),{name:'별첨 보안관리약정서',text}];
    assert.equal(S.evaluate(cp('CORE-10'),F.ITEM,{confirmed:true,scope:F.SCOPE,documents}).eligible,true);
  });
  for(const [id,opposite]of [
    ['CORE-10','본 보안약정의 관리·감독 조항에도 불구하고 을은 갑의 모든 점검 및 시정 요구를 거부할 수 있다.'],
    ['ALL-PII-03','본 보안약정에도 불구하고 을은 고객정보를 업무 목적 외에도 자유롭게 이용할 수 있다.']
  ])test('v1.88 실제 보안약정 '+(index+1)+' 반대특약은 표준경로도 차단 '+id,()=>{
    const documents=[...F.doc(text),{name:'특약',text:opposite}],input={confirmed:true,current:true,scope:F.SCOPE,documents};
    assert.equal(S.evaluate(cp(id),F.ITEM,input).eligible,false,'현재 반대특약의 직접 판정');
    assert.equal(L.evaluate(library,cp(id),F.ITEM,input).eligible,false,'등록 표준이 현재 반대특약을 우회하지 않음');
    const altered=Register.process('반대특약이 포함된 합성 표준','1',text+'\n제99조(특약)\n'+opposite,{type_ids:['outsourcing'],roles:[],stance:'party'},[cp(id)]);
    assert.equal(altered.bindings.some(b=>b.check_id===id),false,'반대약정이 포함된 표준의 허위 연결 금지');
  });
}

test('v1.88 코퍼스 평가 분모는 집계 판정 수를 원문 수로 부풀리지 않음',()=>{
  const file=process.env.CR_PRIVATE_CORPUS||F.defaultCorpusPath();
  if(!file){assert.equal(required,false,'required private corpus unavailable');return;}
  const r=F.corpusSummary(file);assert.equal(r.available,true);
  assert.ok(r.replayable_source_families<=r.snapshot_document_sets);
  if(r.snapshot_document_sets===0){assert.equal(r.original_contract_automatic_pass_rate,null);assert.equal(r.individual_manual_verdicts_with_reasons,null);}
});
