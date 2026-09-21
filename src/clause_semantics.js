"use strict";
/* 유한한 약정 문법: 주체·행위·대상·조건을 따로 추출한다.
   소비하지 못한 문구는 버리지 않으며, 점수/태그만으로 동등성을 선언하지 않는다. */
var ClauseSemantics=(function(){
  var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules');
  var T=typeof ContractTags!=='undefined'?ContractTags:require('./contract_tags');
  var Profiles=typeof PresenceProfiles!=='undefined'?PresenceProfiles:require('./presence_profiles');
  var A=typeof AgreementEvidence!=='undefined'?AgreementEvidence:require('./agreement_evidence');
  var Structure=typeof DocumentStructure!=='undefined'?DocumentStructure:require('./document_structure');
  var contextCache=new WeakMap();
  var knownRoles=Array.from(new Set(['수탁자','위탁자','수급인','발주자','정보제공자','정보수령자','제공자','수령자','전자금융보조업자','클라우드컴퓨팅서비스제공자','클라우드서비스제공자'].concat(Profiles.roles))).filter(function(r){return !['각당사자','본재보험계약'].includes(r);});
  var role='(?:'+Array.from(new Set(knownRoles.concat(Profiles.roles,['당사자일방','갑','을']))).join('|')+')';
  function compact(text){return String(text||'').normalize('NFC').replace(/\s+/g,'');}
  function aliases(documents){var map={},conflicts=new Set(),definitions=[];
    (documents||[]).forEach(function(d){E.sentences([d]).forEach(function(s){
      var h=E.heading(s.text),text=compact(h?s.text.slice(h.prefix.length):s.text),re=new RegExp('(?<![가-힣A-Za-z0-9])('+role+')[（(]이하(?:에서)?[“"「]('+role+')[”"」](?:(?:이라|라)?(?:한다|함))?[）)]','g'),m;
      while((m=re.exec(text))){var known=knownRoles,a=m[1],b=m[2],alias=['갑','을'].includes(a)?a:b,target=alias===a?b:a;
        if(!['갑','을'].includes(alias)||!known.includes(target))continue;
        if(map[alias]&&map[alias]!==target)conflicts.add(alias);else map[alias]=target;
        definitions.push({text:s.text,alias:alias,role:target,standalone:text.replace(/[.。]$/,'')===m[0]});
      }
      var plain=text.replace(/[.。]$/,'').match(new RegExp('^[“"「]?(갑|을)[”"」]?(?:은|는|이란|이라함은)[“"「]?('+knownRoles.join('|')+')[”"」]?(?:을|를)(?:말한다|의미한다)$'));
      if(plain){if(map[plain[1]]&&map[plain[1]]!==plain[2])conflicts.add(plain[1]);else map[plain[1]]=plain[2];
        definitions.push({text:s.text,alias:plain[1],role:plain[2],standalone:true});}
    });});
    conflicts.forEach(function(a){delete map[a];});return {map:map,conflicts:Array.from(conflicts),definitions:definitions};
  }
  // 파일과 명시 별첨 구역마다 갑·을 정의를 격리한다. 다른 구역의 정의를 추정 상속하지 않는다.
  function contexts(documents){documents=documents||[];var units=A.units(documents),saved=contextCache.get(documents);if(saved?.units===units)return saved.value;
    var maps=documents.map(function(d){var m=Structure.inspect(String(d.text||'').normalize('NFC'),d.extraction);m.byId=new Map(m.sections.map(function(s){return [s.id,s];}));return m;}),cursors={},groups=new Map();
    var rows=units.map(function(s){var m=maps[s.document_index],i=cursors[s.document_index]||0;while(i+1<m.lines.length&&m.lines[i+1].offset<=s.start)i++;cursors[s.document_index]=i;
      var line=m.lines[i],region=m.byId.get(line?.section)||m.sections[0],domain=s.document_index+':'+region.id;
      var row=Object.assign({},s,{domain:domain,region:region,boundary:!!line?.boundary});if(!groups.has(domain))groups.set(domain,[]);groups.get(domain).push(row);return row;});
    var scopes=new Map(),conflicts=[];groups.forEach(function(group,domain){var env=aliases([{text:group.filter(function(s){return !s.boundary;}).map(function(s){return s.text;}).join('\n')}]);scopes.set(domain,env);
      env.conflicts.forEach(function(a){conflicts.push({domain:domain,alias:a});});group.forEach(function(s){s.aliases=env;});});
    var paragraphs=new Map();rows.forEach(function(s){var k=s.domain+':'+s.section_index,h=E.heading(s.text),m=(h?s.text.slice(h.prefix.length):s.text).trim().match(/^([①-⑳])/);
      if(m)paragraphs.set(k,{number:m[1].charCodeAt(0)-'①'.charCodeAt(0)+1,anchor:s.sentence_index});
      var p=paragraphs.get(k);s.paragraph_number=p?.number||0;s.paragraph_anchor=p?.anchor??null;s.paragraph_start=!!m;});
    annotateTables(rows,documents);annotateLists(rows);annotateConditions(rows);annotateContinuations(rows);
    var value={rows:rows,scopes:scopes,conflicts:conflicts};contextCache.set(documents,{units:units,value:value});return value;
  }
  function annotateConditions(rows){
    var intro=new RegExp('^('+role+')(?:은|는|이|가)('+frontConditions.join('|')+')(?:다음의|아래의)(?:의무|사항)를(?:이행|준수)(?:하여야한다|해야한다|한다)[:.]?$');
    rows.forEach(function(root,i){if(root.list_id||root.boundary)return;var h=E.heading(root.text),m=compact(h?root.text.slice(h.prefix.length):root.text).replace(/^[①-⑳]/,'').match(intro);if(!m)return;
      var entries=[],valid=true;
      for(var j=i+1;j<rows.length;j++){var s=rows[j];if(s.domain!==root.domain||s.section_index!==root.section_index||s.paragraph_start||s.boundary||E.heading(s.text))break;
        if(s.list_id){valid=false;break;}var body=compact(s.text).replace(/^(?:또한|아울러)[,，]?/,''),subject=body.match(new RegExp('^('+role+')(?:은|는|이|가)'));
        if(subject){if(canonicalRole(subject[1],root.aliases)!==canonicalRole(m[1],root.aliases))valid=false;body=body.slice(subject[0].length);}
        var expanded=m[1]+'는'+(body.startsWith(m[2])?'':m[2])+body;if(!parseAll(expanded,s.aliases))valid=false;entries.push({row:s,text:expanded});
      }
      if(!entries.length)return;root.list_id=root.domain+':condition:'+root.sentence_index;root.list_header=true;root.list_valid=valid;root.list_path=[];root.context_kind='condition';
      entries.forEach(function(e){e.row.list_id=root.list_id;e.row.list_valid=valid;e.row.list_path=[];e.row.list_intros=[root];e.row.context_kind='condition';if(valid)e.row.semantic_text=e.text;});
    });
    // 이미 지원하는 금융위원회 인정 예외가 독립 문장으로 쓰인 경우만 결합한다.
    rows.forEach(function(s,i){var prev=rows[i-1];if(!prev||prev.list_id||s.list_id||s.boundary||s.paragraph_start||E.heading(s.text)||s.domain!==prev.domain||s.section_index!==prev.section_index||s.paragraph_anchor!==prev.paragraph_anchor)return;
      if(!/^다만[,，]?금융위원회가인정한경우(?:에는)?그러하지아니하다[.]?$/.test(compact(s.text)))return;
      var fs=parseAll(prev.text,prev.aliases);if(fs?.length!==1||fs[0].facts.topic!=='credit_subcontract'||fs[0].facts.condition)return;
      var combined=fs[0].facts.actor+'는 금융위원회가 인정한 경우를 제외하고 신용정보 처리 업무를 재위탁하여서는 아니 된다.';
      if(!parseAll(combined,prev.aliases))return;
      prev.semantic_text=combined;prev.list_id=prev.domain+':exception:'+prev.sentence_index;prev.list_valid=true;prev.list_intros=[s];prev.list_path=[];
      s.list_id=prev.list_id;s.list_valid=true;s.list_header=true;s.list_path=[];
    });
  }
  function annotateContinuations(rows){rows.forEach(function(s,i){var prev=rows[i-1];
    if(!prev||s.list_id||prev.list_id||s.boundary||E.heading(s.text)||s.paragraph_start||s.domain!==prev.domain||s.section_index!==prev.section_index||s.paragraph_anchor!==prev.paragraph_anchor)return;
    var continuation=s.text.match(/^(?:또한|아울러)[,，]?\s*(.+)$/);if(!continuation)return;
    var earlier=parseAll(prev.semantic_text||prev.text,prev.aliases),body=continuation[1];
    if(!earlier||earlier.some(function(f){return f.facts.condition;})||new Set(earlier.map(function(f){return f.facts.actor;})).size!==1)return;
    var pointed=body.match(/위\s*(개인신용정보|개인정보)/);if(pointed){
      if(!earlier.every(function(f){return f.facts.object?.includes(pointed[1])&&(pointed[1]!=='개인정보'||!f.facts.object.includes('개인신용정보'));}))return;
      body=body.replace(/위\s*(개인신용정보|개인정보)/g,'$1');
    }
    var subject=new RegExp('^[“"「]?'+role+'[”"」]?(?:은|는|이|가)'),expanded=subject.test(compact(body))?body:earlier[0].facts.actor+'는 '+body;
    if(!parseAll(expanded,s.aliases))return;
    s.semantic_text=expanded;s.context_links=[prev];s.list_intros=(prev.list_intros||[]).concat(prev);
  });}
  // 열의 의미는 명시된 머리글로만 읽고, 원문을 변경하지 않고 모든 셀을 근거로 남긴다.
  function annotateTables(rows,documents){var tables=new Map();
    rows.forEach(function(s){var t=s.source?.table;if(!t)return;var id=s.document_index+':'+t.id;if(!tables.has(id))tables.set(id,[]);tables.get(id).push(s);});
    tables.forEach(function(group,id){var byRow=new Map(),valid=true,headers=[],outputs=[];
      group.forEach(function(s){var t=s.source.table;if(t.invalid||t.merged||t.colspan!==1||t.rowspan!==1||!Number.isSafeInteger(t.row)||!Number.isSafeInteger(t.col)||t.row<0||t.col<0||t.col>8)valid=false;
        if(!byRow.has(t.row))byRow.set(t.row,new Map());var cells=byRow.get(t.row);if(!cells.has(t.col))cells.set(t.col,[]);cells.get(t.col).push(s);});
      var first=byRow.get(0);if(!first)return;
      for(var c=0;c<first.size;c++){var cell=first.get(c);headers.push(cell?.length===1?Structure.tableHeader(cell[0].text):null);}
      if(!headers.includes('actor')||!headers.includes('action'))return;
      if(headers.some(function(h){return !h;})||new Set(headers).size!==headers.length||new Set(group.map(function(s){return s.domain+':'+s.section_index;})).size!==1)valid=false;
      // 빈 셀은 문장 추출에 나오지 않으므로 원본 블록도 검사한다.
      var extraction=documents[group[0].document_index].extraction;
      if(extraction.blocks.some(function(b){return b.source?.table?.id===group[0].source.table.id&&!b.text.trim();}))valid=false;
      for(var r=1;r<byRow.size;r++){var cells=byRow.get(r),fields={};if(!cells||cells.size!==headers.length){valid=false;continue;}
        headers.forEach(function(h,c){var cell=cells.get(c);if(!cell?.length){valid=false;return;}
          if(new Set(cell.map(function(s){return s.source.cell;})).size!==1)valid=false;
          fields[h]=cell.map(function(s){return s.text;}).join(' ');});
        var actor=compact(fields.actor),condition=compact(fields.condition||''),object=compact(fields.object||''),action=compact(fields.action||''),explicit=action.match(new RegExp('^('+role+')(?:은|는|이|가)'));
        if(explicit){if(canonicalRole(explicit[1],group[0].aliases)!==canonicalRole(actor,group[0].aliases))valid=false;action=action.slice(explicit[0].length);}
        if(condition&&action.startsWith(condition))action=action.slice(condition.length);
        var expanded=actor+'는'+condition+(object&&!action.startsWith(object)?object:'')+action;
        if(!new RegExp('^'+role+'$').test(actor)||condition&&!frontConditions.includes(condition)||!parseAll(expanded,group[0].aliases))valid=false;
        var carrier=cells.get(headers.indexOf('action'))?.slice(-1)[0];if(carrier)outputs.push({row:carrier,text:expanded});
      }
      if(!outputs.length)valid=false;
      group.forEach(function(s){s.list_id='table:'+id;s.list_valid=valid;s.list_header=true;s.list_path=[];s.list_intros=[];s.table_context=true;});
      if(valid)outputs.forEach(function(o){o.row.list_header=false;o.row.semantic_text=o.text;
        o.row.list_intros=group.filter(function(s){return s!==o.row&&(s.source.table.row===0||s.source.table.row===o.row.source.table.row);});});
    });
  }
  var letters='가나다라마바사아자차카타파하';
  function listMarker(text){var m=String(text).match(/^\s*(?:([1-9][0-9]?|[가나다라마바사아자차카타파하])\s*([.)])|\(([1-9][0-9]?|[가나다라마바사아자차카타파하])\))\s*(\S[\s\S]*)$/);
    if(!m)return null;var token=m[1]||m[3],letter=letters.includes(token);return {number:letter?letters.indexOf(token)+1:+token,token:letter?token:+token,kind:letter?'목':'호',style:m[3]?'()':m[2],body:m[4]};}
  // 명시 도입문 아래 호→목→(숫자) 세 단계. 들여쓰기나 사라진 번호는 추측하지 않는다.
  function annotateLists(rows){
    var subject=new RegExp('^[“"「]?('+role+')[”"」]?(?:은|는|이|가)');
    var action='(?:협조|실시|시행|취|수립|사용|준수|운영|제공|고지|배상|보증|제거|인도|통지|보관|보존|예탁|운용|교부|허용|제한|암호화|재위탁|변경|유출|응|인수|확보)';
    var nominal=new RegExp(action+'$'),nominalEnd=new RegExp(action+'할것$');
    function header(text,parent){var content=grammar(compact(text).replace(/^[①-⑳]/,'').replace(/[.。:]$/,'').replace(/(?:준수|이행)할것$/,function(s){return s.replace('할것','하여야한다');})),m=content.match(subject),actor=m?m[1]:parent?.actor;
      if(!actor)return null;if(m)content=content.slice(m[0].length);
      var condition=frontConditions.find(function(c){return content.startsWith(c);})||'';if(condition)content=content.slice(condition.length).replace(/^[,，]/,'');
      var positive=content.match(/^(?:다음|아래)각(호|목|세목)의(?:사항을|의무를)(?:모두)?(?:준수|이행)(?:하여야한다|해야한다|한다)$/),negative=content.match(/^(?:다음|아래)각(호|목|세목)의행위를(?:하여서는아니된다|해서는안된다|할수없다)$/);
      if(!positive&&!negative)return null;return {actor:actor,condition:condition,prohibition:!!negative,kind:(positive||negative)[1]};}
    rows.forEach(function(root,i){if(root.boundary||root.list_id)return;var h=E.heading(root.text),spec=header(h?root.text.slice(h.prefix.length):root.text);if(!spec||spec.kind!=='호')return;
      var valid=true,entries=[{row:root,header:true,path:[],intros:[]}],env=root.aliases;
      function same(s){return s&&s.domain===root.domain&&s.section_index===root.section_index&&s.paragraph_anchor===root.paragraph_anchor&&!s.boundary&&!E.heading(s.text);}
      function children(at,parent,path,intros){var count=0,style='',next=at;
        for(;next<rows.length;){var child=rows[next];if(!same(child))break;var marker=listMarker(child.text);if(!marker)break;
          if(parent.kind==='목'&&marker.kind==='호')break;
          if(parent.kind==='세목'){if(marker.kind==='목'||marker.kind==='호'&&marker.style!=='()')break;if(marker.kind==='호'&&marker.style==='()')marker.kind='세목';}
          if(marker.kind!==parent.kind||marker.number!==++count||style&&style!==marker.style)valid=false;style=marker.style;
          var entry={row:child,path:path.concat(marker.token),intros:intros.slice(),marker:marker},nested=header(marker.body,parent);entries.push(entry);next++;
          if(nested&&((parent.kind==='호'&&nested.kind==='목')||(parent.kind==='목'&&nested.kind==='세목'))){
            entry.header=true;if(canonicalRole(nested.actor,env)!==canonicalRole(parent.actor,env)||parent.prohibition&&!nested.prohibition)valid=false;
            if(parent.condition&&nested.condition&&parent.condition!==nested.condition)valid=false;
            nested.condition=nested.condition||parent.condition;next=children(next,nested,entry.path,intros.concat(child));continue;
          }
          var content=compact(marker.body).replace(/[.。;]$/,''),explicit=content.match(subject);
          if(explicit){if(canonicalRole(explicit[1],env)!==canonicalRole(parent.actor,env))valid=false;content=content.slice(explicit[0].length);}
          if(nominalEnd.test(content))content=content.replace(/할것$/,'하여야한다');else if(nominal.test(content))content+=parent.prohibition?'하여서는아니된다':'하여야한다';
          content=grammar(content);
          if(parent.condition&&!content.startsWith(parent.condition))content=parent.condition+content;
          entry.expanded=parent.actor+'는'+content;var parsed=parseAll(entry.expanded,env);
          if(!parsed||parsed.some(function(f){return canonicalRole(parent.actor,env)!==f.facts.actor||(parent.prohibition?f.facts.modality!=='prohibition':!['obligation','prohibition','consent_required'].includes(f.facts.modality));}))valid=false;
        }
        if(!count)valid=false;return next;
      }
      children(i+1,spec,[],[root]);if(entries.length===1)return;
      var id=root.domain+':list:'+root.sentence_index;entries.forEach(function(e){var row=e.row;row.list_id=id;row.list_header=!!e.header;row.list_valid=valid;row.list_path=e.path;row.list_intros=e.intros;
        if(e.marker?.kind==='호')row.list_number=e.marker.number;if(e.marker?.kind==='목')row.list_letter=e.marker.token;
        if(e.marker?.kind==='세목')row.list_subnumber=e.marker.number;
        if(e.intros.length)row.list_intro=e.intros[0];if(valid&&e.expanded)row.semantic_text=e.expanded;});
    });
  }
  function canonicalRole(r,env){r=env?.map?.[r]||r;return r==='클라우드서비스제공자'?'클라우드컴퓨팅서비스제공자':r;}
  function roleText(text,env){return String(text).replace(/[“"「](갑|을)[”"」]/g,function(all,r){return env?.map?.[r]?canonicalRole(r,env):all;})
    .replace(/(^|[\s,(（])(갑|을)(?=은|는|이|가|의|에게|과|와|에)/g,function(all,p,r){return env?.map?.[r]?p+canonicalRole(r,env):all;});}
  function literalScope(text,env){
    // 띄어쓰기가 사라진 미해석 문장 안의 갑·을을 추측 치환하지 않는다.
    // 대신 남은 별칭의 해당 구역 정의를 지문에 보존하여 상대방 정의 변경을 놓치지 않는다.
    var rest=compact(roleText(text,env)),used=Array.from(new Set(Array.from(rest.matchAll(/(갑|을)(?=은|는|이|가|의|에게|과|와|에)/g)).map(function(m){return m[1];}))).sort();
    return used.length?'|literal-aliases:'+JSON.stringify(used.map(function(a){return [a,env?.map?.[a]||null];})):'';
  }
  var frontConditions=['업무수행인력이변경되는경우','신탁계약을변경하는경우','완성물에하자가있는경우','완성물의하자로계약목적을달성할수없는경우','소수주주의동반매도참여권행사시','주식양도시','주주의요청이있는경우','기업결합신고가필요한경우','감독당국의변경권고등조치가있는경우'];
  var frontPattern=new RegExp('^('+frontConditions.join('|')+')[,，]?('+role+')(은|는|이|가)(.+)$');
  function grammar(s){
    // 단순 조사·종결·명시 조건 위치만 정규화한다. '경우에만', 재량, 숫자, 부정은 지우지 않는다.
    s=s.replace(/에대해/g,'에대하여').replace(/를위해/g,'를위하여').replace(/경우에는/g,'경우')
      .replace(/하여야할것이다$/,'하여야한다').replace(/하도록한다$/,'하여야한다')
      .replace(/하여서는안되며$/,'하여서는아니되며').replace(/해서는안된다$/,'하여서는아니된다')
      .replace(/암호화처리(?=하여야한다|해야한다|한다$)/g,'암호화')
      .replace(/기술적(?:[·ㆍ,]|및)?관리적보호조치를이행(?=하여야한다|해야한다|한다$)/g,'기술적·관리적보호조치를실시')
      .replace(/점검에협력(?=하여야한다|해야한다|한다$)/g,'점검에협조')
      .replace(/매년(?=[1-9][0-9]?회이상)/g,'연')
      .replace(/하여야만한다$/,'하여야한다').replace(/하여야할의무를부담한다$/,'하여야한다')
      .replace(/(?:할의무를부담한다|할의무가있다|할의무를진다|하기로한다)$/,'해야한다')
      .replace(/배상할책임(?:을진다|을부담한다|이있다)$/,'배상하여야한다')
      .replace(/(?:하여서는안된다|해서는아니된다)$/,'하여서는아니된다');
    var m=s.match(frontPattern);if(m)s=m[2]+m[3]+m[1]+m[4];
    // 조사로 끝난 목적어·대상구와 명시 주체의 어순만 바꾼다. 남는 내용은 파서가 전부 검사한다.
    if(!new RegExp('^'+role+'(?:은|는|이|가)').test(s)){
      var reordered=s.match(new RegExp('^(.+(?:을|를|에|에게|대하여|위하여))[,，]?('+role+')(은|는|이|가)(.+)$'));
      if(reordered)s=reordered[2]+reordered[3]+reordered[1]+reordered[4];
    }
    return s;
  }
  function parse(text,env){
    var h=E.heading(text),raw=h?String(text).slice(h.prefix.length):String(text),s=compact(raw).replace(/^[①-⑳]/,'').replace(/[.。]$/,'');
    if(!s)return null;
    // 인용된 의무·검토 메모는 실제 규범 문장으로 읽지 않는다. 당사자 표기 인용만 제거한다.
    s=s.replace(new RegExp('[“"「]('+role+')[”"」]','g'),'$1');
    if(/[“”"「」]|�|_{2,}|\[\s*\]/.test(s))return null;
    // 명시적 이행 약속의 종결형만 정규화한다. 노력·재량·조건부 약속은 소비하지 않는다.
    s=grammar(s);
    var restriction=scopedRestriction(s,text,env);if(restriction)return restriction;
    var profile=Profiles.parse(s,env);if(profile)return result(profile.topic,profile.actor,profile.fields,text,env);
    var reverse=s.match(new RegExp('^('+role+')(?:이|가)개인정보(?:처리|관리)현황을점검하는경우('+role+')(?:은|는)이에협조(?:하여야한다|해야한다|한다)$'));
    if(reverse)return result('inspection',reverse[2],{counterparty:canonicalRole(reverse[1],env),object:'개인정보',action:'점검협조',modality:'obligation'},text,env);
    var subject=s.match(new RegExp('^('+role+')(?:은|는|이|가)'));if(!subject)return null;
    var actor=subject[1],rest=s.slice(subject[0].length),original=rest;
    // 평가/감독 협조의 조건·대상·행위를 별도 사실로 보존한다. 일부 단어만 읽지 않는다.
    var required='(?:하여야한다|해야한다|한다)',m;
    var security=securityFacts(rest);if(security)return result(security.topic,actor,security.fields,text,env);
    if(new RegExp('^위탁업무를(?:처리할때|수행할때|처리함에있어)금융실명법등관련법령을준수'+required+'$').test(rest))
      return result('law_compliance',actor,{object:'위탁업무',action:'법령준수',laws:'금융실명법등관련법령',modality:'obligation'},text,env);
    m=rest.match(new RegExp('^('+role+')의(?:위탁)?업무처리현황점검[·,]자료제출요구및감사에협조'+required+'$'));
    if(m)return result('work_supervision',actor,{counterparty:canonicalRole(m[1],env),object:'위탁업무처리현황',action:'점검·자료제출·감사협조',modality:'obligation'},text,env);
    m=rest.match(new RegExp('^('+role+')의(?:위탁)?업무처리현황을점검하고관련자료의제출을요구하며감사를실시할수있다$'));
    if(m)return result('work_supervision_right',actor,{counterparty:canonicalRole(m[1],env),object:'위탁업무처리현황',action:'점검·자료제출요구·감사',modality:'right'},text,env);
    if(new RegExp('^감독당국의변경권고등조치가있는경우(?:본)?계약의?변경및시정에협조'+required+'$').test(rest))
      return result('supervisory_correction',actor,{object:'계약변경·시정',action:'협조',condition:'감독당국변경권고등조치',modality:'obligation'},text,env);
    m=rest.match(new RegExp('^(?:클라우드이용업무의중요도평가에필요한자료(?:의)?제공에협조|클라우드이용업무의중요도평가를위하여필요한자료를제공)'+required+'$'));
    if(m)return result('cloud_importance',actor,{object:'클라우드이용업무중요도평가',action:/제공에협조/.test(rest)?'필요자료제공협조':'필요자료제공',modality:'obligation'},text,env);
    m=rest.match(new RegExp('^(?:클라우드컴퓨팅서비스제공자|클라우드서비스제공자)의건전성(?:·|,|및)안전성평가(?:에필요한자료(?:의)?제공에협조|를위하여필요한자료를제공)'+required+'$'));
    if(m)return result('cloud_soundness',actor,{object:'클라우드제공자건전성·안전성평가',action:/제공에협조/.test(rest)?'필요자료제공협조':'필요자료제공',modality:'obligation'},text,env);
    m=rest.match(new RegExp('^(?:(?:자신이|수탁자가)제공하는)?서비스의품질수준(?:에대한)?연([1-9][0-9]?)회이상평가에협조'+required+'$'));
    if(!m)m=rest.match(new RegExp('^연([1-9][0-9]?)회이상실시하는(?:(?:자신이|수탁자가)제공하는)?서비스의품질수준평가에협조'+required+'$'));
    if(m)return result('service_quality',actor,{object:'제공서비스품질수준평가',action:'협조',minimum_per_year:+m[1],modality:'obligation'},text,env);
    function take(re){var m=rest.match(re);if(!m)return null;rest=rest.slice(0,m.index)+rest.slice(m.index+m[0].length);return m;}
    function consume(parts){for(var p of parts)if(!take(p))return false;return !rest;}
    function done(topic,fields){return !rest?result(topic,actor,fields,text,env):null;}
    // 재위탁 금지형: 주체와 동의권자를 바꾸지 않는다.
    var tail=take(/재위탁(?:할수없다|하여서는아니된다|해서는안된다|하지못한다)$/);
    if(tail){var owner=take(new RegExp('('+role+')의')),consent=take(/동의없이/),prior=take(/사전(?:에)?/),written=take(/서면(?:으로)?/),work=take(/(?:본계약상의|본계약상|위탁받은)?업무를/);
      if(owner&&consent&&prior)return done('prior_consent',{counterparty:canonicalRole(owner[1],env),object:'업무',action:'재위탁',modality:'consent_required',prior:true,written:!!written});
      return null;
    }
    rest=original;
    if(take(/(?:받아야한다|얻어야한다|받는다)$/)){
      var action=take(/(?:업무를)?재위탁(?:하려면|하려는경우|하기전에|에앞서|하는경우|할경우)/),owner=take(new RegExp('('+role+')의')),consent=take(/동의를/),prior=take(/사전에|미리|사전/),written=take(/서면으로|서면/);
      if(action&&owner&&consent&&(prior||/하려면|하려는경우|하기전에|앞서/.test(action[0])))return done('prior_consent',{counterparty:canonicalRole(owner[1],env),object:'업무',action:'재위탁',modality:'consent_required',prior:true,written:!!written});
    }
    rest=original;
    var obligation=take(/(?:하여야한다|해야한다|한다)$/);if(!obligation)return null;
    // 각 요소는 독립적으로 소비하되 남는 조건·수치·부정은 항상 보존한다.
    if(take(/협조$/)){
      var owner=take(new RegExp('('+role+')의')),object=take(/개인정보(?:처리|관리)현황(?:에대한)?점검에/);
      if(owner&&object)return done('inspection',{counterparty:canonicalRole(owner[1],env),object:'개인정보',action:'점검협조',modality:'obligation'});
      return null;
    }
    rest=original.replace(/(?:하여야한다|해야한다|한다)$/,'');
    if(take(/(?:취|실시|시행)$/)){
      var object=take(/개인정보(?:의안전한처리를위하여|보호를위하여|에대한)?/),measures=take(/기술적(?:[·ㆍ,]|및)?관리적보호조치를/);
      if(object&&measures)return done('protection',{object:'개인정보',action:'기술적·관리적보호조치',modality:'obligation'});
      return null;
    }
    rest=original.replace(/(?:하여야한다|해야한다|한다)$/,'');
    if(take(/암호화$/)){
      if(consume([/제공받은/,/개인신용정보의식별정보를/]))return done('encryption',{object:'제공받은개인신용정보식별정보',action:'암호화',modality:'obligation'});
      return null;
    }
    rest=original.replace(/(?:하여야한다|해야한다|한다)$/,'');
    var limit=take(/제한$/),grant=!limit&&take(/부여$/);
    if(limit||grant){
      var object=take(/개인정보에대한접근권한을/),scope=take(grant?/업무수행에필요한최소한(?:의)?범위에서만/:/업무수행에필요한최소한(?:의)?범위로/);
      if(object&&scope)return done('least_access',{object:'개인정보접근권한',action:'최소권한',modality:'obligation',purpose:'업무수행'});
    }
    rest=original;
    if(consume([/개인정보에대한/,/(?:접근권한|접근)을/,/제한(?:하여야한다|해야한다|한다)$/]))return done('access_control',{object:'개인정보접근',action:'접근제한',modality:'obligation'});
    return null;
  }
  var restrictionTargets={
    '신용정보처리업무재위탁금지':['credit_subcontract','prior_consent'],
    '재위탁금지':['prior_consent','credit_subcontract'],
    '개인정보처리현황점검':['inspection','privacy_supervision'],
    '개인정보관리현황점검':['inspection','privacy_supervision'],
    '개인정보접근권한제한':['least_access','access_control'],
    '개인정보기술적·관리적보호조치':['protection'],
    '개인신용정보식별정보암호화':['encryption'],
    '업무수행인력신원조회':['personnel_screening'],
    '인수인계':['personnel_handover']
  };
  function scopedRestriction(s,text,env){var m=s.match(new RegExp('^(?:다만[,，]?)?('+role+')의('+Object.keys(restrictionTargets).join('|')+')의무는(긴급한경우|천재지변이발생한경우)(?:에는|에)?(적용하지않는다|적용하지아니한다|면제된다|에만적용한다)$'));
    if(!m)return null;return result(restrictionTargets[m[2]][0],m[1],{object:m[2],action:m[4],condition:m[3],modality:'restriction',affected_topics:restrictionTargets[m[2]].slice()},text,env);}
  var questionTopics={
    'CORE-07':['prior_consent'],'PRIV-03':['protection'],'PRIV-06':['least_access','access_control'],'PRIV-07':['inspection'],'PRIV-19':['encryption'],
    'CORE-06':['law_compliance'],'CORE-10':['work_supervision','work_supervision_right'],'CORE-13':['supervisory_correction'],
    'ITCL-01':['cloud_importance'],'ITCL-02':['cloud_soundness'],'ITSEC-10':['service_quality'],
    'ITSEC-01':['separate_facilities'],'ITSEC-02':['protected_data'],'ITSEC-03':['financial_info'],'ITSEC-04':['security_plan'],
    'ITSEC-05':['dedicated_connection'],'ITSEC-06':['continuity_plan'],'ITSEC-07':['security_stages'],'ITSEC-08':['backup_plan'],'ITSEC-09':['financial_monitoring'],'ITSEC-13':['security_inspection']};
  Object.keys(Profiles.profiles).forEach(function(id){questionTopics[id]=Profiles.profiles[id].parts.map(function(p){return p.topic;});});
  function independentException(id,text,env){var topics=questionTopics[id];if(!topics||!/^\s*다만[,，]?/.test(text))return false;
    var fs=parseAll(String(text).replace(/^\s*다만[,，]?\s*/,''),env);
    return !!fs&&fs.every(function(f){return !(f.facts.affected_topics||[f.facts.topic]).some(function(t){return topics.includes(t);});});}
  // 현재 존재 질문의 모든 구성요소를 문장 전체에서 확인한다. 실제 이행 여부는 판정하지 않는다.
  var securityRules,financialPattern;
  function securityFacts(rest){
    var duty='(?:하여야한다|해야한다|한다)',ban='(?:하여서는아니된다|해서는안된다|할수없다|하지못한다)',join='(?:[·ㆍ,]|및)',m;
    if(!securityRules){securityRules=[
      ['separate_facilities','외부주문개발업무에사용되는(?:업무장소'+join+'전산설비|전산설비'+join+'업무장소)를내부업무용과분리하여설치'+join+'운영'+duty,
        {object:'외부주문개발업무장소·전산설비',action:'분리설치·운영',condition:'내부업무용과분리',modality:'obligation'}],
      ['protected_data','금융회사와이용자간암호화정보를해독하거나원장등중요데이터를변경'+ban,
        {object:'금융회사·이용자간암호화정보·원장등중요데이터',action:'해독·변경금지',modality:'prohibition'}],
      ['financial_info','계좌번호'+join+'비밀번호등이용자금융정보를무단으로보관하거나유출'+ban,
        {object:'계좌번호·비밀번호등이용자금융정보',action:'무단보관·유출금지',modality:'prohibition'}],
      ['security_plan','접근매체(?:위'+join+'변조|위조'+join+'변조)[·ㆍ,]해킹(?:[·ㆍ,]|및)개인정보유출에대비한보안대책을수립'+duty,
        {object:'접근매체위변조·해킹·개인정보유출',action:'보안대책수립',modality:'obligation'}],
      ['dedicated_connection','금융회사와전자금융보조업자간접속에전용회선을사용'+duty,
        {object:'금융회사·전자금융보조업자간접속',action:'전용회선사용',modality:'obligation'}],
      ['dedicated_connection','금융회사와전자금융보조업자간접속에전용회선과동등한보안수준의가상전용회선을사용'+duty,
        {object:'금융회사·전자금융보조업자간접속',action:'동등보안가상전용회선사용',modality:'obligation'}],
      ['continuity_plan','정보처리시스템장애등서비스중단에대비(?:한비상대책을수립|하여비상대책을수립)'+duty,
        {object:'정보처리시스템장애등서비스중단',action:'비상대책수립',modality:'obligation'}],
      ['security_stages','외부주문의입찰[·ㆍ,]계약[·ㆍ,]수행(?:[·ㆍ,]|및)완료(?:등)?각단계별로금융감독원장이정하는보안관리방안을준수'+duty,
        {object:'외부주문입찰·계약·수행·완료각단계',action:'보안관리방안준수',condition:'금융감독원장이정하는방안',modality:'obligation'}],
      ['backup_plan','중요전산자료의백업자료보존'+join+'백업설비확보를포함한백업대책을수립'+duty,
        {object:'중요전산자료',action:'백업대책수립',condition:'백업자료보존·백업설비확보',modality:'obligation'}],
      ['security_inspection','외부주문에대한자체보안성검토'+join+'정기보안점검(?:실시)?에협조'+duty,
        {object:'외부주문자체보안성검토·정기보안점검',action:'협조',modality:'obligation'}]
    ].map(function(row){return {topic:row[0],pattern:new RegExp('^'+row[1]+'$'),fields:row[2]};});
    financialPattern=new RegExp('^(?:자신의|수탁자의|전자금융보조업자의)재무건전성(?:에대한)?연([1-9][0-9]?)회이상평가'+join+'상시모니터링에필요한자료(?:를제공|제공에협조)'+duty+'$');}
    for(var row of securityRules)if(row.pattern.test(rest))return row;
    m=rest.match(financialPattern);
    if(m)return {topic:'financial_monitoring',fields:{object:'수탁자재무건전성평가·상시모니터링',action:/제공에협조/.test(rest)?'필요자료제공협조':'필요자료제공',minimum_per_year:+m[1],modality:'obligation'}};
    return null;
  }
  function result(topic,actor,fields,text,env){
    if(env?.conflicts?.length)return null;
    var f=Object.assign({topic:topic,actor:canonicalRole(actor,env)},fields);
    var tagText=String(text).replace(/갑(?=[은는이가의])/g,env?.map?.갑||'갑').replace(/을(?=[은는이가의])/g,env?.map?.을||'을');
    return {facts:f,key:JSON.stringify(f),tags:T.values(T.analyzeClause({heading:'',body:tagText},'')),text:text};
  }
  // 명시적 병렬 의무만 분리한다. 조건·대명사·부정의 범위를 추측하여 분할하지 않는다.
  function parseAll(text,env){
    var single=parse(text,env);if(single)return [single];
    var h=E.heading(text),s=compact(h?String(text).slice(h.prefix.length):text).replace(/^[①-⑳]/,'').replace(/[.。]$/,'');
    s=s.replace(new RegExp('[“"「]('+role+')[”"」]','g'),'$1');
    s=grammar(s);
    var subject=s.match(new RegExp('^('+role+')(?:은|는|이|가)'));if(!subject)return null;
    var parts=s.split(/((?:암호화|제한|협조|실시|시행|부여|취|수립|사용|준수|제공|운영|고지|배상|보증|제거|인도|통지|보관|예탁|운용|교부|응)(?:하(?:고|며)|하여야하며))[,，]?/);
    if(parts.length<3||parts.length>11)return null;
    var out=[];
    for(var i=0;i<parts.length;i+=2){var clause=parts[i]+(parts[i+1]?parts[i+1].replace(/(?:하(?:고|며)|하여야하며)$/,'한다'):''),value=parse(new RegExp('^'+role+'(?:은|는|이|가)').test(clause)?clause:subject[0]+clause,env);
      if(!value)return null;out.push(value);}
    return out;
  }
  function key(text,env){var fs=parseAll(text,env);return fs?'semantic:'+JSON.stringify(fs.map(function(f){return f.key;}).sort()):null;}
  function keys(text,env){var fs=parseAll(text,env);return fs?fs.map(function(f){return 'semantic:'+JSON.stringify([f.key]);}):null;}
  function aliasDefinition(text,env){return (env?.definitions||[]).some(function(d){return d.standalone&&d.text===text;});}
  return {VERSION:'clause-semantics-v8',parse:parse,parseAll:parseAll,key:key,keys:keys,aliases:aliases,contexts:contexts,aliasDefinition:aliasDefinition,roleText:roleText,literalScope:literalScope,independentException:independentException};
})();
if(typeof module!=='undefined')module.exports=ClauseSemantics;
