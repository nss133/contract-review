"use strict";
/* 질문별 약정 확인. 검색의 유사도와 법적 적정성 판단을 혼동하지 않는다.
   짧은 약정/표의 값을 읽되 제목·예시·과거 결론은 현재 약정의 증거가 아니다. */
var AgreementJudgment=(function(){
  var A=typeof AgreementEvidence!=='undefined'?AgreementEvidence:require('./agreement_evidence');
  var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules');
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  var Q=typeof ClauseSemantics!=='undefined'?ClauseSemantics:require('./clause_semantics');
  var Structure=typeof DocumentStructure!=='undefined'?DocumentStructure:require('./document_structure');
  var VERSION='agreement-judgment-v3',profiles=Object.create(null),cache=new WeakMap(),aliasCache=new WeakMap(),profileCache=new WeakMap();
  var legacy={'CMN-04':'CNS-PRICE','CMN-06':'CNS-TERM','CMN-08':'CNS-END','CMN-09':'CNS-END','CMN-11':'CNS-DAMAGE','CMN-15':'CNS-SECRET'};
  function c(s){return String(s||'').normalize('NFC').replace(/\s+/g,'').replace(/[“”"「」‘’']/g,'').replace(/[∙ㆍ•]/g,'·');}
  function test(re,s){return !re||re.test(s);}
  function group(label,object,action,deny){return {label:label,object:object,action:action,deny:deny};}
  function add(id,terms,groups,options){profiles[id]=Object.assign({id:id,terms:terms,groups:groups},options||{});}
  function compiledProfile(profile){
    var revision=Structure.revisionToken(profile),saved=profileCache.get(profile);if(saved&&saved.revision===revision)return saved.value;
    var terms=profile.terms.map(c),value=Object.assign({},profile,{terms:terms,longest_terms:terms.slice().sort(function(a,b){return b.length-a.length;})});
    profileCache.set(profile,{revision:revision,value:value});return value;
  }
  var duty=/실시|수립|운영|마련|확보|준수|수행|적용|설치|보존|보관|시행|부담|응하|응한|협조|제공|제출|통지|고지|청구|요구|정한다|따른다|관리|허용/;
  var cooperate=/협조|협력|응하|응한|응할의무|제공|제출|요구할수|요청할수|점검할수|감사할수|허용/;
  var ban=/금지|할수없|하지못|아니|않|안된|한정|한하여|제한|목적으로만|범위에서만/;
  var privateInfo=/개인(?:신용)?정보|개인\(신용\)정보|고객정보|고객금융정보|금융거래정보|계좌번호|비밀번호|식별정보|신용정보|정보주체/;
  add('CMN-19',['관할','법원','중재','분쟁'],[],{kind:'court'});
  add('CMN-05',['부가가치세','부가세','VAT'],[],{kind:'vat'});
  add('CNS-PRICE',['대금','금액','단가','수수료','정산','대가'],[],{kind:'price'});
  add('CNS-TERM',['계약기간','유효기간','효력','체결일','기간'],[],{kind:'term'});
  add('CNS-END',['해지','해제'],[group('해제·해지 사유 또는 권리',/해지|해제/,/할수|할권리|해지한다|해제한다|해지할|해제할|해지사유|해제사유|사유로.*(?:해지|해제)/)],{kind:'termination'});
  add('CNS-DAMAGE',['손해배상','배상','책임','면책','지체상금','위약금'],[group('책임 배분 약정',/배상|면책|책임|지체상금|위약금/,/배상|부담|책임을|책임이|책임은|책임지|책임을지지|면책|책임없|한도|지체상금.{0,70}(?:지급|부과|공제)|위약금.{0,70}(?:지급|부담)/)],{kind:'damages'});
  add('CNS-SECRET',['비밀','기밀','공개','누설','기술정보','경영정보'],[group('비밀정보 사용·공개 제한',/비밀정보|기밀정보|영업상정보|기술[·및]*(?:경영)?정보|경영정보|상대방.{0,15}정보/,/누설.{0,20}(?:금지|않|아니|안된|할수없)|(?:사용|이용|공개|제공).{0,24}(?:금지|않|아니|안된|할수없|한정|제한)|비밀(?:로|을).{0,6}유지|비밀유지의무를(?:부담|준수)|목적.{0,12}(?:한정|한하여|으로만|범위에서만|외)/)],{kind:'confidentiality'});
  add('CNS-IP',['지식재산','지적재산','저작권','이용권','사용권','산출물'],[group('산출물의 권리 귀속 또는 사용권',/저작권|지식재산권|지적재산권|소유권|이용권|사용권|산출물/,/귀속|소유|이용허락|사용허락|이용할수있|사용할수있|라이선스|권리를갖|양도/)],{kind:'ip'});
  add('CMN-21',['계약변경','변경','합의','서면'],[group('합의에 의한 변경',/변경|수정|개정/,/합의|동의/),group('서면 변경 방식',/변경|수정|개정/,/서면|문서|전자문서/) ]);
  add('CMN-18',['지식재산권','지적재산권','침해','면책'],[group('제3자 권리침해 대응',/제3자|타인/,/침해/),group('침해 주장 방어·해결',/침해|청구|분쟁/,/방어|해결|대응/),group('침해 배상·면책',/침해|청구|분쟁/,/면책|배상|책임을/)]);
  add('CMN-20',['양도','이전','담보','권리의무'],[group('계약상 권리·지위 이전의 동의 또는 금지',/양도|담보|권리.{0,10}이전|지위.{0,10}이전/,/승낙|동의|승인|금지|할수없|하지못|아니|안된/)],{kind:'assignment'});
  add('CORE-06',['법령','법규','준수'],[group('업무 관련 법령 준수',/법령|법규|금융실명법/,/준수|따라|위반.{0,10}(?:않|아니|안된)/)]);
  add('CORE-07',['재위탁','재수탁'],[group('재위탁 동의 또는 금지',/재위탁|재외부주문|재수탁/,/동의|승낙|승인|금지|할수없|하지못|아니|안된/)],{kind:'subcontract'});
  add('CORE-10',['점검','감독','시정','자료요구','감사'],[group('점검·감독·시정 약정',/점검|관리현황|업무처리현황|감사|시정|감독|자료.{0,5}요구/,cooperate)]);
  add('CORE-14',['감독원','금융위원회','감독당국','검사'],[group('감독기관 검사·자료 협조',/금융감독원|금융위원회|감독당국|감독기관/,/검사|자료.{0,3}제출|감독/),group('요구 수인·협조',/검사|자료|요구/,cooperate)],{same_section:true});
  add('PRIV-03',['보호조치','기술적','관리적','안전성'],[group('기술적·관리적 보호조치',/기술적|관리적|물리적|안전성|보안/,/조치|대책|보호/)],{private:true});
  add('PRIV-06',['접근','권한','통제'],[group('접근·권한 제한',/접근|접속|권한|정보취급자/,/통제|제한|인증|패스워드|비밀번호|전용ID|최소/)],{private:true});
  add('PRIV-07',['점검','감독','처리현황'],[group('정보관리 점검·감독',/점검|감독|실태|처리현황/,cooperate)],{private:true});
  add('PRIV-08',['책임','배상'],[group('의무 위반 책임',/배상|책임/,/부담|배상|책임을|책임이/)],{private:true});
  add('PRIV-13',['교육','점검','감독'],[group('개인정보 교육 약정',/교육/,/실시|응하|응한|교육할수|교육한다|교육해야|교육하여야|교육할의무/),group('감독·점검 수인',/점검|감독|실태/,cooperate)],{private:true});
  add('PRIV-19',['식별정보','암호화','고객정보'],[group('정보 암호화·보호',/암호화/,/기술|적용|조치|저장|전송|송수신|암호화한다|암호화하여|암호화해야|암호화처리/)],{private:true});
  add('PRIV-20',['신용정보','교육','보호조치'],[group('안전한 정보처리 교육',/교육/,/실시|응하|응한|교육할수|교육한다|교육해야|교육하여야/),group('안전한 처리',/안전|보호|보안/,/조치|대책|관리/)],{private:true});
  add('PRIV-21',['신용정보','재위탁'],[group('신용정보 재위탁 금지',/재위탁/,/금지|할수없|하지못|아니|안된/)],{private:true,kind:'credit_subcontract'});
  add('ALL-PII-03',['목적','개인정보','이용','제공'],[group('목적 외 이용·제공 제한',/목적/,/목적.{0,18}(?:외|이외|초과).{0,80}(?:이용|사용|제공).{0,35}(?:없|금지|안된|아니|않|못)|목적.{0,20}(?:한정|한하여|한해|범위내|범위에서만|으로만).{0,25}(?:이용|사용|제공)|(?:이용|사용).{0,20}목적.{0,10}(?:한정|제한)/)],{private:true});
  add('ITCL-01',['클라우드','중요도','중요업무'],[group('클라우드 중요도 평가 협조',/중요도|중요업무/,/평가/),group('평가 자료·협조',/평가|중요도|중요업무/,cooperate)],{scope:'cloud'});
  add('ITCL-02',['클라우드','건전성','안전성'],[group('제공자 건전성·안전성 평가',/건전성|안전성/,/평가/),group('평가 자료·협조',/평가|건전성|안전성/,cooperate)],{scope:'cloud'});
  add('ITCL-05',['클라우드','보고','통지'],[group('클라우드 이용 보고 협조',/보고|신규이용|신규계약|변경사항/,/자료|통지|협조|제공|제출/)],{scope:'cloud'});
  add('ITCL-06',['클라우드','합병','분할','재위탁','변경'],[group('제공자 중대한 변경 통지',/합병|분할|지위양도|재위탁|중대한변경/,/사전.{0,15}(?:통지|통보|고지)|(?:발생|변경).{0,8}전.{0,15}(?:통지|통보|고지)/)],{scope:'cloud'});
  add('ITSEC-01',['업무장소','전산설비','분리'],[group('외주 개발 업무장소 분리',/장소|업무공간/,/분리|구분/),group('외주 개발 전산설비 분리',/전산설비|개발설비|개발환경|개발망/,/분리|구분/)],{scope:'electronic'});
  add('ITSEC-02',['암호화정보','해독','원장','중요데이터'],[group('해독 금지',/해독/,ban),group('원장·중요 데이터 변경 금지',/원장|중요데이터/,/변경.{0,20}(?:금지|할수없|하지못|아니|안된|않)/)],{scope:'electronic'});
  add('ITSEC-03',['무단보관','유출','금융정보'],[group('무단 보관·유출 제한',/보관|저장|출력|복사/,/사전승인|승낙|금지|할수없|아니|안된|않/),group('정보 유출·누설 제한',/유출|누설|제공/,/금지|할수없|아니|안된|않/)],{private:true,scope:'electronic'});
  add('ITSEC-04',['보안대책','보호조치','해킹'],[group('보안대책 약정',/보안|보호|안전성/,/대책|조치|계획/)],{scope:'electronic'});
  add('ITSEC-05',['전용회선','VPN','가상전용'],[group('전용회선·동등 보안 접속',/전용회선|VPN|가상전용/i,/사용|이용|접속|통신|연결|구성/)],{scope:'electronic',kind:'connection'});
  add('ITSEC-06',['비상대책','서비스중단','장애','업무연속'],[group('서비스 중단 비상대책',/비상대책|업무연속|복구계획|재해복구|BCP/i,/수립|확보|마련|시행|운영|계획/)],{scope:'electronic'});
  add('ITSEC-07',['단계별','입찰','보안관리'],[group('외주 단계별 보안관리',/단계별|각단계|입찰.{0,30}수행/,/보안관리|보안방안/),group('관리방안 준수',/보안/,/준수|따라|적용|시행|수행/)],{scope:'electronic'});
  add('ITSEC-08',['백업','백업대책'],[group('백업 대책',/백업|backup/i,/대책|보존|보관|확보|설비|실시|수행/)],{scope:'electronic'});
  add('ITSEC-09',['재무건전성','재무상태','모니터링'],[group('재무 평가 자료 협조',/재무|건전성/,/평가|모니터링|재무제표/),group('평가 협조·자료 제공',/재무|건전성|평가/,cooperate)],{scope:'electronic'});
  add('ITSEC-10',['품질','서비스수준','평가'],[group('서비스 품질 평가 협조',/품질|서비스수준|SLA/i,/평가|점검/),group('평가 협조',/품질|서비스|평가/,cooperate)],{scope:'electronic'});
  add('ITSEC-11',['재외부주문','재위탁','계약업체'],[group('재외부주문 동의 통제',/재위탁|재외부주문/,/동의|승낙|승인|금지|할수없|하지못|안된/)],{scope:'electronic',kind:'subcontract'});
  add('ITSEC-12',['신원조회','신원보증','인수인계'],[group('인력 신원확인',/신원조회|신원보증|신원확인/,/실시|확보|보증|확인/),group('인력변경 인수인계',/인력|담당자|수행자|인수인계/,/인수인계/)],{scope:'electronic'});
  add('ITSEC-13',['보안점검','보안성','점검'],[group('보안 점검 협조',/보안|보호|정보관리|정보폐기/,/점검|검토|검사/),group('점검 수행·협조',/점검|검토|검사/,cooperate)],{scope:'electronic'});
  add('ITSEC-14',['금융거래정보','개별지시','재수탁'],[group('금융거래정보 변경 지시',/금융거래정보|금융거래데이터/,/변경/),group('위탁회사·원수탁자 지시',/위탁회사|원수탁|위탁자/,/개별지시|지시에따라|지시에의해/)],{scope:'electronic_sub'});
  add('ITSEC-15',['금융거래정보','전산실','재수탁'],[group('금융거래정보 보관 장소',/금융거래정보/,/위탁회사.{0,10}전산실|위탁자.{0,10}전산실/)],{scope:'electronic_sub',kind:'data_location'});
  add('SOL-05',['교육','점검','선임','감독'],[group('업무 교육·관리 약정',/교육|점검|선임|감독/,/실시|운영|관리|협조|응하|응한|요구|할수|정한다/)],{kind:'sales_supervision'});
  add('ITDL-07',['오픈소스','라이선스','소프트웨어'],[group('라이선스 정보 고지',/라이선스|사용권|오픈소스/,/목록|명세|고지|제공|제출/),group('라이선스 준수 또는 책임',/라이선스|사용권|오픈소스/,/준수|책임|배상/)]);
  add('ALL-REINS-01',['재보험','원보험','효력'],[group('원보험 효력과 재보험의 독립',/원보험/,/영향.{0,8}(?:않|아니|없)|독립|분리/)]);
  add('FIN-SEC-02',['질권','통지','승낙'],[group('질권 설정 통지·승낙',/질권/,/통지|승낙/),group('통지·승낙 협력',/통지|승낙/,/협조|확보|실시|통지한다|승낙을받|하기로/)]);
  add('INV-MAN-01',['선량한','충실','일임'],[group('선관주의 운용',/선량한관리자|선관주의/,/주의|운용/),group('투자자 이익·충실',/투자자|고객|위탁자/,/이익|충실/)]);
  add('INV-BEN-04',['신탁계약','수익자','변경','통지'],[group('신탁 변경 수익자 통지',/신탁|수익자/,/변경/),group('변경 수익자 공시·통지',/수익자/,/공시|통지|통보/)]);
  add('INV-BEN-07',['규약','투자자','통지'],[group('규약상 투자자 통지',/규약|규정/,/통지|통보/),group('투자자 대상',/투자자|수익자/,/전체|모든|통지|통보/)]);
  add('INV-MAN-03',['일임재산','고유재산','예탁'],[group('재산 분리',/일임재산|고유재산/,/분리|분별/),group('신탁업자 예탁',/신탁업자|수탁기관/,/예탁|보관/)]);
  add('SP-DEL-05',['하자','보수','보증'],[group('하자보수 약정',/하자/,/보수|수리|보완|시정|청구/)]);
  add('SH-SHARE-06',['동반매도','동일조건','소수주주'],[group('동반매도 동일 조건',/동반매도|tag.?along/i,/동일.{0,8}조건|같은조건/),group('지분 인수',/지분|주식/,/매수|인수|매도|참여/)]);
  add('SH-SHARE-08',['주권','명의개서','주식양도'],[group('주식 이전',/주권|주식/,/교부|인도|이전|전자등록/),group('명의개서 협조',/명의개서/,/협조|협력|이행|절차|신청|청구/)]);
  add('SH-GOV-04',['회계장부','의사록','열람','정보접근'],[group('계약상 정보접근',/회계장부|이사회의사록/,/열람|등사|제공/)]);
  // 단순 약정 확인으로 전수 재분류한 질문. 구체적 거래 적정성을 대신 승인하지 않는다.
  add('CNS-PRIVSUB',['재위탁','재수탁'],profiles['CORE-07'].groups,{private:true,kind:'subcontract'});
  add('CNS-PRIVNOTICE',['위탁업무','수탁자','공개'],[group('위탁업무·수탁자의 공개',/위탁업무|위탁하는업무/,/공개|게시/),group('수탁자의 공개',/수탁자|수탁업체|수탁회사/,/공개|게시/),group('공개 방식·책임',/홈페이지|웹사이트|신문|간행물|사업장|정보처리방침|공개책임|공개담당/,/공개|게시|게재|담당|책임/) ]);
  add('PRIV-12',['정보주체','홍보','판매권유','통지'],[group('홍보·판매 위탁 사실 통지',/홍보|판매권유|판매를권유/,/위탁/),group('업무 내용·수탁자 알림',/업무내용|위탁업무/,/알리|알려|알린|고지|통지|안내/),group('수탁자 알림',/수탁자|수탁업체/,/(?:정보주체|고객).{0,25}(?:알리|알려|알린|고지|통지|안내)|(?:알리|알려|알린|고지|통지|안내).{0,20}(?:정보주체|고객)/)]);
  add('ITDL-02',['소스코드','산출물','에스크로','임치'],[group('소스코드·산출물 인도 또는 임치',/소스코드|산출물/,/인도|제공|교부|납품|에스크로|임치/)]);
  add('NDA-12',['반환','폐기','비밀'],[group('종료·요청 시 비밀정보 반환·폐기',/비밀|기밀|자료/,/반환|폐기|파기/),group('반환·파기 발생 조건',/종료|요청|요구/,/반환|폐기|파기/)]);
  add('SH-GOV-03',['동의','중요사항','경영사항'],[group('주요경영 동의 대상',/주요경영|중요경영|경영사항|신주발행|정관변경|합병|영업양도|차입|자산처분|증자|감자/,/사전동의|사전승인/)]);
  add('SH-GOV-05',['교착','협의','중재','매수'],[group('교착 해소 절차',/교착|deadlock/i,/협의|중재|매수|매도|해산|조정|해소절차/)]);
  add('SH-FIN-06',['추가출자','자본조달','자금조달','출자비율'],[group('추가 자본조달 참여',/추가출자|자본조달|자금조달|후속출자|추가자본/,/참여|출자|납입/),group('참여 의무·비율',/주주|당사자/,/지분비율|출자비율|보유비율|[0-9]+%/)]);
  // 구 데이터와의 읽기 호환. 활성 여부는 JudgmentPolicy가 결정한다.
  ['PRIV-08','NDA-15','SP-DEL-06'].forEach(function(id){if(!profiles[id])profiles[id]=Object.assign({},profiles['CNS-DAMAGE'],{id:id});});
  Object.keys(legacy).forEach(function(id){profiles[id]=Object.assign({},profiles[legacy[id]],{id:id});});
  function nonContract(row){
    var s=row.body;
    return !s||/^목차|^작성(?:예|요령|안내)|^(?:예시|가령|가정|견본|작성예)[):：.·-]?|^검토(?:의견|결과|메모)|^태그[:：]|^표시용해시태그/.test(s)||
      /(?:작성예시|예시문구|표준문안예시|기재예시|문구예시|예를들어)/.test(s)||/\.{3,}\d+$/.test(s)||
      /(?:라고|다고|고)(?:예시|가정|기록|설명|소개)(?:한|한다|하였다)|(?:한|된)것으로기록|이행실적|실시완료보고/.test(s)||
      /(?:한다는|해야한다는|하여야한다는)사실을?확인/.test(s)||
      /(?:협조한|실시한|암호화한|수립한)(?:자료|기록|사실).{0,10}(?:삭제|정리|확인)/.test(s)||
      /^[“"「][\s\S]+[”"」][.。]?$/.test(String(row.text||'').trim())||
      /(?:내용을|문구를|법원을|기간을).{0,8}(?:기재|입력|작성)(?:하세요|바람|할것|요망)/.test(s)||
      /^[가-힣A-Za-z0-9()·&-]{1,75}(?:계약서|약정서|합의서)(?:\(.*\))?$/.test(s);
  }
  function tableRows(rows,documents){
    var groups={};rows.forEach(function(r){if(r.source?.table)(groups[r.document_index+':'+r.source.table.id]||(groups[r.document_index+':'+r.source.table.id]=[])).push(r);});
    Object.values(groups).forEach(function(group){var doc=documents[group[0].document_index],tableId=group[0].source.table.id;
      var bs=(doc.extraction?.blocks||[]).filter(function(b){return b.source?.table?.id===tableId;}),byRow={},valid=Structure.validExtraction(doc.text,doc.extraction);
      bs.forEach(function(b){var t=b.source.table;if(t.invalid||t.merged||t.colspan!==1||t.rowspan!==1||!Number.isSafeInteger(t.row)||!Number.isSafeInteger(t.col)||t.row<0||t.col<0||!String(b.text).trim())valid=false;
        var cells=byRow[t.row]||(byRow[t.row]={});if(cells[t.col])valid=false;cells[t.col]=b;});
      var first=byRow[0]||{},headers=Object.keys(first).sort(function(a,b){return a-b;}).map(function(col){return Structure.tableHeader(first[col].text);});
      var obligationTable=headers.includes('actor')&&headers.includes('action');
      if(!obligationTable){group.forEach(function(r){r.unresolved_table=true;});return;}
      if(headers.some(function(h){return !h;})||new Set(headers).size!==headers.length)valid=false;
      var outputs=[];
      for(var i=1;i<Object.keys(byRow).length;i++){var cells=byRow[i],fields={};if(!cells||Object.keys(cells).length!==headers.length){valid=false;continue;}
        headers.forEach(function(h,col){if(!cells[col]){valid=false;return;}fields[h]=c(cells[col].text);});
        var actor=fields.actor||'',action=fields.action||'',explicit=(action.match(/^(수탁자|위탁자|갑|을|제공자|수령자|발주자|수급인)(?:은|는|이|가)/)||[]);
        var env=group[0].aliases?.map||{},role=function(a){return env[a]||a;};
        if(!actor||explicit[1]&&role(explicit[1])!==role(actor))valid=false;
        if(explicit[0])action=action.slice(explicit[0].length);
        var object=fields.object||'',condition=fields.condition||'';
        var carrier=group.find(function(r){return r.source.table.row===i&&r.source.table.col===headers.indexOf('action');});
        if(carrier)outputs.push({row:carrier,text:actor+'는'+condition+(object&&!action.startsWith(object)?object:'')+action});else valid=false;
      }
      group.forEach(function(r){r.table_context=true;r.table_valid=valid;r.list_header=true;r.unresolved_table=!valid;});
      if(valid)outputs.forEach(function(o){o.row.list_header=false;o.row.semantic_text=o.text;o.row.list_intros=group.filter(function(r){return r!==o.row&&(r.source.table.row===0||r.source.table.row===o.row.source.table.row);});});
    });
  }
  function keywordOnly(p,r){
    if(r.source?.table&&r.table_valid||r.list_valid&&r.list_intros?.length)return false;
    var s=r.body.replace(/[.,。·/;:：()\[\]_-]/g,'');
    p.longest_terms.forEach(function(t){s=s.split(t).join('');});
    return !s||/^(?:비밀유지|비밀정보보호|손해배상책임|기술적관리적보호조치|접근권한제한)$/.test(r.body);
  }
  function prepare(documents){
    documents=documents||[];var old=cache.get(documents),structure=documents.map(function(d){return Structure.revisionToken(d.extraction);});
    // 문자열은 불변이다. 체크마다 전체 문서를 다시 해시하지 않으며 같은 배열의 text 교체도 감지한다.
    if(old&&old.inputs.length===documents.length&&old.inputs.every(function(d,i){var n=documents[i];return d.text===n.text&&d.name===n.name&&d.revision===n.revision&&d.independent===n.independent&&d.extraction===n.extraction&&d.structure===structure[i];}))return old;
    var contexts=Q.contexts(documents),texts=documents.map(function(d){return c(d.text);}),rows=contexts.rows.map(function(row){var h=E.heading(row.text);
      return Object.assign({},row,{body:c(h?row.text.slice(h.prefix.length):row.text),heading:c(row.section),document_text:texts[row.document_index]});});
    tableRows(rows,documents);
    var bySection={};rows.forEach(function(r){var k=r.document_index+':'+r.section_index;(bySection[k]||(bySection[k]=[])).push(r);});
    Object.values(bySection).forEach(function(group){
      var headers=group.filter(function(r){return !r.source?.table&&Structure.tableHeader(r.body);}).map(function(r){return Structure.tableHeader(r.body);});
      if(headers.includes('actor')&&headers.includes('action'))group.forEach(function(r){
        if(!r.source?.table&&!/^(?:수탁자|위탁자|갑|을)(?:은|는|이|가).{0,40}(?:개인정보|신용정보|고객정보)/.test(r.body))r.unresolved_table=true;
      });
    });
    var examples={};
    rows.forEach(function(r){var k=r.document_index+':'+r.section_index;
      if(/^(?:작성예시|작성요령|예시|예문|견본|목차)(?:\(|:|：|$)/.test(r.body))examples[k]=true;
      r.group=bySection[k];r.non_contract=nonContract(r)||!!examples[k];
    });
    rows.forEach(function(r,i){var prev=rows[i-1];
      // 추출 과정의 단순 행바꿈: 조사로 끝난 미완성 구절만 같은 조·구역의 후속 내용에 연결한다.
      // 새 조문·목록·당사자 문장·표 경계를 넘거나 완전한 앞 문장을 합성하지 않는다.
      if(!prev||r.non_contract||prev.non_contract||r.source?.table||prev.source?.table||r.domain!==prev.domain||r.section_index!==prev.section_index||
        !/(?:은|는|이|가|을|를|에서|의|와|과|위하여|및|또는)$/.test(prev.body)||
        /^(?:제\d+조|[①-⑳]|\d+[.)]|[가-하][.)]|(?:수탁자|위탁자|갑|을|회사|각당사자)(?:은|는|이|가))/.test(r.body))return;
      r.semantic_text=c(prev.semantic_text||prev.body)+c(r.semantic_text||r.body);
      r.list_intros=(prev.list_intros||[]).concat([prev],r.list_intros||[]);
    });
    var names={};rows.forEach(function(r){var env=names[r.domain]||(names[r.domain]={roles:{},conflicts:[]}),m=r.body.match(/^(수탁자|위탁자)(?:상호|회사명|명칭)[:：](.+?)[.]?$/);
      if(m){var value=companyName(m[2]);if(env.roles[m[1]]&&env.roles[m[1]]!==value)env.conflicts.push(m[1]);else env.roles[m[1]]=value;}
      if(/수탁자(?:란|는).{0,4}위탁자(?:를|을)(?:말한다|의미한다)/.test(r.body))env.conflicts.push('수탁자');
    });rows.forEach(function(r){r.party_names=names[r.domain];});
    var roleContradiction=rows.some(function(r){return !documents[r.document_index].independent&&/수탁자(?:란|는).{0,4}위탁자(?:를|을)(?:말한다|의미한다)/.test(r.body);});
    if(roleContradiction)rows.forEach(function(r){if(!documents[r.document_index].independent)r.role_contradiction=true;});
    var bySentence=new Map();rows.forEach(function(r,i){r.row_index=i;r.semantic_body=c(r.semantic_text||r.body);bySentence.set(r.document_index+':'+r.sentence_index,r);});
    var out={key:H.of(texts),rows:rows,contract_rows:rows.filter(function(r){return !r.non_contract;}),texts:texts,has_private_info:privateInfo.test(texts.join('\n')),
      documents:documents,contexts:contexts,by_sentence:bySentence,inputs:documents.map(function(d,i){return {text:d.text,name:d.name,revision:d.revision,independent:d.independent,extraction:d.extraction,structure:structure[i]};})};cache.set(documents,out);return out;
  }
  function proof(r,label){return {document:r.document,document_index:r.document_index,section:r.section,section_index:r.section_index,
    sentence_index:r.sentence_index,domain:r.domain,start:r.start,end:r.end,source:r.source,text:r.text,element:label};}
  function topicAlias(a){
    // 태그 별칭은 주제 명칭만 보조한다. 판단·의무·조건·긍부정을 포함한 문구는 동의어로 축약하지 않는다.
    return !/(?:않|아니|없|못|불필요|불가|면제|배제|삭제|허용|금지|한정|제외|예외|미정|추후|향후|나중에|다만|경우|때만|의무|할수|될수|하여야|해야|하도록|한다|선택|재량|임의|자유롭게|사후|일부|조건|범위|사전동의|사전승인)/.test(a)&&
      !/^(?:미|비|불)(?:이행|준수|수행|암호화|실시|적용|처리|보관|설치|통지|제출)/.test(a)&&!/[0-9]+(?:일|개월|년|회|%)/.test(a);
  }
  function aliases(knowledge){
    if(!knowledge||typeof knowledge!=='object')return [];
    var revision=knowledge.revision||knowledge.meta?.data_revision||knowledge.meta?.updated_at;
    var saved=aliasCache.get(knowledge),keys=Object.keys(knowledge.tags||{});
    // 태그 원문·스냅샷 전체가 아니라 인식에 쓰는 짧은 별칭만 비교한다. in-place 수정도 놓치지 않는다.
    if(saved&&saved.revision===revision&&saved.keys.length===keys.length&&saved.inputs.every(function(t,i){var n=knowledge.tags[keys[i]];
      return t.id===keys[i]&&t.label===n.label&&t.type===n.type&&t.aliases.length===(n.aliases||[]).length&&t.aliases.every(function(a,j){return a===n.aliases[j];});}))return saved.rows;
    var rows=[],byLabel=new Map();Object.keys(knowledge.tags||{}).forEach(function(id){var t=knowledge.tags[id],label=c(t.label);
      if(!label||/결과|부서|유형|department|case_type/.test(t.type||'')||/이상없음|수용가능|검토의견/.test(label))return;
      (t.aliases||[]).forEach(function(a){a=c(a);if(a.length>=3&&a!==label&&topicAlias(a)&&!/^(?:계약|업무|회사|정보|자료|의무|책임|검토|협조)$/.test(a)){var row={id:id,label:label,alias:a,order:rows.length};rows.push(row);if(!byLabel.has(label))byLabel.set(label,[]);byLabel.get(label).push(row);}});
    });var indexed={by_label:byLabel,profiles:new WeakMap()};aliasCache.set(knowledge,{revision:revision,keys:keys,inputs:keys.map(function(id){var t=knowledge.tags[id];return {id:id,label:t.label,type:t.type,aliases:(t.aliases||[]).slice()};}),rows:indexed});return indexed;
  }
  function profileAliases(index,profile){
    if(!index.by_label)return [];
    var saved=index.profiles.get(profile);if(saved)return saved;
    var rows=[],seen=new Set();profile.terms.forEach(function(t){if(seen.has(t))return;seen.add(t);rows=rows.concat(index.by_label.get(t)||[]);});
    rows.sort(function(a,b){return a.order-b.order;});index.profiles.set(profile,rows);return rows;
  }
  function expand(row,aliasRows){var s=row.semantic_body,original=s,tags=[];
    aliasRows.forEach(function(a){if(original.includes(a.alias)){
      // 원문 별칭을 지우지 않고 바로 뒤에 주제 명칭만 추가한다. 새로 추가한 명칭은 다른 태그의 원문 증거가 아니다.
      s=s.split(a.alias).join(a.alias+a.label);tags.push({tag_id:a.id,label:a.label,matched_term:a.alias});
    }});return {text:s,tags:tags};
  }
  function companyActor(scope){var p=scope&&scope.party;
    if(typeof p==='string')return /^(갑|을)$/.test(c(p))?c(p):null;
    if(!p||typeof p!=='object')return null;
    // 탐지 후보의 첫 값을 회사로 확정하지 않는다. 모순된 호칭은 실제 방향 판단에 필요한 때만 미확인으로 남긴다.
    var values=[p.companyLabel,p.ourLabel,p.company_alias,p.our_party,p.label,p.party].concat(Array.isArray(p.ourAliases)?p.ourAliases:[]);
    var labels=Array.from(new Set(values.filter(function(v){return typeof v==='string';}).map(c).filter(function(v){return /^(갑|을)$/.test(v);})));
    if(labels.length!==1)return null;
    if((Array.isArray(p.counterpartyAliases)?p.counterpartyAliases:[]).some(function(v){return c(v)===labels[0];}))return null;
    return labels[0];
  }
  function problem(code,reason,r){return Object.assign({code:code,reason:reason},r?proof(r,reason):{});}
  function companyName(s){return c(s).replace(/(?:주식회사|\(주\)|㈜)/g,'').replace(/[.]$/,'');}
  function wrongActor(p,r,s){
    var provider=['CORE-07','CNS-PRIVSUB','PRIV-03','PRIV-06','PRIV-19','ITCL-01','ITCL-02','ITCL-05','ITCL-06','ITSEC-01','ITSEC-02','ITSEC-03','ITSEC-04','ITSEC-05','ITSEC-06','ITSEC-07','ITSEC-08','ITSEC-09','ITSEC-10','ITSEC-11'].includes(p.id);
    var m=s.match(/^(?:다만[,，]?)?(수탁자|위탁자|갑|을|발주자|수급인)(?:은|는|이|가)/);
    var subjects=Array.from(s.matchAll(/(수탁자|위탁자|갑|을)(?:은|는)/g));if(subjects.length)m=subjects[subjects.length-1];
    if(!m){var prior=(r.group||[]).filter(function(x){return x.start<r.start&&/(?:다음|아래).{0,16}(?:각호|사항|조치|의무)/.test(x.body||'');});
      var intros=(r.list_intros||[]).concat(prior);for(var i=intros.length-1;i>=0&&!m;i--)m=c(intros[i].semantic_text||intros[i].body||intros[i].text).match(/(수탁자|위탁자|갑|을)(?:은|는|이|가)/);
    }
    if(provider&&r.role_contradiction)return true;
    if(!m){var explicit=s.match(/^([가-힣A-Za-z0-9()㈜]{1,35}(?:회사|기업|은행|보험))(?:은|는|이|가)/),known=r.party_names?.roles?.수탁자;
      return !!(provider&&explicit&&known&&companyName(explicit[1])!==known);}
    var who=r.aliases?.map?.[m[1]]||m[1];
    if(provider&&who==='위탁자')return true;
    if(['CORE-10','ITSEC-13'].includes(p.id)&&who==='위탁자'&&/협조/.test(s))return true;
    if(provider&&who==='수탁자'&&r.party_names?.conflicts?.includes('수탁자'))return true;
    if(p.id==='PRIV-07'&&who==='위탁자'&&/(?:점검|감독).{0,40}(?:협조|협력)/.test(s)){
      var providerNames=['수탁자'].concat(Object.keys(r.aliases?.map||{}).filter(function(k){return r.aliases.map[k]==='수탁자';}));
      return !providerNames.some(function(name){return new RegExp(name+'(?:는|가|은|이).{0,20}(?:협조|협력)').test(s);});
    }return false;
  }
  function undecided(s){return /(?:추후|향후|나중에).{0,12}(?:협의|논의|합의|정한|결정)|미정|정하지(?:않|아니)(?:한다|한다는)|별도로정한다|할수도있|여부.{0,8}(?:협의|결정)|_{2,}|\[\s*\]|�/.test(s);}
  // 재위탁 금지 뒤의 예외를 금지 조항 부재와 혼동하지 않는다. 이 유한한
  // 구조 인식은 법령상 금지업무를 예외 대상에서 제외하고 사전 서면승낙을
  // 요구하는 같은 조의 약정만 읽는다. 다른 조/별첨의 단어를 끌어오지 않는다.
  function controlledCreditException(r){
    var s=r.semantic_body;
    if(!/^(?:다만|단)[,，]?다음각호.{0,16}해당하지않는경우/.test(s)||
      !/(?:갑|위탁자)의(?:사전)?서면(?:승낙|동의|승인)(?:을|를)?(?:얻어|받아|받은경우에만)재위탁할수있다[.]?$/.test(s)||
      /사후|자유롭게|관계없이|불구하고/.test(s))return null;
    var section=(r.group||[]).filter(function(q){return !q.non_contract&&q.domain===r.domain;}),at=section.indexOf(r);
    var principle=section[at-1];
    if(!principle||wrongActor({kind:'credit_subcontract',id:'PRIV-21'},principle,principle.semantic_body)||
      !/재위탁(?:을)?(?:할수없다|하여서는아니된다|해서는안된다)[.]?$/.test(principle.semantic_body))return null;
    // 바로 이어진 목록에서 법령상 금지 업무를 읽되 번호·순서에는 의존하지
    // 않는다. 다른 문단의 법령 인용 또는 '금지하지 않는 경우'는 근거가 아니다.
    var condition=null;
    for(var i=at+1;i<section.length;i++){
      var item=section[i].semantic_body;
      if(!/^(?:\d+[.)]|[①-⑳])/.test(item))break;
      if(/^(?:\d+[.)]|[①-⑳])(?:관련|관계)?법령에서(?:해당|그)업무의(?:재)?위탁을금지(?:하고있는|하는|한)경우[.]?$/.test(item))condition=section[i];
    }
    if(!condition)return null;
    if(section.some(function(q){return /(?:위|이|해당)(?:조건|제한|예외조건).{0,16}(?:적용하지|배제|면제|생략)|법령.{0,20}금지.{0,12}(?:관계없이|불구하고)/.test(q.semantic_body);}))return null;
    return [r,condition];
  }
  function deny(s,p){
    if(p.kind==='damages')return false;
    if(p.kind==='court')return /(?:관할|법원|중재|분쟁해결).{0,35}(?:적용하지|배제한다|지정하지|정하지|효력이없)/.test(s);
    if(p.kind==='confidentiality')return /(?:비밀|기밀|기술.{0,8}정보|경영정보).{0,35}(?:자유롭게|제한없이).{0,12}(?:공개|사용|누설)|(?:비밀유지|공개제한).{0,15}(?:배제|부담하지|의무없|적용하지)/.test(s);
    if(p.id==='CORE-06')return /(?:준수|법령|법규).{0,20}(?:의무|책임).{0,12}(?:배제|면제|없|부담하지)|준수하지(?:않|아니)/.test(s);
    if(p.id==='PRIV-06')return /(?:접근|권한|접속).{0,25}(?:제한|통제).{0,12}(?:하지않|하지아니|없|적용하지|배제|제외|면제|선택사항)|(?:모든직원|누구나).{0,30}(?:접근할수|열람할수)|(?:업무와관계없이).{0,20}접근/.test(s);
    if(p.id==='SH-GOV-04')return /(?:열람|등사|정보접근)(?:을|를)?(?:할수없|하지못)|(?:열람|등사|정보접근).{0,6}(?:금지한다|금지된다)|(?:법정|법령상|상법상).{0,20}(?:열람권|정보권).{0,8}(?:배제|포기)(?!하지|할수없)/.test(s);
    if(p.id==='ITSEC-14')return /지시.{0,8}(?:관계없이|무관하게)|지시없이.{0,15}변경|임의로.{0,15}변경/.test(s);
    if(p.id==='ITSEC-15')return /위탁회사.{0,10}전산실.{0,15}보관하지(?:않|아니)|위탁회사.{0,10}전산실.{0,15}보관할수없/.test(s);
    if(p.id==='PRIV-03'&&/(?:기술적|관리적|보호조치).{0,15}(?:불필요|필요없|조치가없다)/.test(s))return true;
    if(p.id==='INV-BEN-07')return /일부(?:의)?(?:투자자|수익자).{0,20}(?:통지|통보)/.test(s);
    if(p.kind==='termination')return /(?:해지|해제).{0,15}(?:금지|할수없|하지못)|해지권.{0,6}없/.test(s);
    if(p.kind==='subcontract')return /(?:동의|승낙|승인).{0,12}(?:불필요|필요없)|(?:동의|승낙|승인)없이.{0,15}(?:할수있|허용)|사후(?:서면)?(?:동의|승낙|승인)|자유롭게재위탁|(?:계약업체|수탁업체|수행업체).{0,12}(?:임의|자유롭게).{0,10}(?:교체|변경)/.test(s);
    if(p.kind==='assignment')return /(?:동의|승낙|승인).{0,12}(?:불필요|필요없)|(?:동의|승낙|승인)없이.{0,25}(?:양도|이전|담보).{0,15}(?:할수있|허용)|사후(?:서면)?(?:동의|승낙|승인)|자유롭게.{0,10}(?:양도|이전|담보)/.test(s);
    if(p.kind==='credit_subcontract')return /(?:서면|사전)?(?:동의|승낙|승인).{0,25}재위탁할수|자유롭게재위탁|위탁자.{0,10}(?:인정|승인|동의).{0,10}경우.{0,8}(?:제외|예외|그러하지)/.test(s)&&!/금융위원회/.test(s);
    if(p.id==='ALL-PII-03')return /목적.{0,10}(?:외|초과).{0,40}(?:이용|사용|제공).{0,12}(?:할수있|허용|자유)|(?:자체|고유)목적.{0,30}(?:제한받지|제한없|제한하지|허용|할수있)|목적.{0,10}(?:제한없|제한하지)/.test(s);
    var own=p.groups.some(function(g){return test(g.object,s);});if(!own)return false;
    return /(?:의무|책임).{0,20}(?:면제|배제|적용하지|생략|부담하지)|(?:교육|점검|시정|감독|검사|협조|제출|통지|보호조치|보안조치|암호화|하자보수|열람|예탁|분리보관|자료제공|인수인계|신원조회|백업).{0,22}(?:의무|책임).{0,10}(?:없|면제|부담하지|지지않)|(?:교육|점검|시정|감독|검사|협조|제출|통지|보호조치|보안조치|암호화|하자보수|열람|예탁|분리보관|자료제공|인수인계|신원조회|백업).{0,18}(?:거부할수|응하지않아도|실시하지않아도|생략할수|생략한다|하지않(?:는다|음|으며)|하지아니(?:한다|함))|(?:권리|청구).{0,6}(?:없|포기)/.test(s);
  }
  function risk(p,rows,scope){var out=[],actor=companyActor(scope);
    rows.forEach(function(r){var s=r.body;
      if(p.kind==='damages'&&/고의|중과실/.test(s)&&/(?:면책|책임.{0,10}(?:없|지지않|부담하지)|배상.{0,8}(?:않|아니))/.test(s)){
        var who=(s.match(/(?:^|[,，])(?:다만)?(갑|을|수탁자|수급인|위탁자|발주자)(?:은|는|이|가|의)/)||[])[1];
        var ours=who&&actor&&who===actor;
        if(!ours)out.push(problem('B5',who&&actor?'상대방의 고의·중과실 책임까지 배제하는 내용':'고의·중과실 책임 배제의 적용 주체 확인 필요',r));
      }
      if(p.kind==='damages'&&/(?:귀책사유|고의|과실).{0,10}(?:관계없이|무관하게|불문하고)|무과실/.test(s)&&/(?:모든|일체의?)손해/.test(s)&&/배상|부담/.test(s)){
        var liable=(s.match(/(?:^|[,，])(?:다만)?(갑|을|수탁자|위탁자)(?:만|은|는|이|가)/)||[])[1];
        if(!actor||!liable||liable===actor)out.push(problem('B5','회사의 귀책 없는 전손해 부담 또는 적용 주체 확인 필요',r));
      }
      if(p.kind==='damages'&&/(?:개인정보|신용정보|비밀정보|영업비밀|하자).{0,25}(?:손해|배상|책임).{0,20}(?:배제|적용하지|부담하지|지지않)/.test(s))out.push(problem('B5','통합 책임 질문에 포함된 해당 위반의 배상책임 배제',r));
      if(p.kind==='termination'&&/(?:사유|이유).{0,5}없|임의로|언제든지/.test(s)&&/해지|해제/.test(s)&&/일방|갑만|을만|단독/.test(s)){
        var who=(s.match(/(갑|을)(?:만|은|는)/)||[])[1];
        if(!actor||!who||who!==actor)out.push(problem('B5','일방의 무사유 해지권과 상대방 구속 범위 확인 필요',r));
      }
      if(p.kind==='price'&&/대금|금액|단가|수수료/.test(s)&&/일방|단독|임의로|동의없이/.test(s)&&/변경|인상|증액/.test(s)&&!/변경.{0,15}(?:할수없|하지못|아니|않)|증액.{0,15}(?:할수없|하지못|아니|않)/.test(s))out.push(problem('B5','합의 없는 대가 변경권 확인 필요',r));
      if(p.id==='CMN-21'&&/변경|수정/.test(s)&&/일방|단독|합의없이|동의없이/.test(s))out.push(problem('B5','일방적 계약 변경권',r));
      if(p.kind==='connection'&&/전용회선.{0,15}(?:않|아니)|전용회선이외|대신|VPN|가상전용/i.test(s)&&!/(?:동등|상응|같은|동일|이상).{0,10}보안|보안.{0,12}(?:동등|상응|같은|동일|이상)/.test(s))out.push(problem('B4','전용회선 대체수단의 동등 보안수준 확인 필요',r));
    });return out;
  }
  function dateValue(y,m,d){var t=new Date(Date.UTC(+y,+m-1,+d));return t.getUTCFullYear()===+y&&t.getUTCMonth()===+m-1&&t.getUTCDate()===+d?t.getTime():null;}
  function numericPrice(s){
    var names=/(?:계약금액|총대금|대금|대가|수수료|보수)/g,name;
    while((name=names.exec(s))){
      var tail=s.slice(names.lastIndex),prefix=tail.match(/^(?:은|는|:|：|총|일금)*/)[0];
      // 두 반복에서 '일금'을 서로 되돌려 잡지 않는다. 단위가 없는 긴 금액도 선형으로 끝낸다.
      var amount=tail.slice(prefix.length).match(/^([일금영일이삼사오육칠팔구십백천만억조정]*\d[\d,]*(?:\.\d+)?)(원|만원|억원|%)/);
      if(amount)return amount;
    }
    return null;
  }
  function ipProblems(rows,opts){
    var ours=companyActor(opts.scope),roles=opts.scope?.roles||[],names=['회사','본사'].concat(ours?[ours]:[],roles.filter(function(r){return /^(?:위탁자|수탁자|발주자|수급인)$/.test(r);}));
    function escape(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
    var who='(?:'+Array.from(new Set(names)).map(escape).join('|')+')',texts=rows.map(function(r){return c(r.semantic_text||r.body);}),all=texts.join('\n'),out=[];
    var use=new RegExp(who+'(?:은|는|이|가|에게|에).{0,25}(?:사용|이용|수정)(?:할수|하도록|권을|을허락)|'+who+'.{0,12}(?:사용권|이용권).{0,10}(?:갖|부여|허락|귀속)');
    var own=new RegExp(who+'(?:에게|에)?(?:귀속|이전|양도)(?!하지|되지|되지아니)|'+who+'(?:의)?(?:소유|저작권|지식재산권)|(?:소유권|저작권|지식재산권).{0,8}'+who+'(?:에게|에)있(?:음|다)');
    var denied=new RegExp(who+'(?:은|는|이|가|에게|에).{0,25}(?:사용|이용|수정).{0,10}(?:할수없|금지|허용하지|하지못)|'+who+'.{0,12}(?:사용권|이용권).{0,10}(?:없|배제)');
    rows.forEach(function(r,i){if(denied.test(texts[i]))out.push(problem('B2','회사의 산출물 사용·이용 권한을 명시적으로 배제함',r));});
    if(out.length)return out;
    if(use.test(all)||own.test(all)||/공동소유|공동으로귀속|각당사자.{0,15}(?:사용|이용)할수/.test(all))return out;
    if(rows.length&&!opts.source_standard)out.push(problem('B1','산출물 권리 배분은 있으나 회사 귀속 또는 필요한 회사 사용권 미확인',rows[0]));
    return out;
  }
  function valueHit(p,r){var s=r.body,m;
    if(p.kind==='court'){
      if(!/법원|중재/.test(s)||!/(?:관할|분쟁|소송|중재)/.test(s+r.heading))return null;
      if(/중재/.test(s)&&/중재원|중재규칙|중재법|중재로|중재에의/.test(s)&&/해결|따른다|의한다|신청|회부/.test(s))return {key:'arbitration',label:'중재에 의한 분쟁해결'};
      m=s.match(/([가-힣]{2,15}(?:지방법원|고등법원|가정법원)(?:[가-힣]{2,8}지원)?|(?:갑|을|당사자|위탁자|수탁자|회사)의?(?:본사|본점|주된사무소|주소지|소재지).{0,14}법원)/);
      if(!m)return null;
      var before=s.slice(0,m.index),after=s.slice(m.index+m[0].length);
      if(!/(?:관할(?:법원)?|전속관할|합의관할)(?:은|는|:|：|으로는)$/.test(before)&&
        !/^(?:을|를|은|는)?(?:제1심의?)?(?:전속|합의)?관할(?:법원)?(?:으로|로|로서|이다)|^(?:으로|로)(?:정한다|지정한다|한다)|^(?:을|를)(?:정한다|지정한다|삼는다)|^에서.{0,12}(?:해결|소송|제소|다툰)/.test(after)&&
        !(m[0]===s.replace(/[.]$/,'')&&/관할|분쟁/.test(r.heading)))return null;
      // 붙여 읽힌 '관할법원은' 등 앞 서술은 법원 값이 아니다. 같은 법원의 반복을 충돌로 만들지 않는다.
      var court=m[1].replace(/^.*(?:관할법원(?:은|는|으로는)|관할(?:은|는)|소송(?:은|는)|분쟁(?:은|는))/, '');
      return {key:court,label:'분쟁해결 법원 지정'};
    }
    if(p.kind==='vat'){
      m=s.match(/(?:부가가치세|부가세|VAT)(?:\((?:부가가치세|부가세|VAT)\))?(?:은|는|가|를)?[:：]?(미포함|불포함|포함|별도|제외|면세|영세율)/i);
      if(!m)m=s.match(/(?:면세|영세율)(?:거래|적용|대상)/);
      if(!m)return null;return {key:/미포함|불포함|별도|제외/.test(m[1]||m[0])?'excluded':/면세|영세율/.test(m[0])?'exempt':'included',label:'부가가치세 처리 방식'};
    }
    if(p.kind==='term'){
      if(!/계약기간|계약의기간|유효기간|존속기간|효력|체결일|업무완료|계약종료/.test(s+r.heading))return null;
      var ds=Array.from(s.matchAll(/(\d{4})[.년/-](\d{1,2})[.월/-](\d{1,2})(?:일|\.)?/g));
      if(ds.length>=2){var a=dateValue(ds[0][1],ds[0][2],ds[0][3]),b=dateValue(ds[1][1],ds[1][2],ds[1][3]);
        if(a===null||b===null||a>b)return {invalid:true,label:'계약기간 날짜의 유효성·선후관계 확인 필요'};
        return {key:a+':'+b,label:'계약기간 날짜'};
      }
      m=s.match(/(?:체결일|효력발생일|계약일|시작일|착수일)(?:로)?부터([1-9]\d*)(년|개월|월|일)/);
      if(m)return {key:'duration:'+m[1]+m[2],label:'기준일부터의 계약기간'};
      if(/(?:업무|용역|과업|사업|납품|이행|검수|공사).{0,10}(?:완료|종료)(?:일|시|되는날|할때)?까지/.test(s))return {key:'completion',label:'업무 완료에 따른 종료 기준'};
      if(/(?:유효한동안|유효한것|보유하고있는한|기간의정함없이|무기한)/.test(s))return {key:'effective-condition',label:'효력·종료 조건'};
      m=s.match(/(?:계약기간|유효기간|존속기간)(?:은|는|:|：)?([1-9]\d*)(년|개월|월|일)/);if(m)return {key:'duration:'+m[1]+m[2],label:'계약기간'};
      return null;
    }
    if(p.kind==='price'){
      if(!/대금|금액|대가|단가|수수료|보수|계약가/.test(s+r.heading))return null;
      m=numericPrice(s);
      if(m){var n=Number(m[1].replace(/,/g,'')),unit=m[2];return {key:(unit==='%'?'rate:':'amount:')+(Number.isFinite(n)?n*(unit==='만원'?10000:unit==='억원'?100000000:1):m[1]),label:'대금·산정 값'};}
      if(/[₩￦][1-9][\d,]*|금[일이삼사오육칠팔구십백천만억조]+원/.test(s))return {key:'amount:'+s,label:'확정 대가'};
      if(/(?:발주|주문|건별|개별).{0,35}(?:단가|금액|대금)|(?:단가|산식|산정기준|수수료율).{0,35}(?:따라|적용|정산|정한다|별첨|발주)|(?:매출|판매|수익|보험료).{0,25}\d+(?:\.\d+)?%/.test(s))return {key:'formula',label:'대가 산정·건별 정산 방식'};
      if(/(?:발주서|주문서|개별계약|견적서).{0,30}(?:정하|따른|기재|기준)|(?:대금|금액).{0,20}(?:발주서|주문서|개별계약|견적서).{0,20}(?:정하|따른|기재|기준)/.test(s))return {key:'order-defined',label:'개별 문서에 의한 대가 결정 방식'};
      return null;
    }
    return null;
  }
  function priceBucket(s){
    var names=Array.from(s.matchAll(/유지보수(?:대금|비|료)|개발(?:대금|비|료)|물품대금|용역대금|계약대금|계약금액|임대료|수수료|운송비|배송비|설치비|보증금|총대금|대금|대가/g));
    var name=names.length?names[names.length-1][0]:'대가';
    return /^(?:계약대금|계약금액|총대금|대금)$/.test(name)?'대가':name;
  }
  function valueRows(p,r){
    if(p.kind!=='vat'&&p.kind!=='price'){var one=valueHit(p,r);return one?[{value:one,row:r}]:[];}
    var s=r.body,out=[];
    if(p.kind==='vat'){
      var tax=/(?:부가가치세|부가세|VAT)(?:\((?:부가가치세|부가세|VAT)\))?(?:은|는|가|를)?[:：]?(미포함|불포함|포함|별도|제외|면세|영세율)/gi,m;
      while((m=tax.exec(s))){var item=valueHit(p,Object.assign({},r,{body:m[0]}));
        if(/^(?:분|액|금액|표시는|표기가|이라고기재한것은).{0,15}(?:환급|반환|오기|오류)|^(?:분|액)(?:을|은|는|:)/.test(s.slice(tax.lastIndex)))continue;
        if(/포함/.test(m[1])&&/^(?:하지않|하지아니|이아니|이아님)/.test(s.slice(tax.lastIndex)))item.key='excluded';
        item.bucket=priceBucket(s.slice(0,m.index));out.push({value:item,row:r});
      }
      if(!out.length&&/면세|영세율/.test(s)){var exempt=valueHit(p,r);if(exempt){exempt.bucket=priceBucket(s);out.push({value:exempt,row:r});}}
    }else{
      var parts=s.split(/(?=(?:유지보수대금|개발대금|물품대금|용역대금|계약금액|계약대금|수수료)(?:은|는|:|：|\d))/);
      parts.forEach(function(part){var item=valueHit(p,Object.assign({},r,{body:part}));if(item){item.bucket=priceBucket(part);out.push({value:item,row:r});}});
    }
    return out;
  }
  function relevant(p,r){return p.terms.some(function(t){return r.body.includes(t)||r.heading.includes(t);});}
  function scopedQualifiers(p,prepared,hits){
    var out=[],rows=prepared.rows,used=new Set(hits.map(function(h){return h.document_index+':'+h.section_index;}));
    rows.forEach(function(r,i){if(r.non_contract)return;var s=r.body,prev=rows[i-1];
      var same=used.has(r.document_index+':'+r.section_index);
      var linked=same&&prev&&prev.document_index===r.document_index&&relevant(p,prev)&&(/^(?:다만[,，]?|단[,，]?|그러나|또한)?(?:이|그|해당|위)(?:의무|책임|조항|규정|내용)|^다만.{0,20}(?:이|그|해당|위)의무|^그러하지/.test(s));
      if(linked&&/면제|면한다|생략|적용하지|아니|않|배제|삭제/.test(s))out.push(problem('B4','같은 약정에 대한 제한·배제',r));
      if(same&&prev&&prev.document_index===r.document_index&&relevant(p,prev)&&/불구하고.{0,10}(?:위|그|이)의무.{0,10}(?:면제|배제|면한다)/.test(s))out.push(problem('B4','직전 약정에 우선하는 면제 특약',r));
      if(same&&prev&&prev.document_index===r.document_index&&relevant(p,prev)&&/^다만/.test(s)&&/그러하지(?:아니|않)/.test(s)&&!(p.kind==='credit_subcontract'&&/금융위원회/.test(s)))out.push(problem('B4','직전 필수 약정을 제외하는 단서',r));
      // 전역적인 무효화만 전역으로 취급한다. 다른 조의 '불구하고'는 대상 확인 없이 가져오지 않는다.
      if(/(?:본|이)계약의?(?:모든|전체|일체의?)(?:조항|의무|규정).{0,25}(?:배제|적용하지|면제)/.test(s))out.push(problem('B4','계약 전체 약정의 명시적 배제',r));
      if(same&&/^(?:다만[,，]?)?(?:수탁자(?:의)?|갑의|을의)?(?:모든|전체|일체의?)(?:조항|의무|규정).{0,25}(?:배제|적용하지|면제)/.test(s))out.push(problem('B4','같은 조의 모든 약정을 배제하는 단서',r));
      if(p.private&&/(?:모든|전체|일체의?)보호의무.{0,20}(?:면제|배제|적용하지)/.test(s))out.push(problem('B4','정보 보호 의무 전체를 명시적으로 배제하는 특약',r));
      if(/불구하고|배제|우선적용|대체/.test(s)){
        var refs=Array.from(s.matchAll(/제(\d+(?:의\d+)?)조/g)).map(function(m){return m[1];});
        if(refs.length&&hits.some(function(h){var q=prepared.rows.find(function(x){return x.document_index===h.document_index&&x.section_index===h.section_index&&E.heading(x.text);});
          var n=q&&c(q.text).match(/^제(\d+(?:의\d+)?)조/);return n&&refs.includes(n[1])&&h.document_index===r.document_index;})){
          if(deny(s,p)||undecided(s))out.push(problem('B4','확인한 조항을 변경·배제하는 참조',r));
        }
      }
      if(relevant(p,r)&&/별첨|부속|부록/.test(s)&&/달리|우선|변경|대체|따른다/.test(s)){
        var other=prepared.documents.filter(function(d,j){return j!==r.document_index&&String(d.text||'').trim();});
        if(!other.length&&!valueHit(p,r))out.push(problem('B4','이 약정의 내용을 정하는 별첨 원문 미확보',r));
      }
      if(same&&prev&&prev.document_index===r.document_index&&relevant(p,prev)&&/^다만[,，]?(?:별첨|부속|부록).{0,20}우선/.test(s)&&!prepared.documents.some(function(d,j){return j!==r.document_index&&String(d.text||'').trim();}))out.push(problem('B4','직전 약정에 우선하는 별첨 원문 미확보',r));
      if(prev&&same&&prev.document_index===r.document_index&&undecided(s)&&relevant(p,r))out.push(problem('B1','해당 약정 내용이 미정·공란',r));
    });return out;
  }
  function referenceProblems(p,prepared,hits){
    var rows=prepared.rows,out=[];
    if(!hits.length||!rows.some(function(r){return /제\d+(?:조|항|호)|전조|전항|별첨|부속|별표/.test(r.body)&&/적용|따른|준용|면제|배제|제외|경우에만|우선/.test(r.body);}))return out;
    var D=typeof DecisionEvidence!=='undefined'?DecisionEvidence:require('./decision_evidence');
    prepared.referenceBundles=prepared.referenceBundles||{};
    var b=prepared.referenceBundles[p.id]||(prepared.referenceBundles[p.id]=D.bundle({id:p.id},prepared.documents,{terms:p.terms}));
    var keys=new Set(hits.map(function(h){return h.document_index+':'+h.sentence_index;}));
    (b.reference_links||[]).forEach(function(link){
      var r=rows.find(function(x){return x.document_index===link.document_index&&x.sentence_index===link.sentence_index;});if(!r||r.non_contract)return;
      var s=r.body,restriction=/(?:적용하지|적용을.{0,6}(?:배제|제외)|(?:의무|책임|조치|규정).{0,12}(?:면제|배제|제외)|선택적으로|동의하는경우에만|재량으로)/.test(s);
      var affects=(link.targets||[]).some(function(t){return keys.has(t.document_index+':'+t.sentence_index);});
      // 해소 실패인 추가 특약도 본문 근거 조문을 명시하면 임의로 무관하다고 버리지 않는다.
      if(!affects&&restriction&&link.missing){var ns=Array.from(s.matchAll(/제(\d+)조/g)).map(function(m){return m[1];});
        affects=hits.some(function(h){if(h.document_index===r.document_index)return false;
          var heading=rows.find(function(x){return x.document_index===h.document_index&&x.domain===h.domain&&x.section_index===h.section_index&&E.heading(x.text);});
          var n=heading&&c(heading.text).match(/^제(\d+)조/);return n&&ns.includes(n[1]);});}
      if(affects&&restriction)out.push(problem('B4','확인한 약정을 제한·배제하는 역참조 또는 범위 특약',r));
      else if(link.missing&&relevant(p,r)&&/(?:예외|제한|변경|우선).{0,20}(?:따른|적용)|(?:범위|조건).{0,12}(?:제\d+|별첨|부속)/.test(s))out.push(problem('B4','해당 약정의 범위·예외를 정하는 참조 원문 미확보',r));
    });return out;
  }
  function discretionary(s){return /가능한경우에만|필요한경우에만|가능한신원조회|가능한범위(?:내|안|에서|의)|선택적으로|자신의재량|수탁자의재량|수탁자가동의하는경우에만|사항중하나|(?:실시|이행|준수|수행|확보|협조|협력|암호화(?:처리)?)(?:하도록|하기위하여)노력|(?:사항|의무).{0,12}(?:이행|준수|수행)할수있|(?:보호조치|보안조치|암호화).{0,10}(?:일부만|일부실시|일부를)/.test(s);}
  function localDiscretion(p,s){
    // 하나의 문장에 병렬로 적힌 다른 의무의 선택 조건을 본 요건에 전파하지 않는다.
    var parts=s.split(/하고|하며|[,，;]/),matching=parts.filter(function(part){return p.groups.some(function(g){return test(g.object,part);})||p.terms.some(function(t){return part.includes(c(t));});});
    if(parts.length>1&&discretionary(parts[0])&&!/한다|하되|한다는/.test(parts[0])&&/^(?:수탁자|전자금융보조업자)(?:는|가)/.test(parts[0]))return true;
    // 백업자료 보존과 설비 확보는 기준표의 대체 요건이다. 한쪽의 추가 약정 한정이 독립된 다른 약정을 없애지는 않는다.
    if(p.id==='ITSEC-08'&&s.split(/하고|하며|및|[,，;]/).some(function(part){return /백업자료.{0,10}(?:보존|보관|복구)/.test(part)&&!discretionary(part);}))return false;
    return matching.some(function(part){return discretionary(part)&&!/^(?:위탁자|회사|발주자|주주)(?:은|는|가).{0,20}필요한경우에만.{0,40}(?:요청|요구|점검|감사|열람|청구)할수/.test(part);});
  }
  function listLimitations(prepared,hits){
    var out=[],rows=prepared.rows;
    function level(s){return /^[①-⑳]/.test(s)?0:/^\d+[.)]/.test(s)?1:/^[가-하][.)]/.test(s)?2:/^\(\d+\)/.test(s)?3:-1;}
    hits.forEach(function(h){var r=prepared.by_sentence.get(h.document_index+':'+h.sentence_index);if(!r)return;
      var used=(r.list_intros||[]).slice(),at=r.row_index,max=level(r.body);if(max<0)max=9;
      for(var i=at-1;i>=0;i--){var q=rows[i];if(q.document_index!==r.document_index||q.domain!==r.domain||q.section_index!==r.section_index)break;
        var s=q.body,l=level(s),intro=/(?:다음|아래).{0,20}(?:각호|각목|각세목|사항|행위|의무)/.test(s);
        if(intro&&(l<max||l<0)){used.push(q);if(l>=0)max=l;}
        // 독립된 완전 문장 뒤까지 앞 목록의 선택 조건을 퍼뜨리지 않는다.
        if(!intro&&l<0&&/^(?:수탁자|위탁자|갑|을)(?:은|는).{0,60}(?:한다|하여야한다)[.]?$/.test(s))break;
      }
      used.forEach(function(q){var s=c(q.body||q.text);if(discretionary(s)||nonContract({body:s,text:q.text}))out.push(problem('B4','해당 목록의 상위 약정이 선택·노력·예시로 제한됨',q));});
    });return out;
  }
  function evaluate(cp,documents,options){
    var p=profiles[cp.id],out={eligible:false,status:'no_rule',evidence:[],blockers:[],missing:[],elements:[],tag_evidence:[],version:VERSION};if(!p)return out;p=compiledProfile(p);
    var prepared=prepare(documents),all=prepared.rows,opts=options||{},rows=prepared.contract_rows,hits=[],conditionalHits=[],values=[],aliasRows=profileAliases(aliases(opts.knowledge),p);
    if(!rows.length){out.status='source_quality';out.missing=['판정할 약정 텍스트 미확보'];return out;}
    // 등록 표준은 범위의 적합성이 아니라 해당 조항의 내용만 색인한다. 실제 적용은 본건에서 결정한다.
    if(p.private&&!prepared.has_private_info){out.status='no_evidence';out.missing=['대상 정보에 관한 현재 약정'];return out;}
    var groups=p.groups.map(function(g){return {rule:g,hits:[]};});
    rows.forEach(function(r){var ex=expand(r,aliasRows),s=ex.text,original=r.semantic_body,expanded=s!==original,related=relevant(p,r)||ex.tags.length;
      if(keywordOnly(p,r))return;
      if(p.kind==='vat'&&related&&/(?:포함|별도|제외)(?:여부(?![:：]?(?:포함|별도|제외))|또는|혹은|중선택)|(?:포함|별도|제외)\/(?:포함|별도|제외)/.test(s)){out.blockers.push(problem('B1','VAT 처리 값이 선택·미확정 상태',r));return;}
      if(p.kind==='vat'&&related&&/(?:부가가치세|부가세|VAT)(?:은|는|의|처리는|:|：)?별도(?:로)?(?:협의|합의|결정)/i.test(s)){out.blockers.push(problem('B1','VAT 처리 방식이 별도 협의로 미정',r));return;}
      if(related&&(undecided(s)||expanded&&undecided(original))){out.blockers.push(problem('B1','해당 약정의 미정·공란·판독 불가',r));return;}
      if(related&&/(?:조항|문구|약정)(?:을|를)?.{0,8}(?:삭제한다|폐기한다)/.test(s)){out.blockers.push(problem('B2','질문에 해당하는 조항·문구를 삭제하는 내용',r));return;}
      // 명칭 추가로 부정어와 주제 사이의 거리가 늘어나도 원문에서 확인한 배제를 무효화하지 않는다.
      var controlled=p.kind==='credit_subcontract'&&controlledCreditException(r);
      if(related&&(deny(s,p)||expanded&&deny(original,p))&&!controlled){out.blockers.push(problem('B2',p.kind==='credit_subcontract'?'재위탁 제한 약정의 예외 범위 확인 필요':'질문이 요구하는 약정의 명시적 배제',r));return;}
      if(controlled){out.elements.push('재위탁 예외의 서면승낙·법령상 금지업무 제외');controlled.forEach(function(q){conditionalHits.push(proof(q,'재위탁 예외의 서면승낙·법령상 금지업무 제외'));});}
      if(p.kind==='assignment'&&related&&/동의|승인|승낙/.test(s)&&(!/서면|전자문서|문서/.test(s)||!/사전|미리|이전|전에|(?:동의|승인|승낙)(?:를|을)?(?:없이|거쳐|얻어|받아)/.test(s))){out.blockers.push(problem('B1','양도 통제 예외의 사전 서면 동의 방식 미확인',r));return;}
      if(related&&(wrongActor(p,r,s)||expanded&&wrongActor(p,r,original))){out.blockers.push(problem('B2','질문의 의무 주체와 본건 약정의 주체가 반대임',r));return;}
      if(related&&r.aliases?.conflicts?.some(function(a){return s.includes(a+'은')||s.includes(a+'는');})){out.blockers.push(problem('B3','해당 근거의 당사자 별칭 정의 충돌',r));return;}
      if(related&&(localDiscretion(p,s)||expanded&&localDiscretion(p,original))){out.blockers.push(problem('B2','해당 의무를 선택·일부·노력으로 제한하는 조건',r));return;}
      if(related&&/(?:그|위|해당)의무대신/.test(s)){out.blockers.push(problem('B4','필수 약정을 다른 조치로 대체하는 내용',r));return;}
      if(related&&/(?:수탁자|전자금융보조업자|클라우드(?:컴퓨팅)?서비스제공자)(?:는|가)/.test(s)&&
        /(?:조치를취|조치를실시|조치를이행|암호화(?:처리)?|협조|협력|준수|대책을수립|전용회선을사용)(?:할수있|할수도있|하기위하여노력)|(?:보호|보안)조치.{0,25}(?:실시|이행|수행|취)할수있|분리.{0,12}(?:설치|운영).{0,4}할수있/.test(s)){
        out.blockers.push(problem('B1','수탁자의 선택 가능한 행위만 있고 해당 의무 약정은 미확인',r));return;
      }
      if(p.kind==='court'||p.kind==='vat'||p.kind==='price'||p.kind==='term'){
        valueRows(p,Object.assign({},r,{body:s})).forEach(function(v){if(v.value.invalid)out.blockers.push(problem('B3',v.value.label,r));else {values.push(v);hits.push(proof(r,v.value.label));}});
      }else groups.forEach(function(g){
        if(r.list_header&&r.list_valid||r.table_context&&r.list_header)return;
        var context=s;
        // 목록 항목은 같은 조의 명시적 목록 도입부로 주제만 연결한다. 다른 조의 단어를 합성하지 않는다.
        if(!test(g.rule.object,context)&&r.source?.table)context=r.heading+s;
        if(test(g.rule.object,context)&&test(g.rule.action,s)&&!deny(s,p)){
          // 감독기관 제재 이력 또는 재수탁자 문서 제출은 본건 위탁자의
          // 개인정보 점검 권한을 확인한 근거가 아니다.
          if(p.id==='PRIV-07'&&/기관경고|형사처벌|제재.{0,20}받은|감독규정/.test(s)&&!/점검할수|실태를점검|점검에.{0,8}협조/.test(s))return;
          if(p.kind==='ip'&&/기존|기보유|계약전|종전/.test(s)&&!/산출물|성과물|개발결과|납품물/.test(s))return;
          if(p.kind==='sales_supervision'&&!/모집|보험판매|판매대리|보험대리|판매업무|판매수탁/.test(r.document_text))return;
          if(r.unresolved_table){out.blockers.push(problem('B1','해당 약정의 표 주체·대상·행 구조를 확인할 수 없음',r));return;}
          (r.list_intros||[]).forEach(function(intro){g.hits.push(proof(intro,'목록·표의 대상 및 주체'));});
          g.hits.push(proof(r,g.rule.label));
          var parsed=Q.parseAll(s,r.aliases);
          out.tag_evidence.push({document:r.document,text:r.text,tags:ex.tags.concat([{label:g.rule.label,type:'content',check_id:p.id}]),
            facts:parsed?.map(function(f){return f.facts;})||[],method:ex.tags.length?'current_text_tag_alias':parsed?'structured_requirements':'current_clause_elements'});
        }
      });
    });
    if(p.same_section&&groups.length){var common=groups.map(function(g){return new Set(g.hits.map(function(h){return h.document_index+':'+h.domain+':'+h.section_index;}));});
      if(!Array.from(common[0]).some(function(k){return common.every(function(set){return set.has(k);});}))out.missing.push('감독기관의 요구와 협조 의무의 같은 조 내 연결');}
    if(groups.length){groups.forEach(function(g){if(g.hits.length){out.elements.push(g.rule.label);hits=hits.concat(g.hits);}else out.missing.push(g.rule.label);});}
    hits=hits.concat(conditionalHits); // 대표 근거는 금지 원칙, 예외 조건은 보조 근거로 유지한다.
    // 같은 분쟁의 법원 충돌. 다른 문서의 독립 약정 관할을 본계약과 무조건 합치지 않는다.
    if(p.kind==='court'){
      var byDoc={};values.forEach(function(v){(byDoc[v.row.document_index]||(byDoc[v.row.document_index]=[])).push(v);});
      Object.values(byDoc).forEach(function(vs){if(new Set(vs.map(function(v){return v.value.key;})).size>1&&vs.filter(function(v){return /전속|제1심|관할법원/.test(v.row.body);}).length>1&&!vs.some(function(v){return /우선적용|대체|변경/.test(v.row.body);}))out.blockers.push(problem('B3','같은 분쟁의 관할 지정이 충돌함',vs[1].row));});
    }
    if(p.kind==='vat'||p.kind==='price'){
      var buckets={};values.forEach(function(v){var doc=prepared.documents[v.row.document_index],scope=doc.contract_scope||doc.scope_id||(doc.independent?'document:'+v.row.document_index:'current_contract');
        if(p.kind==='price'&&!/^(?:amount|rate):/.test(v.value.key))return;
        var k=scope+':'+v.value.bucket+(p.kind==='price'?':'+v.value.key.split(':')[0]:'');(buckets[k]||(buckets[k]=[])).push(v);});
      Object.values(buckets).forEach(function(vs){if(new Set(vs.map(function(v){return v.value.key;})).size>1&&!vs.some(function(v){return /변경(?:한|후|전)|증액분|감액분|우선적용|대체한다/.test(v.row.body);}))out.blockers.push(problem('B3',p.kind==='vat'?'같은 대가의 VAT 포함·별도 표시 충돌':'같은 대가의 금액·산정 값 충돌',vs[1].row));});
    }
    if(p.kind==='term'){
      var dateRows=values.filter(function(v){return /^\d+:\d+$/.test(v.value.key)&&!/갱신|연장/.test(v.row.body);}),byDoc={};
      dateRows.forEach(function(v){(byDoc[v.row.document_index]||(byDoc[v.row.document_index]=[])).push(v);});
      Object.values(byDoc).forEach(function(vs){if(new Set(vs.map(function(v){return v.value.key;})).size>1)out.blockers.push(problem('B3','동일 계약기간의 날짜 충돌',vs[1].row));});
    }
    var relevantRows=rows.filter(function(r){return relevant(p,r);});
    out.blockers=out.blockers.concat(risk(p,relevantRows,opts.scope),scopedQualifiers(p,prepared,hits),referenceProblems(p,prepared,hits),listLimitations(prepared,hits));
    if(p.kind==='ip')out.blockers=out.blockers.concat(ipProblems(rows.filter(function(r){return hits.some(function(h){return h.document_index===r.document_index&&
      (h.sentence_index===r.sentence_index||h.domain===r.domain&&h.section_index===r.section_index&&/이를|그산출물|해당산출물/.test(r.body)&&/사용|이용|권리/.test(r.body));});}),opts));
    var evidenceSeen=new Set(),blockerSeen=new Set();
    out.evidence=hits.filter(function(h){var key=h.document_index+':'+h.start+':'+h.end;if(evidenceSeen.has(key))return false;evidenceSeen.add(key);return true;});
    out.blockers=out.blockers.filter(function(h){var key=h.document_index+':'+h.start+':'+h.code;if(blockerSeen.has(key))return false;blockerSeen.add(key);return true;});
    if(!hits.length&&!out.missing.length)out.missing=[p.kind==='court'?'분쟁해결 지정 내용':p.kind==='vat'?'부가가치세 처리 값':'질문에 해당하는 약정 내용'];
    out.eligible=out.evidence.length>0&&!out.missing.length&&!out.blockers.length;
    out.status=out.eligible?'supported':out.blockers.length?'related_exception':'no_evidence';
    out.signature=out.evidence.map(function(e){return e.element+':'+c(e.text);});
    out.recognition={stage:out.evidence.length?'clause_found':'not_found',evidence:out.evidence};return out;
  }
  function recognize(id,text){var p=profiles[id];if(!p)return null;var r=evaluate({id:id},[{name:'문서',text:text}],{});return r.eligible?{key:H.of(r.signature),element:r.elements.join(' · ')||r.evidence[0].element}:null;}
  return {VERSION:VERSION,profiles:profiles,evaluate:evaluate,recognize:recognize,prepare:prepare,compact:c};
})();
if(typeof module!=='undefined')module.exports=AgreementJudgment;
