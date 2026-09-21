"use strict";
/* 추출 원문·블록 출처와 논리 번호 영역. 페이지/파일 section을 별첨으로 간주하지 않는다. */
var DocumentStructure = (function () {
  var revisionCache=new WeakMap();
  // JSON 직렬화 없이 중첩 원본의 제자리 수정을 감지한다. 불변 스냅샷은 재순회하지 않는다.
  // 객체를 얼리거나 입력에 표식을 쓰지 않으며, 자식 교체·키 추가·배열 순서도 별도 개정으로 본다.
  function snapshot(value){
    if(!value||typeof value!=='object')return {value:value,frozen:true};
    var keys=Object.keys(value),children=keys.map(function(k){return snapshot(value[k]);});
    return {value:value,keys:keys,children:children,frozen:Object.isFrozen(value)&&children.every(function(s){return s.frozen;})};
  }
  function sameSnapshot(value,saved){
    if(value!==saved.value)return false;
    if(saved.frozen)return true;
    var keys=Object.keys(value);return keys.length===saved.keys.length&&keys.every(function(k,i){return k===saved.keys[i]&&sameSnapshot(value[k],saved.children[i]);});
  }
  function revisionToken(value){
    if(!value||typeof value!=='object')return value;
    var saved=revisionCache.get(value);if(saved&&sameSnapshot(value,saved.snapshot))return saved.token;
    var token={};revisionCache.set(value,{snapshot:snapshot(value),token:token});return token;
  }
  function normalize(s) {return String(s||"").normalize("NFC").replace(/[０-９]/g,function(c){return String(c.charCodeAt(0)-65296);})
    .replace(/[（［【「]/g,"[").replace(/[）］】」]/g,"]").replace(/[\u200B\uFEFF]/g,"").trim();}
  function boundary(s) {
    var t=normalize(s),m;
    if(!t||t.length>120||/(?:따른다|따라|참조|첨부한다|포함한다|정한다|으로\s*한다|에\s*의|를\s*|을\s*|에서\s*|내지|\.\.{2,}|…)/.test(t))return null;
    if((m=/^\[?\s*(별첨|별표|별지|붙임|부록|첨부|Annex|Appendix)\s*(?:제\s*)?([0-9]+(?:[-.][0-9]+)*|[A-Z])?\s*(?:호)?\s*\]?\s*[:.\-]?\s*(.*)$/i.exec(t))) {
      if(m[3] && /^(?:에|의|와|과|및|또는|제\s*\d+\s*조)(?:\s|$)/.test(m[3]))return null;
      if(m[3]&&(/[.!?]$/.test(m[3])||/\b(?:shall|pursuant|refer|applies|section|article)\b/i.test(m[3])))return null;
      return {kind:"annex",token:m[1].toLowerCase()+(m[2]||""),label:t,number:m[2]||""};
    }
    if(/^부\s*칙(?:\s|\[|$)/.test(t))return {kind:"addendum",token:"부칙",label:t};
    return null;
  }
  // 자료 제목은 공백·인용부호·파일 확장자만 정규화한다. 개정일·버전·숫자를 버리지 않는다.
  function titleKey(s){
    var t=String(s||'').normalize('NFC').trim().replace(/\.(?:pdf|hwpx?|docx?|txt)$/i,'');
    var b=boundary(t);if(b)t=t.replace(/^\s*[\[（(【「]?\s*(?:별첨|별표|별지|붙임|부록|첨부|Annex|Appendix)\s*(?:제\s*)?(?:[0-9]+(?:[-.][0-9]+)*|[A-Z])?\s*(?:호)?\s*[\]）)】」]?\s*[:.\-]?\s*/i,'');
    t=t.replace(/^[「“"『]|[」”"』]$/g,'').replace(/\s/g,'');
    return /^[가-힣A-Za-z0-9·ㆍ&()_-]{2,90}(?:계약서|약정서|합의서|명세서|계획서)$/.test(t)?t:'';
  }
  function fromBlocks(format,blocks,warnings) {
    var text="",out=[];
    (blocks||[]).forEach(function(b,i){var s=String(b.text||"").normalize('NFC').replace(/\r\n?/g,"\n");
      var start=text.length;text+=s+"\n";out.push(Object.assign({},b,{id:"b"+i,text:s,start:start,end:start+s.length}));});
    return {format:"cr-document-structure-v1",source_format:format,text:text,blocks:out,warnings:warnings||[]};
  }
  function validExtraction(text,extraction) {
    if(!extraction||extraction.format!=='cr-document-structure-v1'||extraction.text!==text||!Array.isArray(extraction.blocks))return false;
    var at=0;return extraction.blocks.every(function(b){var ok=b.start===at&&b.end===at+b.text.length&&text.slice(b.start,b.end)===b.text;at=b.end+1;return ok;})&&at===text.length;
  }
  // 구조가 원문과 일치하는 경우만 판정·내부 평가자료에 전달한다.
  function document(name,text,extraction){var d={name:name,text:text};if(validExtraction(text,extraction))d.extraction=extraction;return d;}
  var tableHeaders={주체:'actor',의무자:'actor',의무주체:'actor',대상:'object',대상정보:'object',의무:'action',의무내용:'action',약정내용:'action',조건:'condition',적용조건:'condition'};
  function tableHeader(text){return tableHeaders[String(text||'').replace(/\s/g,'')]||null;}
  function inspect(text,extraction,overrides) {
    text=String(text||"");var valid=validExtraction(text,extraction),blocks=valid?extraction.blocks||[]:[],pos=0,bi=0;
    var lines=text.split(/\n/).map(function(t,i){
      while(bi+1<blocks.length&&blocks[bi].end<pos)bi++;
      var b=blocks[bi],line={index:i,text:t,offset:pos,source:b&&b.start<=pos&&b.end>=pos?b.source||null:null,
        numbering:b&&b.start===pos?b.numbering||null:null,block_id:b&&b.start<=pos&&b.end>=pos?b.id:null};pos+=t.length+1;return line;});
    var sections=[{id:"main",label:"본문",kind:"main",start:0,parent:null}],current=sections[0],candidates=[],previousNonblank=null;
    lines.forEach(function(line,i){
      var auto=boundary(line.text),manual=(overrides||[]).filter(function(o){return o.line===i;})[0];
      // 목차의 별첨 표제와 PDF 반복 머리말은 실제 경계로 사용하지 않는다.
      var ahead=lines.slice(i+1,i+7).filter(function(l){return l.text.trim();});
      var toc=(ahead[0]&&boundary(ahead[0].text))||(previousNonblank&&boundary(previousNonblank.text));
      var ignored=line.source&&line.source.repeated_margin;
      if(auto&&(toc||ignored))auto=null;
      if(manual&&manual.mode==="continue")auto=null;
      if(manual&&manual.mode!=="continue")auto={kind:manual.mode==="skip"?"excluded":"annex",label:manual.label||"별도 문서",token:boundary(manual.label||"")&&boundary(manual.label).token,manual:true};
      if(auto){
        current={id:"section-"+i,label:auto.label,token:auto.token||"",kind:auto.kind,start:i,parent:manual&&manual.parent||"main",manual:!!auto.manual};
        sections.push(current);line.boundary=true;
      }else if(/(?:약정서|계약서|합의서)\s*$/.test(line.text.trim())&&i>0&&ahead.some(function(l){return /^\s*(?:제\s*)?1\s*조/.test(l.text);}))candidates.push({line:i,label:line.text.trim()});
      line.section=current.id;
      if(line.text.trim())previousNonblank=line;
    });
    return {format:"cr-document-map-v1",source_format:valid?extraction.source_format:"text",lines:lines,sections:sections,candidates:candidates,
      warnings:valid?extraction.warnings||[]:[],source_valid:!!valid};
  }
  function clauseStarts(text,clauses) {
    var cursor=0;
    return (clauses||[]).map(function(c,i){var key=c.heading&&!/^\((?:전문|전체)\)$/.test(c.heading)?c.heading:String(c.body||"").split("\n").filter(Boolean)[0]||"";
      var at=key?text.indexOf(key,cursor):cursor;if(at<0)at=cursor;cursor=at+key.length;
      return {start:at,index:typeof c.index==="number"?c.index:i};});
  }
  function location(source) {
    if(!source)return "텍스트";
    return [source.page?source.page+"쪽":"",source.part||source.section||"",typeof source.paragraph==="number"?"문단 "+(source.paragraph+1):"",
      typeof source.record_offset==="number"?"레코드 "+source.record_offset:"",source.cell?"표 셀 "+source.cell:""].filter(Boolean).join(" · ")||"원본 블록";
  }
  return {fromBlocks:fromBlocks,inspect:inspect,boundary:boundary,titleKey:titleKey,normalize:normalize,clauseStarts:clauseStarts,location:location,validExtraction:validExtraction,document:document,tableHeader:tableHeader,revisionToken:revisionToken};
})();
if(typeof module!=="undefined")module.exports=DocumentStructure;
