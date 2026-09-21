"use strict";
var _StdHash=typeof SafetyDigest!=="undefined"?SafetyDigest:require('./safety_digest');
var _StdPolicy=typeof JudgmentPolicy!=="undefined"?JudgmentPolicy:require('./judgment_policy');
var _StdCurrent=typeof AgreementJudgment!=="undefined"?AgreementJudgment:require('./agreement_judgment');
var _StdStructure=typeof DocumentStructure!=="undefined"?DocumentStructure:require('./document_structure');
/* 현행 질문별 공통 인식 결과를 검증된 자동판정 티켓으로 전달한다.
   과거 정답·승인·문장 전체 일치로 현재 근거 검사를 우회하지 않는다. */
var StandardAuto=(function(){
  var VERSION='standard-auto-v13', tickets=new WeakMap(),evaluations=new WeakMap(),inputProofs=new WeakMap();
  function bindingKey(cp,item){return _StdHash.of([cp.id,cp.meaning_revision,cp.check,cp.active,cp.review_scope,
    item&&[item.roleGated,item.relationshipGated,item.serviceGated,item.opinionScope]]);}
  function inputProof(input){var rows=input.documents||[],scope=_StdHash.of(input.scope||{}),structure=_StdCurrent.prepare(rows),tags=_StdStructure.revisionToken(input.knowledge?.tags),old=inputProofs.get(input);
    if(old&&old.scope===scope&&old.structure===structure&&old.tags===tags&&old.confirmed===input.confirmed&&old.rows.length===rows.length&&rows.every(function(d,i){var o=old.rows[i];return o.name===d.name&&o.text===d.text&&o.extraction===d.extraction;}))return old;
    var proof={scope:scope,structure:structure,tags:tags,confirmed:input.confirmed,rows:rows.map(function(d){return {name:d.name,text:d.text,extraction:d.extraction};}),hash:_StdHash.of([rows,input.scope])};inputProofs.set(input,proof);return proof;}
  var catalog={
    'CMN-04':{question:'대금의 지급 시기·방법과 정산 절차가 규정되어 있는가',terms:['대금','지급','정산','계좌','청구','검수','세금계산서']},
    'CMN-05':{question:'대금·수수료의 부가가치세 포함 여부가 명시되어 있는가',terms:['부가가치세','부가세','VAT','vat']},
    'CMN-06':{question:'계약기간의 시기·종기가 명시되어 있는가',terms:['계약기간','계약 기간','계약의 기간','유효기간','존속기간','갱신','연장','만료']},
    'CMN-19':{question:'분쟁해결 방식(소송·중재)과 관할 법원 지정 조항이 있는가',terms:['분쟁','관할','소송','중재','법원']},
    'CMN-08':{bounded:true,question:'해지·해제 사유(중대한 위반, 도산 등)가 규정되어 있고, 임의해지권·해지사유가 당사자 간 균형 있게(회사에만 불리하지 않게) 부여되어 있는가',
      decision:'해지·해제 사유와 당사자 간 권리 배분이 회사에 일방적으로 불리하지 않아 수정이 불필요한가?',
      terms:['해지','해제','중도','위반','시정','종료']},
    'CMN-09':{question:'해지 절차(시정 최고 기간·서면 통지)가 규정되어 있는가',terms:['해지','해제','시정','최고','통지','종료']},
    'CMN-11':{bounded:true,question:'손해배상 책임의 귀책사유와 배상 범위 조항이 있고, 그 책임이 어느 일방(특히 우리 회사)에만 편면적으로 부과되지 않는가',
      decision:'손해배상 책임과 범위가 회사에 편면적으로 불리하지 않아 수정이 불필요한가?',
      terms:['손해','배상','책임','면책','보상','한도','간접','일실','위약','지체상금']},
    'CMN-15':{question:'비밀정보의 정의·범위 조항이 있는가',terms:['비밀','기밀','영업비밀','공개','정보의 범위']}
  };
  var labels={no_rule:'현재 질문을 충족하는 정형 규칙 없음',disabled_check:'종합 판단이 필요한 체크',input_unconfirmed:'현재 본문을 분석하면 자동판정 재실행',
    uncertain_mapping:'현재 적용 대상·근거 연결 확인 필요',related_exception:'관련 단서·참조·충돌 확인 필요',
    no_evidence:'전체 요건을 충족하는 정형 문구 미확인',variant:'정형 패턴 밖의 관련 문구 확인 필요',
    source_quality:'빈 문서·미입력·변환 오류 확인 필요',historical_conflict:'같은 원문 또는 정형 패턴에 과거 보완·위험수용 판정 있음',
    supported:'질문별 약정 요건 확인',reused:'동일 본문·별첨·맥락의 사용자 충족 판정 재사용',clause_reused:'관련 조항·조건이 동등한 사용자 판단 재사용',stopped:'정형 자동판정 꺼짐'};
  [
    ['CNS-DAMAGE','CMN-11','손해배상의 귀책사유·범위와 면책·책임한도·지연책임 약정이 계약의 성격 및 회사의 지위에 비추어 합리적인가'],
    ['CNS-END','CMN-08','계약 해제·해지 사유와 권리 배분 및 시정·통지 절차가 회사에 일방적으로 불리하지 않고 명확한가'],
    ['CNS-TERM','CMN-06','계약의 시작·종료 시점과 갱신 약정이 있는 경우 그 조건·거절 절차가 명확하고 합리적인가'],
    ['CNS-PRICE','CMN-04','대금·수수료의 금액 또는 산정 기준과 지급 시기·방법·정산 절차가 거래 구조에 맞게 명확한가']
  ].forEach(function(row){catalog[row[0]]=Object.assign({},catalog[row[1]],{bounded:true,question:row[2],decision:row[2]+'?'});});
  catalog['CNS-PRICE'].terms=catalog['CMN-04'].terms.concat(['금액','수수료','단가','산식']);
  function norm(s){return String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();}
  function recognize(id,text){return _StdCurrent.recognize(id,text);}
  function scopeKey(scope){scope=scope||{};return _StdHash.of({type:scope.type,roles:scope.roles,party:scope.party,
    stance:scope.stance,modules:scope.modules,scope_answers:scope.scope_answers});}
  function evaluate(cp,item,input){
    input=input||{};var policy=_StdPolicy.get(cp);
    var out={check_id:cp.id,eligible:false,status:'no_rule',evidence:[],version:VERSION,history:[],blockers:[],missing:[],policy:policy};
    function end(status){out.status=status;out.message=labels[status]||status;
      evaluations.set(out,{binding:bindingKey(cp,item),input:input,proof:inputProof(input),digest:_StdHash.of(out)});return out;}
    if(cp.active===false||policy.active===false||cp.review_scope==='execution_only')return end('disabled_check');
    if(!input.confirmed)return end('input_unconfirmed');
    if(!policy.compatible||policy.level!=='presence')return end('no_rule');
    // 매핑은 후보 선택. 인용 위치 미확정·재할당만으로 본문 확인을 막지 않는다.
    if(!item||item.roleGated||item.relationshipGated||item.serviceGated||item.opinionScope)return end('uncertain_mapping');
    var result=_StdCurrent.evaluate(cp,input.documents||[],{scope:input.scope,knowledge:input.knowledge,hints:input.hints,source_standard:input.source_standard});
    Object.assign(out,result,{check_id:cp.id,version:VERSION,policy:policy,history:[]});
    out.recognition={stage:out.evidence.length?'clause_found':'not_found',evidence:out.evidence};
    out.pattern_key=_StdHash.of([VERSION,cp.id,policy.meaning_revision,result.elements,result.signature,(result.evidence||[]).map(function(e){return norm(e.text);})]);
    // 과거 결론은 평가·참고 자료. 현재 약정의 존재를 거부하거나 대신 충족시키지 않는다.
    out.references=[];
    return end(result.status);
  }
  function observe(checks,items,input,verdicts){var map={},out={};items.forEach(function(i){map[i.cpId]=i;});
    checks.forEach(function(cp){var v=verdicts[cp.id];if(!v||v.origin!=='manual'||v.needs_reconfirmation||
      !(v.verdict==='검토의견'||v.verdict==='이상없음'&&['반영되어 있음','수용 가능한 위험'].includes(v.reason)))return;
      // 사람 판단 외에 현재 원문의 정형 요건을 다시 확인한다. 과거 정답 재사용은 배제.
      var r=evaluate(cp,map[cp.id],Object.assign({},input,{corpus:null,review_packets:[],knowledge:null,judgment_sources:null}));
      if(r.status==='supported')out[cp.id]={version:VERSION,key:r.pattern_key,scope:scopeKey(input.scope),evidence:r.evidence};
    });return out;}
  function ticketFromEvaluation(cp,item,input,r){
    var known=evaluations.get(r);
    if(!known||known.binding!==bindingKey(cp,item)||known.input!==input||known.proof!==inputProof(input)||!r.eligible||known.digest!==_StdHash.of(r))return null;
    var t={};tickets.set(t,{check_id:cp.id,rule_id:'STANDARD-'+cp.id,
      rule_hash:_StdHash.of([VERSION,cp.id,_StdPolicy.get(cp).meaning_revision]),
      input_hash:known.proof.hash,evidence:r.evidence,kind:r.status,
      history:[],references:r.references||[],version:VERSION,meaning_revision:_StdPolicy.get(cp).meaning_revision});return t;
  }
  function ticket(cp,item,input){return ticketFromEvaluation(cp,item,input,evaluate(cp,item,input));}
  function consume(t,id){var p=tickets.get(t);if(!p||p.check_id!==id)return null;tickets.delete(t);return p;}
  function report(checks,items,input){var map={};items.forEach(function(i){map[i.cpId||i.check_id]=i;});
    var rows=checks.map(function(cp){return evaluate(cp,map[cp.id],input);}),counts={};rows.forEach(function(r){counts[r.status]=(counts[r.status]||0)+1;});
    var scored=0,wrong=0,released=0;rows.forEach(function(r){
      var known=r.history.filter(function(h){return h.verdict==='검토의견'||h.verdict==='이상없음'&&h.reason==='반영되어 있음';});
      if(!known.length)return;scored++;if(r.eligible&&known.some(function(h){return h.verdict==='검토의견';}))wrong++;
      if(r.eligible&&known.every(function(h){return h.verdict==='이상없음';}))released++;
    });
    return {version:VERSION,rows:rows,counts:counts,total:rows.length,candidates:rows.filter(function(r){return r.eligible;}).length,
      historical_comparison:{scored:scored,wrong:wrong,released:released,independent:false},
      caveat:'동일 입력의 과거 판정을 참고한 운영 비교이며 독립 정확도 시험이 아닙니다.'};
  }
  // 원문을 갖춘 실제 검토 저장본을 재실행. 자기 정답을 검색·재사용 경로에 넣지 않는다.
  function replay(packet,options){
    var labelsById=packet.verdicts||{},map={},rows=[];
    var input={confirmed:packet.confirmed===true,documents:packet.documents,
      scope:packet.context,date:packet.date,knowledge:options?.knowledge};
    (packet.items||[]).forEach(function(i){map[i.cpId||i.check_id]=i;});
    (packet.checks||[]).forEach(function(cp){var v=labelsById[cp.id];
      if(!v||v.origin!=='manual'||v.needs_reconfirmation)return;
      var truth=v.verdict==='검토의견'?'issue':v.verdict==='이상없음'&&v.reason==='반영되어 있음'?'safe':null;
      if(!truth)return;
      var r=evaluate(cp,map[cp.id],cp.id==='CMN-05'&&!input.confirmed?Object.assign({},input,{confirmed:true}):input);
      rows.push({check_id:cp.id,truth:truth,candidate:r.eligible,status:r.status,evidence:r.evidence,
        false_safe:r.eligible&&truth!=='safe',released:r.eligible&&truth==='safe'&&!(packet.before_auto||[]).includes(cp.id)});
    });
    return {id:packet.id,rows:rows,checked:rows.length,candidates:rows.filter(function(r){return r.candidate;}).length,
      false_safe:rows.filter(function(r){return r.false_safe;}).length,released:rows.filter(function(r){return r.released;}).length,
      independent:false,version:VERSION};
  }
  Object.keys(_StdCurrent.profiles).forEach(function(id){var p=_StdPolicy.all()[id];if(p)catalog[id]={question:p.question,terms:_StdCurrent.profiles[id].terms,bounded:true};});
  labels.related_exception='해당 약정의 배제·충돌·구체적 위험 확인 필요';labels.variant=labels.related_exception;labels.no_evidence='질문에 필요한 현재 약정 내용 미확인';labels.no_rule='현재 기준은 사람의 명확성·적정성 판단 대상';labels.disabled_check='검토 제외·통합된 항목';labels.source_quality='해당 약정의 원문 확인 필요';
  return {VERSION:VERSION,catalog:catalog,labels:labels,evaluate:evaluate,ticket:ticket,ticketFromEvaluation:ticketFromEvaluation,consume:consume,report:report,recognize:recognize,replay:replay,observe:observe};
})();
if(typeof module!=='undefined')module.exports=StandardAuto;
