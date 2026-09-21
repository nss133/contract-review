"use strict";
/* 조항 존재와 내용의 방향을 분리한다. 이 모듈의 recognized는 적정성 판정이 아니다. */
var AgreementEvidence=(function(){
  var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules');
  var Profiles=typeof PresenceProfiles!=='undefined'?PresenceProfiles:require('./presence_profiles');
  var Structure=typeof DocumentStructure!=='undefined'?DocumentStructure:require('./document_structure');
  var unitCache=new WeakMap();
  var actorStart=new RegExp('^(?:[①-⑳])?[“"「]?(?:'+Array.from(new Set(Profiles.roles.concat(['갑','을','당사자일방','클라우드서비스제공자']))).join('|')+')[”"」]?[은는이가]');
  function compact(s){return String(s||'').replace(/\s+/g,'');}
  function globalEffect(text){var s=compact(text);
    if(/불구하고|우선(?:적용|한다)|(?:본|이)계약.{0,20}(?:전체|전부|모든|일체|배제)/.test(s))return true;
    // 제목이 달라도 지시 대상이 불명확한 의무 축소는 무관하다고 단정하지 않는다.
    if(/^(?:다만[,，]?)?(?:이|그|해당|위)(?:의무|책임|조항|규정).*(?:면제|면책|배제|제외|축소|제한|적용하지)/.test(s))return true;
    // 특정 항 위반의 배상책임은 계약 전체의 모든 의무를 수정하는 문장이 아니다.
    var penalty=s.replace(/[“"「](갑|을|수탁자|위탁자)[”"」]/g,'$1');
    var localPenalty=/^(?:수탁자는|을은)(?:제\d+항(?:또는제\d+항)*|본조)의의무를위반한경우이에따른민[·∙ㆍ]?형사상일체의책임을부담하며,(?:갑|위탁자)에게발생한모든손해를배상(?:하여야한다|해야한다|한다)[.]?$/.test(penalty);
    return !localPenalty&&/(?:모든|일체의?)(?:의무|책임)/.test(s);
  }
  // 추출기의 단순 줄바꿈만 합친다. 조·항·호 및 새 주체의 문장은 넘지 않는다.
  function units(documents){documents=documents||[];var saved=unitCache.get(documents),structure=documents.map(function(d){return Structure.revisionToken(d.extraction);});
    if(saved&&saved.inputs.length===documents.length&&saved.inputs.every(function(d,i){return d.text===documents[i].text&&d.name===documents[i].name&&saved.structure[i]===structure[i];}))return saved.rows;
    var out=[],cursor={},raws=documents.map(function(d){return String(d.text||'').normalize('NFC');}),blockCursors={},blocks=documents.map(function(d){return String(d.text||'').normalize('NFC')===d.text&&Structure.validExtraction(d.text,d.extraction)?d.extraction.blocks:[];});
    E.sentences(documents).forEach(function(s){var raw=raws[s.document_index],start=raw.indexOf(s.text,cursor[s.document_index]||0);cursor[s.document_index]=start+s.text.length;
      var bs=blocks[s.document_index],bi=blockCursors[s.document_index]||0;while(bi+1<bs.length&&bs[bi].end<start)bi++;blockCursors[s.document_index]=bi;
      var source=bs[bi]?.start<=start&&bs[bi]?.end>=start?bs[bi].source:null;
      var row=Object.assign({},s,{start:start,end:start+s.text.length,source:source}),prev=out[out.length-1];
      if(prev&&prev.document_index===s.document_index&&prev.section_index===s.section_index&&!E.heading(s.text)&&!E.heading(prev.text)&&
        !source?.table&&!prev.source?.table&&
        (actorStart.test(compact(prev.text))||/^(?:본|이)\s*(?:계약|약정)/.test(prev.text))&&
        !/[.。;:]\s*$|다\s*$/.test(prev.text)&&!/^\s*(?:[①-⑳]|(?:\d+|[가나다라마바사아자차카타파하])[.)]|\((?:\d+|[가나다라마바사아자차카타파하])\)|[-•□※])/.test(s.text)&&!actorStart.test(compact(s.text))&&start>=prev.end){
        prev.text=raw.slice(prev.start,row.end);prev.end=row.end;prev.exception=prev.exception||s.exception;prev.unusable=prev.unusable||s.unusable;
      }else out.push(row);
    });out.forEach(function(s){s.compact_text=compact(s.text);});unitCache.set(documents,{structure:structure,inputs:documents.map(function(d){return {name:d.name,text:d.text};}),rows:out});return out;
  }
  function scan(terms,documents,sourceRows){
    var all=sourceRows||E.sentences(documents),selected=new Set(),sections=new Set();
    all.forEach(function(s,i){var text=s.compact_text||compact(s.text);if(terms.some(function(t){return t&&text.includes(compact(t));})){selected.add(i);if(s.section)sections.add(s.document_index+':'+s.section_index);}});
    if(!selected.size)return [];
    all.forEach(function(s,i){
      var h=E.heading(s.text),body=h?s.text.slice(h.prefix.length):s.text;
      if(s.section&&sections.has(s.document_index+':'+s.section_index))selected.add(i);
      // 전역 우선·배제 규정은 다른 제목에 있어도 놓치지 않는다.
      if(globalEffect(body))selected.add(i);
    });
    // 같은 문서·구역에서 바로 이어지는 단서/지시어는 근거와 함께 읽는다.
    all.forEach(function(s,i){var prev=all[i-1];if(prev&&selected.has(i-1)&&prev.document_index===s.document_index&&prev.section_index===s.section_index&&(/^(?:다만|단[,，]|그러나|이\s|그\s|해당\s|위\s)/.test(s.text)||/(?:이|그|해당|위)\s*(?:의무|책임|조항|규정)|그러하지|이와\s*달리/.test(s.text)))selected.add(i);});
    for(var i=all.length-2;i>=0;i--){var s=all[i],next=all[i+1];
      if(selected.has(i+1)&&s.document_index===next.document_index&&s.section_index===next.section_index&&/다음|아래|이하/.test(s.text)&&(/경우|조건|한하|한해|면제|배제|적용/.test(s.text)||/(?:다음|아래)\s*각\s*[호목]/.test(s.text)))selected.add(i);
    }
    // 제목 없이 깨진 문장은 무관하다고 입증할 수 없다. 단순 표시용 빈칸과 구별한다.
    var usedDocs=new Set(Array.from(selected).map(function(i){return all[i].document_index;}));
    all.forEach(function(s,i){if(!s.section&&/�/.test(s.text)&&usedDocs.has(s.document_index))selected.add(i);});
    return all.filter(function(s,i){return selected.has(i);});
  }
  function scanUnits(terms,documents){return scan(terms,documents,units(documents));}
  function isDocumentTitle(row,documents){
    var all=units(documents),first=all.find(function(s){return s.document_index===row.document_index;});
    return first?.sentence_index===row.sentence_index&&first?.text===row.text&&!row.section&&/^[가-힣A-Za-z0-9 ()·ㆍ&-]{1,70}(?:계약서|약정서|합의서)$/.test(row.text)&&
      !/다만|단서|예외|제외|면제|면책|배제|우선|하지|책임|의무|가정|예시|검토|취소/.test(row.text)&&
      all.some(function(s){return s.document_index===row.document_index&&s.section_index>0;});
  }
  function inspect(cp,documents){
    var terms=(cp.triggers||{}).keywords||[],rows=scanUnits(terms,documents).filter(function(s){var h=E.heading(s.text);return (!h||s.text.slice(h.prefix.length).trim())&&terms.some(function(t){return t&&(compact(s.text).includes(compact(t))||compact(s.section).includes(compact(t)));});});
    return {stage:rows.length?'clause_found':'not_found',evidence:rows.map(function(s){return {document:s.document,text:s.text,section:s.section,direction:s.direction,
      actors:Array.from(new Set(Array.from(s.text.matchAll(/(?:^|\s)(수탁자|위탁자|임대인|임차인|매도인|매수인|당사자 일방|상대방|갑|을)(?=은|는|이|가|의|에게|\s|$)/g)).map(function(m){return m[1];}))),
      effect:/면제|책임.{0,15}(?:지지|부담하지|없)|배상.{0,10}(?:않|아니)/.test(s.text)?'책임 제한·배제':/책임|배상/.test(s.text)?'책임 규정':'기타 약정',
      qualification:/다만|경우|한하여|조건|예외|한도/.test(s.text)};})};
  }
  return {scan:scan,scanUnits:scanUnits,units:units,isDocumentTitle:isDocumentTitle,globalEffect:globalEffect,inspect:inspect};
})();
if(typeof module!=='undefined')module.exports=AgreementEvidence;
