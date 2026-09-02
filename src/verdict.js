"use strict";
/* 조항별 검토의견(verdict) 순수 로직 — 계약서 건별 판정 축.
   '검수'(verified: 지식 정확성)와는 완전 별개. 이건 "이 계약서의 이 항목은
   이상없음/검토의견" 이라는 검토자 의견을 건별로 축적한다.
   브라우저 전역 Verdict + node require 겸용.

   판정 체계(14.1차 재구성, 사용자 피드백):
     이상없음 ─ 사유(reason, 선택): 반영되어 있음 | 해당사항 없음 |
       회사에 유리·불리하지 않음 | 수용 가능한 위험 | (미선택)
     검토의견 ─ 코멘트 필수 성격
   구 '해당없음'은 독립 판정에서 폐기됨 — "우리 케이스와 해당사항이 없어서 이상없다"는
   경우를 '해당없음'으로 찍게 되어 곤란했음(체크 자체가 부적절하다는 뜻으로 오독).
   해당사항 없음은 **이상없음의 사유**로 격하. 기존 저장분은 로드 시 자동 이관. */
var Verdict = (function () {
  var VERDICTS = ["이상없음", "검토의견"];
  // 저장·교환 포맷은 기존 값을 유지하고 화면에서만 행동을 풀어 쓴다.
  var ACTION_DISPOSITIONS = ["수정요청", "삭제요청", "유지", "계약외조치", "비적용", "보류"];
  var ACTION_DISPOSITION_LABELS = {
    "수정요청": "계약서 수정 요청",
    "삭제요청": "문제 문구 삭제 요청",
    "유지": "현 문구 유지",
    "계약외조치": "별도 자료·절차로 확인",
    "비적용": "이 계약에는 해당 없음",
    "보류": "추가 확인 후 결정"
  };
  // 이상없음의 사유(선택). 빈 문자열 = 미선택.
  var OK_REASONS = ["반영되어 있음", "해당사항 없음",
    "회사에 유리·불리하지 않음", "수용 가능한 위험"];
  // 구 UI에서 선택한 값은 기록 손실 없이 읽되 새 판정 선택지에는 노출하지 않는다.
  // 계약 반영 필요성은 matcher의 contract_requirement에서 선행 라우팅한다.
  var LEGACY_OK_REASONS = ["계약 반영 불필요"];
  var LEGACY_NA = "해당없음"; // 구 판정값 — 이상없음 + '해당사항 없음'으로 이관
  var LEGACY_SUBDOC_COMMENT = "표준 개인(신용)정보 보안관리약정서(2025.01) 체결로 반영 — 별첨 체결·간인 확인";
  var CURRENT_SUBDOC_COMMENT = "표준 개인(신용)정보 보안관리약정서 적용으로 관련 문서화 항목 반영";
  // "auto" = 시스템 자동 기재(참고 항목 매칭 확인 등) — 사람 판정과 구분해 코퍼스 집계됨.
  var ORIGINS = ["manual", "bulk", "subdoc", "prior_review", "llm_draft", "legacy", "auto"];

  function verdictKey(hash) { return "cr-verdict-" + hash; }

  function _clone(store) {
    var out = {};
    for (var k in store) if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
    return out;
  }

  // 구 판정값 이관 — '해당없음' → 이상없음 + 사유 '해당사항 없음'.
  // 저장분·내보내기 파일 어디서 들어오든 이 함수를 거쳐 현행 체계로 정규화한다.
  function migrateItem(item) {
    if (!item) return null;
    var v = item.verdict, reason = item.reason || "";
    if (v === LEGACY_NA) { v = "이상없음"; reason = reason || "해당사항 없음"; }
    if (VERDICTS.indexOf(v) === -1) return null;
    if (v !== "이상없음") reason = ""; // 사유는 이상없음 전용
    if (reason && OK_REASONS.indexOf(reason) === -1 && LEGACY_OK_REASONS.indexOf(reason) === -1) reason = "";
    var origin = ORIGINS.indexOf(item.origin) !== -1 ? item.origin : "legacy";
    var actionDisposition = ACTION_DISPOSITIONS.indexOf(item.action_disposition) !== -1
      ? item.action_disposition : "";
    var comment = item.comment || "";
    // 과거 시스템이 자동 생성한 정확한 원문만 범위 변경에 맞춰 이관한다.
    // 검토자가 작성·수정한 일반 코멘트는 일절 치환하지 않는다.
    if (comment === LEGACY_SUBDOC_COMMENT) comment = CURRENT_SUBDOC_COMMENT;
    return { verdict: v, reason: reason, comment: comment, date: item.date || "", origin: origin,
      action_disposition: actionDisposition };
  }
  // 저장소 전체 정규화(로드 직후 1회).
  function migrateStore(store) {
    var out = {};
    for (var k in store || {}) {
      if (!Object.prototype.hasOwnProperty.call(store, k)) continue;
      var m = migrateItem(store[k]);
      if (m) out[k] = m;
    }
    return out;
  }

  // verdict가 빈값/null이면 판정 취소(삭제). 허용 안 되는 값이면 원본 유지.
  // reason은 이상없음일 때만 유효(그 외에는 무시).
  function setVerdict(store, cpId, verdict, comment, date, reason, origin) {
    var next = _clone(store || {});
    if (!verdict) { delete next[cpId]; return next; }
    var previousAction = next[cpId] && next[cpId].action_disposition || "";
    var m = migrateItem({ verdict: verdict, reason: reason, comment: comment, date: date,
      origin: origin || "manual", action_disposition: previousAction });
    if (!m) return store || {};
    next[cpId] = m;
    return next;
  }
  function setActionDisposition(store, cpId, actionDisposition) {
    var cur = (store || {})[cpId];
    if (!cur || !cur.verdict) return store || {};
    if (actionDisposition && ACTION_DISPOSITIONS.indexOf(actionDisposition) === -1) return store || {};
    var next = _clone(store);
    next[cpId] = Object.assign({}, cur, { action_disposition: actionDisposition || "",
      origin: cur.origin === "auto" ? "manual" : (cur.origin || "manual") });
    return next;
  }
  // 사유만 변경(판정은 유지). 이상없음이 아니면 무시.
  // 자동 기재분(origin auto)의 사유를 사람이 바꾸면 사람 판정(manual)으로 승격 —
  // 이후 재분석의 자동 회수 대상에서 제외(사람 손댄 판정 보존 원칙).
  function setReason(store, cpId, reason) {
    var cur = (store || {})[cpId];
    if (!cur || cur.verdict !== "이상없음") return store || {};
    var next = _clone(store);
    next[cpId] = { verdict: cur.verdict, reason: OK_REASONS.indexOf(reason) !== -1 ? reason : "",
      comment: cur.comment || "", date: cur.date || "",
      origin: cur.origin === "auto" ? "manual" : (cur.origin || "legacy"),
      action_disposition: cur.action_disposition || "" };
    return next;
  }

  // 자동 기재분 회수(12차): origin이 'auto'인 항목 중 keepIds에 없는 것을 제거.
  // 사람이 판정·코멘트·사유를 손대면 origin이 manual로 바뀌므로 여기 걸리지 않음.
  // 자동 기재 코멘트는 문장 인용을 담아 계약서마다 달라 comment 대조로는 회수 불가 — origin 기준.
  function revertAutoVerdicts(store, keepIds) {
    var keep = {};
    (keepIds || []).forEach(function (id) { keep[id] = true; });
    var next = _clone(store || {});
    var removed = 0;
    for (var k in next) {
      if (!Object.prototype.hasOwnProperty.call(next, k)) continue;
      if (next[k].origin === "auto" && !keep[k]) { delete next[k]; removed++; }
    }
    return { store: next, removed: removed };
  }

  // 자동 이상없음 자격 정책(12~13차): 증거 확정과 법적 무문제 판정을 분리한다.
  // auto_verdict:false인 복합 체크는 문장 요건이 충족돼도 사람 판정을 남긴다.
  function canAutoPass(check, result) {
    if (!check || !result || result.coverage !== "addressed" || check.auto_verdict === false) return false;
    // 당사 관점 규칙은 일반 문장요건과 별도의 보수적 통과 사유다. 현재는 참고 항목에서
    // 상대방만 의무를 지고 당사 보호가 강화되는 경우처럼 방향이 명백할 때만 생성된다.
    if (check.severity === "참고" && result.perspective && result.perspective.auto_pass) return true;
    // 참고 항목도 auto_clear를 명시했다면 그 보수적 문장 요건을 우회하지 않는다.
    // 미선언 참고 체크만 기존 정책(확정 매칭이면 자동 완료)을 유지한다.
    if (check.severity === "참고") return !check.auto_clear || !!(result.autoClear && result.autoClear.ok);
    return check.severity === "권장" && !!(result.autoClear && result.autoClear.ok);
  }

  function verdictSummary(store) {
    var reasons = {};
    OK_REASONS.forEach(function (r) { reasons[r] = 0; });
    var sum = { "이상없음": 0, "검토의견": 0, total: 0, reasons: reasons };
    store = store || {};
    for (var k in store) {
      if (!Object.prototype.hasOwnProperty.call(store, k)) continue;
      var it = store[k];
      var v = it && it.verdict;
      if (VERDICTS.indexOf(v) !== -1) {
        sum[v]++; sum.total++;
        if (it.reason && sum.reasons[it.reason] !== undefined) sum.reasons[it.reason]++;
      }
    }
    return sum;
  }

  function exportVerdicts(store, meta, systemAssessments) {
    var out = { meta: meta || {}, verdicts: _clone(store || {}) };
    if (systemAssessments && systemAssessments.format) out.system_assessments = systemAssessments;
    return out;
  }

  // 구조 검증: verdicts dict만 신뢰, 각 항목의 verdict 값이 유효한 것만 통과.
  // 구 '해당없음' 파일(팀원이 이전 버전으로 회신한 검토의견)도 자동 이관해 받는다.
  function importVerdicts(obj) {
    if (!obj || typeof obj !== "object") return {};
    var v = obj.verdicts;
    if (!v || typeof v !== "object") return {};
    return migrateStore(v);
  }

  // 3분할 작업열 결정. 이상없음을 방금 선택한 카드는 사유·메모 입력을 끝낼 때까지
  // ③ 작업열에 고정하고, 명시적으로 완료한 뒤에만 ② 확인 완료 열로 보낸다.
  function reviewColumn(item, editPinned) {
    return item && item.verdict === "이상없음" && !editPinned ? "done" : "needs";
  }

  // 일괄 판정(코멘트 포함): cpIds 중 '미판정'인 것만 verdict+comment로 채움 — 이미 찍은 판정(예외 지정분)은 보존.
  // 반환: { store, applied } — applied는 실제 채워진 개수.
  function bulkVerdictComment(store, cpIds, verdict, comment, date, reason, origin) {
    if (VERDICTS.indexOf(verdict) === -1) return { store: store || {}, applied: 0 };
    var next = _clone(store || {});
    var applied = 0;
    (cpIds || []).forEach(function (id) {
      if (next[id] && next[id].verdict) return; // 기판정 보존
      var m = migrateItem({ verdict: verdict, reason: reason, comment: comment, date: date,
        origin: origin || "bulk" });
      if (!m) return;
      next[id] = m;
      applied++;
    });
    return { store: next, applied: applied };
  }

  // 일괄 판정(통과계약 모드) — 코멘트 없는 bulkVerdictComment.
  function bulkVerdict(store, cpIds, verdict, date, reason) {
    return bulkVerdictComment(store, cpIds, verdict, "", date, reason, "bulk");
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
  //         opinions: [{label, severity, loc, comment}...], formalWarnTitles: [title...],
  //         compare: {date, changed, added, removed} } — compare는 비교 모드 시에만(옵션, 기존 호출 무영향)
  function composeOpinion(d) {
    d = d || {};
    var SEV = { "필수": 0, "권장": 1, "참고": 2 };
    var sents = [];
    // 1문장: 전반 상태 — 시스템의 원문 검색 결과가 아니라 사람의 추가 판단 필요 여부를 기술.
    var mustLabels = d.contractActionLabels || d.mustCoreLabels || [];
    var holdLabels = d.holdLabels || [];
    var externalLabels = d.externalCheckLabels || [];
    var negotiationLabels = d.negotiationLabels || [];
    var actionAware = d.contractActionLabels !== undefined || d.holdLabels !== undefined ||
      d.externalCheckLabels !== undefined || d.negotiationLabels !== undefined;
    var first = (d.name || "계약서") + "(" + (d.clauseCount || 0) + "개 조항, " +
      (d.typeName ? d.typeName + " 유형" : "유형 미확정") + ") 검토 결과 ";
    if (actionAware) {
      var actionParts = [];
      if (mustLabels.length) actionParts.push("계약서 수정 검토 " + mustLabels.length + "건");
      if (holdLabels.length) actionParts.push("반영 여부 확인 " + holdLabels.length + "건");
      if (externalLabels.length) actionParts.push("별도 자료 확인 " + externalLabels.length + "건");
      if (negotiationLabels.length) actionParts.push("회사 유불리 검토(필수 아님) " + negotiationLabels.length + "건");
      sents.push(first + (actionParts.length ? actionParts.join("·") + "이 있음." : "추가 조치가 필요한 항목 없음."));
    } else {
      sents.push(first + (mustLabels.length
        ? "추가 판단이 필요한 필수 항목이 " + mustLabels.length + "건 있음."
        : "추가 판단이 필요한 필수 항목 없음."));
    }
    // 비교 모드(재검토): 전년 대비 요지 1문장 — 정렬은 보조 도구이므로 "확인됨" 단정 대신 기술식 유지.
    if (d.compare) {
      var c = d.compare;
      var diffs = [];
      if (c.changed) diffs.push("변경 " + c.changed);
      if (c.added) diffs.push("신설 " + c.added);
      if (c.removed) diffs.push("삭제 " + c.removed);
      sents.push("전년(" + (c.date || "일자 미상") + ") 검토 대비 " +
        (diffs.length ? diffs.join("·") + "개 조항이 달라짐." : "조항 구성 변동 없음."));
    }
    // 2문장~: 검토의견 코멘트 인용 — 코멘트는 사용자 판단 기록이므로 글자 수를 자르지 않음.
    var ops = (d.opinions || []).slice().sort(function (a, b) {
      // 특정 조항을 넘어 계약 전체에 관한 의견을 먼저 제시한다.
      var sa = a.scope === "contract" ? 0 : 1;
      var sb = b.scope === "contract" ? 0 : 1;
      if (sa !== sb) return sa - sb;
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
      var loc = _shortLoc(o.loc);
      if (o.scope === "contract") {
        sents.push((i === 0 ? "다만, " : "또한 ") + "계약 전반에 관한 검토의견으로서 「" +
          (o.label || "") + "」에 대하여 " + (c ? "‘" + c + "’ " : "") +
          "의견이 있어 계약 전체 기준의 검토·보완이 필요함.");
      } else {
        sents.push((i === 0 ? "다만, " : "또한 ") +
          (loc ? loc + " 관련 " : "계약서 전체를 기준으로 볼 때 ") +
          "「" + (o.label || "") + "」에 대하여 " + (c ? "‘" + c + "’ " : "") +
          "의견이 있어 보완 필요함.");
      }
    });
    if (ops.length > 3) sents.push("외 검토의견 " + (ops.length - 3) + "건이 있음.");
    // 필수 미확인: 조항 신설 검토
    if (mustLabels.length) {
      sents.push("「" + mustLabels[0] + "」" + (mustLabels.length > 1 ? " 등 " + mustLabels.length + "건은" : " 항목은") +
        (actionAware ? " 계약 문구의 추가·수정 또는 조치 필요성 판단 요함." : " 해당 여부 또는 계약 내용 보완 필요성 판단 요함."));
    }
    if (externalLabels.length) {
      sents.push("「" + externalLabels[0] + "」" + (externalLabels.length > 1 ? " 등 " + externalLabels.length + "건은" : " 항목은") +
        " 계약 본문이 아닌 부속서류·증빙·내부 운영자료 확인 요함.");
    }
    // 형식 경고 1줄
    var fw = d.formalWarnTitles || [];
    if (fw.length) {
      sents.push("형식 점검에서 「" + fw[0] + "」" + (fw.length > 1 ? " 등 " + fw.length + "건" : "") +
        " 경고가 있어 확인 요함.");
    }
    // 특이사항 전무
    if (!ops.length && !mustLabels.length && !holdLabels.length && !externalLabels.length && !negotiationLabels.length && !fw.length)
      sents.push("전반적으로 특이사항 없음.");
    return sents.join(" ");
  }

  return {
    VERDICTS: VERDICTS,
    ACTION_DISPOSITIONS: ACTION_DISPOSITIONS,
    ACTION_DISPOSITION_LABELS: ACTION_DISPOSITION_LABELS,
    OK_REASONS: OK_REASONS,
    ORIGINS: ORIGINS,
    migrateStore: migrateStore,
    setReason: setReason,
    setActionDisposition: setActionDisposition,
    revertAutoVerdicts: revertAutoVerdicts,
    canAutoPass: canAutoPass,
    reviewColumn: reviewColumn,
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
