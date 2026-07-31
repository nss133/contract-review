"use strict";
/* 형식 점검(#5) — 당사 고유명사(상호·대표자·주소) 근방의 근사 오기만 점검(7차 피드백 재정의).
   일반 오타 검출은 룰로 불가하므로 "당사 고유명사 근방의 근사 오기"로 범위를 한정함.
   빈칸·일자 미기입은 체결 전 서식 단계에서 정상일 수 있어 점검 대상 아님
   (구 FORM-BLANK·FORM-DATE·FORM-CORP 폐지 — 2026-07 재정의).
   대표자명·주소 정본은 사규성 코드 상수 — 지식 YAML 아님(법령 quote 검증 대상 아님).
   브라우저 전역 Formal + node require 겸용. */
var Formal = (function () {
  // 정식 상호: 접미형("미래에셋생명보험㈜") 또는 전치형("주식회사 미래에셋생명보험")
  var OUR_FULL_SUFFIX = /미래에셋생명보험\s*(?:㈜|주식회사|\(주\))/;
  var OUR_FULL_PREFIX = /(?:주식회사|㈜)\s*미래에셋생명보험/;
  var OUR_FULL = new RegExp(OUR_FULL_SUFFIX.source + "|" + OUR_FULL_PREFIX.source);
  var OUR_STEM_BAD = /미래에셋생명(?!보험)/g; // '보험' 누락 오기
  // 대표이사 정본(2026-07 현재: 김재식·황문규) — 대표이사 변경 시 이 배열을 갱신할 것
  var REP_NAMES = ["김재식", "황문규"];
  // 회사 주소 정본 — 2026-07-31 사용자 확인, 이전: 서울특별시 영등포구 국제금융로 56
  // (여의도동, 미래에셋증권빌딩 — samples/internal-standards 보안관리약정서 서명란은 구주소 표본).
  // 사옥 이전·주소 개정 시 아래 상수들(정본·KEY·구주소)을 함께 갱신할 것.
  var ADDR_CANON = "서울시 마포구 만리재로 24";
  // 정규화(공백 제거) 후 도로명+번지만 대조 — "서울특별시" 표기·괄호 부기 등 변형 허용.
  // (?![\d-])로 "만리재로 241"·"만리재로 24-1"류 번지 변형은 불일치로 잡음
  var ADDR_KEY = /만리재로24(?![\d-])/;
  // 구주소 도로명 — 사내 표준서식·기존 계약서에 잔존 가능성이 높아 별도 경고(오기 아님·갱신 필요)
  var ADDR_OLD = /국제금융로/;
  // 당사 상호와 서명 블록 표기 사이 근접 윈도(문자) — 상대방 블록의 대표자명·주소 오탐 방지
  var NEAR = 200;
  // 당사 언급 탐지는 stem 기준('보험' 누락 오기 상태에서도 근방 점검이 걸리도록)
  var OUR_STEM = /미래에셋생명/g;
  // 서명란 직함 표기 — "대 표 이 사"처럼 자간 공백이 든 관행 허용
  var REP_TOKEN = /대\s*표\s*이\s*사/g;
  // 직함 뒤 이름 후보: 한글 2~4음절(자간 공백 허용), 5음절 이상 연속(직함 연결·산문)은 후보 제외
  var REP_NAME_CAND = /^[ \t]*\n?[ \t]*((?:[가-힣][ \t]*){2,4})(?![가-힣])/;
  // 주소 후보: 현주소 구(마포구)·구주소 구(영등포구) 또는 도로명 직접 등장 — 당사 근방일 때만 정본 대조
  var ADDR_CAND = /(?:서울[가-힣]*시\s*)?(?:마포구|영등포구)[^\n]{0,60}|만리재로[^\n]{0,40}|국제금융로[^\n]{0,40}/g;

  // 한글 음절 → 자모 시퀀스(초성 0~/중성 100~/종성 200~, 종성 없으면 생략) — 근사 오기 비교용
  function jamoSeq(s) {
    var out = [], i, c, v;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      v = c - 0xac00;
      if (v < 0 || v > 11171) { out.push(c); continue; }
      out.push(Math.floor(v / 588));
      out.push(100 + Math.floor((v % 588) / 28));
      if (v % 28) out.push(200 + (v % 28));
    }
    return out;
  }
  function levenshtein(a, b) {
    var m = a.length, n = b.length, i, j, prev = [], cur;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  // 이름 후보 vs 정본 대조 — 후보가 정본보다 길면 정본 길이 접두도 함께 비교
  // ("김재식이 서명" 류 조사 연결 흡수). exact: 정확 일치, dist: 최소 자모 편집거리.
  function repMatch(cand) {
    var exact = false, best = Infinity, i, j, d;
    for (i = 0; i < REP_NAMES.length; i++) {
      var rep = REP_NAMES[i];
      var variants = [cand];
      if (cand.length > rep.length) variants.push(cand.slice(0, rep.length));
      for (j = 0; j < variants.length; j++) {
        if (variants[j] === rep) exact = true;
        d = levenshtein(jamoSeq(variants[j]), jamoSeq(rep));
        if (d < best) best = d;
      }
    }
    return { exact: exact, dist: best };
  }

  function checkFormal(text) {
    var t = String(text || "");
    var out = [];
    var m, i;

    // 당사 언급 위치 수집 — FORM-REP·FORM-ADDR의 근접 윈도 기준점
    var ourIdx = [];
    OUR_STEM.lastIndex = 0;
    while ((m = OUR_STEM.exec(t))) ourIdx.push(m.index);
    function nearOurs(idx) {
      for (var k = 0; k < ourIdx.length; k++)
        if (Math.abs(idx - ourIdx[k]) <= NEAR) return true;
      return false;
    }

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

    // FORM-REP — 당사 대표자 이름 오기. 당사 상호 근방(근접 윈도)의 "대표이사" 뒤 이름만 대조:
    //   정확 일치 pass / 자모 편집거리 1 근사 변형(김제식·황문귀 등) warn / 그 외 이름·이름 부재 pass.
    //   상대방 서명 블록의 대표자명은 정본과 편집거리가 멀어 warn 안 됨(오탐 방지).
    var repWarns = [], repExact = false;
    REP_TOKEN.lastIndex = 0;
    while ((m = REP_TOKEN.exec(t))) {
      if (!nearOurs(m.index)) continue;
      var nm = REP_NAME_CAND.exec(t.slice(REP_TOKEN.lastIndex, REP_TOKEN.lastIndex + 40));
      if (!nm) continue;
      var cand = nm[1].replace(/[ \t]+/g, "");
      var r = repMatch(cand);
      if (r.exact) repExact = true;
      else if (r.dist === 1 && repWarns.indexOf(cand) < 0) repWarns.push(cand);
    }
    if (repWarns.length)
      out.push({ id: "FORM-REP", title: "대표자 이름 표기", status: "warn",
        detail: "'" + repWarns.join("', '") + "' — 정본(" + REP_NAMES.join("·") + ")과 근사 불일치, 오기 확인 요" });
    else if (repExact)
      out.push({ id: "FORM-REP", title: "대표자 이름 표기", status: "pass",
        detail: "대표자 정본 확인(" + REP_NAMES.join("/") + ")" });
    else
      out.push({ id: "FORM-REP", title: "대표자 이름 표기", status: "pass",
        detail: "당사 대표자명 미기재(정상 — 기재 시에만 대조)" });

    // FORM-ADDR — 회사 주소지 점검. 당사 상호 근방의 주소 후보를 3분류:
    //   ① 구주소(국제금융로) → 오기 아님·갱신 필요 경고(표준서식 잔존이 실무상 최다 케이스)
    //   ② 정본(만리재로 24) 일치 → pass  ③ 그 외 불일치(만리재로 42·24-1 등) → 오기 warn
    //   주소 부재 pass. 시도 표기·줄바꿈·괄호 부기는 변형으로 허용(정규화 후 대조).
    var addrBads = [], addrOld = false, addrOk = false;
    ADDR_CAND.lastIndex = 0;
    while ((m = ADDR_CAND.exec(t))) {
      if (!nearOurs(m.index)) continue;
      var norm = m[0].replace(/\s+/g, "");
      if (ADDR_OLD.test(norm)) addrOld = true;
      else if (ADDR_KEY.test(norm)) addrOk = true;
      else {
        var snip = m[0].replace(/\s+/g, " ").slice(0, 30);
        if (addrBads.indexOf(snip) < 0) addrBads.push(snip);
      }
    }
    if (addrOld || addrBads.length) {
      var parts = [];
      if (addrOld) parts.push("구주소(국제금융로 56) 표기 — 현주소(" + ADDR_CANON + ")로 갱신 필요");
      if (addrBads.length) parts.push("'" + addrBads.join("', '") + "' — 정본: " + ADDR_CANON);
      out.push({ id: "FORM-ADDR", title: "회사 주소 표기", status: "warn", detail: parts.join(" / ") });
    }
    else if (addrOk)
      out.push({ id: "FORM-ADDR", title: "회사 주소 표기", status: "pass",
        detail: "정본 주소 확인(만리재로 24)" });
    else
      out.push({ id: "FORM-ADDR", title: "회사 주소 표기", status: "pass",
        detail: "당사 주소 미기재(정상 — 기재 시에만 대조)" });

    return out;
  }
  return { checkFormal: checkFormal };
})();
if (typeof module !== "undefined") module.exports = Formal;
