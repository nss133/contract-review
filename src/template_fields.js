"use strict";
/* 허용 입력란은 독립된 표제:값 줄에만 한정. 본문 숫자·의무·기한은 치환하지 않는다. */
var TemplateFields=(function(){
  function norm(s){return String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();}
  function parse(line){
    var m=String(line||'').match(/^\s*((?:(?:위탁자|수탁자|갑|을)\s*)?(?:상호|회사명|대표자|주소)|계약\s*체결일|체결일)\s*[:：]\s*([^\n]+?)\s*$/);
    if(!m)return null;var label=norm(m[1]).replace(/\s/g,''),kind=/체결일$/.test(label)?'execution_date':/대표자$/.test(label)?'representative':/주소$/.test(label)?'address':'party_name';
    return {label:label,kind:kind,source:String(line),value:m[2].trim()};
  }
  function candidates(text){return String(text||'').split('\n').map(parse).filter(Boolean).filter(function(f,i,a){return a.filter(function(x){return x.label===f.label;}).length===1;});}
  function validValue(f,value){
    if(!value||value.length>160||/[\n\r\[\]{}<>_�]|다만|불구|면제|의무|책임|하여야|해야|할수|한다[.]?$/.test(value.replace(/\s/g,'')))return false;
    if(f.kind==='execution_date'){
      var m=value.match(/^(\d{4})[.년/-]\s*(\d{1,2})[.월/-]\s*(\d{1,2})(?:일|\.)?$/);if(!m)return false;
      var d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3];
    }
    return /[가-힣A-Za-z]/.test(value)&&!/[.!?;]$/.test(value);
  }
  function validate(text,fields){
    if(!Array.isArray(fields)||fields.length>30)throw Error('허용 입력란 형식 오류');var seen=new Set();
    fields.forEach(function(f){var p=parse(f.source);if(!p||p.label!==f.label||p.kind!==f.kind||!String(text).split('\n').includes(f.source)||seen.has(f.label))throw Error('허용 입력란은 원문에 있는 고유한 상호·대표자·주소·체결일 줄만 지정할 수 있습니다.');seen.add(f.label);});return fields;
  }
  function key(line,fields,source){
    var p=parse(line);if(!p)return null;var f=(fields||[]).find(function(f){return f.label===p.label&&f.kind===p.kind;});
    if(!f||!source&&!validValue(f,p.value))return null;return 'field:'+f.kind+':'+f.label;
  }
  function fill(text,fields,values){validate(text,fields);var out=String(text);
    fields.forEach(function(f){var value=norm(values[f.label]);if(!validValue(f,value))throw Error(f.label+' 입력값을 확인하세요.');
      var original=parse(f.source).value;if(value!==original&&String(text).replace(f.source,'').includes(original))throw Error(f.label+' 값이 본문에도 사용되어 있습니다. 본문 의무 주체·조건을 먼저 확인하세요.');
      out=out.replace(f.source,f.label+': '+value);});return out;}
  function fillDocument(name,text,fields,values,extraction){var filled=fill(text,fields,values),Structure=typeof DocumentStructure!=='undefined'?DocumentStructure:require('./document_structure');
    if(!Structure.validExtraction(text,extraction))return {name:name,text:filled};
    var replacements=new Map((fields||[]).map(function(f){return [f.source,f.label+': '+norm(values[f.label])];}));
    var blocks=extraction.blocks.map(function(b){return Object.assign({},b,{text:b.text.split('\n').map(function(line){return replacements.has(line)?replacements.get(line):line;}).join('\n')});});
    var next=Structure.fromBlocks(extraction.source_format,blocks,extraction.warnings);next.derived_from=extraction.file_sha256||null;
    return Structure.document(name,filled,next);
  }
  function consistent(text,fields,documents){return (fields||[]).every(function(f){var original=parse(f.source).value;
    if(!String(text).replace(f.source,'').includes(original))return true;
    return (documents||[]).every(function(d){return String(d.text||'').split('\n').map(parse).filter(function(p){return p&&p.label===f.label;}).every(function(p){return p.value===original;});});});}
  return {candidates:candidates,validate:validate,key:key,fill:fill,fillDocument:fillDocument,parse:parse,validValue:validValue,consistent:consistent};
})();
if(typeof module!=='undefined')module.exports=TemplateFields;
