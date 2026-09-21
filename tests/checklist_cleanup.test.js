const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../src/standard_auto'),M=require('../src/matcher');
const vat={id:'CMN-05',check:S.catalog['CMN-05'].question,severity:'참고'};
function run(text){return S.evaluate(vat,{coverage:'quiet'},{confirmed:true,documents:[{name:'본문',text}]});}
test('부가세 포함·제외·별도 표시를 금액 문장·괄호·표 형태에서도 자동 확인',()=>{
 for(const text of ['계약금액은 1,000,000원(부가가치세 포함)이다.','대금: 1,000만원 / 부가세 제외',
 '부가가치세(부가세) 포함','부가가치세(VAT) 별도','공급가액 100원, VAT: 미포함',
 '계약금액은 부가세를 포함한 금액으로 한다.','부가세를 포함하지 않는다.','부가세 포함이 아님'])assert.equal(run(text).eligible,true,text);
});
test('부가세 부정·미정·선택·상충·예시는 자동확정하지 않음',()=>{
 for(const text of ['부가세 포함 여부 확인','부가세 포함 또는 제외',
 '예시: 부가세 포함','부가세 별도 협의','부가세 포함\n부가세 제외',
 '부가세 포함\n다만 본조의 부가세 처리 방식은 별첨 1의 내용을 우선 적용한다.','부가세 포함분은 환급한다.',
 '검토메모: 부가세 포함으로 볼 수 없다.','부가세 포함 표시는 오기이다.'])assert.equal(run(text).eligible,false,text);
});
test('지체상금만 있는 납품 조항을 지연이자 근거로 사용하지 않음',()=>{
 const cp={id:'CMN-05-2',check:'지연지급 시 지연이자(지연손해금) 약정이 있는가',severity:'참고',sources:[],absence_check:true,
 triggers:{keywords:['지연이자','지연손해금','연체이자','연체료','대금 지급 지연']},
 evidence_required_groups:[['지연이자','지연손해금','연체이자','연체료'],['지연이자','연체이자','연체료','대금 지급','대금의 지급','지급 지연','지급을 지체','미지급','연체']]};
 const clauses=[{index:0,heading:'지체상금',body:'납품이 지연되면 매 지체일마다 계약금액의 0.3%를 지체상금으로 지급한다.'},
 {index:1,heading:'지연이자',body:'대금 지급을 지체한 경우 미지급 대금에 연 12%의 지연이자를 지급한다.'}];
 assert.equal(M.evidenceRequirementsMet(clauses[0],cp),false);
 assert.equal(M.evidenceRequirementsMet(clauses[1],cp),true);
 const r=M.analyze(clauses,[{checkpoints:[cp]}],{modules:[],stance:'party'}).results[0];
 assert.equal(r.best.clauseIndex,1);
 assert.equal(M.evidenceRequirementsMet({heading:'납품 지연손해금',body:'납품 지연손해금은 계약금액의 0.1%로 지급한다.'},cp),false);
});
