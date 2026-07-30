"use strict";
/* 재검토 비교 순수 로직 — 구(아카이브)·신(현재) 계약의 조항 정렬·어절 diff·판정 이관 후보.
   설계: docs/superpowers/specs/2026-07-30-review-archive-compare.md
   브라우저 전역 Compare + node require 겸용. sim.js(Sim)에 의존 — JS_ORDER에서 sim 뒤. */
var Compare = (function () {
  var SimRef = typeof Sim !== "undefined" ? Sim
    : (typeof require !== "undefined" ? require("./sim.js") : null);

  // 매칭 임계(스펙 §조항 정렬): 0.60 미만 미매칭 / 0.95 이상 "동일".
  var MATCH_MIN = 0.60;
  var SAME_MIN = 0.95;
  // 대응 불확실: 유사도 매칭 경로에서 sim이 낮거나(0.75 미만) 차순위 후보와 동점권(0.05 이내).
  var UNCERTAIN_BELOW = 0.75;
  var UNCERTAIN_GAP = 0.05;

  // 조번호 추출 — "제7조"/"제7조의2" 정규화 문자열. 없으면 null((전문)·숫자 헤딩 등).
  function _clauseNo(heading) {
    var m = String(heading || "").match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
    if (!m) return null;
    return "제" + m[1] + "조" + (m[2] ? "의" + m[2] : "");
  }
  function _normHeading(heading) {
    return String(heading || "").replace(/\s+/g, " ").trim();
  }
  // 유사도용 텍스트 — 조번호("제N조")는 제거: 번호 이동만으로 유사도가 깎여
  // "이동"(내용 동일)이 "변경"으로 오분류되는 것을 막음(표제 문언·본문만 비교).
  function _clauseText(c) {
    return (String(c.heading || "") + " " + String(c.body || ""))
      .replace(/제\s*\d+\s*조(?:\s*의\s*\d+)?/g, " ");
  }

  // 매칭 쌍 분류: ≥0.95 동일(조번호 다르면 이동) / 미만 변경.
  function _kindOf(oldC, newC, sim) {
    if (sim >= SAME_MIN) {
      var on = _clauseNo(oldC.heading), nn = _clauseNo(newC.heading);
      if (on && nn && on !== nn) return "moved";
      return "same";
    }
    return "changed";
  }

  /* alignClauses(oldClauses, newClauses) → [{oldIdx, newIdx, kind, sim, uncertain}]
     kind: same|changed|moved|added|removed. 출력 순서: 신 계약 조항 순 → 삭제(구 조항 순).
     1) 조번호+표제 완전 일치 직결 → 2) 잔여 전 쌍 TF-IDF 코사인 greedy(임계 0.60). */
  function alignClauses(oldClauses, newClauses) {
    oldClauses = oldClauses || [];
    newClauses = newClauses || [];
    var entries = [];
    if (!oldClauses.length && !newClauses.length) return entries;

    // IDF 코퍼스: 구·신 전 조항 텍스트(전처리 후).
    var texts = oldClauses.concat(newClauses).map(function (c) {
      return SimRef.preprocess(_clauseText(c));
    });
    var model = SimRef.buildIdf(texts);
    var oldVecs = oldClauses.map(function (c, i) { return SimRef.tfidfVec(texts[i], model); });
    var newVecs = newClauses.map(function (c, j) {
      return SimRef.tfidfVec(texts[oldClauses.length + j], model);
    });
    function simAt(i, j) { return SimRef.cosine(oldVecs[i], newVecs[j]); }

    var oldUsed = {}, newUsed = {};
    var pairByNew = {}; // newIdx → {oldIdx, sim, viaHeading}

    // 1단계: 조번호+표제 완전 일치 직결(선착순 — 동일 표제 중복은 순서대로).
    var oldByHeading = {};
    oldClauses.forEach(function (c, i) {
      var h = _normHeading(c.heading);
      if (!oldByHeading[h]) oldByHeading[h] = [];
      oldByHeading[h].push(i);
    });
    newClauses.forEach(function (c, j) {
      var pool = oldByHeading[_normHeading(c.heading)];
      if (!pool) return;
      for (var k = 0; k < pool.length; k++) {
        if (oldUsed[pool[k]]) continue;
        oldUsed[pool[k]] = true; newUsed[j] = true;
        pairByNew[j] = { oldIdx: pool[k], sim: simAt(pool[k], j), viaHeading: true };
        return;
      }
    });

    // 2단계: 잔여 전 쌍 유사도 → greedy 최적 매칭(임계 이상만).
    var cands = [];
    for (var i = 0; i < oldClauses.length; i++) {
      if (oldUsed[i]) continue;
      for (var j = 0; j < newClauses.length; j++) {
        if (newUsed[j]) continue;
        var s = simAt(i, j);
        if (s >= MATCH_MIN) cands.push({ oldIdx: i, newIdx: j, sim: s });
      }
    }
    cands.sort(function (a, b) { return b.sim - a.sim; });
    cands.forEach(function (c) {
      if (oldUsed[c.oldIdx] || newUsed[c.newIdx]) return;
      oldUsed[c.oldIdx] = true; newUsed[c.newIdx] = true;
      // 동점권 차순위(다른 구 조항이 이 신 조항에 근접 유사) → 오정렬 가능성 표시.
      var gap = Infinity;
      cands.forEach(function (o) {
        if (o === c || o.newIdx !== c.newIdx || o.oldIdx === c.oldIdx) return;
        var d = c.sim - o.sim;
        if (d < gap) gap = d;
      });
      pairByNew[c.newIdx] = {
        oldIdx: c.oldIdx, sim: c.sim, viaHeading: false,
        uncertain: c.sim < UNCERTAIN_BELOW || gap < UNCERTAIN_GAP
      };
    });

    // 출력: 신 계약 순(매칭 분류 or 신설) → 삭제(구 조항 순).
    newClauses.forEach(function (c, j) {
      var p = pairByNew[j];
      if (!p) {
        entries.push({ oldIdx: null, newIdx: j, kind: "added", sim: 0, uncertain: false });
        return;
      }
      entries.push({
        oldIdx: p.oldIdx, newIdx: j,
        kind: _kindOf(oldClauses[p.oldIdx], c, p.sim),
        sim: p.sim,
        uncertain: !!p.uncertain
      });
    });
    oldClauses.forEach(function (c, i) {
      if (!oldUsed[i]) entries.push({ oldIdx: i, newIdx: null, kind: "removed", sim: 0, uncertain: false });
    });
    return entries;
  }

  /* diffWords(oldText, newText) → [{op:"eq"|"add"|"del", text}]
     어절(공백 분리) 단위 LCS diff — 공백 정규화(연속 공백·개행은 경계로만).
     연속 같은 op는 한 블록으로 병합(text는 공백 결합). */
  function _tokens(t) {
    var s = String(t || "").trim();
    return s ? s.split(/\s+/) : [];
  }
  function diffWords(oldText, newText) {
    var a = _tokens(oldText), b = _tokens(newText);
    var n = a.length, m = b.length;
    if (!n && !m) return [];
    // LCS 길이 DP — 조항 단위 텍스트라 O(n·m)로 충분.
    var dp = [];
    for (var i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--)
      for (var j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    // 역추적 → 원시 op 목록
    var raw = [];
    i = 0; var jj = 0;
    while (i < n && jj < m) {
      if (a[i] === b[jj]) { raw.push({ op: "eq", text: a[i] }); i++; jj++; }
      else if (dp[i + 1][jj] >= dp[i][jj + 1]) { raw.push({ op: "del", text: a[i] }); i++; }
      else { raw.push({ op: "add", text: b[jj] }); jj++; }
    }
    while (i < n) { raw.push({ op: "del", text: a[i] }); i++; }
    while (jj < m) { raw.push({ op: "add", text: b[jj] }); jj++; }
    // 같은 op 병합
    var out = [];
    raw.forEach(function (r) {
      var last = out[out.length - 1];
      if (last && last.op === r.op) last.text += " " + r.text;
      else out.push({ op: r.op, text: r.text });
    });
    return out;
  }

  /* carryVerdicts(oldVerdicts, mapping, checkResults) → 이관 후보 목록
     [{cpId, verdict, comment, date, basis:"same"|"consider", newIdx}]
     규칙(스펙 §판정 이관): "동일"(same·moved, 불확실 제외) 조항에 매칭된 체크만 —
     변경 조항은 이관하지 않음(참고 표시는 UI 몫). 부재 알람(consider)은 체크 id 기준.
     자동 확정 아님 — 수용(1클릭·일괄)은 호출 측이 처리. */
  function carryVerdicts(oldVerdicts, mapping, checkResults) {
    oldVerdicts = oldVerdicts || {};
    var sameNew = {}; // newIdx → true (same·moved & 확실)
    (mapping || []).forEach(function (e) {
      if ((e.kind === "same" || e.kind === "moved") && !e.uncertain && e.newIdx !== null)
        sameNew[e.newIdx] = true;
    });
    var out = [];
    (checkResults || []).forEach(function (r) {
      var old = oldVerdicts[r.cpId];
      if (!old || !old.verdict) return;
      if (r.coverage === "consider") {
        out.push({ cpId: r.cpId, verdict: old.verdict, comment: old.comment || "",
          date: old.date || "", basis: "consider", newIdx: null });
        return;
      }
      if (r.coverage !== "addressed" && r.coverage !== "verify") return;
      if (!r.best || !sameNew[r.best.clauseIndex]) return;
      out.push({ cpId: r.cpId, verdict: old.verdict, comment: old.comment || "",
        date: old.date || "", basis: "same", newIdx: r.best.clauseIndex });
    });
    return out;
  }

  return {
    alignClauses: alignClauses,
    diffWords: diffWords,
    carryVerdicts: carryVerdicts
  };
})();

if (typeof module !== "undefined") module.exports = Compare;
