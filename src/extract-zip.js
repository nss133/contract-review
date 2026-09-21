/* 06-extract-zip: docx·hwpx 텍스트 추출 (JSZip + DOMParser).
   둘 다 zip+XML 구조라 공통 워커(텍스트 노드 수집기) 하나로 처리.
   docx: word/document.xml (w:p/w:t/w:br/w:tab), hwpx: Contents/sectionN.xml (hp:p/hp:t) */
(function () {

  function attr(el, name) {
    if (!el || !el.attributes) return '';
    for (var i = 0; i < el.attributes.length; i++)
      if (el.attributes[i].localName === name) return el.attributes[i].value;
    return '';
  }
  function children(el, name) {
    var out = [];
    if (!el) return out;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling)
      if (!name || c.localName === name) out.push(c);
    return out;
  }
  function first(el, name) {
    var all = el && el.getElementsByTagNameNS ? el.getElementsByTagNameNS('*', name) : [];
    return all && all.length ? all[0] : null;
  }
  function parseXml(xmlString) {
    var doc = new DOMParser().parseFromString(xmlString, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 파싱 오류');
    return doc;
  }
  function circled(n) {
    return n >= 1 && n <= 20 ? String.fromCharCode(0x245F + n) : '(' + n + ')';
  }
  function roman(n) {
    var vals = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],
      [40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']], out = '';
    for (var i = 0; i < vals.length; i++) while (n >= vals[i][0]) { out += vals[i][1]; n -= vals[i][0]; }
    return out;
  }
  function formatNumber(n, fmt) {
    if (fmt === 'decimalEnclosedCircle' || fmt === 'decimalEnclosedCircleChinese') return circled(n);
    if (fmt === 'lowerLetter') return String.fromCharCode(96 + Math.max(1, Math.min(26, n)));
    if (fmt === 'upperLetter') return String.fromCharCode(64 + Math.max(1, Math.min(26, n)));
    if (fmt === 'lowerRoman') return roman(n).toLowerCase();
    if (fmt === 'upperRoman') return roman(n);
    if (fmt === 'none' || fmt === 'bullet') return '';
    return String(n);
  }

  // DOCX의 자동 번호는 w:t에 들어 있지 않다. numbering.xml의 numId→abstractNum→lvl을
  // 복원하지 않으면 화면에 보이는 ①②③과 제N조 번호가 통째로 사라진다.
  function parseNumbering(xmlString) {
    if (!xmlString) return null;
    var doc = parseXml(xmlString), abstracts = {}, nums = {};
    Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'abstractNum'), function (a) {
      var levels = {};
      children(a, 'lvl').forEach(function (lvl) {
        var ilvl = Number(attr(lvl, 'ilvl') || 0);
        var st = first(lvl, 'start'), fmt = first(lvl, 'numFmt'), txt = first(lvl, 'lvlText');
        levels[ilvl] = { start: Number(attr(st, 'val') || 1), format: attr(fmt, 'val') || 'decimal',
          text: attr(txt, 'val') || ('%' + (ilvl + 1)),restart:first(lvl,'lvlRestart')?Number(attr(first(lvl,'lvlRestart'),'val')):null };
      });
      abstracts[attr(a, 'abstractNumId')] = levels;
    });
    Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'num'), function (n) {
      var aid = first(n, 'abstractNumId'), overrides = {};
      children(n, 'lvlOverride').forEach(function (ov) {
        var so = first(ov, 'startOverride');
        if (so) overrides[Number(attr(ov, 'ilvl') || 0)] = Number(attr(so, 'val') || 1);
      });
      var levelOverrides={};children(n,'lvlOverride').forEach(function(ov){var lvl=children(ov,'lvl')[0];if(lvl)levelOverrides[Number(attr(ov,'ilvl')||0)]={start:Number(attr(first(lvl,'start'),'val')||1),format:attr(first(lvl,'numFmt'),'val')||'decimal',text:attr(first(lvl,'lvlText'),'val')||'%1'};});
      nums[attr(n, 'numId')] = { abstractId: attr(aid, 'val'), overrides: overrides, levels:levelOverrides };
    });
    return { abstracts: abstracts, nums: nums };
  }
  function parseStyles(xmlString) {
    var out = {};
    if (!xmlString) return out;
    var doc = parseXml(xmlString);
    Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'style'), function (s) {
      var ppr = first(s, 'pPr'), np = ppr && first(ppr, 'numPr'), num = np && first(np, 'numId');
      var il = first(np, 'ilvl');
      out[attr(s, 'styleId')] = { numId: num?attr(num, 'val'):null, ilvl: il?Number(attr(il, 'val')):null,basedOn:attr(first(s,'basedOn'),'val') };
    });
    return out;
  }
  function paragraphNumPr(p, styles) {
    var ppr = children(p, 'pPr')[0], np = ppr && first(ppr, 'numPr'), num = np && first(np, 'numId');
    if(num&&attr(num,'val')==='0')return null;
    var ps=ppr&&first(ppr,'pStyle'),id=attr(ps,'val'),seen={},inherited={};
    while(id&&styles[id]&&!seen[id]){seen[id]=true;var st=styles[id];if(inherited.numId==null&&st.numId!=null)inherited.numId=st.numId;if(inherited.ilvl==null&&st.ilvl!=null)inherited.ilvl=st.ilvl;id=st.basedOn;}
    var il=first(np,'ilvl'),numId=num?attr(num,'val'):inherited.numId;
    return numId&&numId!=='0'?{numId:numId,ilvl:il?Number(attr(il,'val')):inherited.ilvl||0}:null;
  }
  function numberingPrefix(p, numbering, styles, counters) {
    if (!numbering) return '';
    var np = paragraphNumPr(p, styles || {});
    if (!np || !numbering.nums[np.numId]) return '';
    var num = numbering.nums[np.numId], levels = Object.assign({},numbering.abstracts[num.abstractId] || {},num.levels||{});
    var def = levels[np.ilvl];
    if (!def) return '';
    if (!counters[np.numId]) counters[np.numId] = {};
    var cs = counters[np.numId];
    var start = Object.prototype.hasOwnProperty.call(num.overrides, np.ilvl) ? num.overrides[np.ilvl] : def.start;
    cs[np.ilvl] = Object.prototype.hasOwnProperty.call(cs, np.ilvl) ? cs[np.ilvl] + 1 : start;
    Object.keys(cs).forEach(function (k) {var restart=levels[k]&&levels[k].restart;
      if(Number(k)>np.ilvl&&restart!==0&&(restart==null||restart===np.ilvl+1))delete cs[k];});
    return def.text.replace(/%(\d+)/g, function (_, raw) {
      var level = Number(raw) - 1, ld = levels[level] || def;
      return formatNumber(Object.prototype.hasOwnProperty.call(cs, level) ? cs[level] : ld.start, ld.format);
    });
  }
  function needsSpace(prefix, text) {
    if (!prefix || !text) return '';
    if (/^[①-⑳]/.test(prefix) || /[.)]$/.test(prefix)) return ' ';
    if (/제\s*\d+$/.test(prefix) && /^\s*조/.test(text)) return '';
    if (/조$/.test(prefix) && /^\s*\(/.test(text)) return '';
    return ' ';
  }

  /* XML 서브트리에서 단락 구조를 보존하며 텍스트 수집.
     localName 기준이라 w:/hp: 네임스페이스 모두 동작. */
  function collectText(node, out) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) continue; // 텍스트 노드는 't' 요소 단위로만 수집
      if (c.nodeType !== 1) continue;
      var ln = c.localName;
      if(ln==='del'||ln==='moveFrom')continue;
      if (ln === 'AlternateContent') {
        // DOCX 호환성 마크업은 Choice와 Fallback에 같은 내용을 중복 보관한다.
        // 두 분기를 모두 순회하면 계약 본문이 두 번 추출되므로 사용할 한 분기만 고른다.
        var choice = children(c, 'Choice')[0] || children(c, 'Fallback')[0];
        if (choice) collectText(choice, out);
        continue;
      }
      if (ln === 't') out.text += c.textContent;
      else if (ln === 'tab') out.text += '\t';
      else if (ln === 'br' || ln === 'cr' || ln === 'lineBreak') out.text += '\n';
      else if (ln === 'p') { collectText(c, out); out.text += '\n'; }
      else if (ln === 'tc') { collectText(c, out); out.text += '\t'; }
      else collectText(c, out);
    }
  }

  function xmlToText(xmlString) {
    var doc = parseXml(xmlString);
    var out = { text: '' };
    collectText(doc.documentElement, out);
    return out.text;
  }
  function paragraphText(node) {
    var out='';
    function walk(n){children(n).forEach(function(c){var ln=c.localName;
      if(ln==='p'||ln==='tbl'||ln==='tc'||ln==='del'||ln==='moveFrom')return;
      if(ln==='AlternateContent'){var branch=children(c,'Choice')[0]||children(c,'Fallback')[0];if(branch)walk(branch);return;}
      if(ln==='t')out+=c.textContent;else if(ln==='tab')out+='\t';else if(ln==='br'||ln==='cr'||ln==='lineBreak')out+='\n';else walk(c);
    });}walk(node);return out;
  }

  function docxXmlToText(xmlString, numberingXml, stylesXml, structured) {
    var doc = parseXml(xmlString), numbering = parseNumbering(numberingXml), styles = parseStyles(stylesXml);
    var out = { text: '' }, counters = {}, blocks=[],paragraph=0,cell=0,warnings=[],table=null,tableCount=0,cellInfo=null;
    if(doc.getElementsByTagNameNS('*','del').length||doc.getElementsByTagNameNS('*','moveFrom').length)warnings.push('변경추적은 삽입 포함·삭제 제외의 최종본 텍스트로 읽었습니다. 원본 표시와 대조하세요.');
    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var ln = c.localName;
        if(ln==='del'||ln==='moveFrom'){if(warnings.indexOf('변경추적 삭제 문구는 최종본 텍스트에서 제외했습니다.')<0)warnings.push('변경추적 삭제 문구는 최종본 텍스트에서 제외했습니다.');continue;}
        if (ln === 'AlternateContent') {
          var branch = children(c, 'Choice')[0] || children(c, 'Fallback')[0];
          if (branch) walk(branch);
          continue;
        }
        if (ln === 'p') {
          var raw = paragraphText(c).replace(/\n+$/, '');
          var prefix = numberingPrefix(c, numbering, styles, counters);
          var np=paragraphNumPr(c,styles),pp=children(c,'pPr')[0],ind=pp&&first(pp,'ind');
          // 숨김 run 등에 번호가 문자로도 들어 있는 문서는 중복 접두를 만들지 않는다.
          if (prefix && !/^\s*(?:[①-⑳]|제\s*\d+\s*조|\d+\s*[.)])/.test(raw))
            raw = prefix + needsSpace(prefix, raw) + raw;
          out.text += raw + '\n';
          blocks.push({text:raw,numbering:np?Object.assign({},np,{prefix:prefix,confirmed:!!prefix}):null,
            source:{part:'word/document.xml',paragraph:paragraph++,cell:cell||null,table:cellInfo,style:attr(pp&&first(pp,'pStyle'),'val'),indent:attr(ind,'left')||attr(ind,'start'),page_break:!!(pp&&first(pp,'pageBreakBefore'))}});
          walk(c); // 텍스트상자·중첩 표의 문단은 독립 블록으로 보존.
        } else if(ln==='tbl'){var oldTable=table,oldInfo=cellInfo;table={id:'docx-table-'+(++tableCount),row:-1,col:0};cellInfo=null;walk(c);table=oldTable;cellInfo=oldInfo;}
        else if(ln==='tr'&&table){var trpr=children(c,'trPr')[0],before=Number(attr(trpr&&first(trpr,'gridBefore'),'val')||0),after=Number(attr(trpr&&first(trpr,'gridAfter'),'val')||0);
          table.row++;table.col=before;table.omitted=before!==0||after!==0;walk(c);}
        else if (ln === 'tc') { var oldCell=cell,previousInfo=cellInfo,pr=children(c,'tcPr')[0],span=Number(attr(pr&&first(pr,'gridSpan'),'val')||1);
          cell=++paragraph;cellInfo=table?{id:table.id,row:table.row,col:table.col,colspan:span,rowspan:1,invalid:table.omitted,merged:!!(pr&&(first(pr,'vMerge')||first(pr,'hMerge')))}:null;
          if(table)table.col+=span;walk(c);cell=oldCell;cellInfo=previousInfo;out.text += '\t'; }
        else walk(c);
      }
    }
    walk(doc.documentElement);
    return structured?DocumentStructure.fromBlocks('docx',blocks,warnings):out.text;
  }

  function extractDocx(arrayBuffer, structured) {
    return JSZip.loadAsync(arrayBuffer).then(function (zip) {
      var f = zip.file('word/document.xml');
      if (!f) throw new Error('docx 형식 아님 (word/document.xml 없음)');
      return Promise.all([f.async('string'), zip.file('word/numbering.xml') ? zip.file('word/numbering.xml').async('string') : '',
        zip.file('word/styles.xml') ? zip.file('word/styles.xml').async('string') : '']);
    }).then(function (parts) { return docxXmlToText(parts[0], parts[1], parts[2],structured); });
  }

  function hwpxStructure(xml,header,part,counters) {
    var doc=parseXml(xml),defs={},props={},blocks=[],warnings=[],headerDoc=header?parseXml(header):null;
    if(headerDoc){
      Array.prototype.forEach.call(headerDoc.getElementsByTagNameNS('*','numbering'),function(n){
        var levels={};children(n,'paraHead').forEach(function(h){levels[Number(attr(h,'level'))]={template:h.textContent,start:Number(attr(h,'start')||attr(n,'start')||1),format:attr(h,'numFormat')};});defs[attr(n,'id')]=levels;
      });
      Array.prototype.forEach.call(headerDoc.getElementsByTagNameNS('*','paraPr'),function(p){var h=first(p,'heading');if(h)props[attr(p,'id')]={type:attr(h,'type'),id:attr(h,'idRef'),level:Number(attr(h,'level')||0)};});
    }
    function visit(node,path,table,cell){children(node).forEach(function(p,i){var here=path+'/'+p.localName+'['+i+']';
      if(p.localName==='tbl'){visit(p,here,{id:part+here,row:-1,col:0},null);return;}
      if(p.localName==='tr'&&table){table.row++;table.col=0;visit(p,here,table,null);return;}
      if(p.localName==='tc'&&table){var addr=first(p,'cellAddr'),span=first(p,'cellSpan'),col=addr?Number(attr(addr,'colAddr')):table.col,row=addr?Number(attr(addr,'rowAddr')):table.row;
        var cs=Number(attr(span,'colSpan')||1),rs=Number(attr(span,'rowSpan')||1);table.col=col+cs;
        visit(p,here,table,{id:table.id,row:row,col:col,colspan:cs,rowspan:rs});return;}
      if(p.localName==='p'){
        var raw=paragraphText(p).replace(/\n+$/,''),num=props[attr(p,'paraPrIDRef')],prefix='',confirmed=false;
        var auto=first(p,'autoNum');
        if(auto&&/^\d+$/.test(attr(auto,'num'))){prefix=attr(auto,'num');confirmed=true;}
        if(num&&num.type==='NUMBER'){
          var level=num.level+1,def=(defs[num.id]||{})[level],key=part+'|'+num.id;
          if(def){var cs=counters[key]||(counters[key]={});cs[level]=cs[level]==null?def.start:cs[level]+1;Object.keys(cs).forEach(function(k){if(Number(k)>level)delete cs[k];});
            prefix=def.template.replace(/\^(\d+)/g,function(_,n){var v=cs[n]==null?((defs[num.id]||{})[n]||def).start:cs[n];return /CIRCLED/.test(def.format)?circled(v):String(v);});confirmed=!!prefix;
          }
        }
        if(prefix&&!/^\s*(?:제\s*\d+\s*조|[①-⑳]|\d+[.)])/.test(raw))raw=prefix+needsSpace(prefix,raw)+raw;
        blocks.push({text:raw,numbering:num||auto?Object.assign({},num||{},{prefix:prefix,confirmed:confirmed}):null,
          source:{part:part,path:here,paragraph:blocks.length,paragraph_style:attr(p,'paraPrIDRef'),cell:here.indexOf('/tc[')>=0?here.slice(0,here.lastIndexOf('/p[')):null,table:cell||null}});
        visit(p,here,table,cell);
      }else visit(p,here,table,cell);
    });}
    visit(doc.documentElement,'');return {blocks:blocks,warnings:warnings};
  }
  function extractHwpx(arrayBuffer, structured) {
    return JSZip.loadAsync(arrayBuffer).then(function (zip) {
      var sections = [];
      zip.forEach(function (path) {
        if (/^Contents\/section\d+\.xml$/.test(path)) sections.push(path);
      });
      if (!sections.length) throw new Error('hwpx 형식 아님 (Contents/sectionN.xml 없음)');
      sections.sort(function (a, b) {
        return parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10);
      });
      var header=zip.file('Contents/header.xml'),blocks=[],warnings=[],counters={};
      var chain = (header?header.async('string'):Promise.resolve('')).then(function(h){return {text:'',header:h};});
      for (var i = 0; i < sections.length; i++) {
        (function (path) {
          chain = chain.then(function (acc) {
            return zip.file(path).async('string').then(function (xml) {
              if(structured){var result=hwpxStructure(xml,acc.header,path,counters);blocks=blocks.concat(result.blocks);warnings=warnings.concat(result.warnings);}
              acc.text+=xmlToText(xml)+'\n';return acc;
            });
          });
        })(sections[i]);
      }
      return chain.then(function(acc){return structured?DocumentStructure.fromBlocks('hwpx',blocks,warnings):acc.text;});
    });
  }

  PF.extractDocx = extractDocx;
  PF.extractHwpx = extractHwpx;
  PF._xmlToText = xmlToText;
  PF._docxXmlToText = docxXmlToText;
  PF._parseDocxNumbering = parseNumbering;
  PF._hwpxStructure = hwpxStructure;
})();
