/* 05-extract-pdf: pdf.js 텍스트 추출.
   워커 전략: 내장 워커 소스(text/plain 블록) → Blob URL 워커. 실패 시 fake worker(메인 스레드) 폴백.
   file://에서 외부 워커 파일을 로드할 수 없으므로 두 경로 모두 네트워크 무의존. */
(function () {
  var workerReady = false;
  var workerMode = 'none';

  function setupWorker() {
    if (workerReady) return workerMode;
    var el = document.getElementById('pdfjs-worker-src');
    if (!el || !window.pdfjsLib) { workerMode = 'unavailable'; workerReady = true; return workerMode; }
    var src = el.textContent;
    try {
      var blob = new Blob([src], { type: 'text/javascript' });
      var url = URL.createObjectURL(blob);
      pdfjsLib.GlobalWorkerOptions.workerSrc = url;
      workerMode = 'blob';
    } catch (e) {
      try {
        /* fake worker: 워커 소스를 메인 스레드에서 평가 → window.pdfjsWorker 등록됨.
           pdf.js는 GlobalWorkerOptions.workerSrc가 없고 globalThis.pdfjsWorker가 있으면
           네트워크 fetch 없이 메인 스레드 fake worker로 동작한다. */
        (0, eval)(src);
        workerMode = 'fake';
      } catch (e2) {
        console.error('pdf.js 워커 초기화 실패', e2);
        workerMode = 'failed';
      }
    }
    workerReady = true;
    return workerMode;
  }

  /* 줄 구조 복원. 개행 기준을 폰트 크기에 비례시킴 — 종전 고정 임계(2pt)는 HWP/Word 변환
     PDF에서 같은 줄 내 조각의 미세한 y 변동에도 개행을 삽입해 줄이 잘게 쪼개졌음.
     |Δy| > 0.6×폰트크기일 때만 실제 줄바꿈으로 처리하고 hasEOL 중복 개행은 제거. */
  function itemsToText(items) {
    var out = '';
    var lastY = null, lastEndX = null, lastH = 12;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var tr = it.transform;
      var y = tr ? tr[5] : null;
      var h = tr ? (Math.abs(tr[0]) || Math.abs(tr[3]) || lastH) : lastH;
      if (h > 1) lastH = h;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 0.6 * lastH) {
        out += '\n';
      } else if (lastEndX !== null && tr && tr[4] - lastEndX > 0.5 * lastH &&
                 out && out[out.length - 1] !== ' ' && out[out.length - 1] !== '\n') {
        out += ' '; // 같은 줄에서 글자폭 절반 이상 벌어지면 공백 (단어 붙음 방지)
      }
      out += it.str;
      if (y !== null) lastY = y;
      lastEndX = (tr && typeof it.width === 'number') ? tr[4] + it.width : null;
    }
    return out;
  }

  function pageBlocks(items,pageNumber,height) {
    var rows=[];
    (items||[]).filter(function(it){return it.str&&it.transform;}).forEach(function(it){var x=it.transform[4],y=it.transform[5],h=Math.abs(it.transform[3])||Math.abs(it.transform[0])||12;
      var row=rows.filter(function(r){return Math.abs(r.y-y)<=Math.max(2,Math.min(r.h,h)*0.45);})[0];
      if(!row){row={y:y,h:h,items:[]};rows.push(row);}row.items.push(it);
    });
    rows.sort(function(a,b){return b.y-a.y;});
    var blocks=[],table=null,tableNo=0;
    rows.forEach(function(row){row.items.sort(function(a,b){return a.transform[4]-b.transform[4];});var group=[],end=null;
      var headerItems=row.items.filter(function(it){return it.str.trim();}),heads=headerItems.map(function(it){return DocumentStructure.tableHeader(it.str);});
      if(heads.length>=2&&heads.every(Boolean)&&new Set(heads).size===heads.length&&heads.includes('actor')&&heads.includes('action'))table={id:'pdf-'+pageNumber+'-table-'+(++tableNo),xs:headerItems.map(function(it){return it.transform[4];}),row:0,y:row.y};
      else if(table){if(table.y-row.y>row.h*3||/^(?:제\s*\d+\s*조|[①-⑳]|\[?별첨|\[?붙임)/.test(itemsToText(row.items)))table=null;else {table.row++;table.y=row.y;}}
      if(table){var cells=table.xs.map(function(){return [];}),bad=false;
        row.items.forEach(function(it){if(!it.str.trim())return;var x=it.transform[4],col=table.xs.findIndex(function(left,i){return x>=left-3&&(i===table.xs.length-1||x<table.xs[i+1]-3);});
          if(col<0){bad=true;return;}if(col+1<table.xs.length&&x+(it.width||0)>table.xs[col+1]-3)bad=true;cells[col].push(it);});
        if(cells.some(function(c){return !c.length;}))bad=true;
        cells.forEach(function(items,col){blocks.push({text:itemsToText(items),source:{page:pageNumber,x:table.xs[col],y:row.y,height:row.h,page_height:height,
          table:{id:table.id,row:table.row,col:col,colspan:1,rowspan:1,invalid:bad},cell:table.id+':'+table.row+':'+col}});});
        if(bad)table=null;return;
      }
      function emit(){if(!group.length)return;var first=group[0],last=group[group.length-1];
        blocks.push({text:itemsToText(group),source:{page:pageNumber,x:first.transform[4],y:row.y,width:last.transform[4]+(last.width||0)-first.transform[4],height:row.h,page_height:height,
          spans:group.map(function(it){return {text:it.str,x:it.transform[4],y:it.transform[5],width:it.width,font:it.fontName};})}});group=[];}
      row.items.forEach(function(it){if(end!==null&&it.transform[4]-end>Math.max(80,row.h*6))emit();group.push(it);end=it.transform[4]+(it.width||0);});emit();
    });
    return blocks;
  }
  function pageText(page,structured) {
    return page.getTextContent().then(function (tc) {
      return structured?pageBlocks(tc.items,page.pageNumber,page.getViewport({scale:1}).height):itemsToText(tc.items);
    });
  }

  function extractPdf(arrayBuffer,structured) {
    var mode = setupWorker();
    if (mode === 'unavailable' || mode === 'failed')
      return Promise.reject(new Error('pdf.js 사용 불가 (워커 모드: ' + mode + ')'));
    return pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise
      .then(function (doc) {
        var chain = Promise.resolve(structured?[]:'');
        var total = doc.numPages;
        for (var p = 1; p <= total; p++) {
          (function (pageNum) {
            chain = chain.then(function (acc) {
              return doc.getPage(pageNum).then(function(page){return pageText(page,structured);}).then(function (t) {
                return structured?acc.concat(t):acc + t + '\n\n';
              });
            });
          })(p);
        }
        return chain.then(function (text) {
          doc.destroy();
          if(structured){
            var margins={};text.forEach(function(b){var s=b.source,key=b.text.trim();if(s.y>s.page_height*.92||s.y<s.page_height*.08){if(!margins[key])margins[key]={};margins[key][s.page]=true;}});
            text.forEach(function(b){var s=b.source,key=b.text.trim();if(margins[key]&&Object.keys(margins[key]).length>=2&&(s.y>s.page_height*.92||s.y<s.page_height*.08))s.repeated_margin=true;});
            var present={};text.forEach(function(b){present[b.source.page]=true;});
            var warnings=Object.keys(present).length<total?['텍스트층이 없는 페이지가 있습니다. 해당 페이지는 내부 OCR 또는 원본 대조가 필요합니다.']:[];
            return DocumentStructure.fromBlocks('pdf',text,warnings);
          }
          return text;
        });
      });
  }

  PF.extractPdf = extractPdf;
  PF._pdfItemsToText = itemsToText; // 테스트용
  PF._pdfPageBlocks = pageBlocks;
  PF.pdfWorkerMode = function () { setupWorker(); return workerMode; };
})();
