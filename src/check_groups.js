"use strict";
/* 표시만 통합한다. 서로 다른 체크 ID·법적 요건·판정은 병합/승계하지 않는다. */
var CheckGroups = (function () {
  var GROUPS = [
    { id: "termination_rights", title: "해지·해제 사유와 권리의 적정성", members: {
      "CMN-08": "실무 검토: 약정 해지사유와 당사자 간 권리 균형",
      "SP-UNF-09": "약관 검토: 고객의 법정권 제한·사업자의 부당한 해지권 여부" } },
    { id: "termination_procedure", title: "해지 절차·통지", members: {
      "CMN-09": "계약 문언: 시정 최고기간과 서면 통지",
      "SOL-02": "모집위탁 특칙: 해지절차 마련·계약 반영·모집종사자 설명" } },
    { id: "termination_handover", title: "계약 종료 후 정산·반환·이관", members: {
      "CMN-10": "공통 검토: 대금 정산·자료 반환·업무 인수인계",
      "NDA-12": "비밀정보: 사본 포함 반환·파기와 이행 증빙",
      "CH-02": "채널계약: 기존 계약자 관리 이관과 고객보호" } },
    { id: "confidential_survival", title: "비밀유지와 관련 의무의 종료 후 존속", members: {
      "CMN-16": "공통 검토: 비밀유지 존속기간",
      "NDA-21": "비밀유지계약: 반환·파기·구제 조항의 잔존 범위" } }
  ];
  function group(items) {
    var buckets = {}, order = [];
    items.forEach(function (item, index) {
      var def = GROUPS.find(function (g) { return Object.prototype.hasOwnProperty.call(g.members, item.r.cpId); });
      var anchor = item.r.best ? item.r.best.clauseIndex : "missing";
      var key = def ? def.id + ":" + anchor : "single:" + index;
      if (!buckets[key]) { buckets[key] = { definition: def || null, items: [] }; order.push(key); }
      buckets[key].items.push(item);
    });
    return order.map(function (key) { return buckets[key]; });
  }
  return { GROUPS: GROUPS, group: group };
})();
if (typeof module !== "undefined") module.exports = CheckGroups;
