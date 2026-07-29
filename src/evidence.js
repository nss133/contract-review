"use strict";
/* 제안사항 패널·조항별 보기 verify 항목 공용 — "근거 원문" 발췌 순수 함수.
   왜 이 체크가 이 조항에 떴는지: check.triggers.keywords ∪ check 텍스트 주요 어휘가
   조항 body와 겹치는 위치를 찾아 그 주변을 발췌하고, 겹친 어휘를 강조 표시한다.
   브라우저 전역 Evidence + node require 겸용(sim.js에 의존). */
if (typeof require !== "undefined") {
  var Sim = Sim || require("./sim.js");
}

var Evidence = (function () {
  var RADIUS = 60;      // 발췌 반경(겹침 발견 시 앞뒤 글자 수)
  var FALLBACK_LEN = 100; // 겹침 못 찾을 때 본문 앞부분 발췌 길이

  // check에서 겹침 탐색용 어휘 목록 — triggers.keywords 우선, 없으면 check 텍스트의 2글자+ 한글 어휘.
  function checkTerms(cp) {
    var kws = (cp.triggers && cp.triggers.keywords) || [];
    if (kws.length) return kws.slice();
    return Object.keys(Sim.keywords(String(cp.check || "")));
  }

  // body 안에서 terms 중 가장 먼저(앞에서부터) 발견되는 위치를 찾는다.
  // 반환: { term, index } 또는 못 찾으면 null.
  function _firstHit(body, terms) {
    var best = null;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      if (!term) continue;
      var idx = body.indexOf(term);
      if (idx === -1) continue;
      if (!best || idx < best.index) best = { term: term, index: idx };
    }
    return best;
  }

  // clause{heading, body}·cp{check, triggers}로 {heading, snippet(HTML, esc+mark 적용 완료)} 반환.
  // esc: app.js의 esc()와 동일한 이스케이프 함수를 주입받음(중복 방지).
  function evidenceSnippet(cp, clause, esc) {
    if (!clause) return null;
    var body = String(clause.body || "");
    var heading = clause.heading || "";
    if (!body) return { heading: heading, snippet: "" };

    var terms = checkTerms(cp).filter(function (t) { return t && t.length >= 2; });
    var hit = _firstHit(body, terms);

    if (!hit) {
      var head = body.slice(0, FALLBACK_LEN);
      return { heading: heading, snippet: esc(head) + (body.length > FALLBACK_LEN ? "…" : "") };
    }

    var start = Math.max(0, hit.index - RADIUS);
    var end = Math.min(body.length, hit.index + hit.term.length + RADIUS);
    var before = body.slice(start, hit.index);
    var mid = body.slice(hit.index, hit.index + hit.term.length);
    var after = body.slice(hit.index + hit.term.length, end);

    var snippet = (start > 0 ? "…" : "") + esc(before) + "<mark>" + esc(mid) + "</mark>" + esc(after) +
      (end < body.length ? "…" : "");
    return { heading: heading, snippet: snippet };
  }

  return { evidenceSnippet: evidenceSnippet, checkTerms: checkTerms };
})();

if (typeof module !== "undefined") module.exports = Evidence;
