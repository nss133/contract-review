"use strict";
/* 계약서 텍스트 → 조항 배열 [{heading, body, index}] */

var CR_HEADING_RES = [
  /^제\s*\d+\s*조(?:의\s*\d+)?(?:\s|\(|\[|$)/, // 제1조, 제2조의2 (제목 괄호 허용)
  /^\d+\.\s+/,                                  // "1. 목적" 형태
];

function segmentContract(text) {
  var lines = text.split(/\r?\n/);
  var clauses = [];
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    var isHeading = t && CR_HEADING_RES.some(function (re) { return re.test(t); });
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

if (typeof module !== "undefined") module.exports = { segmentContract: segmentContract };
