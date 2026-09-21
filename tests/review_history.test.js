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

test("계약검토 단독 적재도 태그 열을 보존하고 태그 수정은 새 리비전이 된다",()=>{
  const headers=HEADERS.concat(['태그 1','태그 52','표시용 해시태그','엄격 태그']);
  const a=History.datasetFromRows([headers,row().concat(['보안 관리','개인정보','#보안 관리 #개인정보','위탁'])],{fingerprint:'f'});
  assert.deepEqual(a.records[0].tags.map(t=>t.label),['보안 관리','개인정보','위탁']);
  assert.equal(a.records[0].tag_fields['태그 52'],'개인정보');
  const b=History.datasetFromRows([headers,row().concat(['보안 관리','개인정보','#보안 관리 #개인정보','제공'])],{fingerprint:'f'});
  assert.equal(a.records[0].review_id,b.records[0].review_id);
  assert.notEqual(a.records[0].fingerprint,b.records[0].fingerprint);
  const merged=History.mergeDataset(History.mergeDataset(History.emptyHistory(),a).history,b).history;
  assert.equal(merged.meta.review_count,1);assert.equal(merged.meta.revision_count,2);
});

test("임시 이력 ID는 파일 간 자동 병합하지 않고 같은 파일은 중복 제외한다", () => {
  const input = [HEADERS.concat(["문서 ID"]), row().concat(["ROW-2"])];
  const a = History.datasetFromRows(input, { fingerprint: "file-a" });
  const b = History.datasetFromRows(input, { fingerprint: "file-b" });
  assert.equal(a.diagnostics.stable_id_available, false);
  assert.notEqual(a.records[0].review_id, b.records[0].review_id);
  const first = History.mergeDataset(null, a);
  const merged = History.mergeDataset(first.history, b);
  assert.equal(merged.history.meta.review_count, 2);
  assert.equal(History.mergeDataset(merged.history, a).result.skipped, 1);
});

test("통합적재는 유효한 원본 시트를 우선하고 불완전하면 다음 시트로 이동한다", () => {
  const valid = { rows: [HEADERS, row()] };
  const dataset = History.datasetFromTables({ "원본+태깅결과": valid, "문서대장": valid }, {});
  assert.equal(dataset.source.sheet_name, "원본+태깅결과");
  const fallback = History.datasetFromTables({ "원본+태깅결과": { rows: [["제목"]] }, "문서대장": valid }, {});
  assert.equal(fallback.source.sheet_name, "문서대장");
});

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

function taggedExportRows() {
  const headers = [
    "진행상태", "작성자", "작성일자", "신청부서", "신청자", "보안등급", "제목",
    "개인정보_제공_및_위탁_여부", "업무위탁_관련_확인_여부", "계약기간_시작", "계약기간_종료",
    "계약금액", "유형A", "유형B", "계약상대방", "신규변경연장", "계약배경_및_요청내용",
    "검토대상_계약서", "관련자료", "계약검토_작성자", "계약검토_작성일", "계약검토_신청부서",
    "계약검토_신청자", "계약검토_보안등급", "계약검토_계약명",
    "계약검토_개인정보_제공_및_위탁_여부", "계약검토_업무위탁_관련_확인_여부",
    "계약검토_계약기간", "계약검토_유형", "난이도", "검토유형", "계약검토_신규변경연장",
    "검토결과", "첨부파일", "ROW_NUMBERS", "표시용 해시태그", "태그 1", "엄격 태그",
    "신청·결과 충돌", "처리 상태", "오류·검토 사유", "태그 엔진 버전"
  ];
  const data = [
    "완료", "신청작성자", "2026-07-01", "총무팀", "신청자", "일반", "시설관리 계약", "N", "N",
    "2026-08-01", "2027-07-31", "1000000", "계약", "용역", "관리업체", "신규", "시설 관리를 위탁함",
    "계약서.docx", "제안서.pdf", "검토자", "2026-07-03", "총무팀", "신청자", "일반", "시설관리 계약",
    "N", "N", "2026-08-01~2027-07-31", "일반용역", "중", "일반검토", "신규", "수정의견 없음",
    "검토본.docx", "2", "#용역", "#용역", "#용역", "일치", "처리 성공", "", "0.8.2"
  ];
  return [headers, data];
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

test("태거 원본+태깅결과의 실제 열 이름과 분할 필드를 읽는다", () => {
  const dataset = History.datasetFromRows(taggedExportRows(), {
    file_name: "tagged.xlsx", sheet_name: "원본+태깅결과", fingerprint: "tagged-1"
  });
  assert.equal(dataset.records.length, 1);
  assert.equal(dataset.diagnostics.source_layout, "tagged_export");
  assert.equal(dataset.diagnostics.header_score, 32);
  assert.equal(dataset.diagnostics.header_expected, 32);
  assert.equal(dataset.records[0].request.contract_name, "시설관리 계약");
  assert.equal(dataset.records[0].request.contract_period, "2026-08-01 ~ 2027-07-31");
  assert.equal(dataset.records[0].request.type, "계약");
  assert.equal(dataset.records[0].request.type_a, "계약");
  assert.equal(dataset.records[0].request.type_b, "용역");
  assert.equal(dataset.records[0].request.type_detail, "용역");
  assert.equal(dataset.records[0].result.type, "일반용역");
  assert.equal(dataset.records[0].result.review_text, "수정의견 없음");
});

test("문서대장의 행 ID는 원천 ID가 아니며 신청·결과 제목을 구별한다", () => {
  const headers = [
    "문서 ID", "원본 행", "대표 계약명", "신청 계약명", "결과 계약명", "계약배경 및 요청내용", "신청부서의견", "검토결과",
    "신청 작성일", "결과 작성일", "신청부서", "결과 신청부서", "신청 유형", "결과 유형", "유형2", "난이도", "검토유형",
    "신청 보안등급", "결과 보안등급", "신청 신규/변경/연장", "결과 신규/변경/연장", "신청 개인정보 제공·(재)위탁",
    "결과 개인정보 제공·(재)위탁", "신청 업무위탁", "결과 업무위탁", "신청 계약기간", "결과 계약기간", "계약금액",
    "계약상대방", "검토대상 계약서", "관련 자료", "첨부자료", "원본 상태", "신청·결과 충돌", "처리 상태", "검토 사유", "엔진 버전"
  ];
  const data = [
    "ROW-2", 2, "대표 계약", "신청 계약", "결과 계약", "시설 관리를 위탁함", "", "수정의견 없음",
    "2026-07-01", "2026-07-03", "총무팀", "총무팀", "계약", "일반용역", "용역", "중", "일반검토",
    "일반", "일반", "신규", "신규", "N", "N", "N", "N", "2026-08-01~2027-07-31", "2026-08-01~2027-07-31",
    "1000000", "관리업체", "계약서.docx", "제안서.pdf", "검토본.docx", "완료", "일치", "처리 성공", "", "0.8.2"
  ];
  const dataset = History.datasetFromRows([headers, data], { sheet_name: "문서대장", fingerprint: "ledger-1" });
  assert.equal(dataset.diagnostics.source_layout, "document_ledger");
  assert.equal(dataset.diagnostics.header_score, dataset.diagnostics.header_expected);
  assert.match(dataset.records[0].review_id, /^LOCAL-/);
  assert.equal(dataset.records[0].id_quality, "provisional");
  assert.equal(dataset.records[0].request.contract_name, "신청 계약");
  assert.equal(dataset.records[0].result.contract_name, "결과 계약");
  assert.equal(dataset.records[0].request.type_detail, "용역");
  assert.equal(dataset.records[0].result.attachments, "검토본.docx");
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
