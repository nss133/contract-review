"use strict";
/* 큐레이션 리포트 — 반출된 verdict JSON들(폴더)을 병합해 규칙 정교화 후보를 산출.
   방법1 사이클의 개발환경 쪽 절반: 폐쇄망에서 라벨링·반출된 판정 파일을 받아
   ① 항목별 판정 분포 ② 강등(게이트) 후보 ③ 코멘트 전문 ④ 유형별 커버리지를 뽑는다.
   병합은 loop.js mergeIntoCorpus(계약해시 멱등)를 그대로 사용 — 같은 파일 중복 투입 안전.

   실행: node build/curation_report.js <verdict-json-폴더> [--min-n 3]
   출력: stdout 마크다운 리포트(그대로 검토·논의 자료). */
const fs = require("fs");
const path = require("path");
const Loop = require("../src/loop.js");

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("사용법: node build/curation_report.js <verdict-json-폴더> [--min-n 3]");
  process.exit(1);
}
const minNArg = process.argv.indexOf("--min-n");
const MIN_N = minNArg !== -1 ? parseInt(process.argv[minNArg + 1], 10) : 3; // 부트스트랩 단계라 기본 완화(3)

// ── 병합
let corpus = Loop.emptyCorpus();
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
let loaded = 0, skipped = 0;
const byType = {}; // type_id → 계약 수
for (const f of files) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { skipped++; continue; }
  if (obj && obj.byCheck) { // 코퍼스 백업 형식(반출 집계) — 계약 단위가 아니라 통째 병합
    const before = corpus.meta.contract_count;
    corpus = Loop.mergeCorpusBackup(corpus, obj);
    if (corpus.meta.contract_count > before) {
      loaded += corpus.meta.contract_count - before;
      byType["(백업)"] = (byType["(백업)"] || 0) + (corpus.meta.contract_count - before);
    } else skipped++;
    continue;
  }
  if (!obj || !obj.verdicts) { skipped++; continue; }
  const before = corpus.meta.contract_count;
  corpus = Loop.mergeIntoCorpus(corpus, obj);
  if (corpus.meta.contract_count > before) {
    loaded++;
    const t = (obj.meta && obj.meta.type_id) || "(미상)";
    byType[t] = (byType[t] || 0) + 1;
  } else skipped++; // 동일 계약 재투입(멱등)
}

// ── 리포트
const L = [];
L.push("# 큐레이션 리포트 — 판정 데이터 기반 규칙 정교화 후보");
L.push("");
L.push(`- 입력: ${files.length}파일 → 계약 ${loaded}건 병합(중복·오류 ${skipped}건 제외)`);
L.push(`- 유형별: ${Object.entries(byType).map(([k, v]) => k + " " + v).join(" · ") || "-"}`);
L.push(`- 신호 임계: 표본 ${MIN_N}건+ (부트스트랩 완화 — 정식 운용은 5)`);
L.push("");

const sig = Loop.curationSignals(corpus, { minN: MIN_N, ratio: 0.8 });
L.push(`## ① 게이트(강등) 후보 — 반복 '해당없음' (${sig.conditional.length}건)`);
L.push("> 다음 유사 계약에서 이 알람이 안 뜨게 규칙을 고칠 후보. 판정 기준: 문언 제도채택=precondition / 문언밖 사실=conditional / 모듈 오활성=activation.");
L.push("");
for (const c of sig.conditional) {
  L.push(`- **${c.cpId}** — 표본 ${c.n}건 중 해당없음 ${c.pct}%`);
  for (const cm of Loop.topComments(corpus, c.cpId, 3))
    L.push(`  - 코멘트(×${cm.count}${cm.reviewers.length ? ", " + cm.reviewers.join("·") : ""}): ${cm.text}`);
}
if (!sig.conditional.length) L.push("- (없음 — 표본 축적 필요)");
L.push("");

L.push(`## ② 안정 항목 — 반복 '이상없음' (${sig.gold.length}건)`);
for (const g of sig.gold) L.push(`- ${g.cpId} — 표본 ${g.n}건 중 이상없음 ${g.pct}%`);
if (!sig.gold.length) L.push("- (없음)");
L.push("");

// ③ 검토의견(코멘트 있는 판정) 전문 — 신규 체크·문구 개선의 원료
L.push("## ③ 검토의견 코멘트 전문 (신규 체크·문구 개선 원료)");
const opinionRows = [];
for (const [cpId, slot] of Object.entries(corpus.byCheck)) {
  for (const cm of slot.comments) {
    if (cm.verdict === "검토의견") opinionRows.push({ cpId, cm });
  }
}
opinionRows.sort((a, b) => b.cm.count - a.cm.count);
for (const { cpId, cm } of opinionRows)
  L.push(`- [${cpId}] (×${cm.count}) ${cm.text}`);
if (!opinionRows.length) L.push("- (없음)");
L.push("");

// ④ 전 항목 분포(표본 있는 것만, 해당없음 비율 내림차순) — 임계 미달이어도 경향 확인
L.push("## ④ 항목별 판정 분포 (표본 순)");
const stats = Object.keys(corpus.byCheck)
  .map((cpId) => ({ cpId, st: Loop.checkStats(corpus, cpId) }))
  .filter((x) => x.st)
  .sort((a, b) => b.st.pct["해당없음"] - a.st.pct["해당없음"] || b.st.n - a.st.n);
L.push("| check | n | 이상없음 | 검토의견 | 해당없음 |");
L.push("|---|---|---|---|---|");
for (const { cpId, st } of stats)
  L.push(`| ${cpId} | ${st.n} | ${st.pct["이상없음"]}% | ${st.pct["검토의견"]}% | ${st.pct["해당없음"]}% |`);

console.log(L.join("\n"));
