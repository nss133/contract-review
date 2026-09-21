/* 로컬 Chrome DevTools Protocol로 실행기 설치→XLSX 적재→앱 재로딩 후 유지 여부를 검증한다.
   폐쇄망 운용과 같은 file:// 실행기를 기본으로 하며, 전제는 Chrome
   --remote-debugging-port=9223 및 build/build_html.py 실행 완료다. */
import fs from "node:fs/promises";
import { createBatchWorkbook } from "../../legal-opinion-tagger/lib/export-xlsx.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const APP_VERSION = (await fs.readFile(ROOT + "VERSION", "utf8")).trim();
const UPDATE = ROOT + "dist/contract-review-v" + APP_VERSION + ".crupdate";
const TEMP = await fs.mkdtemp('/private/tmp/cr-launcher-verification.');
const UPDATE_NEXT = TEMP + "/contract-review-next-test.crupdate";
const ENDPOINT = process.env.CR_TEST_ENDPOINT || 'http://127.0.0.1:9223';
const LAUNCHER_URL = process.env.CR_LAUNCHER_URL || new URL("../dist/contract-review-launcher.html", import.meta.url).href;
const nextPackage = JSON.parse(await fs.readFile(UPDATE, "utf8"));
nextPackage.version = APP_VERSION + "-next-test";
await fs.writeFile(UPDATE_NEXT, JSON.stringify(nextPackage));

const tag = {
  id: "legal_relation-위탁", label: "위탁", hashtag: "#위탁", status: "직접 후보",
  type: "legal_relation", typeLabel: "법률관계", score: 95, confidence: "높음",
  sources: ["신청", "결과"], aliases: ["업무위탁"],
  evidence: [{ source: "신청", text: "단발성 행사대행 업무위탁 여부", at: 0 }],
  occurrences: 2, cardMappings: [],
};
const conclusion = {
  id: "conclusion-비적용", label: "비적용", hashtag: "#비적용", status: "직접 후보",
  type: "conclusion", typeLabel: "결론·효과", score: 91, confidence: "높음",
  sources: ["결과"], aliases: ["해당하지 않음"],
  evidence: [{ source: "결과", text: "규정상 업무위탁에 해당하지 않음", at: 10 }],
  occurrences: 1, cardMappings: [],
};
const records = [{
  originalValues: ["OP-TEST-1", "행사대행 검토"], documentId: "OP-TEST-1", rowNumber: 2,
  title: "행사대행 검토", requestText: "단발성 행사대행 업무위탁 여부", departmentOpinion: "",
  resultText: "규정상 업무위탁에 해당하지 않음", date: "2026-08-30", processedDate: "2026-08-30",
  department: "법무팀", type: "계약", type2: "행사", difficulty: "", reviewType: "법률검토",
  securityLevel: "", attachment: "", sourceStatus: "", processStatus: "처리 성공", reason: "",
  engineVersion: "0.6.3", analysis: {
    normalizedTags: [tag, conclusion], strategies: { strict: [tag, conclusion] },
    relations: [{ sourceTag: "#위탁", targetTag: "#비적용", relation: "결론", score: 88, evidence: "결과" }],
  }, connections: [],
}];
const xlsx = await createBatchWorkbook(["문서 ID", "제목"], records);
const xlsxBase64 = Buffer.from(xlsx).toString("base64");
const historyTemplatePath = process.env.CR_HISTORY_TEMPLATE || "";
const historyTemplateBase64 = historyTemplatePath
  ? Buffer.from(await fs.readFile(historyTemplatePath)).toString("base64")
  : "";

// Use only a dedicated test browser profile. Never point this harness at a user profile.
const target = await fetch(ENDPOINT+"/json/new?" + encodeURIComponent(LAUNCHER_URL), { method: "PUT" }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
};
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, awaitPromise = false) {
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "브라우저 평가 오류");
  return result.result.value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

