/* 로컬 Chrome DevTools Protocol로 실행기 설치→XLSX 적재→앱 재로딩 후 유지 여부를 검증한다.
   폐쇄망 운용과 같은 file:// 실행기를 기본으로 하며, 전제는 Chrome
   --remote-debugging-port=9223 및 build/build_html.py 실행 완료다. */
import fs from "node:fs/promises";
import { createBatchWorkbook } from "../../legal-opinion-tagger/lib/export-xlsx.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const APP_VERSION = (await fs.readFile(ROOT + "VERSION", "utf8")).trim();
const UPDATE = ROOT + "dist/contract-review-v" + APP_VERSION + ".crupdate";
const UPDATE_NEXT = "/private/tmp/contract-review-next-test.crupdate";
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

const target = await fetch("http://127.0.0.1:9223/json/new?" + encodeURIComponent(LAUNCHER_URL), { method: "PUT" }).then(r => r.json());
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
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,100));if(w.legalOpinionKnowledge&&w.legalOpinionKnowledge.meta.document_count===1)return w.legalOpinionKnowledge.meta;}
  throw new Error(w.document.getElementById("knowledge-action-msg").textContent||"XLSX 적재 시간초과");
})()`, true);

await evaluate(`document.getElementById("reload").click()`);
await wait(1400);
const retained = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(w.legalOpinionKnowledge)return {count:w.legalOpinionKnowledge.meta.document_count,state:w.document.getElementById("knowledge-store-state").textContent};}
  return {count:-1,state:"load timeout"};
})()`, true);
if (retained.count !== 1) throw new Error("앱 재로딩 후 태깅자료가 유지되지 않음: " + JSON.stringify(retained));

const document2 = await cdp("DOM.getDocument", { depth: -1, pierce: true });
const inputNode2 = await cdp("DOM.querySelector", { nodeId: document2.root.nodeId, selector: "#update-file" });
await cdp("DOM.setFileInputFiles", { nodeId: inputNode2.nodeId, files: [UPDATE_NEXT] });
await wait(1500);
const afterUpdate = await evaluate(`(async()=>{
  const w=document.getElementById("frame").contentWindow;
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(w.legalOpinionKnowledge)return {version:document.getElementById("version").textContent,count:w.legalOpinionKnowledge.meta.document_count};}
  return {version:document.getElementById("version").textContent,count:-1};
})()`, true);
if (afterUpdate.version !== "v" + APP_VERSION + "-next-test" || afterUpdate.count !== 1)
  throw new Error("버전 업데이트 후 태깅자료가 유지되지 않음: " + JSON.stringify(afterUpdate));

console.log(JSON.stringify({ installed, importResult, retained, afterUpdate }, null, 2));
ws.close();
