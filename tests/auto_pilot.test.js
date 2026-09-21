const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../src/auto_pilot'),T=require('../src/eval_trial'),H=require('../src/safety_digest');
function fixture(truth='safe',other=truth,text='수탁자는 해지 시 서면 통지하여야 한다.'){
 const checks=[{id:'A',check:'통지 확인'}],c={key:'k',source:{kind:'contract'},version:'before',documents:[{role:'main',name:'본문',text}],items:[{id:'i',check_id:'A',reviewer:'준비',status:'reviewed_draft'}]};
 c.items[0].context_digest=H.of([c.version,c.documents]);const t=T.freeze(c,checks,[{index:0,body:text}]);
 [truth,other].forEach((v,i)=>T.saveReview(t,{trial_id:t.id,seal:t.seal,reviewer:'독립'+i,independent:true,source_reviewed:true,labels:[{id:'A',truth:v,direct:v==='not_applicable'?[]:[0],reason:'대조함',evidence:'본문'}]}));
 const rule={id:'R',revision:'1',check_id:'A',type_ids:['outsourcing'],party_roles:['위탁자'],rationale:'시험',obligations:[{id:'o',actors:['수탁자'],actions:['통지'],objects:['해지'],conditions:['서면'],polarity:'obligation'}]};
 return [t,c,rule,checks,[{id:'A',coverage:'addressed',top1:0,top3:[0],surfaced:true,auto_safe:false}],{type:'outsourcing',roles:['위탁자'],source_quality_confirmed:true,scope_confirmed:true},'engine'];
}
test('합의 정답과 일치해도 개발 후보일 뿐 승인 근거로 승격하지 않는다',()=>{const args=fixture(),before=JSON.stringify(args);const r=A.observe(...args);assert.equal(r.status,'candidate_only');assert.equal(r.approval_eligible,false);assert.equal(JSON.stringify(args),before);});
test('문제·비적용 정답을 통과시키는 후보는 실패로 기록한다',()=>{for(const truth of ['issue','not_applicable']){const r=A.observe(...fixture(truth));assert.equal(r.false_safe,true);assert.equal(r.status,'failed');}});
test('검수 이견·판단불가는 안전 후보 성공으로 집계하지 않는다',()=>{for(const a of [fixture('safe','issue'),fixture('unknown')]){const r=A.observe(...a);assert.equal(r.unresolved_candidate,true);assert.equal(r.status,'unresolved');}});
test('부속서 예외·부정·필수 조건 누락·미노출은 후보를 보류한다',()=>{for(const text of ['수탁자는 해지 시 서면 통지할 수 있다.','수탁자는 해지 시 통지하여야 한다.','수탁자는 해지 시 서면 통지하여야 한다.\n다만 별첨이 우선 적용한다.'])assert.equal(A.observe(...fixture('safe','safe',text)).candidate,false);const a=fixture();a[4][0].coverage='quiet';assert.equal(A.observe(...a).candidate,false);});
test('안전 정답이라도 근거 조항이 잘못 연결되면 실패다',()=>{const a=fixture();a[4][0].top1=null;assert.equal(A.observe(...a).mapping_error,true);});
test('원문·체크 변경, 금지 체크, 범위·원문 미확인 차단',()=>{for(const mutate of [a=>a[1].documents[0].text+='변경',a=>a[3][0].auto_verdict=false,a=>a[5].scope_confirmed=false,a=>a[5].roles=['수탁자'],a=>a[0].reviews.pop()]){const a=fixture();mutate(a);assert.throws(()=>A.observe(...a));}});