await cdp("Page.enable");
await cdp("Runtime.enable");
await wait(800);
await cdp("DOM.enable");
const document = await cdp("DOM.getDocument", { depth: -1, pierce: true });
const inputNode = await cdp("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#update-file" });
await cdp("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [UPDATE] });
await wait(1800);

const installed = await evaluate(`({version:document.getElementById("version").textContent,
  app:!!document.getElementById("frame").contentDocument.querySelector('[data-tab="knowledge"]')})`);
if (installed.version !== "v" + APP_VERSION || !installed.app) throw new Error("실행기 앱 설치 실패: " + JSON.stringify(installed));

const importResult = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  const bytes=Uint8Array.from(atob(${JSON.stringify(xlsxBase64)}),c=>c.charCodeAt(0));
  const file=new w.File([bytes],"legal-opinion-test.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const dt=new w.DataTransfer();dt.items.add(file);
  const input=w.document.getElementById("knowledge-xlsx");input.files=dt.files;
  input.dispatchEvent(new w.Event("change",{bubbles:true}));
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,100));if(w.legalOpinionKnowledge&&w.legalOpinionKnowledge.meta.document_count===1&&w.reviewHistory&&w.reviewHistory.latest["OP-TEST-1"])return w.legalOpinionKnowledge.meta;}
  throw new Error(w.document.getElementById("knowledge-action-msg").textContent||"XLSX 적재 시간초과");
})()`, true);

const taggedHistoryValidation = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  const bytes=Uint8Array.from(atob(${JSON.stringify(xlsxBase64)}),c=>c.charCodeAt(0));
  const file=new w.File([bytes],"legal-opinion-test.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const parsed=await w.ReviewHistory.workbookRows(file);
  const dataset=w.ReviewHistory.datasetFromRows(parsed.rows,parsed.source);
  return {sheet:dataset.source.sheet_name,layout:dataset.diagnostics.source_layout,
    records:dataset.records.length,stable:dataset.diagnostics.stable_id_available};
})()`, true);
if (taggedHistoryValidation.sheet !== "문서대장" || taggedHistoryValidation.layout !== "document_ledger" ||
    taggedHistoryValidation.records !== 1 || !taggedHistoryValidation.stable)
  throw new Error("태거 XLSX를 계약검토 이력으로 인식하지 못함: " + JSON.stringify(taggedHistoryValidation));

const historyUiValidation = await evaluate(`(()=>{
  const w=document.getElementById("frame").contentWindow;
  const record=w.ReviewHistory.latestRecord(w.reviewHistory,"OP-TEST-1");
  const type=w.CR.types[0].meta.type_id, other=w.CR.types[1].meta.type_id;
  w.reviewHistory=w.ReviewHistory.setTypeMapping(w.reviewHistory,w.historyRecordDbType(record),other);
  w.state.typeId=type;
  w.applyHistoryReference("OP-TEST-1");
  const unchanged=w.state.typeId===type;
  w.document.getElementById("contract-text").value="임대차계약서\\n제1조 사무실 임대차 목적물을 임대한다.";
  w.document.getElementById("input-department").value="정보보호";
  w.refreshInputSetup();
  const withDepartment=w.state.detectRanked[0].typeId;
  w.document.getElementById("input-department").value="영업부";
  w.refreshInputSetup();
  return {unchanged,departmentStable:withDepartment===w.state.detectRanked[0].typeId,
    manualMappingHidden:w.getComputedStyle(w.document.getElementById("history-type-map-fold")).display==="none",
    historyCollapsed:!w.document.querySelector("details.history-search-box").open};
})()`);
if (Object.values(historyUiValidation).some(value=>value!==true))
  throw new Error("유형·이력 UI 보호 검증 실패: " + JSON.stringify(historyUiValidation));

const historyImportResult = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  const headers=${JSON.stringify([
    "칼럼명", "진행상태", "작성자", "작성일", "신청부서", "신청자", "보안등급", "계약명",
    "개인(신용)정보 제공 및 (재)위탁 여부", "업무위탁 관련 확인 여부", "계약기간", "계약금액", "유형", "계약상대방",
    "신규/변경/연장", "계약배경 및 요청내용", "검토대상 계약서", "관련 자료", "작성자", "작성일", "신청부서", "신청자",
    "보안등급", "계약명", "개인(신용)정보 제공 및 (재)위탁 여부", "업무위탁 관련 확인 여부", "계약기간", "유형", "난이도",
    "검토유형", "신규/변경/연장", "검토결과", "첨부자료", "검토번호"
  ])};
  const data=${JSON.stringify([
    "계약검토", "완료", "신청자", "2026-09-01", "법무팀", "담당자", "대외비", "행사대행 계약", "아니오", "아니오",
    "2026년", "1000000", "용역", "행사업체", "신규", "단발성 행사", "행사계약.docx", "기획안.pdf", "검토자", "2026-09-02",
    "법무팀", "담당자", "대외비", "행사대행 계약", "아니오", "아니오", "2026년", "조달", "중", "일반검토", "신규",
    "일반 용역계약으로 검토", "검토본.docx", "CR-TEST-1"
  ])};
  const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const col=i=>{let s="";for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s};
  const rows=[new Array(34).fill(""),headers,["범위","완료",...new Array(31).fill("ALL"),"ALL"],data];
  rows[0][0]="화면";rows[0][1]="현황 탭";rows[0][2]="계약서 검토 신청 탭";rows[0][18]="(검토결과 탭)";
  const sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((row,ri)=>
    '<row r="'+(ri+1)+'">'+row.map((v,ci)=>v===""?"":'<c r="'+col(ci)+(ri+1)+'" t="inlineStr"><is><t>'+esc(v)+'</t></is></c>').join("")+'</row>'
  ).join("")+'</sheetData></worksheet>';
  const zip=new w.JSZip();
  zip.file("xl/workbook.xml",'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="계약서 검토" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml",sheet);
  const bytes=await zip.generateAsync({type:"uint8array"});
  const file=new w.File([bytes],"contract-review-history-test.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const dt=new w.DataTransfer();dt.items.add(file);
  const input=w.document.getElementById("history-xlsx");input.files=dt.files;
  input.dispatchEvent(new w.Event("change",{bubbles:true}));
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,100));if(w.reviewHistory&&w.reviewHistory.meta.review_count===2)return w.reviewHistory.meta;}
  throw new Error(w.document.getElementById("history-action-msg").textContent||"이력 XLSX 적재 시간초과");
})()`, true);

const historyTemplateValidation = !historyTemplateBase64 ? null : await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  const bytes=Uint8Array.from(atob(${JSON.stringify(historyTemplateBase64)}),c=>c.charCodeAt(0));
  const file=new w.File([bytes],${JSON.stringify(historyTemplatePath.split("/").pop())},{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const parsed=await w.ReviewHistory.workbookRows(file);
  const dataset=w.ReviewHistory.datasetFromRows(parsed.rows,parsed.source);
  return {sheet:dataset.source.sheet_name,headerScore:dataset.diagnostics.header_score,
    headerRow:dataset.diagnostics.header_row,records:dataset.records.length,
    skippedScopeRows:dataset.diagnostics.skipped_scope_rows};
})()`, true);
if (historyTemplateValidation && historyTemplateValidation.headerScore !== 33)
  throw new Error("실제 계약검토 빈 양식의 33열 머리글을 인식하지 못함: " + JSON.stringify(historyTemplateValidation));

