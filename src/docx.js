"use strict";
/* .docx ArrayBuffer → 평문 텍스트. JSZip 전역 사용 (빌드 시 인라인) */

function extractDocxText(arrayBuffer) {
  return JSZip.loadAsync(arrayBuffer).then(function (zip) {
    var entry = zip.file("word/document.xml");
    if (!entry) throw new Error("word/document.xml 없음 — 올바른 .docx가 아님");
    return entry.async("string");
  }).then(function (xml) {
    return xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  });
}
