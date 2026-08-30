"use strict";
const { test } = require("node:test");
const assert = require("node:assert");

global.PF = {};
require("../src/extract-hwp.js");

function paraRecord(chars) {
  const payload = [];
  for (const ch of chars) payload.push(ch.charCodeAt(0));
  const buf = new Uint8Array(4 + payload.length * 2);
  new DataView(buf.buffer).setUint32(0, (payload.length * 2 << 20) | 67, true);
  payload.forEach((v, i) => new DataView(buf.buffer).setUint16(4 + i * 2, v, true));
  return buf;
}
function autoNumberPayload(textBefore, textAfter) {
  return Array.from(textBefore).concat([String.fromCharCode(18)], Array(7).fill("\0"), Array.from(textAfter));
}
function concat(...parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let at = 0; parts.forEach(p => { out.set(p, at); at += p.length; }); return out;
}

test("HWP 자동번호 제어문자를 조 번호와 원숫자 항으로 복원", () => {
  const bytes = concat(
    paraRecord(autoNumberPayload("제", "조(목적)")),
    paraRecord(autoNumberPayload("", "첫째 항")),
    paraRecord(autoNumberPayload("", "둘째 항"))
  );
  const text = PF._hwpParseRecords(bytes);
  assert.match(text, /제1조\(목적\)/);
  assert.match(text, /①첫째 항/);
  assert.match(text, /②둘째 항/);
});
