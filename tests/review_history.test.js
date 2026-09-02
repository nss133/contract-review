"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const History = require("../src/review_history.js");

const HEADERS = [
  "칼럼명", "진행상태", "작성자", "작성일", "신청부서", "신청자", "보안등급", "계약명",
  "개인(신용)정보 제공 및 (재)위탁 여부", "업무위탁 관련 확인 여부", "계약기간", "계약금액",
  "유형", "계약상대방", "신규/변경/연장", "계약배경 및 요청내용", "검토대상 계약서", "관련 자료",
  "작성자", "작성일", "신청부서", "신청자", "보안등급", "계약명",
  "개인(신용)정보 제공 및 (재)위탁 여부", "업무위탁 관련 확인 여부", "계약기간", "유형",
  "난이도", "검토유형", "신규/변경/연장", "검토결과", "첨부자료"
];

function row(overrides = {}) {
  const values = [
    "계약검토", "완료", "신청작성자", "2026-01-03", "영업부", "신청자", "대외비", "행사대행 계약",
    "아니오", "아니오", "2026년", "1000000", "용역", "행사업체", "신규", "행사 운영을 맡김",
    "행사계약.docx", "기획안.pdf", "검토자", "2026-01-05", "영업부", "신청자", "대외비", "행사대행 계약",
    "아니오", "아니오", "2026년", "조달", "중", "일반검토", "신규", "일반 용역계약으로 검토", "검토본.docx"
  ];
  Object.entries(overrides).forEach(([index, value]) => { values[Number(index)] = value; });
  return values;
}

function rows(dataRows, extraHeader, extraValues) {
  const group = new Array(33).fill("");
  group[0] = "화면"; group[1] = "현황 탭"; group[2] = "계약서 검토 신청 탭"; group[18] = "(검토결과 탭)";
  const headers = HEADERS.slice();
  if (extraHeader) headers.push(extraHeader);
  const scope = ["범위", "완료"].concat(new Array(31).fill("ALL"));
  return [group, headers, scope].concat((dataRows || []).map((r, i) => {
    const out = r.slice();
    if (extraHeader) out.push(extraValues && extraValues[i] || "");
    return out;
  }));
}

test("33열 한 시트에서 신청·결과를 분리하고 범위행을 제외한다", () => {
  const dataset = History.datasetFromRows(rows([row()]), { file_name: "history.xlsx", fingerprint: "f1" });
  assert.equal(dataset.records.length, 1);
  assert.equal(dataset.diagnostics.header_row, 2);
  assert.equal(dataset.diagnostics.skipped_scope_rows, 1);
  assert.equal(dataset.records[0].request.type, "용역");
  assert.equal(dataset.records[0].result.type, "조달");
  assert.equal(dataset.records[0].request.contract_name, "행사대행 계약");
});

test("원천 ID가 없으면 로컬 임시 ID와 진단코드를 남긴다", () => {
  const dataset = History.datasetFromRows(rows([row()]), { fingerprint: "f1" });
  const record = dataset.records[0];
  assert.match(record.review_id, /^LOCAL-[0-9a-f]{16}$/);
  assert.equal(record.id_quality, "provisional");
  assert.ok(record.diagnostic_codes.includes("STABLE_ID_MISSING"));
  assert.equal(dataset.diagnostics.error_counts.STABLE_ID_MISSING, 1);
});

test("추가된 계약검토번호 열을 안정적 ID로 우선 사용한다", () => {
  const dataset = History.datasetFromRows(rows([row()], "계약검토번호", ["CR-2026-001"]), { fingerprint: "f1" });
  assert.equal(dataset.records[0].review_id, "CR-2026-001");
  assert.equal(dataset.records[0].id_quality, "source");
  assert.equal(dataset.diagnostics.stable_id_available, true);
});

test("신청값과 결과값 충돌을 덮어쓰지 않고 기록한다", () => {
  const dataset = History.datasetFromRows(rows([row({ 23: "행사대행 변경계약", 25: "예" })]), { fingerprint: "f1" });
  const record = dataset.records[0];
  assert.ok(record.conflicts.includes("contract_name"));
  assert.ok(record.conflicts.includes("financial_outsourcing"));
  assert.equal(record.request.contract_name, "행사대행 계약");
  assert.equal(record.result.contract_name, "행사대행 변경계약");
});

test("같은 이력은 멱등 병합하고 변경 결과는 리비전으로 보존한다", () => {
  const first = History.datasetFromRows(rows([row()], "검토번호", ["CR-1"]), { fingerprint: "f1" });
  const one = History.mergeDataset(History.emptyHistory(), first);
  assert.equal(one.result.added, 1);
  const duplicate = History.mergeDataset(one.history, first);
  assert.equal(duplicate.result.skipped, 1);
  assert.equal(duplicate.history.meta.revision_count, 1);
  const changed = History.datasetFromRows(rows([row({ 31: "수정 의견 있음" })], "검토번호", ["CR-1"]), { fingerprint: "f2" });
  const two = History.mergeDataset(duplicate.history, changed);
  assert.equal(two.result.updated, 1);
  assert.equal(two.history.meta.review_count, 1);
  assert.equal(two.history.meta.revision_count, 2);
  assert.equal(History.latestRecord(two.history, "CR-1").result.review_text, "수정 의견 있음");
});

test("계약명·상대방·부서·유형으로 과거 검토를 검색한다", () => {
  const data = rows([
    row(),
    row({ 7: "시스템 유지보수", 12: "IT", 13: "전산업체", 23: "시스템 유지보수", 27: "IT외주" })
  ], "검토번호", ["CR-1", "CR-2"]);
  const merged = History.mergeDataset(History.emptyHistory(), History.datasetFromRows(data, { fingerprint: "f1" })).history;
  assert.equal(History.search(merged, "전산업체", {}).length, 1);
  assert.equal(History.search(merged, "유지보수", {})[0].review_id, "CR-2");
  assert.equal(History.search(merged, "", { type: "조달" })[0].review_id, "CR-1");
});

test("폐쇄망 유형 매핑은 이력 데이터와 함께 보존된다", () => {
  const mapped = History.setTypeMapping(History.emptyHistory(), "용역", "procurement");
  const restored = History.fromPack(History.packJson(mapped));
  assert.equal(restored.config.type_mappings["용역"], "procurement");
});

test("선택한 이력의 검토 완료 결과를 앱 버전별 내부 평가로 누적한다", () => {
  let history = History.addBenchmarkRun(History.emptyHistory(), {
    review_id: "CR-1", app_version: "1.50.0", contract_hash: "h1",
    initial_auto_type_id: "procurement", final_type_id: "procurement"
  });
  history = History.addBenchmarkRun(history, {
    review_id: "CR-2", app_version: "1.50.0", contract_hash: "h2",
    initial_auto_type_id: "nda", final_type_id: "procurement"
  });
  const summary = History.benchmarkSummary(history);
  assert.equal(summary.label_count, 2);
  assert.equal(summary.run_count, 2);
  assert.equal(summary.versions[0].auto_agreement_rate, 50);
  assert.equal(summary.versions[0].reviewer_changed, 1);
});

test("33열 머리글이 아니면 실제 행을 임의 해석하지 않는다", () => {
  assert.throws(() => History.datasetFromRows([["제목", "내용"], ["a", "b"]]), /SCHEMA_HEADER_MISMATCH/);
});
