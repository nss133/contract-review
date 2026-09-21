"use strict";
/* 완전한 문장을 제한된 명제 구조로 해석. 유사도·태그 점수는 동등성 증거가 아니다. */
var ClauseEquivalence=(function(){
  var actor='(수탁자|위탁자|갑|을|제공자|수령자|당사자일방|각당사자)',data='(개인정보|개인신용정보|비밀정보|제공받은비밀정보|위탁받은개인정보)';
  function compact(s){return String(s||'').normalize('NFC').replace(/\s+/g,'').replace(/[.。]$/,'');}
  function frame(text){
    var s=compact(text),m;
    // 인용·가정·새 조건이 붙은 문장은 정형 동의 표현으로 축약하지 않는다.
    if(/다만|불구하고|예외|면제|원칙적으로|가능한한|노력|가급적|예를|라고|라는|[“”"「」]/.test(s))return null;
    function match(pattern){pattern=pattern.split(actor+'는').join(actor+'(?:은|는)').split(actor+'가').join(actor+'(?:이|가)');return s.match(new RegExp('^'+pattern+'$'));}
    function out(topic,values){return {topic:topic,values:values,key:topic+':'+JSON.stringify(values)};}
    m=match(actor+'는'+actor+'의사전서면동의없이재위탁할수없다');
    if(m)return out('prior_consent',[m[1],m[2],'재위탁','서면','사전']);
    m=match(actor+'가(?:업무를)?재위탁하려면'+actor+'의서면동의를(?:미리|사전에)받아야한다');
    if(m)return out('prior_consent',[m[1],m[2],'재위탁','서면','사전']);
    m=match(actor+'는'+data+'를(?:위탁목적외로|위탁목적외의용도로)(?:이용|사용)(?:하여서는아니된다|해서는안된다|할수없다)');
    if(m)return out('purpose_limit',[m[1],m[2],'위탁목적','금지']);
    m=match(actor+'는'+data+'를위탁목적으로만(?:이용|사용)(?:하여야한다|해야한다)');
    if(m)return out('purpose_limit',[m[1],m[2],'위탁목적','금지']);
    m=match(actor+'는'+data+'를제3자에게(?:누설|공개)(?:하여서는아니된다|해서는안된다|할수없다)');
    if(m)return out('nondisclosure',[m[1],m[2],'제3자','금지']);
    m=match(actor+'는제3자에게'+data+'를(?:누설|공개)(?:하여서는아니된다|해서는안된다|할수없다)');
    if(m)return out('nondisclosure',[m[1],m[2],'제3자','금지']);
    m=match(actor+'는'+actor+'의(?:개인정보처리현황점검|개인정보처리현황에대한점검)에협조(?:하여야한다|해야한다)');
    if(m)return out('inspection',[m[1],m[2],'개인정보처리현황점검','협조의무']);
    m=match(actor+'가개인정보처리현황을점검하는경우'+actor+'는이에협조(?:하여야한다|해야한다)');
    if(m)return out('inspection',[m[2],m[1],'개인정보처리현황점검','협조의무']);
    m=match(actor+'는계약종료시'+data+'를'+actor+'에게반환(?:하여야한다|해야한다)');
    if(m)return out('return_on_end',[m[1],m[2],m[3],'계약종료시']);
    m=match('계약이종료되면'+actor+'는'+actor+'에게'+data+'를반환(?:하여야한다|해야한다)');
    if(m)return out('return_on_end',[m[1],m[3],m[2],'계약종료시']);
    m=match(actor+'는계약종료(?:일로|일)?부터([1-9][0-9]*)일이내에'+data+'를파기(?:하여야한다|해야한다)');
    if(m)return out('destroy_after_end',[m[1],m[3],m[2]+'일','계약종료']);
    m=match('계약종료후([1-9][0-9]*)일이내에'+actor+'는'+data+'를파기(?:하여야한다|해야한다)');
    if(m)return out('destroy_after_end',[m[2],m[3],m[1]+'일','계약종료']);
    m=match(actor+'는'+data+'의유출을인지한(?:때|경우)즉시'+actor+'에게(?:서면으로통지|서면통지)(?:하여야한다|해야한다)');
    if(m)return out('incident_notice',[m[1],m[2],m[3],'인지','즉시','서면']);
    m=match(actor+'는'+data+'의유출을알게되면즉시'+actor+'에게서면으로알려야한다');
    if(m)return out('incident_notice',[m[1],m[2],m[3],'인지','즉시','서면']);
    m=match(actor+'는'+data+'에대한접근권한을업무수행에필요한최소한의범위로제한(?:하여야한다|해야한다)');
    if(m)return out('least_access',[m[1],m[2],'업무수행','최소범위']);
    m=match(actor+'는업무수행에필요한최소한의범위에서만'+data+'에대한접근권한을부여(?:하여야한다|해야한다)');
    if(m)return out('least_access',[m[1],m[2],'업무수행','최소범위']);
    return null;
  }
  return {VERSION:'clause-equivalence-v1',frame:frame};
})();
if(typeof module!=='undefined')module.exports=ClauseEquivalence;
