"use strict";
/* 조항별 검토의견(verdict) 순수 로직 — 계약서 건별 판정 축.
   '검수'(verified: 지식 정확성)와는 완전 별개. 이건 "이 계약서의 이 항목은
   이상없음/검토의견/해당없음" 이라는 검토자 의견을 건별로 축적한다.
   브라우저 전역 Verdict + node require 겸용. */
var Verdict = (function () {
  var VERDICTS = ["이상없음", "검토의견", "해당없음"];

  function verdictKey(hash) { return "cr-verdict-" + hash; }

  function _clone(store) {
    var out = {};
    for (var k in store) if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
    return out;
  }

  // verdict가 빈값/null이면 판정 취소(삭제). 허용 안 되는 값이면 원본 유지.
  function setVerdict(store, cpId, verdict, comment, date) {
    var next = _clone(store || {});
    if (!verdict) { delete next[cpId]; return next; }
    if (VERDICTS.indexOf(verdict) === -1) return store || {};
    next[cpId] = { verdict: verdict, comment: comment || "", date: date || "" };
    return next;
  }

  function verdictSummary(store) {
    var sum = { "이상없음": 0, "검토의견": 0, "해당없음": 0, total: 0 };
    store = store || {};
    for (var k in store) {
      if (!Object.prototype.hasOwnProperty.call(store, k)) continue;
      var v = store[k] && store[k].verdict;
      if (VERDICTS.indexOf(v) !== -1) { sum[v]++; sum.total++; }
    }
    return sum;
  }

  function exportVerdicts(store, meta) {
    return { meta: meta || {}, verdicts: _clone(store || {}) };
  }

  // 구조 검증: verdicts dict만 신뢰, 각 항목의 verdict 값이 유효한 것만 통과.
  function importVerdicts(obj) {
    if (!obj || typeof obj !== "object") return {};
    var v = obj.verdicts;
    if (!v || typeof v !== "object") return {};
    var out = {};
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      var item = v[k];
      if (item && VERDICTS.indexOf(item.verdict) !== -1) {
        out[k] = { verdict: item.verdict, comment: item.comment || "", date: item.date || "" };
      }
    }
    return out;
  }

  // 일괄 판정(코멘트 포함): cpIds 중 '미판정'인 것만 verdict+comment로 채움 — 이미 찍은 판정(예외 지정분)은 보존.
  // 반환: { store, applied } — applied는 실제 채워진 개수.
  function bulkVerdictComment(store, cpIds, verdict, comment, date) {
    if (VERDICTS.indexOf(verdict) === -1) return { store: store || {}, applied: 0 };
    var next = _clone(store || {});
    var applied = 0;
    (cpIds || []).forEach(function (id) {
      if (next[id] && next[id].verdict) return; // 기판정 보존
      next[id] = { verdict: verdict, comment: comment || "", date: date || "" };
      applied++;
    });
    return { store: next, applied: applied };
  }

  // 일괄 판정(통과계약 모드) — 코멘트 없는 bulkVerdictComment.
  function bulkVerdict(store, cpIds, verdict, date) {
    return bulkVerdictComment(store, cpIds, verdict, "", date);
  }

  // 일괄 판정 해제(자동 기재 취소용): cpIds 중 verdict·comment가 '원형 그대로'인 항목만 제거 —
  // 판정이나 코멘트를 사람이 손댄 항목은 자동 생성분으로 보지 않고 보존.
  // 반환: { store, removed } — removed는 실제 제거된 개수.
  function revertBulkVerdict(store, cpIds, verdict, comment) {
    var next = _clone(store || {});
    var removed = 0;
    (cpIds || []).forEach(function (id) {
      var v = next[id];
      if (v && v.verdict === verdict && (v.comment || "") === (comment || "")) {
        delete next[id];
        removed++;
      }
    });
    return { store: next, removed: removed };
  }

  // 종합 검토의견 저장키 — 계약서 해시별(verdictKey와 동일 패턴, 별도 축).
  function opinionKey(hash) { return "cr-opinion-" + hash; }

  // 종합 검토의견 자동 초안 조립 — 룰 기반 문장 조립(LLM 아님), ~음/~함 기술식.
  // 사용자 코멘트 인용부만 '…'(U+2018/2019)로 감쌈 — 렌더 측이 이 구간을 형광 강조.
  // 라벨·제목은 「…」로 구분(강조 대상 아님).
  // data: { name, clauseCount, typeName, mustCoreLabels: [label...],
  //         opinions: [{label, severity, loc, comment}...], formalWarnTitles: [title...] }
  function composeOpinion(d) {
    d = d || {};
    var SEV = { "필수": 0, "권장": 1, "참고": 2 };
    var sents = [];
    // 1문장: 전반 상태 — 계약명·조항수·유형 + 필수 확인 상태
    var mustLabels = d.mustCoreLabels || [];
    sents.push((d.name || "계약서") + "(" + (d.clauseCount || 0) + "개 조항, " +
      (d.typeName ? d.typeName + " 유형" : "유형 미확정") + ") 검토 결과 " +
      (mustLabels.length
        ? "필수 확인사항 중 " + mustLabels.length + "건이 계약서에서 확인되지 않음."
        : "필수 확인사항은 관련 조항에 반영되어 있음."));
    // 2문장~: 검토의견 코멘트 인용 — 필수·권장 순 최대 3건 + "외 N건"
    var ops = (d.opinions || []).slice().sort(function (a, b) {
      var ra = SEV[a.severity]; if (ra === undefined) ra = 3;
      var rb = SEV[b.severity]; if (rb === undefined) rb = 3;
      return ra - rb;
    });
    // 조항 위치 축약 — 표제가 "제N조(제목) 본문…" 형태로 길어도 조번호(+제목)만 인용.
    function _shortLoc(loc) {
      var s = String(loc || "").trim();
      // 특정 조항에 귀속되지 않는 의견(세그먼터 내부 라벨·전반 지칭)은 빈 값으로 —
      // 문장에서 "계약서 전체를 기준으로 볼 때"로 표현(2026-07-30 피드백).
      if (!s || s === "(전문)" || s === "(전체)" || s === "계약서 전반") return "";
      var m = s.match(/^제\s?\d+\s?조(?:의\s?\d+)?\s?(?:\([^)]*\))?/);
      if (m) return m[0];
      return s.length > 24 ? s.slice(0, 24) + "…" : s;
    }
    ops.slice(0, 3).forEach(function (o, i) {
      var c = String(o.comment || "").trim();
      if (c.length > 80) c = c.slice(0, 80) + "…";
      var loc = _shortLoc(o.loc);
      sents.push((i === 0 ? "다만, " : "또한 ") +
        (loc ? loc + " 관련 " : "계약서 전체를 기준으로 볼 때 ") +
        "「" + (o.label || "") + "」에 대하여 " + (c ? "‘" + c + "’ " : "") +
        "의견이 있어 보완 필요함.");
    });
    if (ops.length > 3) sents.push("외 검토의견 " + (ops.length - 3) + "건이 있음.");
    // 필수 미확인: 조항 신설 검토
    if (mustLabels.length) {
      sents.push("「" + mustLabels[0] + "」" + (mustLabels.length > 1 ? " 등 " + mustLabels.length + "건은" : " 항목은") +
        " 계약서에서 확인되지 않아 조항 신설 검토 요함.");
    }
    // 형식 경고 1줄
    var fw = d.formalWarnTitles || [];
    if (fw.length) {
      sents.push("형식 점검에서 「" + fw[0] + "」" + (fw.length > 1 ? " 등 " + fw.length + "건" : "") +
        " 경고가 있어 확인 요함.");
    }
    // 특이사항 전무
    if (!ops.length && !mustLabels.length && !fw.length) sents.push("전반적으로 특이사항 없음.");
    return sents.join(" ");
  }

  return {
    VERDICTS: VERDICTS,
    verdictKey: verdictKey,
    opinionKey: opinionKey,
    composeOpinion: composeOpinion,
    setVerdict: setVerdict,
    bulkVerdict: bulkVerdict,
    bulkVerdictComment: bulkVerdictComment,
    revertBulkVerdict: revertBulkVerdict,
    verdictSummary: verdictSummary,
    exportVerdicts: exportVerdicts,
    importVerdicts: importVerdicts
  };
})();

if (typeof module !== "undefined") module.exports = Verdict;
