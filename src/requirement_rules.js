"use strict";
/* 존재 질문의 필수 약정 요소. 주제 태그만으로는 충족시키지 않는다. */
var RequirementRules=(function(){
  var A=typeof AgreementEvidence!=='undefined'?AgreementEvidence:require('./agreement_evidence');
  var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules');
  var D=typeof DecisionEvidence!=='undefined'?DecisionEvidence:require('./decision_evidence');
  var Q=typeof ClauseSemantics!=='undefined'?ClauseSemantics:require('./clause_semantics');
  var Profiles=typeof PresenceProfiles!=='undefined'?PresenceProfiles:require('./presence_profiles');
  function frame(text){
    var Q=typeof ClauseEquivalence!=='undefined'?ClauseEquivalence:require('./clause_equivalence');return Q.frame(text);
  }
  var catalog={
    'CORE-07':{question:'수탁자가 위탁자의 사전 동의 없이 재위탁하지 못하도록 하는 조항이 있는가',terms:['재위탁','재수탁','사전 동의'],elements:['위탁자의 사전 동의'],topic:'prior_consent',values:['수탁자','위탁자','재위탁','서면','사전']},
    'PRIV-06':{question:'위탁 문서에 개인정보에 대한 접근 제한 등 안전성 확보 조치에 관한 사항이 포함되어 있는가',terms:['접근','안전성'],elements:['개인정보 접근 제한'],topic:'least_access',values:['수탁자','개인정보','업무수행','최소범위']},
    'PRIV-07':{question:'위탁 문서에 개인정보 관리 현황 점검 등 감독에 관한 사항이 포함되어 있는가',terms:['점검','감독','관리 현황'],elements:['위탁자의 현황 점검에 협조'],topic:'inspection',values:['수탁자','위탁자','개인정보처리현황점검','협조의무']},
    'PRIV-03':{question:'위탁 문서에 개인정보의 기술적·관리적 보호조치에 관한 사항이 포함되어 있는가',terms:['기술적','관리적','보호조치','안전성'],elements:['기술적·관리적 보호조치']},
    'PRIV-19':{question:'수탁자에게 개인신용정보 제공 시 식별정보의 암호화 등 보호조치 조항이 있는가',terms:['식별정보','암호화'],elements:['제공받은 개인신용정보 식별정보 암호화']},
    'CMN-20':{question:'계약상 지위·권리의무의 사전 서면 동의 없는 양도·이전·담보 제공을 금지하는 조항이 있는가',terms:['계약상 지위','권리의무','양도','이전','담보'],elements:['지위·권리의무의 양도·이전·담보 사전 서면 동의']},
    'CMN-21':{question:'완전합의 조항과 서면에 의한 변경 방식 조항이 있는가',terms:['완전한 합의','완전합의','종전','계약의 변경','계약변경','서면에 의한 변경'],elements:['완전합의','쌍방 서면 변경']},
    'PRIV-08':{question:'위탁 문서에 수탁자의 의무 위반 시 손해배상 등 책임에 관한 사항이 포함되어 있는가',terms:['의무 위반','의무를 위반','배상','책임'],elements:['수탁자의 위탁 의무 위반에 따른 배상책임']},
    'CORE-14':{question:'수탁자가 위탁업무와 관련한 금융감독원장의 검사·자료제출 요구에 응하도록 하는 조항이 있는가',terms:['감독원','검사','자료제출'],elements:['위탁업무 관련 감독원 검사·자료제출 수인']},
    'CMN-18':{question:'제3자 지식재산권 침해 주장 시 수탁자의 방어·면책 의무 조항이 있는가',terms:['지식재산','지적재산','침해','방어','면책'],elements:['제3자 권리침해 주장에 대한 방어·면책']},
    'CRS-03':{question:'국문·영문 등 복수 언어로 작성된 경우, 언어 간 불일치 시 어느 언어본이 우선하는지 정하는 조항이 있는가',terms:['국문','영문','언어','번역','불일치'],elements:['국문·영문 불일치 시 우선 언어']},
    'NDA-15':{question:'비밀정보(영업비밀) 침해로 인한 손해배상책임 조항이 있는가',terms:['비밀','침해','누설','배상'],elements:['비밀정보 침해에 따른 배상책임']}
  };
  Object.assign(catalog,{
    'CORE-06':{question:'위탁업무 처리가 금융실명법 등 관련 법령에 저촉되지 않도록 하는 법령 준수 조항이 있는가',terms:['금융실명','법령','준수'],elements:['위탁업무 처리 시 금융실명법 등 관련 법령 준수'],semantic:'law_compliance'},
    'CORE-10':{question:'위탁자의 업무 처리 현황 점검·자료 요구·감사권 등 수탁자 관리·감독 조항이 있는가',terms:['업무 처리','업무처리','점검','자료','감사','감독'],elements:['위탁자의 업무 처리 현황 점검·자료 요구·감사'],semantic:'work_supervision'},
    'CORE-13':{question:'감독당국의 변경권고 등 조치가 있는 경우 계약 변경·시정에 협조하는 조항이 있는가',terms:['변경권고','감독당국','시정'],elements:['감독당국 조치 시 계약 변경·시정 협조'],semantic:'supervisory_correction'},
    'ITCL-01':{question:'클라우드 이용업무의 중요도 평가에 필요한 자료 제공 협조 조항이 있는가',terms:['중요도','중요업무','클라우드'],elements:['클라우드 이용업무 중요도 평가 자료 제공 협조'],semantic:'cloud_importance',actors:['수탁자','클라우드컴퓨팅서비스제공자']},
    'ITCL-02':{question:'클라우드컴퓨팅서비스 제공자의 건전성·안전성 평가에 필요한 자료 제공 협조 조항이 있는가',terms:['건전성','안전성','클라우드'],elements:['클라우드 제공자 건전성·안전성 평가 자료 제공 협조'],semantic:'cloud_soundness',actors:['수탁자','클라우드컴퓨팅서비스제공자']},
    'ITSEC-10':{question:'수탁자가 제공하는 서비스의 품질수준 연 1회 이상 평가에 협조하는 조항이 있는가',terms:['품질','서비스 수준','평가'],elements:['제공 서비스 품질수준 연 1회 이상 평가 협조'],semantic:'service_quality'}
  });
  Object.assign(catalog,{
    'ITSEC-01':{"question":"외부주문 개발업무에 사용되는 업무장소·전산설비를 내부 업무용과 분리하여 설치·운영하는 조항이 있는가","terms":["업무장소","전산설비","분리"],"elements":["외부주문 개발 업무장소·전산설비의 내부 업무용 분리 설치·운영"],"semantic":"separate_facilities","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-02':{"question":"금융회사와 이용자 간 암호화정보 해독 및 원장 등 중요 데이터 변경을 금지하는 조항이 있는가","terms":["암호화정보","해독","원장","중요 데이터"],"elements":["암호화정보 해독·중요 데이터 변경 금지"],"semantic":"protected_data","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-03':{"question":"계좌번호·비밀번호 등 이용자 금융정보의 무단보관·유출 금지 조항이 있는가","terms":["계좌번호","비밀번호","금융정보","무단보관","유출"],"elements":["이용자 금융정보 무단보관·유출 금지"],"semantic":"financial_info","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-04':{"question":"접근매체 위·변조, 해킹, 개인정보유출 등에 대비한 보안대책 수립 조항이 있는가","terms":["접근매체","해킹","보안대책"],"elements":["접근매체 위변조·해킹·개인정보유출 보안대책"],"semantic":"security_plan","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-05':{"question":"금융회사와 전자금융보조업자 간 접속에 전용회선(동등 보안수준의 가상 전용회선 포함)을 사용하는 조항이 있는가","terms":["전용회선","접속"],"elements":["전용회선 또는 동등 보안수준 가상 전용회선"],"semantic":"dedicated_connection","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-06':{"question":"정보처리시스템 장애 등 서비스 중단에 대비한 비상대책 수립 조항이 있는가","terms":["장애","서비스 중단","비상대책"],"elements":["정보처리시스템 장애 등 서비스 중단 비상대책"],"semantic":"continuity_plan","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-07':{"question":"외부주문의 입찰·계약·수행·완료 등 각 단계별 보안관리방안(금융감독원장이 정하는 방안)을 따르도록 하는 조항이 있는가","terms":["입찰","단계별","보안관리방안"],"elements":["외부주문 각 단계별 감독원장 보안관리방안 준수"],"semantic":"security_stages","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-08':{"question":"중요 전산자료의 백업자료 보존·백업설비 확보 등 백업대책 수립 조항이 있는가","terms":["백업","중요 전산자료"],"elements":["백업자료 보존·백업설비 확보 포함 백업대책"],"semantic":"backup_plan","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-09':{"question":"수탁자(전자금융보조업자)의 재무건전성 연 1회 이상 평가·상시 모니터링에 필요한 자료 제공 협조 조항이 있는가","terms":["재무건전성","모니터링"],"elements":["재무건전성 연 1회 이상 평가·상시 모니터링 자료 협조"],"semantic":"financial_monitoring","actors":["수탁자","전자금융보조업자"]},
    'ITSEC-13':{"question":"외부주문에 대한 자체 보안성검토와 정기 보안점검 실시(수탁자 협조) 조항이 있는가","terms":["보안성검토","보안점검"],"elements":["외부주문 자체 보안성검토·정기 보안점검 협조"],"semantic":"security_inspection","actors":["수탁자","전자금융보조업자"]}
  });
  Object.assign(catalog,Profiles.profiles);
  Object.values(catalog).forEach(function(r){r.bounded=true;});
  var Policy=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy');
  Object.values(Policy.all()).forEach(function(p){
    if(p.level==='presence'&&p.active!==false){
      catalog[p.id]=Object.assign({},catalog[p.id]||{terms:[p.topic||p.id],elements:[]},{question:p.question,meaning_revision:p.meaning_revision,active:true,bounded:true});
    }else if(catalog[p.id])catalog[p.id].active=false;
  });
  function recognize(id,text,env){var r=catalog[id];if(!r)return null;var s=text.replace(/\s+/g,'').replace(/[.。]$/,'');
    var tagged=taggedElement(id,text,env);if(tagged)return tagged.element;
    var roles=s.replace(/[“"「](수탁자|위탁자|갑|을|각당사자|당사자일방|정보수령자)[”"」]/g,'$1');
    roles=roles.replace(/^(갑|을)(?=[은는이가])/,function(a){return env?.map?.[a]||a;});
    if(id==='PRIV-08'&&/^수탁자(?:는|가)(?:본계약에따른|위탁계약에따른|위탁업무와관련한)의무를위반하여(?:위탁자|정보주체)에게발생한손해를배상(?:하여야한다|해야한다|한다)$/.test(roles))return r.elements[0];
    if(id==='CORE-14'&&/^수탁자(?:는|가)위탁업무와관련(?:하여|한)금융감독원(?:장)?의(?:검사및자료제출|검사[·ㆍ,]자료제출)(?:을위한)?요구에(?:성실히)?응(?:하여야한다|해야한다|한다)$/.test(roles))return r.elements[0];
    if(id==='CMN-18'&&/^수탁자(?:는|가)제3자의(?:지식재산권|지적재산권)침해주장이제기(?:된|되는)경우위탁자를방어하고면책(?:하여야한다|해야한다|한다)$/.test(roles))return r.elements[0];
    if(id==='CRS-03'&&/^(?:본|이)계약의(?:국문과영문|영문과국문)(?:이불일치하는경우|내용이상이한경우)(?:국문|영문)(?:본)?을우선(?:한다|적용한다)$/.test(s))return r.elements[0];
    if(id==='NDA-15'&&/^(?:각당사자|당사자일방|정보수령자)(?:은|는)(?:비밀정보|영업비밀)를(?:침해|누설)하여상대방에게발생한손해를배상(?:하여야한다|해야한다|한다)$/.test(roles))return r.elements[0];
    if(r.topic){var f=frame(text);return f&&f.topic===r.topic&&JSON.stringify(f.values)===JSON.stringify(r.values)?r.elements[0]:null;}
    if(id==='PRIV-03'&&/^수탁자는개인정보(?:의안전한처리를위하여|보호를위하여|에대한)?기술적[·ㆍ,]?관리적보호조치를(?:취|실시|시행)(?:하여야|해야)한다$/.test(s))return r.elements[0];
    if(id==='PRIV-19'&&/^수탁자는제공받은개인신용정보의식별정보를암호화(?:하여야|해야)한다$/.test(s))return r.elements[0];
    if(id==='CMN-20'&&/^(?:각당사자|당사자일방)(?:는|은)상대방의사전서면동의없이(?:본)?계약상지위및권리[·ㆍ]?의무를제3자에게양도[·ㆍ,]?이전하거나담보로제공(?:할수없다|하여서는아니된다)$/.test(s))return r.elements[0];
    if(id==='CMN-21'){
      if(/^(?:본|이)계약은당사자간의완전한합의를구성하며(?:본|이)계약에관한종전의구두또는서면합의를대체한다$/.test(s))return '완전합의';
      if(/^(?:본|이)계약의변경은(?:양당사자|당사자쌍방)의서면합의로만(?:할수있다|가능하다)$/.test(s))return '쌍방 서면 변경';
    }
    return null;
  }
  var semanticTopics={'CORE-07':'prior_consent','PRIV-06':'least_access','PRIV-07':'inspection','PRIV-03':'protection','PRIV-19':'encryption'};
  Object.keys(catalog).forEach(function(id){if(catalog[id].semantic)semanticTopics[id]=catalog[id].semantic;});
  function matchesTopic(id,topic){return topic===semanticTopics[id]||catalog[id]?.parts?.some(function(p){return p.topic===topic;})||id==='PRIV-06'&&topic==='access_control'||id==='CORE-10'&&topic==='work_supervision_right';}
  // 추출된 요소 전체를 비교한다. 태그/유사도 점수는 정답을 대신하지 않는다.
  function taggedElement(id,text,env){var r=catalog[id],facts=Q.parseAll(text,env);if(!r||!facts)return null;
    var relevant=facts.filter(function(row){return (row.facts.affected_topics||[row.facts.topic]).some(function(t){return matchesTopic(id,t);});});
    if(!relevant.length||relevant.some(function(row){var f=row.facts;
      if(f.modality==='restriction')return true;
      var part=r.parts?.find(function(p){return p.topic===f.topic;});if(part)return !part.actors.includes(f.actor);
      if(f.topic==='work_supervision_right')return f.actor!=='위탁자'||f.counterparty!=='수탁자';
      return !(r.actors||['수탁자']).includes(f.actor)||
      ['prior_consent','inspection','work_supervision'].includes(f.topic)&&f.counterparty!=='위탁자';}))return null;
    var hit=relevant[0];
    var elements=Array.from(new Set(relevant.map(function(row){return r.parts?.find(function(p){return p.topic===row.facts.topic;})?.element||r.elements[0];})));
    return hit?{element:elements[0],elements:elements,tags:hit.tags,facts:facts.map(function(f){return f.facts;}),relevant_facts:relevant.map(function(f){return f.facts;}),method:'structured_requirements'}:null;
  }
  function evaluate(cp,documents,options){
    var P=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy');
    var J=typeof AgreementJudgment!=='undefined'?AgreementJudgment:require('./agreement_judgment');
    var p=P.get(cp);
    if(!p.compatible||!p.active||p.level!=='presence')return {eligible:false,status:'no_rule',evidence:[],blockers:[],missing:[],tag_evidence:[]};
    return J.evaluate(cp,documents,options);
  }
  return {catalog:catalog,evaluate:evaluate,recognize:recognize,taggedElement:taggedElement};
})();
if(typeof module!=='undefined')module.exports=RequirementRules;
