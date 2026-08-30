"use strict";
/* 계약서 자체의 구조·내부 인용 완결성 검사. 법률 판단이나 외부 법령 유효성 검사는 하지 않는다. */
var Integrity = (function () {
  // segmenter가 문장 첫머리의 "제2조에 따른다"도 별도 조각으로 나눌 수 있으므로
  // 실제 표제(제N조 또는 제N조(표제))만 조 정의로 인정한다.
  var ARTICLE_BARE_RE = /^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?\s*$/;
  var ARTICLE_TITLE_RE = /^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?\s*\([^\n)]+\)([\s\S]*)$/;
  var REF_RE = /제\s*(\d+)\s*조(?:의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/g;
  var EXTERNAL_BEFORE_RE = /(?:법|법률|시행령|시행규칙|감독규정|규정|고시|규칙|모범규준)\s*$/;
  var CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

  function articleKey(n, sub) { return String(Number(n)) + (sub ? "-" + String(Number(sub)) : ""); }
  function _articleHeading(text) {
    var m = ARTICLE_TITLE_RE.exec(String(text || ""));
    if (m) return { number: m[1], sub: m[2], remainder: String(m[3] || "").trim(), prefixLength: m[0].length - String(m[3] || "").length };
    m = ARTICLE_BARE_RE.exec(String(text || ""));
    return m ? { number: m[1], sub: m[2], remainder: "", prefixLength: m[0].length } : null;
  }
  function _headingText(c) { return String(c && c.heading || ""); }
  function _bodyText(c) { return _headingText(c) + "\n" + String(c && c.body || ""); }
  function _paragraphs(text) {
    var set = {}, m, re = /(?:^|\n)\s*제\s*(\d+)\s*항/g, reliable = false;
    while ((m = re.exec(text))) { set[Number(m[1])] = true; reliable = true; }
    var cre = /(?:^|\n)\s*([①-⑳])/g;
    while ((m = cre.exec(text))) { set[CIRCLED.indexOf(m[1]) + 1] = true; reliable = true; }
    // 번호 없는 단일 본문은 제1항일 수 있지만, 추출기가 자동번호를 잃었을 수도 있다.
    // 누락 판정에는 쓰지 않고 구조 표시용으로만 암묵 1항을 둔다.
    if (!Object.keys(set).length) set[1] = true;
    return { set: set, reliable: reliable };
  }
  function _items(text) {
    var set = {}, m, re = /(?:^|\n)\s*(?:제\s*)?(\d+)\s*(?:호|[.)])\s+/g;
    while ((m = re.exec(text))) set[Number(m[1])] = true;
    return set;
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
    var items = [], articles = {}, articleList = [];
    (clauses || []).forEach(function (c, index) {
      var info = _articleHeading(_headingText(c));
      if (!info) return;
      var key = articleKey(info.number, info.sub);
      var structuralText = (info.remainder ? info.remainder + "\n" : "") + String(c && c.body || "");
      var a = { key: key, number: Number(info.number), sub: info.sub ? Number(info.sub) : null,
        clause_index: typeof c.index === "number" ? c.index : index, heading: _headingText(c),
        text: _bodyText(c), paragraphs: _paragraphs(structuralText), items: _items(structuralText),
        substantive: !!structuralText.trim(), heading_prefix_length: info.prefixLength };
      if (articles[key]) {
        // 본문 중 독립된 '제1조' 참조가 세그먼트로 잘린 경우에는 중복 조항으로 단정하지 않는다.
        if (articles[key].substantive && a.substantive) {
          items.push(_finding("NUM-01", "중요", "high", "조 번호 중복",
            "동일한 제" + info.number + "조" + (info.sub ? "의" + info.sub : "") + "가 두 번 존재합니다.",
            a.clause_index, a.heading, { target: key,
              anchors: [{ document: "main", clause_index: articles[key].clause_index, heading: articles[key].heading },
                { document: "main", clause_index: a.clause_index, heading: a.heading }] }));
        }
        if (!articles[key].substantive && a.substantive) articles[key] = a;
      } else articles[key] = a;
      articleList.push(a);
    });

    // 모든 segment를 인용 출처로 검사한다. 조 정의가 아닌 segment도 앞 조문 본문의
    // 일부일 수 있으므로 누락시키지 않는다.
    (clauses || []).forEach(function (clause, sourceIndex) {
      var sourceText = _bodyText(clause);
      var sourceHeading = _headingText(clause);
      var headingMatch = _articleHeading(sourceHeading);
      var sourceKey = headingMatch ? articleKey(headingMatch.number, headingMatch.sub) : "";
      var clauseIndex = typeof clause.index === "number" ? clause.index : sourceIndex;
      REF_RE.lastIndex = 0;
      var m;
      while ((m = REF_RE.exec(sourceText))) {
        // 조항 표제 자신의 번호는 인용이 아니다.
        if (headingMatch && m.index < headingMatch.prefixLength && articleKey(m[1], m[2]) === sourceKey) continue;
        if (_isExternal(sourceText, m.index)) continue;
        var key = articleKey(m[1], m[2]);
        var target = articles[key];
        var targetLabel = "제" + Number(m[1]) + "조" + (m[2] ? "의" + Number(m[2]) : "");
        if (!target) {
          items.push(_finding("REF-01", "중요", "high", "존재하지 않는 조항 인용",
            sourceHeading + "에서 " + targetLabel + "를 인용하지만 해당 조항이 없습니다.",
            clauseIndex, sourceHeading, { target: key, reference_text: m[0] }));
          continue;
        }
        if (m[3] && !target.paragraphs.reliable) {
          items.push(_finding("REF-02U", "일반", "medium", "항 번호 추출 상태 확인",
            targetLabel + "의 항 번호가 원문에서 보존되었는지 확인할 수 없어 제" + Number(m[3]) + "항의 존재 여부를 자동판정하지 않았습니다.",
            clauseIndex, sourceHeading, { target: key + "-p-unknown", reference_text: m[0] }));
        } else if (m[3] && !target.paragraphs.set[Number(m[3])]) {
          items.push(_finding("REF-02", "중요", "high", "존재하지 않는 항 인용",
            sourceHeading + "에서 " + targetLabel + " 제" + Number(m[3]) + "항을 인용하지만 해당 항이 없습니다.",
            clauseIndex, sourceHeading, { target: key + "-p" + Number(m[3]), reference_text: m[0],
              anchors: [{ document: "main", clause_index: clauseIndex, heading: sourceHeading },
                { document: "main", clause_index: target.clause_index, heading: target.heading }] }));
        } else if (m[4] && !target.items[Number(m[4])]) {
          items.push(_finding("REF-03", "중요", "high", "존재하지 않는 호 인용",
            sourceHeading + "에서 " + targetLabel + " 제" + Number(m[4]) + "호를 인용하지만 해당 호가 없습니다.",
            clauseIndex, sourceHeading, { target: key + "-i" + Number(m[4]), reference_text: m[0],
              anchors: [{ document: "main", clause_index: clauseIndex, heading: sourceHeading },
                { document: "main", clause_index: target.clause_index, heading: target.heading }] }));
        }
      }
    });

    articleList.forEach(function (a) {
      if (/전항/.test(a.text) && Object.keys(a.paragraphs.set).length === 1 && a.paragraphs.set[1]) {
        items.push(_finding("HIER-01", "일반", "medium", "전항 인용 구조 확인",
          a.heading + "에 ‘전항’ 표현이 있으나 앞선 항 번호가 확인되지 않습니다.",
          a.clause_index, a.heading, { target: a.key + "-previous" }));
      }
      if (/다음\s+각\s*호/.test(a.text) && !Object.keys(a.items).length) {
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

    var subNames = (opts.subdocs || []).map(function (d) { return String(d.name || ""); }).join(" ");
    var attRe = /(별첨|별표|별지|붙임)\s*(?:제\s*)?(\d+)\s*(?:호)?/g, am;
    while ((am = attRe.exec(String(text || "")))) {
      var token = am[1] + " " + am[2];
      var occurrences = String(text || "").split(new RegExp(am[1] + "\\s*(?:제\\s*)?" + am[2], "g")).length - 1;
      if (occurrences > 1 || subNames.indexOf(am[1]) !== -1 || subNames.indexOf(am[2]) !== -1) continue;
      var ci = 0;
      for (var j = 0; j < (clauses || []).length; j++) {
        if (_bodyText(clauses[j]).indexOf(am[0]) !== -1) { ci = j; break; }
      }
      items.push(_finding("ATT-01", "일반", "medium", "인용 별첨 확인 필요",
        token + "을 인용하지만 업로드된 부속서류나 본문 내 별첨 표제를 확인하지 못했습니다.",
        ci, _headingText((clauses || [])[ci]), { target: token, reference_text: am[0] }));
    }
    var seen = {};
    return { format: "cr-document-integrity-v1", items: items.filter(function (item) {
      if (seen[item.id]) return false; seen[item.id] = true; return true;
    }) };
  }
  return { analyze: analyze, articleKey: articleKey };
})();
if (typeof module !== "undefined") module.exports = Integrity;
