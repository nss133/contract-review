"use strict";
/* 계약서 텍스트 → 조항 배열 [{heading, body, index}] */

var CR_HEADING_RES = [
  /^제\s*\d+\s*조(?:의\s*\d+)?(?:\s|\(|\[|$)/, // 제1조, 제2조의2 (제목 괄호 허용)
  /^\d+\.\s+/,                                  // "1. 목적" 형태
];

/* 문서 제목(계약서 표제) 추출 — 11.1차.
   계약서의 성격은 제목에 가장 뚜렷하게 드러난다("○○담보설정계약서", "신탁계약 변경합의서").
   본문에 어휘가 스쳐 지나가는 것과, 그 문서가 애초에 무슨 계약인지는 층위가 다름 —
   제목을 별도 신호로 뽑아 유형·모듈·체크 매칭 전반에서 큰 가중치를 준다.
   규칙: 조문(제N조)이 시작되기 전, 앞부분 비어있지 않은 줄 중 "계약서다운" 표제 줄.
   당사자 소개문("갑과 을은 …")·날짜·머리말은 제외. 못 찾으면 빈 문자열(가중치 없음). */
var TITLE_TAIL_RE = /(계약서|계약|약정서|약정|합의서|합의|협약서|협약|각서|확인서|동의서|승낙서|신청서|증서|의향서|양해각서|정관|규약|LOI|MOU|NDA)\s*$/i;
var TITLE_SKIP_RE = /^(주식회사|㈜|\(주\)|[0-9]{4}[.\-년]|별지|별표|붙임|전문|목\s*차)/;
var TITLE_MAX_LEN = 80;   // 제목 후보 최대 길이(자) — 이보다 길면 서술문
var TITLE_SCAN_LINES = 12; // 문서 앞부분 이 줄 수까지만 탐색
function extractDocTitle(text) {
  var lines = String(text || "").split(/\r?\n/);
  for (var i = 0; i < lines.length && i < TITLE_SCAN_LINES; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    if (CR_HEADING_RES[0].test(t)) break; // 조문 시작 — 표제부 끝
    if (t.length > TITLE_MAX_LEN) continue;
    if (TITLE_SKIP_RE.test(t)) continue;
    // 당사자 소개·서술문 배제: 조사·서술어가 붙은 문장은 제목이 아님
    if (/(은|는|이|가|와|과)\s+.*(한다|하였다|합의|체결|다음과)/.test(t)) continue;
    if (TITLE_TAIL_RE.test(t)) return t;
  }
  return "";
}

function segmentContract(text) {
  var lines = text.split(/\r?\n/);
  var clauses = [];
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    var isHeading = t && CR_HEADING_RES.some(function (re) { return re.test(t); });
    // 제N조 조항이 열려 있으면, 숫자 헤딩(1. 2. ...)은 각 호 나열이므로 본문으로 취급
    if (
      isHeading &&
      !CR_HEADING_RES[0].test(t) &&
      current &&
      CR_HEADING_RES[0].test(current.heading)
    ) {
      isHeading = false;
    }
    if (isHeading) {
      if (current) clauses.push(current);
      current = { heading: t, body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + lines[i];
    } else if (t) {
      current = { heading: "(전문)", body: lines[i] };
    }
  }
  if (current) clauses.push(current);
  if (clauses.length < 2) {
    return [{ heading: "(전체)", body: text, index: 0 }];
  }
  return clauses.map(function (c, idx) {
    return { heading: c.heading, body: c.body, index: idx };
  });
}

if (typeof module !== "undefined")
  module.exports = { segmentContract: segmentContract, extractDocTitle: extractDocTitle };
