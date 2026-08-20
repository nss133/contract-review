"use strict";
/* 문장 단위 요건 판정(12차, 2026-08-20 피드백) — 순수 함수.
   "계약기간은 계약 체결일로부터 1년으로 한다"처럼 사실기재형 항목은 한 문장 안에서
   (키워드 + 구체 숫자·기간 + 긍정 종결어미)를 확인할 수 있다. 이 신호는 조항 단위
   어휘 겹침보다 강한 증거이므로, 충족 시 매칭을 확정(confirmed)으로 승격하고
   심각도에 따라 이상없음 자동 기재(권장·참고) 또는 빠른 확인 제안(필수)의 근거가 된다.

   설계 원칙: 자동 이상없음의 오판은 '누락'이라 실패 비용이 비대칭 — 통과 조건은
   보수적으로(부정·단서·정의·공란 문장은 전부 제외), 미달이면 그냥 사람 검토로 남는다.

   check.auto_clear 스키마:
     any_groups: [[...], [...]]  # OR-그룹 목록 — 각 그룹에서 1개 이상이 같은 문장에 있어야 함
     require: [period|date|money|rate|number]  # 하나 이상 충족(OR). 생략 시 숫자 요건 없음
   브라우저 전역 Sentence + node require 겸용. */
var Sentence = (function () {

  // 조항 본문 → 문장 배열. 계약 문어체는 "…다."로 규칙적으로 종결되므로
  // '다.' 뒤 공백만 문장 경계로 본다 — "2026. 1. 1." 같은 날짜 표기를 쪼개지 않는 핵심.
  // 줄바꿈(항·호 구조)은 항상 경계.
  function splitSentences(text) {
    var out = [];
    String(text || "").split(/\n+/).forEach(function (line) {
      line.split(/(?<=다\.)\s+/).forEach(function (s) {
        s = s.trim();
        if (s) out.push(s);
      });
    });
    return out;
  }

  // 단서 문장 — 본칙이 아닌 예외 규정이므로 요건 충족 문장으로 삼지 않음.
  function isProviso(s) {
    return /^[①-⑮\s\d.]*\s*(다만|단,|단서)/.test(s);
  }
  // 정의 문장 — "'계약기간'이란 …을 말한다"는 용어 설명이지 기간의 약정이 아님.
  // weak-role(정의 조항) 게이트를 문장 요건이 관통하므로, 문장 층에서 정의를 걸러야 함.
  function isDefinition(s) {
    return /(이?란|함은|이라\s*함은)\s.*(말한다|의미한다|말하며|의미하며)/.test(s) ||
      /[을를]\s*말한다\s*\.?$/.test(s);
  }
  // 공란 문장 — "계약기간은 20  년  월  일부터"처럼 숫자가 비어 있으면 미기재.
  function isBlank(s) {
    if (/_{2,}|＿{2,}|\[\s*\]/.test(s)) return true;
    // "년 월 일" 연쇄에 숫자가 없는 형태(서식 빈칸)
    if (/(?:^|[^0-9])년\s*월\s*일/.test(s)) return true;
    return false;
  }
  // 부정 종결 — "정하지 아니한다/않는다/할 수 없다" 등은 요건의 존재가 아니라 배제.
  // 보수적: 애매하면 부정으로 보고 사람 검토로 남김(자동 이상없음의 오판 = 누락).
  function isNegated(s) {
    return /(아니\s?한다|아니\s?된다|않는다|않기로\s*한다|할\s*수\s*없다|없는\s*것으로\s*한다|무효로\s*한다)\s*\.?\s*$/.test(s);
  }

  var REQUIRE_RES = {
    number: /\d/,
    period: /\d+\s*(년|개월|월|주|일)(?!자)/,
    date: /\d{4}\s*[.\-\/년]\s*\d{1,2}|\d{4}\s*년/,
    money: /(?:금\s*)?[\d,]+\s*(원|만원|백만원|천만원|억원)|KRW|USD/,
    rate: /\d+(?:\.\d+)?\s*(%|퍼센트)/
  };
  function requireHit(s, kinds) {
    for (var i = 0; i < kinds.length; i++) {
      var re = REQUIRE_RES[kinds[i]];
      if (re && re.test(s)) return kinds[i];
    }
    return null;
  }
  function groupsHit(s, groups) {
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i] || [];
      var hit = false;
      for (var j = 0; j < g.length; j++) {
        if (g[j] && s.indexOf(g[j]) !== -1) { hit = true; break; }
      }
      if (!hit) return false;
    }
    return groups.length > 0;
  }

  // 본문에서 spec을 충족하는 첫 문장을 찾는다. 반환 {ok, sentence?, require_hit?}.
  function evaluate(text, spec) {
    if (!spec || !Array.isArray(spec.any_groups) || !spec.any_groups.length) return null;
    var sents = splitSentences(text);
    for (var i = 0; i < sents.length; i++) {
      var s = sents[i];
      if (isProviso(s) || isDefinition(s) || isBlank(s)) continue;
      if (!groupsHit(s, spec.any_groups)) continue;
      var rq = null;
      if (Array.isArray(spec.require) && spec.require.length) {
        rq = requireHit(s, spec.require);
        if (!rq) continue;
      }
      if (isNegated(s)) continue;
      return { ok: true, sentence: s, require_hit: rq };
    }
    return { ok: false };
  }

  return {
    splitSentences: splitSentences,
    isProviso: isProviso,
    isDefinition: isDefinition,
    isBlank: isBlank,
    isNegated: isNegated,
    evaluate: evaluate
  };
})();

if (typeof module !== "undefined") module.exports = Sentence;
