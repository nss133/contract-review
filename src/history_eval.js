"use strict";
var HistoryEval = (function () {
  function candidates(history) {
    return Object.keys(history.latest || {}).map(function (id) {
      var r=history.records[history.latest[id]], q=r.request||{}, a=r.result||{};
      return {id:id,revision:r.fingerprint||history.latest[id],title:a.contract_name||q.contract_name||id,
        department:a.department||q.department||"",type:a.type||q.type||"",date:a.created_at||q.created_at||"",
        tags:(r.tags||[]).map(function(t){return t.label;}).filter(Boolean),
        attachments:[q.contract_attachment,q.related_attachments,a.attachments].filter(Boolean),
        has_opinion:!!String(a.review_text||"").trim(),conflicts:(r.conflicts||[]).length};
    });
  }
  function validate(candidate, draft, current) {
    if(!candidate)throw Error("이력 후보를 선택하세요.");
    if(!draft.family.trim())throw Error("동일 원계약·갱신·서식의 공통 계약 계열 ID가 필요합니다.");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)||!Number.isFinite(Date.parse(draft.date))||new Date(draft.date).toISOString().slice(0,10)!==draft.date)throw Error("유효한 계약 기준일이 필요합니다.");
    if(["before","after"].indexOf(draft.version)===-1)throw Error("검토 전/수정 후 문서 버전을 확인하세요. 버전 불명은 보류합니다.");
    if(!draft.confirmed)throw Error("선택 이력과 현재 원문·별첨·버전의 일치를 직접 확인하세요.");
    if(!current.analyzed||!current.text.trim()||current.text!==current.live)throw Error("현재 계약 본문을 먼저 분석하세요.");
    return true;
  }
  return {candidates:candidates,validate:validate};
})();
if(typeof module!=="undefined")module.exports=HistoryEval;
