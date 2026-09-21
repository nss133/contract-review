"use strict";
/* 파일 → 텍스트 통합 디스패처. 확장자로 적절한 추출기 선택.
   지원: .docx .hwpx (zip) · .pdf (pdf.js) · .doc (CFB) · .hwp (CFB+deflate).
   스캔 PDF·암호/구형 hwp·.doc 일부는 추출 실패 가능 → 호출측이 붙여넣기로 안내. */
function extractFileText(file) { return extractFileStructure(file).then(function(result){return result.text;}); }
function extractFileStructure(file) {
  var name = (file && file.name ? file.name : "").toLowerCase();
  var ext = name.slice(name.lastIndexOf(".") + 1);
  return file.arrayBuffer().then(function (buf) {
    var result;
    switch (ext) {
      case "docx": result=PF.extractDocx(buf, true);break;
      case "hwpx": result=PF.extractHwpx(buf, true);break;
      case "pdf":  result=PF.extractPdf(buf, true);break;
      case "doc":  result=PF.extractDoc(buf).then(function(text){return DocumentStructure.fromBlocks("doc",[{text:text}],[]);});break;
      case "hwp":  result=PF.extractHwp(buf, true);break;
      default:
        return Promise.reject(new Error("지원하지 않는 형식(." + ext + ") — docx·pdf·doc·hwp·hwpx만 지원"));
    }
    return Promise.resolve(result).then(function(out){out.file_name=file.name;return crypto.subtle.digest('SHA-256',buf).then(function(hash){out.file_sha256=Array.from(new Uint8Array(hash)).map(function(n){return ('0'+n.toString(16)).slice(-2);}).join('');return out;});});
  });
}

if (typeof module !== "undefined") module.exports = { extractFileText: extractFileText, extractFileStructure:extractFileStructure };
