"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Knowledge = require("../src/legal_opinion_knowledge.js");

function tables(version, score) {
  return {
    "문서대장": { rows: [
      ["문서 ID", "원본 행", "제목", "신청내용", "신청부서의견", "검토결과", "작성일", "처리일", "신청부서", "유형", "유형2", "난이도", "검토유형", "보안등급", "첨부파일", "원본 상태", "처리 상태", "검토 사유", "엔진 버전"],
      ["OP-1", 2, "행사대행 검토", "", "", "", "2026-01-01", "", "법무팀", "계약", "행사", "", "법률검토", "", "", "", "처리 성공", "", version]
    ] },
    "문서별태그": { rows: [
      ["문서 ID", "순위", "태그 ID", "해시태그", "정규 태그명", "후보 상태", "유형", "점수", "신뢰도", "출처", "등장 횟수"],
      ["OP-1", 1, "legal_relation-위탁", "#위탁", "위탁", "직접 후보", "법률관계", score, "높음", "신청+결과", 2],
      ["OP-1", 2, "conclusion-비적용", "#비적용", "비적용", "직접 후보", "결론·효과", 90, "높음", "결과", 1]
    ] },
    "태그정본": { rows: [
      ["태그 ID", "정규 태그명", "해시태그", "유형", "별칭", "연결 핵심쟁점 카드"],
      ["legal_relation-위탁", "위탁", "#위탁", "법률관계", "업무위탁", ""],
      ["conclusion-비적용", "비적용", "#비적용", "결론·효과", "적용되지 않음", ""]
    ] },
    "태그별근거": { rows: [
      ["문서 ID", "태그 ID", "해시태그", "근거 출처", "근거 문장", "원문 위치"],
      ["OP-1", "legal_relation-위탁", "#위탁", "신청", "행사대행 위탁 여부", 0],
      ["OP-1", "conclusion-비적용", "#비적용", "결과", "규정상 업무위탁에 해당하지 않음", 10]
    ] },
    "태그연결성": { rows: [
      ["문서 ID", "태그 A", "태그 B", "관계 유형", "연결 점수", "공통 출처", "공통 핵심쟁점 카드"],
      ["OP-1", "#위탁", "#비적용", "결론", 88, "결과", ""]
    ] }
  };
}

test("행 기반 태거 ID는 파일별 분리하고 태그와 근거 연결을 보존한다", () => {
  const input = tables("0.6.3", 95);
  Object.values(input).forEach(table => table.rows.forEach(row => {
    row.forEach((value, index) => { if (value === "OP-1") row[index] = "ROW-2"; });
  }));
  const a = Knowledge.datasetFromTables(input, { fingerprint: "file-a" });
  const b = Knowledge.datasetFromTables(input, { fingerprint: "file-b" });
  assert.notEqual(a.documents[0].source_id, b.documents[0].source_id);
  assert.equal(a.documents[0].tags.length, 2);
  assert.equal(a.documents[0].evidence.length, 2);
  const first = Knowledge.mergeDataset(null, a);
  const merged = Knowledge.mergeDataset(first.knowledge, b);
  assert.equal(merged.knowledge.meta.document_count, 2);
  assert.equal(Knowledge.mergeDataset(merged.knowledge, a).result.skipped, 1);
});

test("태거 5개 구조화 시트를 지식 데이터셋으로 변환한다", () => {
  const dataset = Knowledge.datasetFromTables(tables("0.6.3", 95), { file_name: "tags.xlsx", fingerprint: "f1" });
  assert.equal(dataset.documents.length, 1);
  assert.equal(dataset.documents[0].tags.length, 2);
  assert.equal(dataset.documents[0].evidence.length, 2);
  assert.equal(dataset.documents[0].relations[0].relation, "결론");
  assert.equal(dataset.tags["legal_relation-위탁"].aliases[0], "업무위탁");
});

test("원본은 행과 제목을 함께 검증해 보존하며 충돌행은 잘못 연결하지 않는다", () => {
  const input = tables("0.6.3", 95);
  const base = Knowledge.datasetFromTables(input, {}).documents[0];
  const history = { diagnostics: { source_layout: "tagged_export" }, records: [{
    source_row: base.source_row, review_id: "LOCAL-example", conflicts: [],
    request: { contract_name: base.title, context: "본건 고객지원 업무", applicant: "신청자" },
    result: { contract_name: "결과 계약명" } }] };
  const doc = Knowledge.datasetFromTables(input, {}, history).documents[0];
  assert.equal(doc.original.request.applicant, "신청자");
  assert.equal(doc.request_context, "본건 고객지원 업무");
  history.records[0].request.contract_name = "다른 계약";
  assert.equal(Knowledge.datasetFromTables(input, {}, history).documents[0].original, undefined);
});

