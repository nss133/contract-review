"use strict";
/* 계약서 자체의 구조·내부 인용 완결성 검사. 법률 판단이나 외부 법령 유효성 검사는 하지 않는다. */
var Integrity = (function () {
  var DS=typeof DocumentStructure!=="undefined"?DocumentStructure:require('./document_structure');
  // segmenter가 문장 첫머리의 "제2조에 따른다"도 별도 조각으로 나눌 수 있으므로
  // 실제 표제(제N조 또는 제N조(표제))만 조 정의로 인정한다.
  var ARTICLE_BARE_RE = /^\s*(?:제\s*)?(\d+)\s*조(?:의\s*(\d+))?\s*$/;
  var ARTICLE_TITLE_RE = /^\s*(?:제\s*)?(\d+)\s*조(?:의\s*(\d+))?\s*[([【「][^\n)\]】」]+[)\]】」]([\s\S]*)$/;
  var REF_RE = /제\s*(\d+)\s*조(?:의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/g;
  var EXTERNAL_BEFORE_RE = /(?:법|법률|시행령|시행규칙|감독규정|규정|고시|규칙|모범규준)\s*$/;
  var CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

  function articleKey(n, sub, section) {
    var base = String(Number(n)) + (sub ? "-" + String(Number(sub)) : "");
    return section ? section + "|" + base : base;
  }
  function _sectionLabel(section) {
    if (section === "addendum") return "부칙";
    if (String(section || "").indexOf("annex:") === 0) return String(section).slice(6);
    return "본문";
  }
  // 본문과 부칙·별표는 조 번호 체계가 서로 독립적이다. 정확히 한 줄로 놓인 표제만
  // 경계로 인정해 본문 중 "별표 1에 따른다" 같은 인용문이 영역을 바꾸지 않게 한다.
  function _nextSection(text, current) {
    var next = current || "main";
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var t = line.trim(), m;
      if (/^부\s*칙(?:\s*\([^)]*\))?$/.test(t)) next = "addendum";
      else if ((m = /^(별표|별지|붙임)\s*(?:제?\s*(\d+)\s*호?)?(?:\s*\([^)]*\))?$/.exec(t)))
        next = "annex:" + m[1] + (m[2] ? " " + Number(m[2]) : "");
    });
    return next;
  }
  function _articleHeading(text) {
    var t = _normalize(text), m = ARTICLE_TITLE_RE.exec(t);
    if (m) return { number: m[1], sub: m[2], remainder: String(m[3] || "").trim(), prefixLength: m[0].length - String(m[3] || "").length, explicit: true };
    m = ARTICLE_BARE_RE.exec(t);
    if (m) return { number: m[1], sub: m[2], remainder: "", prefixLength: m[0].length, explicit: true };
    m = /^\s*(?:제\s*)?(\d+)\s*조(?:의\s*(\d+))?\s+(.+)$/.exec(t);
    if (m && _shortTitle(m[3])) return { number:m[1], sub:m[2], remainder:"", prefixLength:t.length, explicit:true };
    // 숫자 목록은 조/항/호를 확정하지 않는다. 존재 후보로만 사용한다.
    m = /^\s*(?:(\d+)\s*[.)]\s*|\((\d+)\)\s*|Article\s+(\d+)\s*[.:]?\s*)(.+)$/i.exec(t);
    if (m && _shortTitle(m[4])) return { number:m[1]||m[2]||m[3], sub:null, remainder:"", prefixLength:t.length, explicit:false };
    return null;
  }
  function _normalize(text) {
    return String(text || "").normalize("NFC").replace(/[０-９]/g,function(c){return String(c.charCodeAt(0)-0xFF10);})
      .replace(/（/g,"(").replace(/）/g,")").replace(/［/g,"[").replace(/］/g,"]")
      .replace(/[\u200B\uFEFF]/g,"").replace(/\u00a0/g," ");
  }
  function _shortTitle(s) {
    return s.trim().length > 0 && s.length <= 60 && !/[。.;:!?]/.test(s) &&
      !/^(?:에|의|을|를|에서|부터|까지|및|또는|내지|제\s*\d+\s*(?:항|호))(?:\s|$)/.test(s) &&
      !/(?:따른|따라|의한|의해|규정|참조|적용한|준용|한다|된다|있다|없다|한다는|경우)/.test(s);
  }
  // 완결성 주소록은 매핑용 segmenter의 제N조 분할 여부에 의존하지 않는다.
  // 원래 clause index는 유지하여 원문 이동·사람 의견의 주소를 바꾸지 않는다.
  function _structureClauses(clauses,model,text) {
    var out=[],current=null,explicit={},starts=DS.clauseStarts(text,clauses),ci=0;
    model.lines.forEach(function(l){var h=_articleHeading(l.text);if(h&&h.explicit)explicit[l.section]=true;});
    model.lines.forEach(function(l){
      while(ci+1<starts.length&&starts[ci+1].start<=l.offset)ci++;
      if(l.boundary || l.source&&l.source.repeated_margin){if(current){out.push(current);current=null;}return;}
      var h=_articleHeading(l.text),start=h&&(h.explicit||!explicit[l.section]),index=starts[ci]?starts[ci].index:0;
      if(current&&(start||current.section!==l.section)){out.push(current);current=null;}
      if(!current)current={heading:start?_normalize(l.text):"",body:"",index:index,section:l.section,source:l.source,line:l.index};
      if(!start)current.body+=(current.body?"\n":"")+_normalize(l.text);
    });
    if(current)out.push(current);
    return out;
  }
  function _headingText(c) { return String(c && c.heading || ""); }
  function _bodyText(c) { return _headingText(c) + "\n" + String(c && c.body || ""); }
  function _paragraphs(text) {
    var set = {}, m, re = /(?:^|\n)\s*제\s*(\d+)\s*항/g, reliable = false, style = "implicit";
    while ((m = re.exec(text))) { set[Number(m[1])] = true; reliable = true; style = "explicit"; }
    var cre = /(?:^|\n)\s*([①-⑳])/g;
    while ((m = cre.exec(text))) { set[CIRCLED.indexOf(m[1]) + 1] = true; reliable = true; style = "circled"; }
    // 추출기·원문 서식에 따라 항 표지가 (1), 1), 1.로 보존되기도 한다.
    // (1)은 각 호 문맥이 아닌 경우 항으로 신뢰하고, 1)/1.은 존재 확인에는 쓰되
    // 항·호 중 어느 층위인지 단정하지 않아 누락 경고를 고확신으로 만들지 않는다.
    var itemCue = /다음\s+각\s*호|각\s*호의/.test(text);
    if (!reliable && !itemCue) {
      var pre = /(?:^|\n)\s*\((\d+)\)\s*/g;
      while ((m = pre.exec(text))) set[Number(m[1])] = true;
      if (Object.keys(set).length) { reliable = true; style = "parenthesized"; }
    }
    if (!reliable && !itemCue) {
      var plain = /(?:^|\n)\s*(\d+)\s*[.)]\s+/g;
      while ((m = plain.exec(text))) set[Number(m[1])] = true;
      if (Object.keys(set).length) style = "ambiguous_numeric";
    }
    // 번호 없는 단일 본문은 제1항일 수 있지만, 추출기가 자동번호를 잃었을 수도 있다.
    // 누락 판정에는 쓰지 않고 구조 표시용으로만 암묵 1항을 둔다.
    if (!Object.keys(set).length) set[1] = true;
    return { set: set, reliable: reliable, style: style };
  }
  function _items(text) {
    var set = {}, m, reliable = false, re = /(?:^|\n)\s*제\s*(\d+)\s*호\s*/g;
    while ((m = re.exec(text))) { set[Number(m[1])] = true; reliable = true; }
    var cue = /다음\s+각\s*호|각\s*호의/.test(text);
    var numeric = /(?:^|\n)\s*(?:\((\d+)\)|(\d+)\s*[.)])\s+/g;
    while ((m = numeric.exec(text))) set[Number(m[1] || m[2])] = true;
    if (cue && Object.keys(set).length) reliable = true;
    return { set: set, reliable: reliable };
  }
  function _isExternal(text, index) {
    return EXTERNAL_BEFORE_RE.test(text.slice(Math.max(0, index - 45), index));
  }
  function _stableId(ruleId, clauseIndex, target) {
    return "IF-" + ruleId + "-" + String(clauseIndex) + "-" + String(target || "none").replace(/[^A-Za-z0-9가-힣_-]/g, "");
  }
  function _finding(ruleId, severity, confidence, title, detail, clauseIndex, heading, extra) {
    var target = extra && extra.target || "";
    return Object.assign({ id: _stableId(ruleId, clauseIndex, target), rule_id: ruleId,
      source: "integrity_rule", category: ruleId.indexOf("ATT") !== -1 ? "attachment" :
        (ruleId.indexOf("REF") !== -1 ? "reference" : "structure"),
      scope: "clause", severity: severity, confidence: confidence, title: title, detail: detail,
      clause_index: clauseIndex, heading: heading || "", anchors: [{ document: "main",
        clause_index: clauseIndex, heading: heading || "" }] }, extra || {});
  }
  function analyze(text, clauses, opts) {
    opts = opts || {};
    var model=DS.inspect(text,opts.structure,opts.boundaries),sectionById={};
    model.sections.forEach(function(s){sectionById[s.id]=s;});
    var originalText=text;
    text = _normalize(text);
    clauses = _structureClauses(clauses && clauses.length ? clauses : [{heading:"",body:text,index:0}],model,originalText);
    var items = [], articles = {}, articleList = [], clauseSections = {}, section = "main", limitations = [];
    (clauses || []).forEach(function (c, index) {
      section=c.section||"main";
      clauseSections[index] = section;
      if(sectionById[section]&&sectionById[section].kind==='excluded')return;
      var info = _articleHeading(_headingText(c));
      if (info) {
        var simpleKey = articleKey(info.number, info.sub);
        var key = articleKey(info.number, info.sub, section);
        var structuralText = (info.remainder ? info.remainder + "\n" : "") + String(c && c.body || "");
        var a = { key: key, simple_key: simpleKey, section: section,
          number: Number(info.number), sub: info.sub ? Number(info.sub) : null,
          clause_index: typeof c.index === "number" ? c.index : index, heading: _headingText(c),
          text: _bodyText(c), structural_text: structuralText, paragraphs: _paragraphs(structuralText),
          items: _items(structuralText), substantive: !!structuralText.trim(),
          heading_prefix_length: info.prefixLength, explicit: info.explicit,source:c.source,line:c.line };
        if (articles[key]) {
          // 본문 중 독립된 '제1조' 참조가 세그먼트로 잘린 경우에는 중복 조항으로 단정하지 않는다.
          if (articles[key].substantive && a.substantive && articles[key].explicit && a.explicit) {
            items.push(_finding("NUM-01", "중요", "high", "조 번호 중복",
              (sectionById[section]||{}).label + "에 동일한 제" + info.number + "조" +
              (info.sub ? "의" + info.sub : "") + "가 두 번 존재합니다.",
              a.clause_index, a.heading, { target: key, section: section,
                anchors: [{ document: "main", clause_index: articles[key].clause_index, heading: articles[key].heading },
                  { document: "main", clause_index: a.clause_index, heading: a.heading }] }));
          }
          if (!articles[key].substantive && a.substantive) articles[key] = a;
        } else articles[key] = a;
        articleList.push(a);
      }
    });

    // XML 선택분기·텍스트상자 등의 동일 내용이 두 번 추출되면 조 번호 중복을 사실 오류로
    // 오인하지 않는다. 두 개 이상 조문이 동일 반복되거나 긴 조문 하나가 통째로 반복되면
    // 파싱 품질 신호 하나만 남기고 그로부터 파생된 번호·인용 경고를 중단한다.
    var fp = {}, repeated = 0, repeatedLong = false;
    articleList.forEach(function (a) {
      var norm = String(a.structural_text || "").replace(/\s+/g, "").replace(/[“”‘’'".,;:·ㆍ]/g, "");
      if (norm.length < 12) return;
      var k = a.section + "|" + a.simple_key + "|" + norm;
      if (fp[k]) { repeated++; if (norm.length >= 100) repeatedLong = true; }
      fp[k] = true;
    });
    var extractionDuplicate = repeated >= 2 || repeatedLong;
    var explicitCount=articleList.filter(function(a){return a.explicit&&a.substantive;}).length;
    var lostLabels=model.lines.filter(function(l){return !l.boundary&&/^\s*(?:조\s*)?[([【][^\n)\]】]+[)\]】]\s*$/.test(l.text);}).length;
    var sectionCounts={};
    articleList.forEach(function(a){if(a.explicit&&a.substantive)sectionCounts[a.section]=(sectionCounts[a.section]||0)+1;});
    var uncertainSections={};model.lines.forEach(function(l){if(l.numbering&&l.numbering.confirmed===false)uncertainSections[l.section]=true;});
    var extractionIncomplete=model.warnings.some(function(w){return /실패|텍스트층이 없는|잘림/.test(w);});
    var reliable = explicitCount >= 2 && !lostLabels && !extractionDuplicate && !/�/.test(text) && !extractionIncomplete;
    if (!reliable) limitations.push(extractionDuplicate ? "동일 본문 반복 추출로 번호 구조를 신뢰하기 어렵습니다." :
      "조 번호의 층위 또는 추출 보존 상태가 불확실하여 조·항·호의 부재를 자동 판단하지 않았습니다.");
    var unresolved=0;

    // 모든 segment를 인용 출처로 검사한다. 조 정의가 아닌 segment도 앞 조문 본문의
    // 일부일 수 있으므로 누락시키지 않는다.
    (clauses || []).forEach(function (clause, sourceIndex) {
      var sourceText = _bodyText(clause);
      var sourceHeading = _headingText(clause);
      var headingMatch = _articleHeading(sourceHeading);
      var sourceSection = clauseSections[sourceIndex] || "main";
      if(sectionById[sourceSection]&&sectionById[sourceSection].kind==='excluded')return;
      if(uncertainSections[sourceSection]){unresolved++;return;}
      var sourceKey = headingMatch ? articleKey(headingMatch.number, headingMatch.sub, sourceSection) : "";
      var clauseIndex = typeof clause.index === "number" ? clause.index : sourceIndex;
      REF_RE.lastIndex = 0;
      var m;
      while ((m = REF_RE.exec(sourceText))) {
        // 조항 표제 자신의 번호는 인용이 아니다.
        if (headingMatch && m.index < headingMatch.prefixLength &&
            articleKey(m[1], m[2], sourceSection) === sourceKey) continue;
        if (_isExternal(sourceText, m.index)) continue;
        var simple = articleKey(m[1], m[2]);
        var referenceSection=sourceSection,prefix=sourceText.slice(Math.max(0,m.index-100),m.index);
        var named=/(별첨|별표|별지|붙임|부록|첨부|Annex|Appendix)\s*(?:제\s*)?([0-9]+(?:[-.][0-9]+)*|[A-Z])\s*(?:호)?\s*(?:의\s*)?$/i.exec(prefix);
        if(/(?:본\s*계약(?:서)?|본문)\s*(?:의\s*)?$/.test(prefix))referenceSection='main';
        if(named){var token=named[1].toLowerCase()+named[2],scopes=model.sections.filter(function(s){return s.token===token;});
          if(scopes.length!==1){unresolved++;continue;}referenceSection=scopes[0].id;}
        if(sectionById[referenceSection]&&sectionById[referenceSection].kind==='excluded'){unresolved++;continue;}
        var key = articleKey(m[1], m[2], referenceSection);
        if(uncertainSections[referenceSection]){unresolved++;continue;}
        var target = articles[key];
        // 이름 없는 인용의 타 구역 자동 승계는 하지 않는다.
        if(!target&&!named&&referenceSection===sourceSection&&articleList.some(function(a){return a.simple_key===simple&&a.section!==sourceSection;})){unresolved++;continue;}
        var targetLabel = "제" + Number(m[1]) + "조" + (m[2] ? "의" + Number(m[2]) : "");
        if (!target) {
          if(!reliable || (sectionCounts[referenceSection]||0)<2){unresolved++;continue;}
          items.push(_finding("REF-01", "중요", "high", "내부 인용 대상 확인",
            sourceHeading + "에서 " + targetLabel + "를 인용하지만 인식된 조 표제에서 찾지 못했습니다. 원문 또는 별도 계약의 인용인지 확인하세요.",
            clauseIndex, sourceHeading, { target: key, reference_text: m[0] }));
          continue;
        }
        if (m[3] && target.paragraphs.set[Number(m[3])]) {
          // 표지 형식이 달라도 실제 번호가 있으면 존재 확인으로 충분하다.
        } else if (m[3] && (!reliable || !target.paragraphs.reliable)) {
          items.push(_finding("REF-02U", "일반", "medium", "항 번호 추출 상태 확인",
            targetLabel + "의 항 번호가 원문에서 보존되었는지 확인할 수 없어 제" + Number(m[3]) + "항의 존재 여부를 자동판정하지 않았습니다.",
            clauseIndex, sourceHeading, { target: key + "-p-unknown", reference_text: m[0] }));
        } else if (m[3] && !target.paragraphs.set[Number(m[3])]) {
          items.push(_finding("REF-02", "중요", "high", "내부 인용 항 확인",
            sourceHeading + "에서 " + targetLabel + " 제" + Number(m[3]) + "항을 인용하지만 추출된 항 표지에서 찾지 못했습니다. 원문과 대조하세요.",
            clauseIndex, sourceHeading, { target: key + "-p" + Number(m[3]), reference_text: m[0],
              anchors: [{ document: "main", clause_index: clauseIndex, heading: sourceHeading },
                { document: "main", clause_index: target.clause_index, heading: target.heading }] }));
        } else if (m[4] && target.items.set[Number(m[4])]) {
          // 실제 호 번호 확인됨.
        } else if (m[4] && (!reliable || !target.items.reliable)) {
          items.push(_finding("REF-03U", "일반", "medium", "호 번호 추출 상태 확인",
            targetLabel + "의 숫자 표지가 항·호 중 어느 층위인지 불명확해 제" + Number(m[4]) + "호의 존재 여부를 자동판정하지 않았습니다.",
            clauseIndex, sourceHeading, { target: key + "-i-unknown", reference_text: m[0] }));
        } else if (m[4] && !target.items.set[Number(m[4])]) {
          items.push(_finding("REF-03", "중요", "high", "내부 인용 호 확인",
            sourceHeading + "에서 " + targetLabel + " 제" + Number(m[4]) + "호를 인용하지만 추출된 호 표지에서 찾지 못했습니다. 원문과 대조하세요.",
            clauseIndex, sourceHeading, { target: key + "-i" + Number(m[4]), reference_text: m[0],
              anchors: [{ document: "main", clause_index: clauseIndex, heading: sourceHeading },
                { document: "main", clause_index: target.clause_index, heading: target.heading }] }));
        }
      }
    });

    articleList.forEach(function (a) {
      if (/전항/.test(a.text) && a.paragraphs.reliable &&
          Object.keys(a.paragraphs.set).length === 1 && a.paragraphs.set[1]) {
        items.push(_finding("HIER-01", "일반", "medium", "전항 인용 구조 확인",
          a.heading + "에 ‘전항’ 표현이 있으나 앞선 항 번호가 확인되지 않습니다.",
          a.clause_index, a.heading, { target: a.key + "-previous" }));
      }
      if (/다음\s+각\s*호/.test(a.text) && !Object.keys(a.items.set).length) {
        items.push(_finding("HIER-02", "일반", "medium", "각 호 목록 누락 가능성",
          a.heading + "에 ‘다음 각 호’가 있으나 번호가 있는 하위 호를 찾지 못했습니다.",
          a.clause_index, a.heading, { target: a.key + "-items" }));
      }
    });

    // 자동 조 번호가 추출에서 유실된 문서는 개별 중복·누락을 만들지 않고 파싱 품질 문제로 격상한다.
    var bareArticleLabels = String(text || "").match(/(?:^|\n)\s*조\s*\([^\n)]+\)/g) || [];
    if (bareArticleLabels.length >= 2 && articleList.length < 2) {
      items.push(_finding("PARSE-01", "중요", "high", "조 번호 추출 실패 가능성",
        "조 표제는 여러 개 보이지만 제N조 번호가 보존되지 않았습니다. 자동번호 서식이 누락되었을 수 있어 문서 완결성 판정을 중단합니다.",
        0, _headingText((clauses || [])[0]), { target: "article-numbering", scope: "contract",
          anchors: [{ document: "main", clause_index: 0, heading: _headingText((clauses || [])[0]) }] }));
    }

    if (extractionDuplicate) {
      items = items.filter(function (item) {
        return !/^(NUM|REF|HIER)-/.test(item.rule_id);
      });
      items.push(_finding("PARSE-DUP", "중요", "high", "본문 중복 추출 가능성",
        "동일한 조문 내용이 반복 추출되었습니다. 조 번호·내부 인용 오류는 원문 구조를 신뢰할 수 없어 자동판정을 중단했습니다.",
        0, _headingText((clauses || [])[0]), { target: "duplicate-extraction", scope: "contract",
          anchors: [{ document: "main", clause_index: 0, heading: _headingText((clauses || [])[0]) }] }));
    }

    var attachments=model.sections.filter(function(s){return s.kind==='annex';}).map(function(s){return s.token;});
    (opts.subdocs||[]).forEach(function(d){var b=DS.boundary(String(d.name||'').replace(/\.[a-z0-9]+$/i,''));if(b)attachments.push(b.token);});
    var attRe = /(별첨|별표|별지|붙임)\s*(?:제\s*)?(\d+(?:[-.]\d+)*)\s*(?:호)?/g, am;
    while ((am = attRe.exec(String(text || "")))) {
      var token = am[1] + " " + am[2];
      if (attachments.indexOf(am[1]+am[2])!==-1)continue;
      var refLine=text.slice(0,am.index).split('\n').length-1;
      if(model.lines[refLine]&&model.lines[refLine].boundary)continue;
      var ci = 0, attachmentHeading = "";
      for (var j = 0; j < (clauses || []).length; j++) {
        if (_bodyText(clauses[j]).indexOf(am[0]) !== -1) { ci = clauses[j].index; attachmentHeading = _headingText(clauses[j]); break; }
      }
      items.push(_finding("ATT-01", "일반", "medium", "인용 별첨 확인 필요",
        token + "을 인용하지만 업로드된 부속서류나 본문 내 별첨 표제를 확인하지 못했습니다.",
        ci, attachmentHeading, { target: token, reference_text: am[0] }));
    }
    // 추출 불확실성은 오류 카드나 사람의 처리 의무로 만들지 않고 한 안내로 모은다.
    var uncertain=items.filter(function(item){return /^PARSE-|^REF-0[23]U$/.test(item.rule_id);});
    if(uncertain.length)limitations.push("일부 번호·본문 추출을 확정할 수 없어 관련 개별 경고를 생략했습니다.");
    items=items.filter(function(item){return !/^PARSE-|^REF-0[23]U$/.test(item.rule_id)&&
      !(item.section&&uncertainSections[item.section])&&
      (reliable || !/^(NUM|REF|HIER)-/.test(item.rule_id));});
    var seen = {};
    if(unresolved)limitations.push("일부 인용의 대상 구역을 확정하지 않았습니다.");
    return { format: "cr-document-integrity-v1", structure:model, assessment:{status:limitations.length?"limited":"checked",
      label:limitations.length?"자동 점검 범위 제한":"인식된 구조 점검",
      detail:limitations.length?limitations.join(" ")+" 오류 또는 검토 미완료를 뜻하지 않으며, 원본 완결성을 확인한 결과도 아닙니다.":
        "인식된 조 표제를 기준으로 점검했습니다. 원본 전체의 완결성 보증은 아닙니다.",
      article_count:articleList.length, explicit_article_count:explicitCount, section_count:model.sections.length,unresolved_reference_count:unresolved}, items: items.filter(function (item) {
      if (seen[item.id]) return false; seen[item.id] = true; return true;
    }) };
  }
  return { analyze: analyze, articleKey: articleKey };
})();
if (typeof module !== "undefined") module.exports = Integrity;
