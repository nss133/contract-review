"use strict";
/* 현재 존재 질문의 복수 요건. 전체 문장 문법만 읽으며 실제 이행·법적 적정성을 추론하지 않는다. */
var PresenceProfiles=(function(){
  var duty='(?:하여야한다|해야한다|한다)',ban='(?:하여서는아니된다|해서는안된다|할수없다|하지못한다)',join='(?:[·ㆍ,]|및)',profiles={},rules=[];
  var roles=['수탁자','위탁자','수급인','발주자','정보수령자','전자금융보조업자','클라우드컴퓨팅서비스제공자','재수탁업자','원수탁업자','매도인','매수인','양도인','양수인','질권설정자','질권자','투자일임업자','집합투자업자','수탁회사','회사','주주','각당사자','본재보험계약'];
  var questions={
    "ITCL-05": "신규 이용계약 등 보고 사유 발생일부터 3개월 이내 감독원장 보고에 필요한 자료·통지 협조 조항이 있는가",
    "ITCL-06": "제공자의 합병·분할·계약상 지위 양도·재위탁 등 중대한 변경사항 발생 시 사전 통지 조항이 있는가",
    "ITSEC-11": "수탁자가 사전 동의 없이 재외부주문 계약 체결·계약업체 변경을 하지 못하도록 통제하는 조항이 있는가",
    "ITSEC-12": "업무수행인력의 사전 신원조회(또는 신원보증) 및 인력변경 시 인수인계 등 외주인력 관리방안 조항이 있는가",
    "ITSEC-14": "재위탁 구조라면 재수탁업자의 금융거래정보 변경이 위탁회사·원수탁업자의 개별 지시에 따르도록 하는 조항이 있는가",
    "ITSEC-15": "재위탁 구조라면 이용자 금융거래정보를 위탁회사 전산실 내에 두도록 하는 조항이 있는가",
    "SOL-03": "수탁자의 금융소비자보호법 위반으로 발생한 손해에 대한 책임 분담 조항이 있는가",
    "SOL-05": "선임·감독상 적절한 주의(면책 단서)를 증빙할 수 있는 교육·점검·관리 체계 조항이 있는가",
    "ITDL-07": "산출물에 사용된 제3자 소프트웨어·오픈소스의 라이선스 목록 고지와 라이선스 준수·책임 조항이 있는가",
    "ITDL-08": "산출물에 악성코드·백도어·무단 기능이 없음을 보증하고 위반 시 조치하는 조항이 있는가",
    "PRIV-13": "위탁자의 수탁자 교육 실시와 처리 현황 점검 등 감독 수인 의무 조항이 있는가",
    "PRIV-20": "수탁자 교육 의무와 수탁자의 안전한 신용정보 처리에 관한 사항이 위탁계약에 반영되어 있는가",
    "PRIV-21": "신용정보 처리 업무의 재위탁 금지(금융위원회 인정 시 예외) 조항이 있는가",
    "ALL-PII-03": "제공한 개인정보를 당초 목적 범위를 초과해 이용·제공하지 않도록 제한하는가",
    "ALL-REINS-01": "재보험 출재 시 원보험계약의 효력과 분리(원계약 무영향)가 전제되어 있는가",
    "FIN-SEC-01": "동산질권 설정 시 목적물 점유 이전(질물 인도)이 규정되어 있는가",
    "FIN-SEC-02": "지명채권 질권 설정에 필요한 통지·승낙의 이행 주체와 협력 의무가 계약에 규정되어 있는가",
    "FIN-SEC-05": "채권양도담보의 통지·승낙 및 확정일자 확보를 위한 의무·협력과 거래 조건이 계약에 규정되어 있는가",
    "INV-MAN-01": "투자일임업자가 선량한 관리자의 주의로 일임재산을 운용하도록(선관·충실의무) 규정되어 있는가",
    "INV-BEN-04": "신탁계약 변경 시 수익자에 대한 공시·통지 절차가 확보되어 있는가",
    "INV-BEN-07": "집합투자규약에서 정한 방법으로 전체 투자자에게 통지하는 절차가 마련되어 있는가(사모는 공시·공고를 이 통지로 갈음)",
    "INV-MAN-03": "투자일임재산의 분별관리(고유재산과 분리보관)와 신탁업자 예탁 등 재산보호 장치가 규정되어 있는가",
    "SP-DEL-04": "발주자(채권자) 귀책 또는 수령지체 중 이행불능 시 수급인의 대금청구권 유지 조항이 있는가",
    "SP-DEL-05": "용역(도급) 완성물에 하자가 있는 경우 상당한 기간을 정한 하자보수 청구권 조항이 있는가",
    "SP-DEL-06": "하자보수에 갈음하거나 보수와 함께 손해배상을 청구할 수 있는 조항이 있는가",
    "SP-DEL-07": "완성물의 하자로 계약 목적을 달성할 수 없는 경우의 해제권 조항이 있는가",
    "SH-SHARE-06": "동반매도참여권(tag-along) 행사 시 매수인이 소수주주 지분을 동일 조건으로 인수하도록 하는 의무가 규정되어 있는가",
    "SH-SHARE-08": "주식양도의 이행방법(주권 교부)과 명의개서 협력의무가 규정되어 있는가",
    "SH-GOV-04": "계약상 정보접근권이 상법상 소수주주 회계장부열람권·이사회의사록 열람권을 보완하도록 규정되어 있는가",
    "SH-ANT-01": "기업결합 관련 신고가 필요한 경우 당사자의 신고 협조 의무와 거래 종결 조건이 계약에 규정되어 있는가"
  };
  function part(topic,element,actors,pattern,fields){return {topic:topic,element:element,actors:actors,pattern:pattern,fields:Object.assign({object:element,action:element,modality:'obligation'},fields)};}
  function add(id,terms,parts){profiles[id]={question:questions[id],terms:terms,elements:parts.map(function(p){return p.element;}),parts:parts,bounded:true};
    parts.forEach(function(p){rules.push({topic:p.topic,pattern:new RegExp('^'+p.pattern+'$'),fields:p.fields});});}
  var trustee=['수탁자','전자금융보조업자'],cloud=['수탁자','클라우드컴퓨팅서비스제공자'];
  add('ITCL-05',['클라우드','보고 사유','감독원장','통지'],[
    part('cloud_reporting','보고 사유 발생일부터 3개월 이내 감독원장 보고 자료·통지 협조',cloud,'클라우드신규이용계약등보고사유발생일부터3개월이내감독원장보고에필요한자료제공'+join+'통지에협조'+duty,{condition:'보고사유발생일부터3개월이내'})]);
  add('ITCL-06',['합병','분할','지위 양도','재위탁','변경사항'],[
    part('cloud_changes','합병·분할·지위 양도·재위탁 등 중대한 변경 사전 통지',cloud,'자신의합병[·ㆍ,]분할[·ㆍ,]계약상지위양도'+join+'재위탁등중대한변경사항이발생하기전에위탁자에게통지'+duty,{counterparty:'위탁자',condition:'변경발생전'})]);
  add('ITSEC-11',['재외부주문','계약업체','사전 동의'],[
    part('resourcing_consent','재외부주문 체결·업체 변경 사전 동의',trustee,'위탁자의사전동의없이재외부주문계약을체결하거나계약업체를변경'+ban,{counterparty:'위탁자',modality:'consent_required',prior:true})]);
  add('ITSEC-12',['업무수행인력','신원조회','신원보증','인력변경','인수인계'],[
    part('personnel_screening','업무수행인력 사전 신원조회·보증',trustee,'업무수행인력에대하여업무투입전에(?:신원조회를실시|신원보증을확보)'+duty,{condition:'업무투입전'}),
    part('personnel_handover','인력변경 시 인수인계',trustee,'업무수행인력이변경되는경우인수인계를실시'+duty,{condition:'인력변경시'})]);
  add('ITSEC-14',['재수탁','금융거래정보','개별 지시'],[
    part('subtrustee_instruction','금융거래정보 변경은 위탁회사·원수탁업자의 개별 지시에 한정',['재수탁업자'],'위탁회사(?:와|또는)원수탁업자의개별지시에따라서만금융거래정보를변경'+duty,{condition:'위탁회사·원수탁업자개별지시',modality:'restricted_action'})]);
  add('ITSEC-15',['재수탁','금융거래정보','전산실'],[
    part('subtrustee_location','이용자 금융거래정보의 위탁회사 전산실 보관',['재수탁업자'],'이용자금융거래정보를위탁회사전산실내에보관'+duty,{condition:'위탁회사전산실내'})]);
  add('SOL-03',['금융소비자보호법','손해','책임'],[
    part('consumer_liability','수탁자의 금융소비자보호법 위반 손해배상',['수탁자'],'자신의금융소비자보호법위반으로발생한손해를배상'+duty,{condition:'자신의금융소비자보호법위반'})]);
  add('SOL-05',['선임','감독','교육','점검','관리 체계','기록'],[
    part('consumer_supervision','수탁자 선임·감독 교육·점검·관리 체계',['위탁자'],'수탁자의선임'+join+'감독을위한교육[·ㆍ,]점검'+join+'관리체계를운영'+duty),
    part('consumer_supervision_records','수탁자 교육·점검·관리 기록 보존',['위탁자'],'수탁자에대한교육[·ㆍ,]점검'+join+'관리기록을작성하고보존'+duty)]);
  add('ITDL-07',['산출물','소프트웨어','오픈소스','라이선스'],[
    part('license_inventory','산출물 제3자 소프트웨어·오픈소스 라이선스 목록 고지',['수탁자'],'산출물에사용된제3자소프트웨어'+join+'오픈소스의라이선스목록을위탁자에게고지'+duty,{counterparty:'위탁자'}),
    part('license_compliance','산출물 제3자 소프트웨어·오픈소스 라이선스 준수',['수탁자'],'산출물에사용된제3자소프트웨어'+join+'오픈소스의라이선스를준수'+duty),
    part('license_liability','산출물 라이선스 위반 손해배상',['수탁자'],'산출물에사용된제3자소프트웨어'+join+'오픈소스의라이선스위반으로위탁자에게발생한손해를배상'+duty,{counterparty:'위탁자',condition:'라이선스위반'})]);
  add('ITDL-08',['산출물','악성코드','백도어','무단 기능','보증'],[
    part('clean_deliverable','악성코드·백도어·무단 기능 부재 보증',['수탁자'],'산출물에악성코드[·ㆍ,]백도어'+join+'무단기능이없음을보증'+duty,{modality:'warranty'}),
    part('clean_deliverable_remedy','보증 위반 시 비용 부담·제거',['수탁자'],'산출물에악성코드[·ㆍ,]백도어또는무단기능이발견된경우자신의비용으로이를제거'+duty,{condition:'악성코드·백도어·무단기능발견'})]);
  add('PRIV-13',['개인정보','교육','처리 현황','점검','감독'],[
    part('privacy_training','위탁자의 개인정보 수탁자 교육',['위탁자'],'수탁자에게개인정보보호교육을실시'+duty,{counterparty:'수탁자'}),
    part('privacy_supervision','수탁자의 개인정보 처리 현황 점검·감독 수인',['수탁자'],'위탁자의개인정보처리현황점검'+join+'감독에응'+duty,{counterparty:'위탁자'})]);
  add('PRIV-20',['신용정보','교육','안전'],[
    part('credit_training','위탁자의 신용정보 수탁자 교육',['위탁자'],'수탁자에게신용정보보호교육을실시'+duty,{counterparty:'수탁자'}),
    part('credit_safety','수탁자의 안전한 신용정보 처리',['수탁자'],'신용정보의안전한처리를위하여기술적'+join+'관리적보호조치를실시'+duty)]);
  add('PRIV-21',['신용정보','재위탁','금융위원회'],[
    part('credit_subcontract','신용정보 처리 재위탁 금지',['수탁자'],'신용정보처리업무를재위탁'+ban,{modality:'prohibition'} )]);
  // 명시된 금융위원회 인정 예외는 별도 조건으로 보존한다. 민간 당사자 동의와 같게 읽지 않는다.
  rules.push({topic:'credit_subcontract',pattern:new RegExp('^금융위원회가인정한경우를제외하고신용정보처리업무를재위탁'+ban+'$'),fields:{object:'신용정보처리업무',action:'재위탁금지',modality:'prohibition',condition:'금융위원회인정예외'}});
  add('ALL-PII-03',['개인정보','목적','이용','제공'],[
    part('privacy_purpose','제공받은 개인정보의 목적 외 이용·제공 금지',['정보수령자','수탁자'],'제공받은개인정보를당초제공목적범위를초과하여이용하거나제3자에게제공'+ban,{modality:'prohibition'})]);
  // 관계 정의는 목적 외 이용 금지의 충족 근거가 아니다. 독립 정의문만 읽어 보존한다.
  rules.push({topic:'privacy_recipient_definition',actors:['정보수령자'],pattern:/^개인정보를제공받는자이다$/,fields:{object:'개인정보',action:'제공받는자정의',modality:'definition'}});
  add('ALL-REINS-01',['재보험','원보험','효력'],[
    part('reinsurance_independence','재보험 효력의 원보험계약 무영향',['본재보험계약'],'원보험계약의효력에영향을미치지않는다',{modality:'declaration'})]);
  add('FIN-SEC-01',['동산질권','목적물','인도','점유'],[
    part('pledge_delivery','질권설정자의 목적물 인도',['질권설정자'],'동산질권설정을위하여목적물을질권자에게인도'+duty,{counterparty:'질권자'})]);
  add('FIN-SEC-02',['지명채권','질권','통지','승낙'],[
    part('pledge_notice','질권설정자의 채무자 통지',['질권설정자'],'지명채권질권설정사실을채무자에게통지'+duty,{counterparty:'채무자'}),
    part('pledge_cooperation','질권자의 통지·승낙 협조',['질권자'],'지명채권질권설정의채무자통지또는승낙확보에협조'+duty)]);
  add('FIN-SEC-05',['채권양도담보','통지','확정일자','대출 실행'],[
    part('security_assignment_notice','양도인의 확정일자 있는 채권양도담보 통지',['양도인'],'채권양도담보설정사실을확정일자있는증서로채무자에게통지'+duty,{counterparty:'채무자'}),
    part('security_assignment_cooperation','양수인의 통지·확정일자 협조',['양수인'],'채권양도담보의채무자통지'+join+'확정일자확보에협조'+duty),
    part('security_assignment_condition','통지·확정일자 완료 전 대출 실행 금지',['양수인'],'채권양도담보의채무자통지'+join+'확정일자확보가완료되기전에는대출을실행'+ban,{modality:'prohibition',condition:'통지·확정일자확보완료전'})]);
  add('INV-MAN-01',['투자일임','일임재산','선량한','충실'],[
    part('mandate_care','투자일임재산의 선관주의 운용',['투자일임업자'],'선량한관리자의주의로일임재산을운용'+duty),
    part('mandate_loyalty','투자일임재산의 투자자 이익을 위한 충실 운용',['투자일임업자'],'투자자의이익을위하여충실하게일임재산을운용'+duty)]);
  add('INV-BEN-04',['신탁계약','변경','수익자','공시','통지'],[
    part('trust_change_notice','신탁계약 변경 내용 수익자 공시·통지',['수탁회사','수탁자'],'신탁계약을변경하는경우변경내용을수익자에게공시하고통지'+duty,{counterparty:'수익자',condition:'신탁계약변경시'})]);
  add('INV-BEN-07',['집합투자','규약','전체 투자자','통지'],[
    part('fund_notice','규약에서 정한 방법으로 전체 투자자 통지',['집합투자업자'],'집합투자규약에서정한방법으로전체투자자에게통지'+duty,{counterparty:'전체투자자',condition:'집합투자규약상방법'})]);
  add('INV-MAN-03',['투자일임','일임재산','고유재산','분리','예탁'],[
    part('mandate_segregation','투자일임재산·고유재산 분리보관',['투자일임업자'],'투자일임재산을고유재산과분리하여보관'+duty),
    part('mandate_deposit','투자일임재산 신탁업자 예탁',['투자일임업자'],'투자일임재산을신탁업자에게예탁'+duty,{counterparty:'신탁업자'})]);
  add('SP-DEL-04',['발주자','귀책','수령지체','이행불능','대금청구'],[
    part('contractor_payment','발주자 귀책·수령지체 중 이행불능에도 대금청구권 유지',['수급인'],'발주자의귀책사유또는수령지체중이행불능이된경우에도대금청구권을유지한다',{modality:'right',condition:'발주자귀책·수령지체중이행불능'})]);
  add('SP-DEL-05',['완성물','하자','하자보수','상당한 기간'],[
    part('defect_repair','완성물 하자에 대한 상당한 기간의 하자보수 청구권',['발주자'],'완성물에하자가있는경우상당한기간을정하여수급인에게하자보수를청구할수있다',{modality:'right',counterparty:'수급인',condition:'완성물하자·상당한기간'})]);
  add('SP-DEL-06',['하자','보수','손해배상'],[
    part('defect_damages','하자보수에 갈음하거나 함께 손해배상 청구',['발주자'],'완성물에하자가있는경우하자보수에갈음하여또는보수와함께수급인에게손해배상을청구할수있다',{modality:'right',counterparty:'수급인',condition:'완성물하자'})]);
  add('SP-DEL-07',['완성물','하자','목적','해제'],[
    part('defect_rescission','완성물 하자로 목적 달성 불능 시 해제권',['발주자'],'완성물의하자로계약목적을달성할수없는경우계약을해제할수있다',{modality:'right',condition:'완성물하자로목적달성불능'})]);
  add('SH-SHARE-06',['동반매도','소수주주','동일 조건','지분'],[
    part('tag_along','동반매도참여권 행사 시 소수주주 지분 동일 조건 인수',['매수인'],'소수주주의동반매도참여권행사시소수주주의지분을대주주와동일한조건으로인수'+duty,{condition:'소수주주동반매도참여권행사시'})]);
  add('SH-SHARE-08',['주식양도','주권','명의개서'],[
    part('share_delivery','주식양도 시 매도인의 주권 교부',['매도인'],'주식양도시매수인에게주권을교부'+duty,{counterparty:'매수인',condition:'주식양도시'}),
    part('share_registration','주식양도의 명의개서 협조',['매도인'],'주식양도에따른명의개서에협조'+duty)]);
  add('SH-GOV-04',['정보접근','회계장부','이사회의사록','열람','등사'],[
    part('shareholder_access','회계장부·이사회의사록의 계약상 열람·등사권',['회사'],'주주의요청이있는경우주주에게회계장부'+join+'이사회의사록의열람'+join+'등사를허용'+duty,{counterparty:'주주',condition:'주주요청시'}),
    part('shareholder_statutory_rights','계약상 정보접근권의 법정 권리 비제한',['회사'],'계약상정보접근권을이유로주주의상법상회계장부열람권'+join+'이사회의사록열람권을제한'+ban,{counterparty:'주주',modality:'prohibition'})]);
  add('SH-ANT-01',['기업결합','신고','거래 종결'],[
    part('merger_filing','기업결합 신고 필요 시 당사자 협조',['각당사자'],'기업결합신고가필요한경우신고에필요한자료제공에협조'+duty,{condition:'기업결합신고필요시'}),
    part('merger_closing','기업결합 신고 절차 완료를 거래 종결 조건으로 설정',['각당사자'],'기업결합신고가필요한경우신고절차가완료되기전에는본거래를종결'+ban,{condition:'기업결합신고필요·절차완료전',modality:'prohibition'})]);
  var subject=new RegExp('^('+roles.join('|')+')(?:은|는|이|가)');
  function parse(text,env){
    var s=text.replace(/(갑|을)(?=은|는|이|가|의|에게)/g,function(a){return env?.map?.[a]||a;}).replace(/클라우드서비스제공자/g,'클라우드컴퓨팅서비스제공자'),m=s.match(subject);
    if(!m)return null;var rest=s.slice(m[0].length);
    for(var rule of rules)if((!rule.actors||rule.actors.includes(m[1]))&&rule.pattern.test(rest)){var fields=Object.assign({},rule.fields);
      if(rule.topic==='personnel_screening')fields.method=rest.includes('신원조회')?'신원조회':'신원보증';
      if(rule.topic==='subtrustee_instruction')fields.instruction_parties=rest.startsWith('위탁회사또는')?'위탁회사또는원수탁업자':'위탁회사와원수탁업자';
      return {topic:rule.topic,actor:m[1],fields:fields};}
    return null;
  }
  return {VERSION:'presence-profiles-v1',profiles:profiles,roles:roles,parse:parse};
})();
if(typeof module!=='undefined')module.exports=PresenceProfiles;
