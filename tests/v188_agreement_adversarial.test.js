'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Agreement=require('../src/agreement_judgment');
const Structure=require('../src/document_structure');
const inventory=require('../knowledge/checklist_inventory_v188.json');
const documents=text=>[{name:'본건 계약서',text}];
const check=(id,text,expected,options={})=>{
 const docs=Array.isArray(text)?text:documents(text),before=JSON.stringify(docs);
 const result=Agreement.evaluate({id},docs,options);
 assert.equal(result.eligible,expected,JSON.stringify({id,text,status:result.status,missing:result.missing,blockers:result.blockers}));
 assert.equal(JSON.stringify(docs),before,'입력 원문·추출 구조를 수정하지 않는다');
 assert.ok(result.evidence.every(e=>docs[e.document_index].text.slice(e.start,e.end)===e.text),'근거는 합성 문장이 아닌 원문 위치여야 한다');
 return result;
};
const cases=[
 ['CORE-06','수탁자는 관련 법령을 준수하지 않는다.',false],
 ['CORE-06','수탁자는 관련 법령을 준수할 수 있다.',false],
 ['CORE-06','수탁자는 관련 법령을 준수하여야 한다고 예시한다.',false],
 ['CORE-10','수탁자는 위탁자의 현황 점검 및 자료제출 요구에 협조하여야 한다고 예시한다.',false],
 ['CORE-10','“수탁자는 위탁자의 점검에 협조하여야 한다.”',false],
 ['PRIV-19','수탁자는 개인정보를 암호화한 것으로 기록한다.',false],
 ['PRIV-19','수탁자는 개인정보를 암호화 처리하여야 한다.',true],
 ['PRIV-19','수탁자는 개인정보를 암호화 처리하도록 노력한다.',false],
 ['PRIV-07','수탁자는 위탁자의 개인정보 처리 현황 점검에 협력할 수 있다.',false],
 ['PRIV-07','수탁자는 위탁자의 개인정보 관리 현황 점검에 협조한 자료를 삭제해야 한다.',false],
 ['PRIV-07','위탁자가 개인정보 관리 현황을 점검하는 경우 수탁자는 이에 협조해야 한다.',true],
 ['PRIV-19','수탁자는 개인정보를 암호화하고 그 의무 대신 기술적·관리적 보호조치를 실시한다.',false],
 ['PRIV-19','수탁자는 개인정보를 암호화하고 기술적·관리적 보호조치를 일부 실시한다.',true],
 ['PRIV-03','수탁자는 개인정보의 기술적·관리적 보호조치를 일부 실시한다.',false],
 ['PRIV-03','수탁자는 필요한 경우에만 개인정보의 기술적·관리적 보호조치를 취한다.',false],
 ['PRIV-03','위탁자는 개인정보의 기술적·관리적 보호조치를 취한다.',false],
 ['PRIV-03','개인정보의 기술적·관리적 보호조치를 위탁자는 실시한다.',false],
 ['PRIV-03','개인정보의 기술적·관리적 보호조치를 수탁자는 실시할 수 있다.',false],
 ['CORE-07','위탁자는 수탁자의 사전 동의 없이 재위탁할 수 없다.',false],
 ['CORE-07','수탁자는 위탁자의 사후 동의를 받아 재위탁할 수 있다.',false],
 ['CORE-07','수탁자 상호: 나회사\n가회사는 위탁자의 사전 동의 없이 재위탁할 수 없다.',false],
 ['CORE-07','수탁자 상호: 나회사\n나회사는 위탁자의 사전 동의 없이 재위탁할 수 없다.',true],
 ['CORE-07','을은 갑의 사전 동의 없이 재위탁할 수 없다.',true],
 ['CORE-07','수탁자는 “위탁자의 사전 동의 없이 재위탁할 수 없다”는 조항을 삭제한다.',false],
 ['CORE-10','갑은 점검과 시정을 요구할 수 있으며 을은 이에 응한다.\n또한 이 의무를 면한다.',false],
 ['PRIV-21','수탁자는 위탁자가 인정한 경우를 제외하고 신용정보 처리 업무를 재위탁하여서는 아니 된다.',false],
 ['PRIV-21','수탁자는 신용정보 처리 업무를 재위탁하여서는 아니 된다.\n다만, 위탁자가 인정한 경우에는 그러하지 아니하다.',false],
 ['PRIV-21','수탁자는 신용정보 처리 업무를 재위탁하여서는 아니 된다.\n다만, 금융위원회가 인정한 경우에는 그러하지 아니하다.',true],
 ['ALL-PII-03','정보수령자는 개인정보를 목적 외 이용할 수 없다.\n정보수령자는 자체 목적의 이용은 제한받지 않는다.',false],
 ['CNS-SECRET','비밀유지 의무는 계약 종료 후 3년간 존속한다.',false],
 ['CNS-SECRET','비밀유지 의무는 「보안관리약정서」 제1조에 따른다.\n별첨 보안관리약정서\n제1조(기간)\n기간은 3년이다.',false],
 ['CNS-SECRET','상대방에게 받은 비밀정보는 비밀로 유지한다.',true],
 ['SH-GOV-04','회사는 주주에게 회계장부 및 이사회의사록 열람을 허용한다.\n회사는 상법상 회계장부열람권 및 이사회의사록 열람권을 제한할 수 없다.',true],
 ['SH-GOV-04','회사는 주주에게 회계장부 열람을 허용한다.\n다만, 회계장부를 열람할 수 없다.',false],
 ['SP-DEL-05','발주자는 필요한 경우에만 하자보수를 청구할 수 있다.',true],
 ['ITSEC-01','외주 개발에 사용하는 전산설비는 내부 업무용과 분리하여 운영한다.',false],
 ['ITSEC-05','금융회사와 수탁자 간 시스템 접속에 VPN을 사용한다.',false],
 ['ITSEC-05','금융회사와 수탁자 간 시스템 접속에 전용회선과 동등한 보안수준의 VPN을 사용한다.',true],
 ['ITSEC-08','수탁자는 중요 전산자료의 백업자료를 보존하고 가능한 범위의 백업설비를 확보한다.',true],
 ['ITSEC-14','재수탁업자는 위탁회사와 원수탁업자의 개별 지시에 관계없이 금융거래정보를 변경한다.',false],
 ['ITSEC-15','재수탁업자는 금융거래정보를 위탁회사 전산실에 보관하지 않고 자체 전산실에 보관한다.',false],
 ['PRIV-03','개인정보에 관한 기술적·관리적 보호조치는 불필요하다.',false],
 ['INV-BEN-04','수탁회사는 신탁계약을 변경하는 경우 그 내용을 회사에게 공시하고 통지한다.',false],
 ['INV-BEN-07','운용자는 규약이 정하는 사항을 일부 투자자에게 통지한다.',false],
 ['CMN-19','관할 법원을 검토하기 위해 서울중앙지방법원을 방문한다.',false],
 ['CMN-19','관할법원은 서울중앙지방법원으로 한다.\n본 계약의 관할법원은 서울중앙지방법원으로 한다.',true],
 ['CMN-05','대금은 100만원이며 부가세 포함하지 않는다.',true],
 ['CMN-05','대금은 100만원이며 부가세 포함이 아님.',true],
 ['CMN-05','계약대금은 부가세 별도 협의한다.',false],
 ['CMN-05','부가세 포함분을 환급한다.',false],
 ['CMN-05','대금은 부가세 포함 또는 제외로 한다.',false],
 ['CMN-05','대금은 부가세 포함, 부가세 별도이다.',false],
 ['CMN-05','개발대금은 부가세 포함, 유지보수대금은 부가세 별도이다.',true],
 ['CNS-PRICE','계약금액은 100만원이다. 계약금액은 200만원이다.',false],
 ['CNS-PRICE','개발대금은 100만원이다. 유지보수대금은 200만원이다.',true]
];
cases.forEach(([id,text,expected],i)=>test('v1.88 적대 사례 '+(i+1)+': '+id,()=>check(id,text,expected)));
test('존재형 62개 모두 키워드 목록이나 제목만으로 승인하지 않는다',()=>{
 for(const r of inventory.checks.filter(r=>r.active&&r.level==='presence')){
  const terms=Agreement.profiles[r.id].terms.join(' / ');
  check(r.id,terms,false);
  check(r.id,'제1조('+terms+')',false);
 }
});
test('알려지지 않은 특수 속성명은 프로파일로 인식하지 않는다',()=>{
 for(const id of ['__proto__','constructor','toString'])check(id,'본 계약의 관할법원은 서울중앙지방법원으로 한다.',false);
});
const personnel='제1조(인력관리)\n① 수탁자는 다음 각 호의 사항을 이행하여야 한다.\n1. 다음 각 목의 사항을 이행할 것\n가. 다음 각 세목의 사항을 이행할 것\n(1) 업무 투입 전에 신원조회를 실시할 것\n(2) 업무수행인력이 변경되는 경우 인수인계를 실시할 것';
test('3단 목록의 실제 세목 제한과 무관한 별첨의 같은 번호를 구별한다',()=>{
 check('ITSEC-12',personnel,true);
 check('ITSEC-12',personnel+'\n제2조(특약)\n제1조 제1항 제1호 가목 제2세목은 적용하지 않는다.',false);
 const annex='\n별첨 1 운송약정서\n제1조(배송)\n배송지는 서울이다.\n제2조(특약)\n제1조 제1항 제1호 가목 제2세목은 적용하지 않는다.';
 check('ITSEC-12',personnel+annex,true);
 check('ITSEC-12',personnel+annex.replace('제1조 제1항','본문 제1조 제1항'),false);
});
test('범위 참조의 양 끝뿐 아니라 중간 필수 약정도 배제 대상인지 확인한다',()=>{
 const text='제1조(목적)\n본 계약의 목적을 정한다.\n제2조(라이선스)\n수탁자는 오픈소스 라이선스 목록을 제공하고 라이선스 준수 책임을 부담한다.\n제3조(기간)\n계약기간은 1년이다.';
 check('ITDL-07',text,true);
 check('ITDL-07',text+'\n제4조(특약)\n제1조부터 제3조까지는 적용하지 않는다.',false);
});
test('미해소 추가 특약이 현재 원문 조문을 지목하면 조용히 버리지 않는다',()=>{
 check('PRIV-03',[{name:'본문',text:'제1조(보호)\n수탁자는 개인정보의 기술적·관리적 보호조치를 취한다.'},{name:'특약',text:'제1조의 조치는 적용하지 않는다.'}],false);
});
test('상위 목록의 선택·노력·면제는 하위 근거에도 남긴다',()=>{
 for(const text of [personnel.replace('이행하여야 한다','준수하도록 노력한다'),personnel.replace('각 목의 사항을 이행할 것','각 목의 사항을 이행할 수 있다'),'수탁자가 동의하는 경우에만 아래 사항을 적용한다.\n'+personnel.replace('제1조(인력관리)\n',''),personnel+'\n다만, 긴급한 경우 해당 의무를 생략할 수 있다.'])check('ITSEC-12',text,false);
});
const grid=[['주체','대상','의무'],['수탁자','개인정보','기술적·관리적 보호조치']];
function table(cells=grid){
 const x=Structure.fromBlocks('docx',[{text:'제1조(보호조치)'}].concat(cells.flatMap((row,r)=>row.map((text,c)=>({text,source:{table:{id:'t',row:r,col:c,colspan:1,rowspan:1}}})))),[]);
 return [Structure.document('본문',x.text,x)];
}
test('명사형도 명시 의무 열의 완전한 행이면 약정으로 인식한다',()=>check('PRIV-03',table(),true));
test('표 셀의 누락·병합·주체 충돌을 명사형 약정 확대로 숨기지 않는다',()=>{
 check('PRIV-03',table([grid[0],['','개인정보','기술적·관리적 보호조치']]),false);
 check('PRIV-03',table([grid[0],['수탁자','개인정보','위탁자는 기술적·관리적 보호조치를 취한다.']]),false);
 for(const [key,value] of [['rowspan',2],['colspan',2],['row',3],['invalid',true]]){
  const docs=table();docs[0].extraction.blocks[4].source.table[key]=value;check('PRIV-03',docs,false);
 }
 check('PRIV-03',documents(table()[0].text),false);
});
test('같은 배열의 원문과 표 구조를 제자리 수정해도 캐시가 예전 통과를 돌려주지 않는다',()=>{
 const docs=documents('수탁자는 관련 법령을 준수한다.');check('CORE-06',docs,true);
 docs[0].text='수탁자는 관련 법령을 준수하지 않는다.';check('CORE-06',docs,false);
 const tab=table();check('PRIV-03',tab,true);tab[0].extraction.blocks[4].source.table.rowspan=2;check('PRIV-03',tab,false);
});
test('태그 별칭은 실제 본문에 나온 내용만 보조하고 수정된 별칭 캐시도 갱신한다',()=>{
 const knowledge={tags:{t:{type:'content',label:'암호화',aliases:['비가독화처리']}}};
 const docs=documents('수탁자는 개인정보를 비가독화처리하여 저장한다.');
 const r=check('PRIV-19',docs,true,{knowledge});assert.ok(r.tag_evidence.some(e=>e.method==='current_text_tag_alias'));
 knowledge.tags.t.aliases[0]='가역변환처리';check('PRIV-19',docs,false,{knowledge});
 check('PRIV-19','표시용 해시태그: 개인정보 암호화 이상없음',false,{knowledge});
});
test('부정·조건·허용 문구를 태그 별칭으로 등록해도 한정이 삭제되거나 충족으로 승격되지 않는다',()=>{
 const examples=[
  ['PRIV-06','접근','접근 제한 의무가 없음','수탁자는 개인정보 접근 제한 의무가 없음에도 일반 권한만 통제한다.'],
  ['PRIV-06','접근','접근 제한','수탁자는 개인정보 접근 제한 구체적인접속관리기준들은 없음으로 정한다.'],
  ['PRIV-19','암호화','암호화하지 않는다','수탁자는 개인정보를 암호화하지 않는다며 저장한다.'],
  ['PRIV-19','암호화','암호화하지 않음','수탁자는 개인정보를 암호화하지 않음 상태로 저장한다.'],
  ['PRIV-19','암호화','필요한 경우에만 비가독화처리','수탁자는 개인정보를 필요한 경우에만 비가독화처리하여 저장한다.'],
  ['PRIV-19','암호화','비가독화처리할 수 있다','수탁자는 개인정보를 비가독화처리할 수 있다며 저장한다.']
 ];
 for(const [id,label,alias,text] of examples){
  const knowledge={tags:{t:{type:'content',label,aliases:[alias]}}};
  check(id,text,false);
  const result=check(id,text,false,{knowledge});
  assert.ok(!result.tag_evidence.some(e=>e.method==='current_text_tag_alias'),'문장형 별칭을 인식 근거로 승격하지 않는다');
 }
 const knowledge={tags:{t:{type:'content',label:'암호화',aliases:['비가독화처리']}}};
 const result=check('PRIV-19','수탁자는 개인정보를 비가독화처리하여 저장한다.',true,{knowledge});
 assert.ok(result.tag_evidence.some(e=>e.method==='current_text_tag_alias'),'정상 명사형 별칭은 계속 활용한다');
 knowledge.tags.t.aliases[0]='필요한 경우에만 비가독화처리';
 check('PRIV-19','수탁자는 개인정보를 필요한 경우에만 비가독화처리하여 저장한다.',false,{knowledge});
});
test('회사 귀속은 명시된 ourAliases를 사용하고 상대방 위험을 회사 이익으로 뒤집지 않는다',()=>{
 const text='갑은 고의·중과실로 인한 손해도 배상책임을 지지 않는다.';
 check('CNS-DAMAGE',text,true,{scope:{party:{ourAliases:['갑']}}});
 check('CNS-DAMAGE',text,false,{scope:{party:{ourAliases:['을']}}});
});
test('갑·을 회사 후보가 상충하면 실제 편중 위험에서만 보류하며 일반 약정은 차단하지 않는다',()=>{
 const extreme='을은 고의·중과실로 발생한 손해에 대해서도 일체의 배상책임을 지지 않는다.';
 for(const party of [
  {ourAliases:['을','갑']},{ourAliases:['갑','을']},
  {companyLabel:'갑',ourAliases:['을']},
  {companyLabel:'을',ourLabel:'갑'},
  {ourAliases:['을'],counterpartyAliases:['을']}
 ]){
  const options={scope:{party}},risk=check('CNS-DAMAGE',extreme,false,options);
  assert.ok(risk.blockers.some(b=>b.code==='B5'));
  check('CNS-DAMAGE','각 당사자는 자신의 귀책사유로 상대방에게 발생한 손해를 배상한다.',true,options);
  check('CMN-19','본 계약의 관할법원은 서울중앙지방법원으로 한다.',true,options);
  const ip=check('CNS-IP','산출물의 저작권은 을에게 귀속한다.',false,options);
  assert.ok(ip.blockers.some(b=>b.code==='B1'));
  check('CNS-IP','회사는 계약 목적상 산출물을 사용할 수 있다.',true,options);
 }
 check('CNS-DAMAGE',extreme,true,{scope:{party:{ourAliases:['을','을'],counterpartyAliases:['갑']}}});
 check('CNS-DAMAGE',extreme,false,{scope:{party:{companyLabel:'갑',ourAliases:['갑']}}});
});
test('양도 절대금지 또는 사전 서면 동의 통제를 대체 요건으로 확인한다',()=>{
 check('CMN-20','계약상 지위의 양도는 금지한다.',true);
 check('CMN-20','계약상 지위는 상대방의 사전 서면 동의를 받아 양도할 수 있다.',true);
 check('CMN-20','계약상 지위는 상대방의 사전 동의를 받아 양도할 수 있다.',false);
 check('CMN-20','계약상 지위는 상대방의 사후 서면 동의를 받아 양도할 수 있다.',false);
});
test('산출물은 회사 소유 또는 사용권을 확인하고 기존 권리·상대방 소유만으로 대체하지 않는다',()=>{
 const opts={scope:{party:{companyLabel:'갑'}}};
 check('CNS-IP','산출물 저작권은 회사에 귀속한다.',true,opts);
 check('CNS-IP','산출물 저작권은 을에게 귀속한다.\n갑은 이를 사용할 수 있다.',true,opts);
 check('CNS-IP','산출물 저작권은 회사에 귀속되지 않지만 회사는 산출물을 사용할 수 있다.',true,opts);
 check('CNS-IP','산출물 저작권은 을에게 귀속한다.',false,opts);
 check('CNS-IP','산출물 저작권은 회사에 귀속되지 않는다.',false,opts);
 check('CNS-IP','산출물 저작권은 을에게 귀속하며 회사는 이를 사용할 수 없다.',false,opts);
 check('CNS-IP','기존 저작권은 갑에게 귀속한다.',false,opts);
 const assigned='수탁자는 산출물에 대한 소유권이 갑에게 있음을 인정한다.';
 check('CNS-IP',assigned,true,opts);
 check('CNS-IP',assigned,false);
 check('CNS-IP',assigned,true,{source_standard:true});
 for(const text of ['수탁자는 산출물을 위탁 목적 외로 이용할 수 없다.','수탁자는 산출물을 업무 목적 외로 사용할 수 없다.']){
  check('CNS-IP',text,false,opts);check('CNS-IP',text,false,{source_standard:true});
 }
});
