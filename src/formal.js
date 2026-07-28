"use strict";
/* 형식 점검(#5) — 자체점검체크리스트의 형식 항목 중 룰로 확정 판정 가능한 것만.
   (원료: samples/internal-standards/ 체크리스트 13종의 공통 형식 항목)
   지식 YAML이 아닌 코드 상수 — 사규성 룰이라 법령 quote 검증 대상이 아님.
   오탈자·견적서 대조 등 룰로 불가한 항목은 범위 밖(스펙 후속 과제).
   브라우저 전역 Formal + node require 겸용. */
var Formal = (function () {
  // 정식 상호: 접미형("미래에셋생명보험㈜") 또는 전치형("주식회사 미래에셋생명보험")
  var OUR_FULL_SUFFIX = /미래에셋생명보험\s*(?:㈜|주식회사|\(주\))/;
  var OUR_FULL_PREFIX = /(?:주식회사|㈜)\s*미래에셋생명보험/;
  var OUR_FULL = new RegExp(OUR_FULL_SUFFIX.source + "|" + OUR_FULL_PREFIX.source);
  var OUR_STEM_BAD = /미래에셋생명(?!보험)/g; // '보험' 누락 오기
  var BLANKS = [
    { re: /OOO|○○○|◯◯◯/g, label: "OOO 자리표시" },
    { re: /_{3,}/g, label: "밑줄 빈칸" },
    { re: /0000\s*\.\s*00\s*\.\s*00/g, label: "0000.00.00 일자 미기입" },
    { re: /20\s+년\s+월\s+일/g, label: "체결일자 공란(년·월·일)" },
  ];
  var CORP_FORM = /㈜|주식회사|\(주\)|유한회사|유한책임회사|합자회사|사단법인|재단법인/;
  var DATE_FILLED = /\d{4}\s*[.년]\s*\d{1,2}\s*[.월]\s*\d{1,2}/;

  function checkFormal(text) {
    var t = String(text || "");
    var out = [];
    // FORM-NAME — 당사 상호(체크리스트: "당사 상호: 미래에셋생명보험㈜ 또는 …주식회사")
    // 정식 상호(접미형 또는 전치형)가 있으면 pass
    if (OUR_FULL.test(t)) {
      out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "pass", detail: "정식 상호 확인" });
    }
    // 정식 상호 없이 "(이하 \"미래에셋생명\"이라 한다)" 별칭 선언이 있으면 pass(관행 인정)
    else if (/\(이하\s*"?미래에셋생명"?이?라\s*한다\)/.test(t)) {
      out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "pass", detail: "정식 상호 + 별칭 선언 확인" });
    }
    // 정식 상호도 없고 별칭 선언도 없는 경우만 stem 오기 검출
    else {
      var bad = t.match(OUR_STEM_BAD) || [];
      if (bad.length)
        out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "warn",
          detail: "'미래에셋생명' 뒤 '보험' 누락 의심 " + bad.length + "곳 — 정식 상호: 미래에셋생명보험㈜/주식회사" });
      else if (/미래에셋생명보험/.test(t))
        out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "warn",
          detail: "법인 형태(㈜·주식회사) 표기 확인 필요" });
      else
        out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "pass",
          detail: "당사 상호 미등장" });
    }
    // FORM-BLANK — 빈칸 잔존(체크리스트: "빈칸을 모두 정확히 채워넣었는가")
    var hits = [];
    BLANKS.forEach(function (b) {
      var m = t.match(b.re);
      if (m) hits.push(b.label + " ×" + m.length);
    });
    out.push(hits.length
      ? { id: "FORM-BLANK", title: "빈칸 잔존", status: "warn", detail: hits.join(", ") }
      : { id: "FORM-BLANK", title: "빈칸 잔존", status: "pass", detail: "자리표시·미기입 패턴 없음" });
    // FORM-DATE — 체결일자(체크리스트: "체결일자(년,월,일)가 정확히 표시")
    out.push(DATE_FILLED.test(t)
      ? { id: "FORM-DATE", title: "체결일자 기재", status: "pass", detail: "완성된 일자 표기 확인" }
      : { id: "FORM-DATE", title: "체결일자 기재", status: "warn", detail: "완성된 일자(YYYY.MM.DD/년월일) 미확인" });
    // FORM-CORP — 법인 형태(체크리스트: "'~주식회사' 등 법인 형태가 포함된 상호명 기재")
    out.push(CORP_FORM.test(t)
      ? { id: "FORM-CORP", title: "법인 형태 표기", status: "pass", detail: "법인 표기 존재" }
      : { id: "FORM-CORP", title: "법인 형태 표기", status: "warn", detail: "㈜·주식회사 등 법인 표기 미확인 — 당사자 상호 확인" });
    return out;
  }
  return { checkFormal: checkFormal };
})();
if (typeof module !== "undefined") module.exports = Formal;
