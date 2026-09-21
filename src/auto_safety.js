"use strict";
/* 안전성 1단계: 승인된 범위가 아직 없으므로 관찰 전용. 후보는 최종판정이 아니다.
   런타임 설정/태그/과거 결론으로 자동 허용을 켤 수 없게 고정한다. */
var AutoSafety = (function () {
  var VERSION = "safe-shadow-v1";
  var ORIGINS = ["auto", "subdoc", "prior_review", "llm_draft"];
  var LABELS = {
    shadow_only: "내부 검증·승인 전 관찰 모드",
    no_rule: "체크별 충족요건 규칙 없음",
    no_evidence: "본건 요건 문장 미확인",
    uncertain_mapping: "관련 조항 또는 적용범위 확인 필요",
    disabled_check: "사람 판단이 필요한 체크",
    exception_signal: "단서·배제·우선 적용 문구 확인 필요",
    reassigned: "근거 조항 변경 후 재검토 필요",
    subdoc: "표준약정의 실제 내용·체결 여부 별도 확인",
    prior_review: "과거 결론을 본건에서 다시 확인 필요"
  };
  // 이전 자동정책을 측정용 비교군으로만 보존한다. 실제 판정에 사용 금지.
  function legacyCandidate(cp, r) {
    if (!cp || !r || r.coverage !== "addressed" || cp.auto_verdict === false) return false;
    var evidence = !!(r.autoClear && r.autoClear.ok);
    var perspective = !!(r.perspective && r.perspective.auto_pass);
    if (r.best && r.best.historySupport && r.best.historySupport.bonus > 0 && !evidence && !perspective) return false;
    if (cp.severity === "참고") return perspective || !cp.auto_clear || evidence;
    return cp.severity === "권장" && evidence;
  }
  function scan(documents) {
    var hits = [];
    (documents || []).forEach(function (doc) {
      String(doc.text || "").split(/\n|(?<=다\.)\s+/).forEach(function (line, i) {
        if (/다만|단,|단서|불구하고|예외|없이|우선\s*(?:적용|한다)|적용하지|면제/.test(line))
          hits.push({ document: String(doc.name || "본문"), line: i + 1, text: line.trim() });
      });
    });
    return hits;
  }
  function evaluate(cp, r, context) {
    cp = cp || {}; r = r || {}; context = context || {};
    var reasons = ["shadow_only"];
    if (cp.auto_verdict === false) reasons.push("disabled_check");
    if (!cp.auto_clear) reasons.push("no_rule");
    if (!(r.autoClear && r.autoClear.ok)) reasons.push("no_evidence");
    if (r.coverage !== "addressed" || r.roleGated || r.relationshipGated) reasons.push("uncertain_mapping");
    if (r.reassigned || r.opinionScope) reasons.push("reassigned");
    if (context.route === "subdoc" || context.route === "prior_review") reasons.push(context.route);
    var signals = context.signals || scan(context.documents);
    if (signals.length) reasons.push("exception_signal");
    return { policy_version: VERSION, mode: "shadow", allowed: false,
      requires_review: legacyCandidate(cp, r) || context.held === true || context.subdoc === true,
      candidate: legacyCandidate(cp, r), reasons: reasons, signals: signals,
      sentence: String(r.autoClear && r.autoClear.sentence || "") };
  }
  function hold(item) {
    if (!item || item.verdict !== "이상없음" || ORIGINS.indexOf(item.origin) === -1) return item;
    var record=item.safety_hold?JSON.parse(JSON.stringify(item.safety_hold)):{ policy_version: VERSION,
        reason: "검증 전 시스템 판정 — 본건 원문 재확인 필요", previous: {
          verdict: item.verdict, reason: item.reason || "", comment: item.comment || "",
          date: item.date || "", origin: item.origin, action_disposition: item.action_disposition || ""
        } };
    if(item.auto_proof){record.proofs=record.proofs||[];
      if(!record.proofs.some(function(p){return JSON.stringify(p)===JSON.stringify(item.auto_proof);}))record.proofs.push(item.auto_proof);}
    return { verdict: "", reason: "", comment: "", date: item.date || "", origin: item.origin,
      action_disposition: "", safety_hold: record };
  }
  return { VERSION: VERSION, LABELS: LABELS, evaluate: evaluate, scan: scan,
    legacyCandidate: legacyCandidate, hold: hold };
})();
if (typeof module !== "undefined") module.exports = AutoSafety;
