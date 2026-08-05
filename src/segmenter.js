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
// 계약 유형어 — 제목 판정의 핵심 신호.
var TITLE_KIND_RE = /(계약서|계약|약정서|약정|합의서|합의|협약서|협약|각서|확인서|동의서|승낙서|신청서|증서|의향서|양해각서|정관|규약|LOI|MOU|NDA)/i;
// 유형어 뒤에 올 수 있는 꼬리표 — 이게 붙어도 제목임("업무위탁계약서(개정)", "근질권설정계약서 (안)").
// 유형어로 '끝나야' 한다고 보면 실제 문서 상당수를 놓침(11.4차 실측).
var TITLE_TAIL_OK_RE = /^[\s(（"'“”‘’\[\]<>【】]*(안|초안|개정|변경|수정|재작성|사본|원본|갑|을|제?\s*\d+\s*[안호부])?[\s)）"'“”‘’\[\]<>【】.]*$/;
var TITLE_SKIP_RE = /^(주식회사|㈜|\(주\)|[0-9]{4}[.\-년]|별지|별표|붙임|전문|목\s*차)/;
var TITLE_MAX_LEN = 80;   // 제목 후보 최대 길이(자) — 이보다 길면 서술문
var TITLE_SCAN_LINES = 12; // 문서 앞부분 이 줄 수까지만 탐색
// 자간 벌린 제목("신 탁 계 약 서")을 붙여쓰기로 환원.
// 한글 계약서 표지에서 흔한 조판인데, 그대로 두면 유형어 매칭이 전부 실패함.
// 한 글자씩 공백으로 떨어진 구간만 붙임 — 정상 낱말 사이 공백은 보존.
function _despace(s) {
  var t = String(s || "");
  // 줄 전체가 "한 글자 + 공백"의 반복이면(3자 이상) 자간 조판으로 보고 전부 붙임.
  // 부분 적용은 정상 낱말을 훼손할 수 있어, 줄 단위로 확신이 설 때만 처리한다.
  if (/^[가-힣A-Za-z](?:\s+[가-힣A-Za-z]){2,}$/.test(t.trim())) return t.replace(/\s+/g, "");
  return t;
}
// 제목 줄에서 따옴표·괄호 등 장식을 벗겨 실제 제목만 남김.
function _stripDeco(s) {
  return String(s || "").replace(/^[\s"'“”‘’「」『』<>《》【】\[\]]+/, "")
    .replace(/[\s"'“”‘’「」『』<>《》【】\[\]]+$/, "").trim();
}
function extractDocTitle(text) {
  var lines = String(text || "").split(/\r?\n/);
  for (var i = 0; i < lines.length && i < TITLE_SCAN_LINES; i++) {
    var raw = lines[i].trim();
    if (!raw) continue;
    if (CR_HEADING_RES[0].test(raw)) break; // 조문 시작 — 표제부 끝
    if (raw.length > TITLE_MAX_LEN) continue;
    if (TITLE_SKIP_RE.test(raw)) continue;
    // 당사자 소개·서술문 배제: 조사·서술어가 붙은 문장은 제목이 아님
    if (/(은|는|이|가|와|과)\s+.*(한다|하였다|합의|체결|다음과)/.test(raw)) continue;
    var t = _stripDeco(_despace(raw));
    if (!t) continue;
    // 유형어가 있고, 그 뒤에 남는 것이 허용 꼬리표뿐이면 제목으로 인정.
    // ⚠️ **마지막** 유형어를 기준으로 봐야 함 — "신탁계약 변경합의서"에서 첫 매칭("계약")을
    // 쓰면 꼬리가 "변경합의서"가 되어 탈락함(11.4차 실측 버그).
    if (!TITLE_KIND_RE.test(t)) continue;
    var last = null, re = new RegExp(TITLE_KIND_RE.source, "gi"), mm;
    while ((mm = re.exec(t)) !== null) last = mm;
    if (!last) continue;
    var tail = t.slice(last.index + last[0].length);
    if (TITLE_TAIL_OK_RE.test(tail)) return t;
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
