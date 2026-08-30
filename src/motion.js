"use strict";

/* 화면 효과 정책을 브라우저·UI에서 함께 쓰는 순수 모듈.
   auto는 운영체제/브라우저의 접근성 설정을 따르고, full/reduce는 사용자의
   명시 선택을 우선한다. 폐쇄망 여부나 네트워크 연결은 판단요소가 아니다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MotionPreference = api;
})(typeof self !== "undefined" ? self : this, function () {
  var VALUES = ["auto", "full", "reduce"];

  function normalize(value) {
    return VALUES.indexOf(value) !== -1 ? value : "auto";
  }

  function isReduced(value, systemReduced) {
    var pref = normalize(value);
    if (pref === "full") return false;
    if (pref === "reduce") return true;
    return !!systemReduced;
  }

  function status(value, systemReduced) {
    var pref = normalize(value);
    var reduced = isReduced(pref, systemReduced);
    if (pref === "auto") {
      return {
        reduced: reduced,
        label: reduced ? "현재 줄임 · 시스템 설정 감지" : "현재 사용 · 시스템 설정",
        reason: reduced
          ? "Windows·Chrome의 동작 줄이기 설정을 따르고 있습니다. 효과를 보려면 ‘효과 사용’을 선택하세요."
          : "Windows·Chrome의 화면 효과 설정을 따르고 있습니다."
      };
    }
    return {
      reduced: reduced,
      label: reduced ? "현재 줄임 · 앱 설정" : "현재 사용 · 앱 설정",
      reason: reduced
        ? "이 브라우저에서 화면 전환과 순차 표시를 최소화합니다."
        : "시스템의 동작 줄이기 설정과 무관하게 화면 전환과 순차 표시를 사용합니다."
    };
  }

  return { VALUES: VALUES, normalize: normalize, isReduced: isReduced, status: status };
});
