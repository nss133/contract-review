"use strict";
/* 원문을 고치지 않는 구역 보정. 전체 입력/파일 지문별 저장, 수정 입력에 이전 경계 이월 금지. */
var StructureReview=(function(){
  function fingerprint(){var x=state.extractedDocument;return SafetyDigest.of({text:state.text,file:x&&x.text===state.text?x.file_sha256||null:null});}
  function key(){return 'cr-structure-boundaries-v1:'+fingerprint();}
  function boundaries(){try{var raw=JSON.parse(localStorage.getItem(key())||'null');return raw&&raw.fingerprint===fingerprint()&&Array.isArray(raw.items)?raw.items:[];}catch(e){return [];}}
  function save(items){localStorage.setItem(key(),JSON.stringify({fingerprint:fingerprint(),items:items}));refreshDocumentIntegrity();renderClauses();renderReport();}
  function html(){var m=state.documentStructure;if(!m)return '';
    var rows=m.lines.filter(function(l){return l.text.trim();}),saved=boundaries();
    return '<details class="structure-review"><summary>본문·별첨 구역 '+m.sections.length+'개 · 원본 위치 / 경계 보정</summary>'+
      '<p>다른 문서가 시작되는 줄을 선택하고 한 번 보정하면 뒤의 조 번호를 별도로 검사합니다. 번호 재시작만으로 별첨을 확정하지 않습니다. 현재 원문이 바뀌면 이전 보정은 적용되지 않습니다.</p>'+
      '<ol>'+m.sections.map(function(s){return '<li>'+esc(s.label)+' · '+(s.start+1)+'행 · '+(s.manual?'사람 보정':'표제 인식')+' · '+esc(s.kind==='excluded'?'번호 검사 제외':s.id)+'</li>';}).join('')+'</ol>'+
      (m.candidates.length?'<p>경계 후보: '+m.candidates.map(function(c){return (c.line+1)+'행 '+esc(c.label);}).join(' / ')+'</p>':'')+
      '<label>시작 위치 <select class="structure-line">'+rows.map(function(l){return '<option value="'+l.index+'">'+(l.index+1)+'행 · '+esc(DocumentStructure.location(l.source))+' · '+esc(l.text.slice(0,100))+'</option>';}).join('')+'</select></label>'+
      '<label>처리 <select class="structure-mode"><option value="annex">여기부터 별첨 / 별도 문서</option><option value="continue">이 표제는 앞 구역의 연속 (경계 아님)</option><option value="skip">여기부터 다음 구역까지 번호 검사 제외</option></select></label>'+
      '<label>구역 이름 <input class="structure-label" placeholder="예: 별첨 1 보안관리약정서"></label>'+
      '<label>상위 구역 <select class="structure-parent">'+m.sections.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.label)+'</option>';}).join('')+'</select></label>'+
      '<button class="ghost structure-save">구역 보정 적용</button> <button class="ghost structure-remove">선택한 줄의 보정 해제</button> <button class="ghost structure-export">구조·보정 내부 백업</button><label>현재 원본의 보정 복구 <input type="file" class="structure-import" accept=".crstructure"></label>'+
      '<p class="structure-message" role="status">저장된 보정 '+saved.length+'건. 백업은 원문을 포함하므로 폐쇄망 내부에만 보관하세요.</p>'+
      '<details><summary>추출 구조와 원본 위치 확인</summary><p>형식: '+esc(m.source_format)+' · 출처 '+(m.source_valid?'유효':'텍스트 입력/수정으로 파일 출처 미적용')+'</p>'+
      '<p>'+esc(m.warnings.join(' / '))+'</p><ol>'+rows.map(function(l){return '<li value="'+(l.index+1)+'">'+esc(DocumentStructure.location(l.source))+' · '+esc(l.section)+'<br>'+esc(l.text)+'</li>';}).join('')+'</ol></details></details>';
  }
  function bind(root){var box=root.querySelector('.structure-review');if(!box)return;
    function line(){return Number(box.querySelector('.structure-line').value);}
    function error(e){box.querySelector('.structure-message').textContent=e.message;}
    box.querySelector('.structure-save').onclick=function(){try{
      if(document.getElementById('contract-text').value!==state.text)throw Error('수정한 본문을 먼저 재분석하세요.');
      var n=line(),label=box.querySelector('.structure-label').value.trim(),mode=box.querySelector('.structure-mode').value,parent=box.querySelector('.structure-parent').value;
      if(mode!=='continue'&&!label)throw Error('구역 이름을 입력하세요.');
      var parentSection=state.documentStructure.sections.filter(function(s){return s.id===parent;})[0];
      if(parent!=='main'&&(!parentSection||parentSection.start>=n))throw Error('상위 구역은 시작 위치보다 앞에 있어야 합니다.');
      var items=boundaries().filter(function(o){return o.line!==n;});items.push({line:n,label:label,mode:mode,parent:parent,date:verdictToday(),reviewer:getReviewer()});save(items);
    }catch(e){error(e);}};
    box.querySelector('.structure-remove').onclick=function(){try{save(boundaries().filter(function(o){return o.line!==line();}));}catch(e){error(e);}};
    box.querySelector('.structure-import').onchange=function(ev){var file=ev.target.files[0];if(!file)return;file.text().then(function(text){var data=JSON.parse(text);
      if(data.format!=='cr-structure-review-v1'||data.fingerprint!==fingerprint()||data.text!==state.text)throw Error('현재 원본/텍스트와 다른 백업입니다. 동일 원본을 먼저 불러오세요.');
      if(!Array.isArray(data.boundaries)||data.boundaries.some(function(o){return !Number.isInteger(o.line)||o.line<0||o.line>=state.documentStructure.lines.length||['annex','continue','skip'].indexOf(o.mode)<0;}))throw Error('구역 보정 형식 오류');
      save(data.boundaries);
    }).catch(error);};
    box.querySelector('.structure-export').onclick=function(){var data={format:'cr-structure-review-v1',fingerprint:fingerprint(),extraction:state.extractedDocument&&state.extractedDocument.text===state.text?state.extractedDocument:null,text:state.text,boundaries:boundaries(),map:state.documentStructure};
      var url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='문서구조_내부백업.crstructure';a.click();setTimeout(function(){URL.revokeObjectURL(url);},3000);};
  }
  return {boundaries:boundaries,html:html,bind:bind,fingerprint:fingerprint};
})();
