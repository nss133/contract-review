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
          text: attr(txt, 'val') || ('%' + (ilvl + 1)) };
      });
      abstracts[attr(a, 'abstractNumId')] = levels;
    });
    Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'num'), function (n) {
      var aid = first(n, 'abstractNumId'), overrides = {};
      children(n, 'lvlOverride').forEach(function (ov) {
        var so = first(ov, 'startOverride');
        if (so) overrides[Number(attr(ov, 'ilvl') || 0)] = Number(attr(so, 'val') || 1);
      });
      nums[attr(n, 'numId')] = { abstractId: attr(aid, 'val'), overrides: overrides };
    });
    return { abstracts: abstracts, nums: nums };
  }
  function parseStyles(xmlString) {
    var out = {};
    if (!xmlString) return out;
    var doc = parseXml(xmlString);
    Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'style'), function (s) {
      var ppr = first(s, 'pPr'), np = ppr && first(ppr, 'numPr'), num = np && first(np, 'numId');
      if (!num) return;
      var il = first(np, 'ilvl');
      out[attr(s, 'styleId')] = { numId: attr(num, 'val'), ilvl: Number(attr(il, 'val') || 0) };
    });
    return out;
  }
  function paragraphNumPr(p, styles) {
    var ppr = children(p, 'pPr')[0], np = ppr && first(ppr, 'numPr'), num = np && first(np, 'numId');
    if (num && attr(num, 'val') !== '0') {
      var il = first(np, 'ilvl');
      return { numId: attr(num, 'val'), ilvl: Number(attr(il, 'val') || 0) };
    }
    var ps = ppr && first(ppr, 'pStyle');
    return (ps && styles[attr(ps, 'val')]) || null;
  }
  function numberingPrefix(p, numbering, styles, counters) {
    if (!numbering) return '';
    var np = paragraphNumPr(p, styles || {});
    if (!np || !numbering.nums[np.numId]) return '';
    var num = numbering.nums[np.numId], levels = numbering.abstracts[num.abstractId] || {};
    var def = levels[np.ilvl];
    if (!def) return '';
    if (!counters[np.numId]) counters[np.numId] = {};
    var cs = counters[np.numId];
    var start = Object.prototype.hasOwnProperty.call(num.overrides, np.ilvl) ? num.overrides[np.ilvl] : def.start;
    cs[np.ilvl] = Object.prototype.hasOwnProperty.call(cs, np.ilvl) ? cs[np.ilvl] + 1 : start;
    Object.keys(cs).forEach(function (k) { if (Number(k) > np.ilvl) delete cs[k]; });
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

  function docxXmlToText(xmlString, numberingXml, stylesXml) {
    var doc = parseXml(xmlString), numbering = parseNumbering(numberingXml), styles = parseStyles(stylesXml);
    var out = { text: '' }, counters = {};
    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var ln = c.localName;
        if (ln === 'AlternateContent') {
          var branch = children(c, 'Choice')[0] || children(c, 'Fallback')[0];
          if (branch) walk(branch);
          continue;
        }
        if (ln === 'p') {
          var tmp = { text: '' }; collectText(c, tmp);
          var raw = tmp.text.replace(/\n+$/, '');
          var prefix = numberingPrefix(c, numbering, styles, counters);
          // 숨김 run 등에 번호가 문자로도 들어 있는 문서는 중복 접두를 만들지 않는다.
          if (prefix && !/^\s*(?:[①-⑳]|제\s*\d+\s*조|\d+\s*[.)])/.test(raw))
            raw = prefix + needsSpace(prefix, raw) + raw;
          out.text += raw + '\n';
        } else if (ln === 'tc') { walk(c); out.text += '\t'; }
        else walk(c);
      }
    }
    walk(doc.documentElement);
    return out.text;
  }

  function extractDocx(arrayBuffer) {
    return JSZip.loadAsync(arrayBuffer).then(function (zip) {
      var f = zip.file('word/document.xml');
      if (!f) throw new Error('docx 형식 아님 (word/document.xml 없음)');
      return Promise.all([f.async('string'), zip.file('word/numbering.xml') ? zip.file('word/numbering.xml').async('string') : '',
        zip.file('word/styles.xml') ? zip.file('word/styles.xml').async('string') : '']);
    }).then(function (parts) { return docxXmlToText(parts[0], parts[1], parts[2]); });
  }

  function extractHwpx(arrayBuffer) {
    return JSZip.loadAsync(arrayBuffer).then(function (zip) {
      var sections = [];
      zip.forEach(function (path) {
        if (/^Contents\/section\d+\.xml$/.test(path)) sections.push(path);
      });
      if (!sections.length) throw new Error('hwpx 형식 아님 (Contents/sectionN.xml 없음)');
      sections.sort(function (a, b) {
        return parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10);
      });
      var chain = Promise.resolve('');
      for (var i = 0; i < sections.length; i++) {
        (function (path) {
          chain = chain.then(function (acc) {
            return zip.file(path).async('string').then(function (xml) {
              return acc + xmlToText(xml) + '\n';
            });
          });
        })(sections[i]);
      }
      return chain;
    });
  }

  PF.extractDocx = extractDocx;
  PF.extractHwpx = extractHwpx;
  PF._xmlToText = xmlToText;
  PF._docxXmlToText = docxXmlToText;
  PF._parseDocxNumbering = parseNumbering;
})();