await evaluate(`document.getElementById("reload").click()`);
await wait(1400);
const retained = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(w.legalOpinionKnowledge&&w.reviewHistory)return {count:w.legalOpinionKnowledge.meta.document_count,historyCount:w.reviewHistory.meta.review_count,state:w.document.getElementById("knowledge-store-state").textContent};}
  return {count:-1,historyCount:-1,state:"load timeout"};
})()`, true);
if (retained.count !== 1 || retained.historyCount !== 2) throw new Error("앱 재로딩 후 내부 자료가 유지되지 않음: " + JSON.stringify(retained));

const document2 = await cdp("DOM.getDocument", { depth: -1, pierce: true });
const inputNode2 = await cdp("DOM.querySelector", { nodeId: document2.root.nodeId, selector: "#update-file" });
await cdp("DOM.setFileInputFiles", { nodeId: inputNode2.nodeId, files: [UPDATE_NEXT] });
await wait(1500);
const afterUpdate = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(w.legalOpinionKnowledge&&w.reviewHistory)return {version:document.getElementById("version").textContent,count:w.legalOpinionKnowledge.meta.document_count,historyCount:w.reviewHistory.meta.review_count};}
  return {version:document.getElementById("version").textContent,count:-1,historyCount:-1};
})()`, true);
if (afterUpdate.version !== "v" + APP_VERSION + "-next-test" || afterUpdate.count !== 1 || afterUpdate.historyCount !== 2)
  throw new Error("버전 업데이트 후 내부 자료가 유지되지 않음: " + JSON.stringify(afterUpdate));

// The worker is embedded in a srcdoc app under a persistent file:// launcher.
// A standalone HTML pass is not sufficient evidence that this origin works.
const launcherAnalysis = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  const body='합성 용역계약서\\n제1조(관할)\\n분쟁에 관한 소송은 서울중앙지방법원을 관할법원으로 한다.\\n제2조(부가세)\\n계약대금 1000000원(부가세 별도)';
  w.document.getElementById('contract-text').value=body;
  w.document.getElementById('btn-analyze').click();
  for(let i=0;i<300;i++){
    await new Promise(r=>setTimeout(r,50));
    if(!w.document.getElementById('btn-analyze').disabled){
      if(!w.state.result||w.state.analyzedText!==body)throw Error('실행기 분석 미완료: '+w.document.getElementById('input-error').textContent);
      for(const id of ['CMN-19','CMN-05'])if(w.verdictStore[id]?.origin!=='auto'||w.verdictStore[id]?.verdict!=='이상없음')throw Error('실행기 자동판정 미완료 '+id);
      const count=w.legalOpinionKnowledge.meta.document_count,historyCount=w.reviewHistory.meta.review_count;
      if(count!==1||historyCount!==2)throw Error('분석 후 내부 자료 변경');
      return {srcdoc_worker_analysis:true,automatic:['CMN-19','CMN-05'],count,historyCount};
    }
  }
  throw Error('실행기 분석 시간초과');
})()`,true);

console.log(JSON.stringify({ installed, importResult, historyUiValidation, historyImportResult, historyTemplateValidation, retained, afterUpdate, launcherAnalysis }, null, 2));
await fetch(ENDPOINT+'/json/close/'+target.id);
ws.close();