test("태거 최신 문서대장의 신청·결과 분리 열을 그대로 읽는다", () => {
  const current = tables("0.6.3", 95);
  current["문서대장"].rows[0] = [
    "문서 ID", "원본 행", "대표 계약명", "신청 계약명", "결과 계약명", "신청 작성일", "결과 작성일",
    "신청부서", "결과 신청부서", "신청 유형", "결과 유형", "유형2", "난이도", "검토유형",
    "신청 보안등급", "결과 보안등급", "원본 상태", "처리 상태", "검토 사유", "엔진 버전"
  ];
  current["문서대장"].rows[1] = [
    "OP-1", 2, "대표 계약", "신청 계약", "결과 계약", "2026-01-01", "2026-01-03",
    "신청부서", "결과부서", "신청유형", "결과유형", "행사", "중", "법률검토",
    "일반", "대외비", "", "처리 성공", "", "0.6.3"
  ];
  current["문서별관계"] = { rows: [
    ["문서 ID", "태그 A", "태그 B", "관계 유형", "연결 점수", "일반허브 감점", "공통 출처·근거", "공통 핵심쟁점 카드"],
    ["OP-1", "#위탁", "#비적용", "결론", 93, 0, "결과", ""]
  ] };
  const dataset = Knowledge.datasetFromTables(current, { fingerprint: "new-format" });
  assert.equal(dataset.documents[0].title, "대표 계약");
  assert.equal(dataset.documents[0].date, "2026-01-01");
  assert.equal(dataset.documents[0].processed_date, "2026-01-03");
  assert.equal(dataset.documents[0].department, "결과부서");
  assert.equal(dataset.documents[0].case_type, "결과유형");
  assert.equal(dataset.documents[0].security_level, "대외비");
  assert.equal(dataset.documents[0].relations[0].score, 93);
});

test("같은 자료 재반입은 중복되지 않고 변경 결과는 리비전으로 보존한다", () => {
  const first = Knowledge.datasetFromTables(tables("0.6.3", 95), { file_name: "a.xlsx", fingerprint: "f1" });
  const one = Knowledge.mergeDataset(Knowledge.emptyKnowledge(), first);
  assert.deepEqual(one.result, { added: 1, updated: 0, skipped: 0, total: 1, snapshot_id: "f1" });

  const duplicate = Knowledge.mergeDataset(one.knowledge, first);
  assert.equal(duplicate.result.skipped, 1);
  assert.equal(duplicate.knowledge.meta.revision_count, 1);

  const changed = Knowledge.datasetFromTables(tables("0.6.4", 88), { file_name: "b.xlsx", fingerprint: "f2" });
  const two = Knowledge.mergeDataset(duplicate.knowledge, changed);
  assert.equal(two.result.updated, 1);
  assert.equal(two.knowledge.meta.document_count, 1);
  assert.equal(two.knowledge.meta.revision_count, 2);
  assert.equal(two.knowledge.snapshots.length, 2);
});

test("지식팩 병합은 문서와 사람 큐레이션을 보존한다", () => {
  const left = Knowledge.mergeDataset(Knowledge.emptyKnowledge(),
    Knowledge.datasetFromTables(tables("0.6.3", 95), { fingerprint: "f1" })).knowledge;
  left.curation.decisions["map-1"] = { decision: "approved" };
  const right = Knowledge.normalizeKnowledge(Knowledge.emptyKnowledge());
  right.curation.decisions["map-2"] = { decision: "rejected" };
  const merged = Knowledge.mergeKnowledge(left, right);
  assert.equal(merged.meta.document_count, 1);
  assert.equal(merged.curation.decisions["map-1"].decision, "approved");
  assert.equal(merged.curation.decisions["map-2"].decision, "rejected");
});

test("계약 문언과 관련된 과거 태그·문서 후보를 shadow로 찾는다", () => {
  const dataset = Knowledge.datasetFromTables(tables("0.6.3", 95), { fingerprint: "f1" });
  const knowledge = Knowledge.mergeDataset(Knowledge.emptyKnowledge(), dataset).knowledge;
  const found = Knowledge.matchText(knowledge, "본 계약은 단발성 행사대행의 업무위탁 해당 여부를 정한다.");
  assert.equal(found.tags[0].tag_id, "legal_relation-위탁");
  assert.equal(found.documents[0].source_id, "OP-1");
  assert.equal(found.documents[0].hit_count, 1);
});
