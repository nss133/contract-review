"use strict";
/* 조항 단위 근거. 검색 태그는 후보를 찾고, 본문·의무·조건 비교는 별도로 수행한다.
   정규화는 종결 표현에 한정한다. 부정·주체·숫자·예외를 지우지 않는다. */
var DecisionEvidence=(function(){
  var H=typeof SafetyDigest!=='undefined'?SafetyDigest:require('./safety_digest');
  var E=typeof EvidenceRules!=='undefined'?EvidenceRules:require('./evidence_rules');
  var A=typeof AgreementEvidence!=='undefined'?AgreementEvidence:require('./agreement_evidence');
  var T=typeof ContractTags!=='undefined'?ContractTags:require('./contract_tags');
  var Q=typeof ClauseSemantics!=='undefined'?ClauseSemantics:require('./clause_semantics');
  var Structure=typeof DocumentStructure!=='undefined'?DocumentStructure:require('./document_structure');
  var Profiles=typeof PresenceProfiles!=='undefined'?PresenceProfiles:require('./presence_profiles');
  var cache=new WeakMap(),VERSION='decision-evidence-v10';
  var topics={
    'CNS-DAMAGE':['손해','배상','책임','면책','보상','위약','지체상금'],
    'CNS-END':['해지','해제','위반','시정','최고','종료'],
    'CNS-SECRET':['비밀','기밀','공개','누설','존속'],
    'CNS-TERM':['계약기간','계약 기간','유효기간','존속기간','갱신','연장','만료'],
    'CNS-PRICE':['대금','지급','정산','수수료','단가','계약금액','검수','청구'],
    'CNS-IP':['지식재산','지적재산','저작','특허','산출물','성과물','사용권','이용권'],
    'CMN-05':['부가가치세','부가세','VAT','vat','세액'],
    'CMN-19':['분쟁','관할','법원','소송','중재'],
    'CMN-20':['양도','이전','담보','계약상 지위','권리의무','권리·의무'],
    'CMN-21':['완전합의','완전한 합의','종전','변경','수정'],
    'CORE-07':['재위탁','재수탁','하도급'],
    'PRIV-03':['기술적','관리적','보호조치','안전성','조치'],
    'PRIV-06':['접근','권한','안전성','조치'],
    'PRIV-07':['점검','감독','관리 현황'],
    'PRIV-19':['식별정보','암호화'],
    'PRIV-08':['의무','위반','배상','책임'],
    'CORE-14':['감독원','검사','자료제출'],
    'CMN-18':['지식재산','지적재산','침해','방어','면책'],
    'CRS-03':['국문','영문','언어','번역','불일치'],
    'NDA-15':['비밀','침해','누설','배상'],
    'CORE-06':['금융실명','법령','준수'],
    'CORE-10':['업무 처리','업무처리','점검','자료','감사','감독'],
    'CORE-13':['변경권고','감독당국','시정'],
    'ITCL-01':['중요도','중요업무','클라우드'],
    'ITCL-02':['건전성','안전성','클라우드'],
    'ITSEC-10':['품질','서비스 수준','평가']
  };
  Object.assign(topics,{
    'ITSEC-01':["업무장소","전산설비","분리"],
    'ITSEC-02':["암호화정보","해독","원장","중요 데이터"],
    'ITSEC-03':["계좌번호","비밀번호","금융정보","무단보관","유출"],
    'ITSEC-04':["접근매체","해킹","보안대책"],
    'ITSEC-05':["전용회선","접속"],
    'ITSEC-06':["장애","서비스 중단","비상대책"],
    'ITSEC-07':["입찰","단계별","보안관리방안"],
    'ITSEC-08':["백업","중요 전산자료"],
    'ITSEC-09':["재무건전성","모니터링"],
    'ITSEC-13':["보안성검토","보안점검"]
  });
  Object.keys(Profiles.profiles).forEach(function(id){topics[id]=Profiles.profiles[id].terms.slice();});
  function body(text){var h=E.heading(text);return String(h?text.slice(h.prefix.length):text).normalize('NFC').trim().replace(/^[①-⑳]\s*/,'').trim();}
  function wording(text){return body(text)
    .replace(/배상할\s*책임(?:을\s*진다|이\s*있다|을\s*부담한다)/g,'배상하여야 한다')
    .replace(/배상책임을\s*부담한다/g,'배상하여야 한다')
    .replace(/하여야\s*한다/g,'해야 한다').replace(/하여서는\s*아니\s*된다/g,'해서는 안 된다');}
  function key(text){return wording(text).replace(/[.。]\s*$/,'').replace(/\s+/g,'');}
  function rows(documents){var fingerprint=H.of(documents),saved=cache.get(documents);if(saved?.fingerprint===fingerprint)return saved.value;
    var contexts=Q.contexts(documents),hasDefinitions=contexts.rows.some(function(s){return s.aliases.definitions.length;});
    var value=contexts.rows.map(function(s){var region=s.region,env=s.aliases;
      var named=region.kind==='main'?Structure.boundary(String(documents[s.document_index].name||'').replace(/\.(?:pdf|hwpx?|docx?|txt)$/i,'')):null;
      var used=Array.from(s.text.matchAll(/(?:^|[\s“"「(（])(갑|을)(?=[”"」]?(?:은|는|이|가|의|에게|과|와))/g)).map(function(m){return m[1];});
      return Object.assign({},s,{annex_token:region.token||named?.token||'',alias_unresolved:hasDefinitions&&used.some(function(a){return !env.map[a];}),
        body:body(s.text),keys:s.list_header&&s.list_valid?[]:Q.keys(s.semantic_text||body(s.text),env)||[key(Q.roleText(s.text,env))+Q.literalScope(s.text,env)],alias_definition:Q.aliasDefinition(s.text,env),document_title:A.isDocumentTitle(s,documents)});});
    if(documents&&typeof documents==='object')cache.set(documents,{fingerprint:fingerprint,value:value});return value;}
  function tags(text){return T.values(T.analyzeClause({heading:'',body:text},''));}
  function bundle(cp,documents,options){
    var literal=options?.registered_reference_context===true,literalSections=new Set(),referenceSections=new Set();
    var terms=options?.terms||topics[cp.id],out={supported:!!terms,reusable:false,evidence:[],key:'',missing:[],tags:{},preserved_reference_context:false,reference_links:[]};
    if(!terms)return out;
    var all=rows(documents),selected=new Set(),scanned=A.scanUnits(terms,documents),locations=new Map(),sections=new Map(),articles=new Map(),sectionArticles=new Map(),domains=new Map(),annexes=new Map(),titles=new Map();
    function addTitle(title,domain){var k=Structure.titleKey(title);if(!k)return;if(!titles.has(k))titles.set(k,new Set());titles.get(k).add(domain);}
    all.forEach(function(s,i){locations.set(s.document_index+':'+s.sentence_index,i);var k=s.document_index+':'+s.section_index;
      if(!domains.has(s.domain))domains.set(s.domain,[]);domains.get(s.domain).push(s);
      if(s.annex_token){if(!annexes.has(s.annex_token))annexes.set(s.annex_token,new Set());annexes.get(s.annex_token).add(s.domain);}
      if(s.region.kind!=='main')addTitle(s.region.label,s.domain);
      else {addTitle(documents[s.document_index].name,s.domain);if(s.document_title)addTitle(s.text,s.domain);}
      if(!sections.has(k))sections.set(k,[]);sections.get(k).push(s);
      var h=E.heading(s.text),m=h&&h.prefix.match(/^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?/);if(m){var a=s.domain+':'+m[1]+(m[2]?'의'+m[2]:'');if(!articles.has(a))articles.set(a,new Set());articles.get(a).add(k);sectionArticles.set(k,{number:+m[1],sub:m[2]});}
    });
    var titlePatterns=Array.from(titles.keys()).map(function(k){return {key:k,re:new RegExp('(?<![가-힣A-Za-z0-9])'+Array.from(k).map(function(c){return c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('\\s*')+'(?=[」”"』]?\\s*(?:의\\s*)?(?:제\\s*\\d+\\s*조|에\\s*(?:따르|따른|정한)|[을를]\\s*준용))','g')};});
    function position(s){return locations.get(s.document_index+':'+s.sentence_index);}
    scanned.forEach(function(s){var i=position(s);if(i!==undefined)selected.add(i);});
    if(!selected.size){out.missing=['관련 조항 없음'];return out;}
    // 당사자 정의는 쟁점 문구가 같아도 의미를 바꿀 수 있다. 모든 정의를 함께 비교한다.
    all.forEach(function(s,i){if(/이란|이라\s*함은|뜻한다|의미한다|이하\s*[“"「]?(?:갑|을)/.test(s.body)||!s.section&&/기간|범위|의무|책임/.test(s.body))selected.add(i);});
    function targets(s,number,domain){var set=articles.get((domain||s.domain)+':'+number);return set?.size===1?sections.get(Array.from(set)[0]).filter(function(r){return !r.boundary;}):[];}
    var listGroups=new Map();all.forEach(function(s){if(s.list_id){if(!listGroups.has(s.list_id))listGroups.set(s.list_id,[]);listGroups.get(s.list_id).push(s);}});
    var linkCache=new Map(),comparisonKeys=new Map(),mainDomain=all.find(function(s){return s.document_index===0&&!s.annex_token;})?.domain;
    function links(s){if(linkCache.has(s))return linkCache.get(s);var linked=[],missing=false,refs=Array.from(s.body.matchAll(/제\s*(\d+)\s*조(?:의\s*(\d+))?/g)),annexRefs=Array.from(s.body.matchAll(/(별첨|별표|별지|붙임|부록|첨부)\s*(?:제\s*)?([0-9]+(?:[-.][0-9]+)*|[A-Z])\s*(?:호)?/g)),namedRefs=[];
      if(s.boundary)return {rows:[],missing:false};
      // 명시된 제목 또는 등록된 실제 제목과 정확히 일치하는 참조만 연결한다.
      Array.from(s.body.matchAll(/[「“"『]([^」”"』\n]{2,100}(?:계약서|약정서|합의서|명세서|계획서))[」”"』]/g)).forEach(function(m){namedRefs.push({index:m.index,end:m.index+m[0].length,key:Structure.titleKey(m[1])});});
      Array.from(s.body.matchAll(/(?:별첨|붙임|첨부|부속)\s*(?![0-9])([가-힣A-Za-z][가-힣A-Za-z0-9 ·ㆍ&()_-]{0,85}?(?:계약서|약정서|합의서|명세서|계획서))/g)).forEach(function(m){namedRefs.push({index:m.index,end:m.index+m[0].length,key:Structure.titleKey(m[1])});});
      titlePatterns.forEach(function(p){Array.from(s.body.matchAll(p.re)).forEach(function(m){if(!namedRefs.some(function(r){return r.index<=m.index&&r.end>=m.index+m[0].length;}))namedRefs.push({index:m.index,end:m.index+m[0].length,key:p.key});});});
      Array.from(s.body.matchAll(/(?:본|이)\s*(?:계약서|약정서)(?=\s*(?:의\s*)?제\s*\d+\s*조)/g)).forEach(function(m){if(!namedRefs.some(function(r){return r.index<=m.index&&r.end>=m.index+m[0].length;}))namedRefs.push({index:m.index,end:m.index+m[0].length,key:'@self'});});
      // 이미 해결한 다른 제목이 있어도 같은 문장에 남은 미등록 제목 참조를 빠뜨리지 않는다.
      Array.from(s.body.matchAll(/[가-힣A-Za-z0-9]*(?:계약서|약정서|합의서|명세서|계획서)(?=[」”"』]?\s*(?:의\s*)?(?:제\s*\d+\s*조|에\s*(?:따르|따른|정한)|[을를]\s*준용))/g)).forEach(function(m){if(!namedRefs.some(function(r){return r.index<=m.index&&r.end>=m.index+m[0].length;}))missing=true;});
      function namedDomain(m){if(m.key==='@self')return s.domain;var ds=titles.get(m.key);return ds?.size===1?Array.from(ds)[0]:null;}
      function annexDomain(m){var ds=annexes.get(m[1]+m[2]);return ds?.size===1?Array.from(ds)[0]:null;}
      function referenceDomain(m){var prefix=s.body.slice(0,m.index),a=annexRefs.filter(function(a){return a.index<m.index&&/^\s*(?:의\s*)?$/.test(prefix.slice(a.index+a[0].length));}).pop();
        if(a)return annexDomain(a);
        var named=namedRefs.filter(function(r){return r.end<=m.index&&/^[」”"』]?\s*(?:의\s*)?$/.test(prefix.slice(r.end));}).pop();if(named)return namedDomain(named);
        if(/본문\s*$/.test(prefix))return mainDomain||null;
        return s.domain;}
      // 번호로 지목한 실제 별첨 구역만 연결한다. 아무 첨부파일이 있다는 이유로 충족시키지 않는다.
      annexRefs.forEach(function(m){if(external(m)){if(!literal)missing=true;else literalSections.add(s.document_index+':'+s.section_index);return;}
        var domain=annexDomain(m),group=domain?(domains.get(domain)||[]).filter(function(r){return !r.boundary;}):[];if(!group.some(function(r){return r.body;})){missing=true;return;}linked.push.apply(linked,group);});
      namedRefs.forEach(function(m){if(m.key==='@self')return;var domain=namedDomain(m),group=domain?(domains.get(domain)||[]).filter(function(r){return !r.boundary;}):[];
        if(!group.some(function(r){return r.body;})){missing=true;return;}
        // '별첨 1 「제목」'에서 번호와 제목이 서로 다른 파일을 가리키면 해결하지 않는다.
        var number=annexRefs.filter(function(a){return a.index<m.index&&/^\s*$/.test(s.body.slice(a.index+a[0].length,m.index));}).pop();
        if(number&&annexDomain(number)!==domain){missing=true;return;}linked.push.apply(linked,group);});
      if(/별첨|별표|별지|붙임|부록|부속/.test(s.body)&&!annexRefs.length&&!namedRefs.length)missing=true;
      if(/(?:계약서|약정서|합의서|명세서|계획서)[」”"』]?\s*(?:의\s*)?(?:제\s*\d+\s*조|에\s*(?:따르|따른|정한)|[을를]\s*준용)/.test(s.body)&&!namedRefs.length)missing=true;
      function external(m){return /(?:법|법률|시행령|시행규칙|규정|고시|지침|약관|정관)[」”"』]?\s*$/.test(s.body.slice(0,m.index));}
      function preserve(group){
        // 등록 표준과 조 전체가 동등한 경우에만 쓰는 경로. 사라진 항 번호를 추정 복원하지 않는다.
        if(!literal||!s.section||!group.length||group.some(function(x){return /^\s*[①-⑳]/.test(x.text);}))return false;
        if(!group.some(function(x){return x.sentence_index<s.sentence_index&&x.body;}))return false;
        literalSections.add(s.document_index+':'+s.section_index);linked.push.apply(linked,group);return true;
      }
      // 제N항은 같은 조(또는 직전에 명시된 제N조)의 번호가 유일할 때만 해결한다.
      // 단순히 문장이 존재한다는 이유로 다른 항의 의무를 가져오지 않는다.
      var paragraphRefs=Array.from(s.body.matchAll(/제\s*(\d+)\s*항/g)),itemTargets=new Map();
      var itemRefs=Array.from(s.body.matchAll(/제\s*(\d+)\s*호/g)).filter(function(p){return !annexRefs.some(function(a){return a.index<=p.index&&a.index+a[0].length>=p.index+p[0].length;});});
      var letterRefs=Array.from(s.body.matchAll(/(?:(?<![가-힣])|(?<=호)|(?<=내지)|(?<=부터))([가나다라마바사아자차카타파하])\s*목(?=\s|부터|내지|까지|[~∼～–—-]|[은는이가의을를에과와,.;。]|$)/g));
      var subitemRefs=Array.from(s.body.matchAll(/제\s*(\d+)\s*세목/g));
      function preceding(matches,p){return matches.filter(function(a){return a.index+a[0].length<=p.index&&/^\s*(?:의\s*)?$/.test(s.body.slice(a.index+a[0].length,p.index));}).pop();}
      function articleGroup(ref){if(!ref)return sections.get(s.document_index+':'+s.section_index)||[];
        var domain=referenceDomain(ref);return domain?targets(s,ref[1]+(ref[2]?'의'+ref[2]:''),domain):[];}
      function paragraphGroup(group,n){var starts=group.filter(function(r){return r.paragraph_start&&r.paragraph_number===n;});
        return starts.length===1?group.filter(function(r){return r.paragraph_anchor===starts[0].paragraph_anchor;}):[];}
      function itemGroup(p){var paragraph=preceding(paragraphRefs,p),article=preceding(refs,paragraph||p),group=articleGroup(article);
        if(paragraph)group=paragraphGroup(group,+paragraph[1]);else if(!article&&s.paragraph_number)group=paragraphGroup(group,s.paragraph_number);return group;}
      function externalPath(p){var item=preceding(itemRefs,p),paragraph=preceding(paragraphRefs,item||p),article=preceding(refs,paragraph||item||p);
        return [p,item,paragraph,article].filter(Boolean).some(external);}
      // 같은 부모 아래 같은 단계의 범위만 확장한다. 양 끝뿐 아니라 중간의 모든 번호를 검사한다.
      var letters='가나다라마바사아자차카타파하',tokens=[],ranges=[],covered=new Set(),replacements=[];
      [[refs,'조'],[paragraphRefs,'항'],[itemRefs,'호'],[letterRefs,'목'],[subitemRefs,'세목']].forEach(function(pair){pair[0].forEach(function(m){tokens.push({m:m,kind:pair[1],number:pair[1]==='목'?letters.indexOf(m[1])+1:+m[1]});});});
      tokens.sort(function(a,b){return a.m.index-b.m.index;});
      function adjacent(a,b){return /^\s*(?:의\s*)?$/.test(s.body.slice(a.m.index+a.m[0].length,b.m.index));}
      function rank(t){return ['조','항','호','목','세목'].indexOf(t.kind);}
      function chainEnding(i){var path=[tokens[i]];while(i>0&&adjacent(tokens[i-1],tokens[i])&&rank(tokens[i-1])<rank(tokens[i]))path.unshift(tokens[--i]);return path;}
      // 양 끝에 부모 경로가 명시된 범위는 같은 번호의 다른 부모와 혼동하지 않는다.
      tokens.forEach(function(t,i){if(covered.has(t.m))return;var tail=s.body.slice(t.m.index+t.m[0].length),op=tail.match(/^\s*(부터|내지|[~∼～–—-])/);if(!op)return;
        var right=[],j=i+1;if(tokens[j]){right.push(tokens[j]);while(j+1<tokens.length&&adjacent(tokens[j],tokens[j+1])&&rank(tokens[j])<rank(tokens[j+1]))right.push(tokens[++j]);}
        if(right.length>1){var left=chainEnding(i),end=right[right.length-1],between=s.body.slice(t.m.index+t.m[0].length,right[0].m.index),suffix=s.body.slice(end.m.index+end.m[0].length),until=suffix.match(/^\s*까지/),finish=end.m.index+end.m[0].length+(until?until[0].length:0),rawRight=right.slice();
          if(left[0].kind!=='조'){var currentArticle=sectionArticles.get(s.document_index+':'+s.section_index);
            if(currentArticle){var local=['',String(currentArticle.number),currentArticle.sub];local.index=left[0].m.index;left.unshift({m:local,kind:'조',number:currentArticle.number});}}
          right=left.filter(function(x){return rank(x)<rank(right[0]);}).concat(right);
          var valid=left[0].kind==='조'&&right[0].kind==='조'&&JSON.stringify(left.map(rank))===JSON.stringify(right.map(rank))&&/^\s*(?:부터|내지|[~∼～])\s*$/.test(between)&&(op[1]!=='부터'||!!until)&&!/^\s*(?:부터|내지|[~∼～–—-]|제\s*\d+\s*(?:조|항|호|세목))/.test(s.body.slice(finish));
          ranges.push({start:t,end:end,left:left,right:right,valid:valid,finish:finish});left.concat(rawRight).forEach(function(x){covered.add(x.m);});return;}
        var end=tokens[i+1],between=end?s.body.slice(t.m.index+t.m[0].length,end.m.index):'',suffix=end?s.body.slice(end.m.index+end.m[0].length):'',until=suffix.match(/^\s*까지/);
        var valid=!!end&&t.kind===end.kind&&/^\s*(?:부터|내지|[~∼～])\s*$/.test(between)&&(op[1]!=='부터'||!!until)&&!covered.has(t.m)&&!covered.has(end.m);
        var finish=end?end.m.index+end.m[0].length+(until?until[0].length:0):t.m.index+t.m[0].length+op[0].length;
        // 범위 뒤의 하위 번호·또 다른 범위는 다중 경로로 해석해야 하므로 여기서 확장하지 않는다.
        if(/^\s*(?:의\s*)?(?:제\s*\d+\s*[조항호]|[가나다라마바사아자차카타파하]\s*목|부터|내지|[~∼～–—-])/.test(s.body.slice(finish)))valid=false;
        ranges.push({start:t,end:end,valid:valid,finish:finish});covered.add(t.m);if(end)covered.add(end.m);
      });
      refs.forEach(function(m){if(covered.has(m))return;
        if(external(m)){if(!literal)missing=true;else literalSections.add(s.document_index+':'+s.section_index);return;}
        var domain=referenceDomain(m),to=domain?targets(s,m[1]+(m[2]?'의'+m[2]:''),domain):[];if(!to.length)missing=true;linked.push.apply(linked,to);
      });
      paragraphRefs.forEach(function(p){if(covered.has(p))return;var before=refs.filter(function(a){return a.index<p.index;}),last=before[before.length-1],group;
        if(last&&external(last)){if(!literal)missing=true;return;}
        if(last){var domain=referenceDomain(last);group=domain?targets(s,last[1]+(last[2]?'의'+last[2]:''),domain):[];}
        else group=sections.get(s.document_index+':'+s.section_index)||[];
        var n=+p[1],matches=paragraphGroup(group,n);
        if(!matches.length||!n){if(last||!n||!preserve(group))missing=true;}else linked.push.apply(linked,matches);
      });
      // 명시 항→호→목 경로 또는 현재 항 안의 유일한 호만 연결한다.
      itemRefs.forEach(function(p){
        if(covered.has(p))return;
        var paragraph=preceding(paragraphRefs,p),last=preceding(refs,paragraph||p),group;
        if(external(p)||last&&external(last)){if(!literal)missing=true;else literalSections.add(s.document_index+':'+s.section_index);return;}
        group=articleGroup(last);
        if(paragraph)group=paragraphGroup(group,+paragraph[1]);
        else if(!last&&s.paragraph_number)group=paragraphGroup(group,s.paragraph_number);
        var matches=group.filter(function(r){return r.list_valid&&r.list_number===+p[1];});
        if(matches.length!==1)missing=true;else {linked.push(matches[0]);itemTargets.set(p,matches[0]);}
      });
      letterRefs.forEach(function(p){if(covered.has(p))return;
        var item=preceding(itemRefs,p),target=item&&itemTargets.get(item),matches=target?(listGroups.get(target.list_id)||[]).filter(function(r){return r.list_valid&&r.list_letter===p[1]&&r.list_path.length===2&&r.list_path[0]===target.list_number;}):[];
        if(matches.length!==1)missing=true;else linked.push(matches[0]);
      });
      subitemRefs.forEach(function(p){if(covered.has(p))return;var letter=preceding(letterRefs,p),item=letter&&preceding(itemRefs,letter),target=item&&itemTargets.get(item);
        var matches=target?(listGroups.get(target.list_id)||[]).filter(function(r){return r.list_valid&&r.list_path.length===3&&r.list_path[0]===target.list_number&&r.list_path[1]===letter[1]&&r.list_subnumber===+p[1];}):[];
        if(matches.length!==1)missing=true;else linked.push(matches[0]);});
      function articleRange(first,last,domain){
        var from=+first[1],to=+last[1],lo=+(first[2]||0),hi=+(last[2]||0),selectedArticles=[],ok=!!domain&&Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>0&&to>=from&&to-from<100&&!(from===to&&lo>hi);
        if(!ok)return {valid:false,rows:[]};
        for(var n=from;n<=to;n++){
          var subs=Array.from(sectionArticles.entries()).filter(function(e){var a=e[1];return a.number===n&&sections.get(e[0])[0].domain===domain;}).map(function(e){return +(e[1].sub||0);}).sort(function(a,b){return a-b;});
          if(n!==from||!lo){if(!subs.includes(0))ok=false;}
          var within=subs.filter(function(b){return (n>from||b>=lo)&&(n<to||b<=hi);});
          if(!within.length||new Set(within).size!==within.length)ok=false;
          if(n===from&&!within.includes(lo)||n===to&&!within.includes(hi))ok=false;
          within.forEach(function(b,i){if(i&&b-within[i-1]!==1&&!(within[i-1]===0&&b===2))ok=false;var rs=targets(s,n+(b?'의'+b:''),domain);if(!rs.some(function(r){return r.body;}))ok=false;selectedArticles.push.apply(selectedArticles,rs);});
        }
        if(selectedArticles.some(function(r,i){return i>0&&position(r)<=position(selectedArticles[i-1]);}))ok=false;
        return {valid:ok,rows:selectedArticles};
      }
      function pathNode(path,group){var p=path.find(function(t){return t.kind==='항';}),it=path.find(function(t){return t.kind==='호';}),l=path.find(function(t){return t.kind==='목';}),sub=path.find(function(t){return t.kind==='세목';});
        if(p)group=paragraphGroup(group,p.number);
        if(it)group=group.filter(function(r){return r.list_valid&&r.list_path?.[0]===it.number;});
        if(l)group=group.filter(function(r){return r.list_path?.[1]===l.m[1];});
        if(sub)group=group.filter(function(r){return r.list_path?.[2]===sub.number;});
        var last=path[path.length-1],roots=group.filter(function(r){return last.kind==='항'?r.paragraph_start:last.kind==='호'?r.list_path?.length===1:last.kind==='목'?r.list_path?.length===2:r.list_path?.length===3;});
        return roots.length===1?{start:roots[0],rows:group}:null;
      }
      ranges.forEach(function(range){var first=range.start,last=range.end,p=first.m,from=first.number,to=last?.number,kind=first.kind;
        if(range.left){var left=range.left,right=range.right,ld=referenceDomain(left[0].m),rd=referenceDomain(right[0].m),interval=articleRange(left[0].m,right[0].m,ld),a=pathNode(left,articleGroup(left[0].m)),b=pathNode(right,articleGroup(right[0].m));
          var good=range.valid&&ld===rd&&interval.valid&&a&&b&&position(a.start)<=position(b.start)&&!external(left[0].m)&&!external(right[0].m);
          // 항 경계를 넘는 범위는 중간 모든 항의 연속성을 확인한다.
          var perSection=new Map();interval.rows.forEach(function(r){var k=r.document_index+':'+r.section_index;if(!perSection.has(k))perSection.set(k,[]);perSection.get(k).push(r);});
          perSection.forEach(function(rs){var ps=rs.filter(function(r){return r.paragraph_start;}).map(function(r){return r.paragraph_number;});if(left.some(function(t){return t.kind==='항';})&&(!ps.length||ps.some(function(n,i){return n!==i+1;})))good=false;
            if(kind!=='항'){if(rs.some(function(r){return r.list_id&&!r.list_valid;}))good=false;
              var anchors=new Set(rs.filter(function(r){return r.paragraph_start;}).map(function(r){return r.paragraph_anchor;}));if(!anchors.size)anchors.add(null);
              anchors.forEach(function(anchor){if(!rs.some(function(r){return r.paragraph_anchor===anchor&&r.list_valid&&r.list_path?.length===1;}))good=false;});}
          });
          linked.push.apply(linked,interval.rows);if(!good){missing=true;linked.push.apply(linked,domains.get(ld)||domains.get(s.domain)||[]);return;}
          var canonicalPath=function(path){return path.map(function(t){return t.kind==='목'?t.m[1]+'목':'제'+t.number+t.kind+(t.kind==='조'&&t.m[2]?'의'+t.m[2]:'');}).join('');};
          replacements.push({start:left[0].m.index,end:range.finish,text:canonicalPath(left)+'~'+canonicalPath(right)});return;
        }
        if(externalPath(p)){if(!literal)missing=true;else literalSections.add(s.document_index+':'+s.section_index);return;}
        if(kind==='조'){var domain=referenceDomain(p),ar=articleRange(p,last?.m||[],domain);linked.push.apply(linked,ar.rows);
          if(!range.valid||!ar.valid){missing=true;linked.push.apply(linked,domains.get(domain)||[]);return;}
          replacements.push({start:p.index,end:range.finish,text:'제'+from+'조'+(p[2]?'의'+p[2]:'')+'~제'+to+'조'+(last.m[2]?'의'+last.m[2]:'')});return;}
        var valid=range.valid&&Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>0&&to>=from&&to-from<100,group=[],found=[],listId=null;
        var article=kind==='항'?preceding(refs,p):null,domain=kind==='조'?referenceDomain(p):null;
        if(kind==='항')group=articleGroup(article);
        if(kind==='호')group=itemGroup(p);
        if(kind==='목'){var parent=preceding(itemRefs,p),target=parent&&itemTargets.get(parent);group=target?(listGroups.get(target.list_id)||[]).filter(function(r){return r.list_path?.length===2&&r.list_path[0]===target.list_number;}):[];}
        if(kind==='세목'){var letter=preceding(letterRefs,p),parent=letter&&preceding(itemRefs,letter),target=parent&&itemTargets.get(parent);group=target?(listGroups.get(target.list_id)||[]).filter(function(r){return r.list_path?.length===3&&r.list_path[0]===target.list_number&&r.list_path[1]===letter[1];}):[];}
        // 손상·혼합 경로는 좁혀 단정하지 않는다. 역방향 제한도 관련 원문에 도달하도록 보존한다.
        function uncertainRows(){return kind==='조'?(domain?domains.get(domain)||[]:all):group.length?group:(domains.get(s.domain)||[]);}
        if(!valid){missing=true;linked.push.apply(linked,uncertainRows());return;}
        if(kind==='조'&&Array.from(sectionArticles.entries()).some(function(entry){var a=entry[1];return a.sub&&a.number>=from&&a.number<to&&sections.get(entry[0])?.some(function(r){return r.domain===domain;});}))valid=false;
        for(var n=from;n<=to;n++){
          var matches=kind==='조'?(domain?targets(s,n,domain):[]):kind==='항'?paragraphGroup(group,n):group.filter(function(r){return r.list_valid&&(kind==='호'?r.list_number===n:kind==='세목'?r.list_subnumber===n:r.list_letter===letters[n-1]);});
          if(!matches.length||!matches.some(function(r){return r.body;})||(kind==='호'||kind==='목')&&matches.length!==1)valid=false;
          if(kind==='호'&&matches.length){if(listId&&matches[0].list_id!==listId)valid=false;listId=matches[0].list_id;}
          found.push.apply(found,matches);
        }
        // 실제 원문의 순서가 번호 범위와 뒤섞여 있거나 번호만 있고 본문이 없으면 확정하지 않는다.
        if(found.some(function(r,i){return i>0&&position(r)<=position(found[i-1]);}))valid=false;
        if(kind==='항'&&Array.from({length:to-from+1},function(_,i){return paragraphGroup(group,from+i);}).some(function(rows){return !rows.some(function(r){return r.body;});}))valid=false;
        linked.push.apply(linked,found);if(!valid){missing=true;linked.push.apply(linked,uncertainRows());return;}
        replacements.push({start:p.index,end:range.finish,text:'제'+from+kind+'~제'+to+kind});
      });
      if(/전조/.test(s.body)){var current=sectionArticles.get(s.document_index+':'+s.section_index),to=current&&!current.sub?targets(s,current.number-1):[];
        if(!to.length||to[0].section_index!==s.section_index-1)missing=true;else linked.push.apply(linked,to);
      }
      if(/전항/.test(s.body)){var group=sections.get(s.document_index+':'+s.section_index)||[],paragraph=0,counts={};
        group.forEach(function(x){if(x.paragraph_start){var n=x.paragraph_number;counts[n]=(counts[n]||0)+1;if(x.sentence_index<=s.sentence_index)paragraph=n;}});
        if(paragraph<2||counts[paragraph]!==1||counts[paragraph-1]!==1){if(!preserve(group))missing=true;}
        else linked.push.apply(linked,group); // 해당 조 전체를 함께 비교하여 항 경계를 넘는 단서도 유지
      }
      if(/준용/.test(s.body)&&!refs.length&&!annexRefs.length&&!namedRefs.length&&!/전항|전조/.test(s.body))missing=true;
      if(paragraphRefs.length||itemRefs.length||ranges.length)linked.forEach(function(x){referenceSections.add(x.document_index+':'+x.section_index);});
      if(replacements.length&&!missing){var normalized=s.body;replacements.sort(function(a,b){return b.start-a.start;}).forEach(function(r){normalized=normalized.slice(0,r.start)+r.text+normalized.slice(r.end);});
        comparisonKeys.set(s,[key(Q.roleText(normalized,s.aliases))+Q.literalScope(normalized,s.aliases)]);}
      var resolved={rows:linked,missing:missing};linkCache.set(s,resolved);return resolved;
    }
    var unresolved=false,changed=true;
    while(changed){changed=false;Array.from(selected).forEach(function(i){var s=all[i];
      var resolved=links(s);if(resolved.missing)unresolved=true;
      // 번호 항목만 검색되어도 주체·의무의 도입문과 목록 전체를 함께 비교한다.
      (listGroups.get(s.list_id)||[]).forEach(function(x){var j=position(x);if(!selected.has(j)){selected.add(j);changed=true;}});
      (s.context_links||[]).forEach(function(x){var j=position(x);if(!selected.has(j)){selected.add(j);changed=true;}});
      resolved.rows.forEach(function(x){var j=position(x);if(!selected.has(j)){selected.add(j);changed=true;}});
    });
      // 다른 조항에서 본 쟁점 조항을 제한하는 역방향 참조도 포함한다.
      all.forEach(function(s,i){if(selected.has(i))return;
        if(links(s).rows.some(function(x){return selected.has(position(x));})){
          all.forEach(function(x,j){if(x.document_index===s.document_index&&x.section_index===s.section_index&&!selected.has(j)){selected.add(j);changed=true;}});
        }
      });
    }
    var picked=all.filter(function(s,i){return selected.has(i)&&s.body;});
    // 문서 제목은 판단 근거가 아니다. 제목 이외의 미해석 문장은 버리지 않는다.
    picked=picked.filter(function(s){return !s.alias_definition&&!s.document_title&&!s.boundary;});
    out.independent_exceptions=picked.filter(function(s){return !s.list_id&&Q.independentException(cp.id,s.body,s.aliases);}).map(function(s){return {document:s.document,text:s.text,reason:'명시된 다른 의무의 독립 단서'};});
    picked=picked.filter(function(s){return s.list_id||!Q.independentException(cp.id,s.body,s.aliases);});
    out.evidence=picked.map(function(s){return {document:s.document,text:s.text,section:s.section,document_index:s.document_index,sentence_index:s.sentence_index};});
    // 인식기는 실제 제한 후보에만 이 그래프를 사용한다. missing 자체를 전역 보류로 옮기지 않는다.
    out.reference_links=all.map(function(s){var link=links(s);return {document_index:s.document_index,sentence_index:s.sentence_index,section_index:s.section_index,domain:s.domain,text:s.text,missing:link.missing,
      targets:Array.from(new Set(link.rows)).map(function(t){return {document_index:t.document_index,sentence_index:t.sentence_index,section_index:t.section_index,domain:t.domain,text:t.text};})};}).filter(function(r){return r.missing||r.targets.length;});
    out.tags=tags(picked.map(function(s){return s.body;}).join('\n'));
    if(!picked.length)out.missing.push('본문 근거 없음');
    if(unresolved)out.missing.push('참조 조항의 적용범위 확인 필요');
    if(Q.contexts(documents).conflicts.length)out.missing.push('같은 문서 구역의 당사자 별칭 정의가 서로 충돌함');
    if(picked.some(function(s){return s.alias_unresolved;}))out.missing.push('해당 문서 구역의 당사자 별칭 정의 확인 필요');
    if(picked.some(function(s){return s.table_context&&!s.list_valid;}))out.missing.push('표의 행·열·주체·의무 내용 확인 필요');
    if(picked.some(function(s){return s.context_kind==='condition'&&!s.list_valid;}))out.missing.push('조건 도입문과 후속 의무의 적용범위 확인 필요');
    if(picked.some(function(s){return s.list_id&&!s.table_context&&s.context_kind!=='condition'&&!s.list_valid;}))out.missing.push('번호 목록의 연속성·주체·의무 내용 확인 필요');
    if(picked.some(function(s){return /�|_{2,}|\[\s*\]/.test(s.body);}))out.missing.push('관련 원문 추출·입력값 확인 필요');
    // 조항 내부 순서를 보존하고 독립 조항의 배열 순서만 정규화한다.
    var groups={};picked.forEach(function(s){var k=s.document_index+':'+s.section_index;(groups[k]||(groups[k]=[])).push.apply(groups[k],comparisonKeys.get(s)||s.keys);});
    // 참조가 있는 조는 항 번호의 순서까지 보존한다. 본문만 같고 번호가 바뀐 경우는 동등하지 않다.
    picked.forEach(function(s){var k=s.document_index+':'+s.section_index;
      if(literalSections.has(k)||referenceSections.has(k)||sections.get(k)?.some(function(x){return /제\s*\d+\s*(?:항|호)|전항/.test(x.body);})){groups[k].push('paragraph-layout:'+sections.get(k).indexOf(s)+':'+(s.paragraph_start?s.paragraph_number:'')+':item:'+JSON.stringify(s.list_path||[]));}
    });
    // 같은 조항들이 있어도 어느 조항을 참조하는지가 바뀌면 다른 약정이다.
    var groupHashes={};Object.keys(groups).forEach(function(k){groupHashes[k]=H.of(groups[k]);});
    var edges=[];picked.forEach(function(s){var from=groupHashes[s.document_index+':'+s.section_index];
      var to=new Set(links(s).rows.map(function(x){return groupHashes[x.document_index+':'+x.section_index];}).filter(Boolean));
      to.forEach(function(target){edges.push(H.of([from,comparisonKeys.get(s)||s.keys,target]));});
    });
    out.preserved_reference_context=literalSections.size>0;
    out.key=H.of([VERSION,cp.id,Object.values(groupHashes).sort(),Array.from(new Set(edges)).sort()]);
    out.reusable=!out.missing.length;return out;
  }
  function scopeKey(s){if(!s?.type)return null;return H.of({type:s.type,roles:(s.roles||[]).slice().sort(),stance:s.stance||'party',party:s.party||null,modules:(s.modules||[]).slice().sort(),answers:s.scope_answers||{}});}
  // 사용자 등록 표준의 질문 연결 기준. 법적 적정성을 독립 추론하는 규칙이 아니다.
  // 완전한 질문의 필수 주제를 갖춘 상호 약정만 추가 자동 연결한다.
  function standardLink(cp,documents,scope){
    var b=bundle(cp,documents),s=b.evidence.map(function(e){return body(e.text);}).join('\n'),c=s.replace(/\s/g,'');
    var P=typeof JudgmentPolicy!=='undefined'?JudgmentPolicy:require('./judgment_policy');
    if(!b.reusable||P.get(cp).level==='unclassified'||cp.review_scope==='execution_only'||cp.text_effect==='required_absent'||/예시|가정|견본|검토\s*중|협의\s*예정|수정\s*예정/.test(s))return null;
    var reciprocal=/당사자일방|각당사자|양당사자|당사자쌍방/.test(c);
    if(!reciprocal&&!(scope?.roles||[]).length)return null;
    var groups={
      'CNS-DAMAGE':[/귀책|고의|과실/,/손해/,/배상(?:해야한다|하여야한다|할책임|책임을부담)/],
      'CNS-END':[/위반|도산|파산/,/해지할수있|해제할수있/,/시정|최고/,/\d+일/,/서면/,/통지/],
      'CNS-SECRET':[/비밀정보.{0,150}(?:말한다|포함|의미|이란|란)/,/목적.{0,30}(?:사용|이용)|(?:사용|이용).{0,30}목적/,/누설|공개/,/제외|예외|그러하지/,/(?:종료|만료).{0,60}(?:년|개월|존속|유효|유지)/]
    }[cp.id];
    if(!groups||!groups.every(function(re){return re.test(c);}))return null;
    return b;
  }
  return {VERSION:VERSION,topics:topics,body:body,wording:wording,key:key,tags:tags,bundle:bundle,scopeKey:scopeKey,standardLink:standardLink};
})();
if(typeof module!=='undefined')module.exports=DecisionEvidence;
