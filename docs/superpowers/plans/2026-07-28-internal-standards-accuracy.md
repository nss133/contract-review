# 사내 표준자료 기반 정확도 향상 (안B) — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사내 표준계약서 13패킷·자체점검체크리스트·보안관리약정서 3종을 골드셋·레지스트리·형식점검으로 배선해 매칭 정확도를 구조적으로 끌어올린다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-28-internal-standards-accuracy-design.md`의 6컴포넌트를 7태스크로 구현. 검증 원료(원자료 반입·corpus 병합) → 측정 인프라(골드셋 사내표준층·recall 어서션) → 엔진(부속서류 참조 감지·형식 점검) → 지식(갭 분석) 순.

**Tech Stack:** Python 3(pyyaml·pytest) + Node(node --test, 추가 패키지 0) + 브라우저 인라인 JS(외부 의존 0).

## Global Constraints

- 완전 오프라인: 런타임 네트워크 요청 0건, 외부 라이브러리 추가 금지.
- `build/build_html.py`의 `JS_ORDER` 순서 준수 — 새 JS 모듈은 의존 순서에 맞게 삽입.
- 테스트 게이트: `python3 -m pytest tests/`(현 57) + `node --test`(무인자 — Node 24에서 디렉토리 인자 실패) + `python3 build/goldset.py`(현 15/15) + `python3 build/build_html.py`(현 check 249) 전부 통과 후 커밋.
- src/·knowledge/ 변경 태스크는 커밋 전 재빌드 + zip 재생성: `python3 build/build_html.py && (cd dist && rm -f contract-review.zip && zip -9 -q contract-review.zip contract-review.html)`.
- 한글 파일명은 NFC로 정규화해 커밋(macOS NFD 혼입 금지).
- 커밋 메시지: 기존 컨벤션(`feat:`/`docs:`/`chore:` + 한국어 본문) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 사용자 확인 게이트 2곳: Task 3(케이스 라벨 트리아지), Task 7(신규 체크 초안). 게이트 전 커밋 금지.
- 원자료 위치: `/Users/nsss/Downloads/RpDIRTJEMF/` (임시 폴더 — Task 1에서 리포로 반입). 추출 텍스트 사전 산출물: `/private/tmp/claude-501/-Users-nsss-contract-review/7f2aa1b1-66ef-4749-bc6e-03c094d39c32/scratchpad/extracted/` (세션 종료 시 소실 가능 — Task 1의 추출 명령으로 재생성 가능).

---

### Task 1: 원자료 리포 반입 — samples/internal-standards/

**Files:**
- Create: `samples/internal-standards/README.md`
- Create: `samples/internal-standards/<packet>/…` (아래 표의 원본 파일 복사)
- Create: `samples/internal-standards/extracted/…` (추출 텍스트)

**Interfaces:**
- Produces: 패킷 디렉토리 구조(아래 표의 ASCII 키). Task 3·4·7이 `extracted/*.txt`를 케이스 text·갭 분석 원료로 사용.

패킷 매핑(디렉토리명은 ASCII):

| 디렉토리 | 원본 폴더(Downloads) | 내용 |
|---|---|---|
| `ga-recruit` | 260728-112246 | GA에이전트·설계매니저 위촉계약서 + 표준위탁계약서 + 체크리스트 2종 |
| `trust` | 260728-112310 | 보험금청구권신탁 계약서 제·개정안 |
| `it-svc` | 260728-112334 | IT Project 용역위탁계약서(보증보험 有/無) + 체크리스트 |
| `ad-online` | 260728-112352 | 온라인 광고 표준계약서 + 체크리스트 |
| `purchase` | 260728-112410 | 물품(용역)구매약정서 + 체크리스트 |
| `sponsor` | 260728-112430 | 후원약정서 + 체크리스트 |
| `ad-media` | 260728-112441 | 언론사 광고계약서 + 체크리스트 |
| `edu-svc` | 260728-112500 | 교육용역계약서 + 체크리스트 |
| `ga-annex` | 260728-112512 | GA 부속약정서(지원·자립) 7종 + 체크리스트 |
| `ga-transfer` | 260728-112528 | GA간 영업양수도 5종 + 체크리스트 (112542는 동일 중복 — 제외) |
| `lease-lessor` | 260728-112610 | 표준임대차계약서(당사임대인용) + 체크리스트 |
| `edu-train` | 260728-112622 | 교육위탁훈련계약서 샘플 PDF 3종 + 체크리스트 |
| `pii-agreements` | (루트 3파일) | 개인신용정보 보안관리약정서 일반·재위탁·GA |
| `lease-lessee` | (루트 1파일) | 임대차(당사임차인용) 자체점검체크리스트 |

- [ ] **Step 1: 복사 + NFC 정규화**

```bash
cd /Users/nsss/contract-review
python3 - <<'EOF'
import shutil, unicodedata
from pathlib import Path
SRC = Path("/Users/nsss/Downloads/RpDIRTJEMF")
DST = Path("samples/internal-standards")
PACKETS = {
    "ga-recruit": "260728-112246", "trust": "260728-112310", "it-svc": "260728-112334",
    "ad-online": "260728-112352", "purchase": "260728-112410", "sponsor": "260728-112430",
    "ad-media": "260728-112441", "edu-svc": "260728-112500", "ga-annex": "260728-112512",
    "ga-transfer": "260728-112528", "lease-lessor": "260728-112610", "edu-train": "260728-112622",
}
for key, folder in PACKETS.items():
    d = DST / key; d.mkdir(parents=True, exist_ok=True)
    for f in (SRC / folder).iterdir():
        if f.is_file():
            shutil.copy2(f, d / unicodedata.normalize("NFC", f.name))
pii = DST / "pii-agreements"; pii.mkdir(exist_ok=True)
lease = DST / "lease-lessee"; lease.mkdir(exist_ok=True)
for f in SRC.iterdir():
    if f.suffix == ".doc" and "보안관리약정서" in unicodedata.normalize("NFC", f.name):
        shutil.copy2(f, pii / unicodedata.normalize("NFC", f.name))
    if f.suffix == ".xls" and "임차인용" in unicodedata.normalize("NFC", f.name):
        shutil.copy2(f, lease / unicodedata.normalize("NFC", f.name))
print("복사 완료:", sum(1 for _ in DST.rglob("*") if _.is_file()), "파일")
EOF
```

Expected: `복사 완료: 46 파일` 안팎(112542 중복 제외분).

- [ ] **Step 2: 텍스트 추출 → extracted/**

`.doc/.docx`는 macOS `textutil`, `.xls/.xlsx`는 xlrd/openpyxl(로컬 개발환경 전용 — 빌드 파이프라인 의존 아님), `.pdf`(edu-train 샘플 3종)는 추출 생략(체크리스트만 추출).

```bash
cd /Users/nsss/contract-review/samples/internal-standards
mkdir -p extracted
find . -name "*.doc" -o -name "*.docx" | while read f; do
  out="extracted/$(echo "${f#./}" | tr '/' '__')"
  textutil -convert txt -output "${out%.*}.txt" "$f"
done
python3 - <<'EOF'
import glob, os
import xlrd, openpyxl  # pip3 install xlrd (1회) — openpyxl은 기설치
for f in glob.glob("**/*.xls*", recursive=True):
    if f.startswith("extracted"): continue
    dest = os.path.join("extracted", os.path.splitext(f.replace("/", "__"))[0] + ".txt")
    rows = []
    if f.endswith(".xls"):
        wb = xlrd.open_workbook(f)
        for sh in wb.sheets():
            for r in range(sh.nrows):
                vals = [str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)]
                if any(vals): rows.append(" | ".join(v for v in vals if v))
    else:
        wb = openpyxl.load_workbook(f, data_only=True)
        for sh in wb.worksheets:
            for row in sh.iter_rows(values_only=True):
                vals = [str(v).strip() for v in row if v is not None and str(v).strip()]
                if vals: rows.append(" | ".join(vals))
    open(dest, "w").write("\n".join(rows))
print("xls 추출 완료")
EOF
ls extracted | wc -l
```

Expected: extracted에 40개 안팎 .txt.

- [ ] **Step 3: README 작성**

`samples/internal-standards/README.md`:

```markdown
# 사내 표준자료 (2026-07-28 반입)

미래에셋생명 표준계약서·자체점검체크리스트·보안관리약정서. 대외 배포 서식이라 커밋 가능(2026-07-28 손남수 확인).
용도: 골드셋 사내표준층(케이스 16~28)·부속서류 레지스트리·형식점검·갭 분석의 원료.

- 원본: 각 패킷 디렉토리(버전은 파일명의 ver.표기 참조). `extracted/`는 textutil·xlrd 추출 텍스트.
- 260728-112542(GA간 영업양수도)는 112528과 동일 중복이라 제외.
- edu-train의 PDF 샘플 3종은 텍스트 추출 생략(체크리스트만 추출).
- 재추출 절차: docs/superpowers/plans/2026-07-28-internal-standards-accuracy.md Task 1 Step 2.
```

- [ ] **Step 4: 검증 — 기존 게이트 무영향 확인**

Run: `python3 -m pytest tests/ -q && python3 build/goldset.py | tail -1`
Expected: 전부 통과(samples/는 빌드·테스트 대상 아님), `골드셋: 15/15 통과`.

- [ ] **Step 5: Commit**

```bash
git add samples/internal-standards
git commit -m "feat: 사내 표준자료 반입 — 13패킷+보안관리약정서 3종 (정확도 원료)"
```

---

### Task 2: corpus 백업 병합(loop.js) + 큐레이션 리포트 산출

**Files:**
- Modify: `src/loop.js` (mergeCorpusBackup 추가, exports 갱신)
- Modify: `build/curation_report.js:26-37` (byCheck 형식 분기)
- Test: `tests/loop.test.js` (기존 파일에 테스트 추가; 없으면 신설)
- Create: `verifications/curation-report-20260728.md` (리포트 산출물)

**Interfaces:**
- Consumes: `Loop.emptyCorpus()`, `Loop.mergeIntoCorpus(corpus, exportObj)`, `_ensureCheck` (src/loop.js 기존)
- Produces: `Loop.mergeCorpusBackup(corpus, backup) → corpus` — backup은 `{meta:{hashes,contract_count,updated}, byCheck}` 형식(코퍼스 백업). Task 7이 리포트 산출물을 갭 분석 입력으로 사용.

배경: 사용자 제공 `contract-review-corpus-backup.json`은 verdict 내보내기(`{meta, verdicts}`)가 아니라 이미 집계된 코퍼스(`{meta, byCheck}`) — 현행 `mergeIntoCorpus`로 처리 불가. 집계라 계약 단위 분해가 불가능하므로 멱등 규칙: 백업의 해시 중 하나라도 기적재면 전체 스킵.

- [ ] **Step 1: 실패 테스트 작성** — `tests/loop.test.js`에 추가 (파일이 없으면 헤더 포함 신설: `"use strict"; const { test } = require("node:test"); const assert = require("node:assert"); const Loop = require("../src/loop.js");`)

```js
test("mergeCorpusBackup: 코퍼스 백업(byCheck) 병합", () => {
  const backup = {
    meta: { updated: "2026-07-15", contract_count: 2, hashes: ["cr-a", "cr-b"] },
    byCheck: { "CMN-11": { counts: { "이상없음": 2, "검토의견": 0, "해당없음": 0 },
      comments: [{ text: "조항 있음", verdict: "이상없음", count: 1, reviewers: ["손남수"], date: "2026-07-15" }],
      lastSeen: "2026-07-15" } },
  };
  const c1 = Loop.mergeCorpusBackup(Loop.emptyCorpus(), backup);
  assert.strictEqual(c1.meta.contract_count, 2);
  assert.strictEqual(c1.byCheck["CMN-11"].counts["이상없음"], 2);
  assert.strictEqual(c1.byCheck["CMN-11"].comments[0].reviewers[0], "손남수");
  // 멱등: 같은 백업 재투입 — 해시 겹침 → 전체 스킵
  const c2 = Loop.mergeCorpusBackup(c1, backup);
  assert.strictEqual(c2.meta.contract_count, 2);
  assert.strictEqual(c2.byCheck["CMN-11"].counts["이상없음"], 2);
});

test("mergeCorpusBackup: 기존 코퍼스와 코멘트 병합(동문 합산)", () => {
  const base = Loop.mergeIntoCorpus(Loop.emptyCorpus(), {
    meta: { contract_hash: "cr-x", reviewer: "손남수", date: "2026-07-16" },
    verdicts: { "CMN-11": { verdict: "이상없음", comment: "조항 있음" } },
  });
  const backup = {
    meta: { updated: "2026-07-15", contract_count: 1, hashes: ["cr-a"] },
    byCheck: { "CMN-11": { counts: { "이상없음": 1, "검토의견": 0, "해당없음": 0 },
      comments: [{ text: "조항 있음", verdict: "이상없음", count: 2, reviewers: ["김검토"], date: "2026-07-15" }],
      lastSeen: "2026-07-15" } },
  };
  const m = Loop.mergeCorpusBackup(base, backup);
  assert.strictEqual(m.meta.contract_count, 2);
  assert.strictEqual(m.byCheck["CMN-11"].counts["이상없음"], 2);
  assert.strictEqual(m.byCheck["CMN-11"].comments[0].count, 3); // 1+2 합산
  assert.deepStrictEqual(m.byCheck["CMN-11"].comments[0].reviewers.sort(), ["김검토", "손남수"]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/loop.test.js`
Expected: FAIL — `Loop.mergeCorpusBackup is not a function`

- [ ] **Step 3: 구현** — `src/loop.js`의 `curationSignals` 함수 뒤, return 객체 앞에 추가:

```js
  // 코퍼스 백업({meta:{hashes…}, byCheck}) 병합 — export JSON이 아닌 이미 집계된 코퍼스.
  // 집계라 계약 단위 분해가 불가하므로 멱등 규칙: 백업 해시가 하나라도 기적재면 전체 스킵.
  function mergeCorpusBackup(corpus, backup) {
    var next = JSON.parse(JSON.stringify(corpus || emptyCorpus()));
    if (!backup || !backup.byCheck || !backup.meta) return next;
    var hashes = backup.meta.hashes || [];
    for (var i = 0; i < hashes.length; i++)
      if (next.meta.hashes.indexOf(hashes[i]) !== -1) return next;
    next.meta.hashes = next.meta.hashes.concat(hashes);
    next.meta.contract_count += backup.meta.contract_count || hashes.length;
    Object.keys(backup.byCheck).forEach(function (cpId) {
      var src = backup.byCheck[cpId];
      var slot = _ensureCheck(next, cpId);
      VERDICTS.forEach(function (v) { slot.counts[v] += (src.counts && src.counts[v]) || 0; });
      (src.comments || []).forEach(function (cm) {
        var found = null;
        for (var j = 0; j < slot.comments.length; j++)
          if (slot.comments[j].text === cm.text) { found = slot.comments[j]; break; }
        if (found) {
          found.count += cm.count || 1;
          (cm.reviewers || []).forEach(function (r) {
            if (r && found.reviewers.indexOf(r) === -1) found.reviewers.push(r);
          });
        } else slot.comments.push(JSON.parse(JSON.stringify(cm)));
      });
      if (src.lastSeen && src.lastSeen > (slot.lastSeen || "")) slot.lastSeen = src.lastSeen;
    });
    if (backup.meta.updated && backup.meta.updated > (next.meta.updated || ""))
      next.meta.updated = backup.meta.updated;
    return next;
  }
```

return 객체에 `mergeCorpusBackup: mergeCorpusBackup,` 추가.

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/loop.test.js`
Expected: PASS (신규 2 포함)

- [ ] **Step 5: curation_report.js 분기** — 파일 루프(26-37행)의 `if (!obj || !obj.verdicts)` 앞에 코퍼스 백업 분기:

```js
  if (obj && obj.byCheck) { // 코퍼스 백업 형식(반출 집계) — 계약 단위가 아니라 통째 병합
    const before = corpus.meta.contract_count;
    corpus = Loop.mergeCorpusBackup(corpus, obj);
    if (corpus.meta.contract_count > before) {
      loaded += corpus.meta.contract_count - before;
      byType["(백업)"] = (byType["(백업)"] || 0) + (corpus.meta.contract_count - before);
    } else skipped++;
    continue;
  }
```

- [ ] **Step 6: 리포트 산출·보존**

```bash
node build/curation_report.js /Users/nsss/Downloads/RpDIRTJEMF --min-n 3 > verifications/curation-report-20260728.md
head -30 verifications/curation-report-20260728.md
```

Expected: `계약 8건 병합`, ①게이트 후보(있다면 SP-DEL 계열), ③검토의견에 SP-DEL-03 불가항력 코멘트. 리포트의 후보 목록은 Task 7 입력.

- [ ] **Step 7: 전체 게이트 + Commit**

Run: `python3 -m pytest tests/ -q && node --test && python3 build/goldset.py | tail -1 && python3 build/build_html.py && (cd dist && rm -f contract-review.zip && zip -9 -q contract-review.zip contract-review.html)`
Expected: 전부 통과.

```bash
git add src/loop.js build/curation_report.js tests/loop.test.js verifications/curation-report-20260728.md dist/
git commit -m "feat: 코퍼스 백업 병합 지원 + 실계약 8건 큐레이션 리포트"
```

---

### Task 3: 골드셋 사내표준층 — 케이스 16~28 (사용자 게이트)

**Files:**
- Create: `tests/goldset/cases/16-mal-ga-recruit.yaml` ~ `28-mal-lease-lessor.yaml` (13건)
- Modify: (트리아지 결과에 따라) `knowledge/common.yaml`·`knowledge/types/*.yaml`의 게이트 필드

**Interfaces:**
- Consumes: Task 1의 `samples/internal-standards/extracted/*.txt`, 기존 케이스 스키마(`id/desc/text/detect_expected/consider_must_include/consider_must_exclude(_prefix)/active_must_include/active_must_exclude/addressed_must_exclude`)
- Produces: 케이스 16~28. Task 4의 케이스 30이 it-svc 케이스 text를 재사용.

케이스·기대 유형 초안(트리아지에서 사용자 확정 — 결정 A: 유형 신설 없이 최근접):

| # | 케이스 id | 원료(extracted) | detect_expected 초안 |
|---|---|---|---|
| 16 | mal-ga-recruit | ga-recruit GA에이전트 위촉계약서 | channel |
| 17 | mal-ga-std-consign | ga-recruit 표준위탁계약서(개인보험대리점) | channel |
| 18 | mal-trust | trust 보험금청구권신탁 개정안 | investment |
| 19 | mal-it-svc | it-svc IT용역위탁(보증보험有) | procurement |
| 20 | mal-ad-online | ad-online 온라인 광고 | procurement |
| 21 | mal-ad-media | ad-media 언론사 광고 | procurement |
| 22 | mal-sponsor | sponsor 후원약정서 | alliance |
| 23 | mal-purchase | purchase 물품(용역)구매약정서 | procurement |
| 24 | mal-edu-svc | edu-svc 교육용역계약서 | procurement |
| 25 | mal-ga-annex | ga-annex 자립GA부속약정서 | channel |
| 26 | mal-ga-transfer | ga-transfer 영업양수도 계약서(1번) | channel |
| 27 | mal-lease-lessor | lease-lessor 표준임대차(임대인용) | 케이스 12(std-lease)와 동일 라벨 사용 |
| 28 | mal-edu-train — PDF 추출 불가 시 케이스 생략하고 27건으로 종료(README에 사유 기재) | edu-train | procurement |

- [ ] **Step 1: 케이스 스캐폴드 생성(라벨 최소)** — 13건을 스크립트로 생성. text는 extracted 원문 전문(YAML block scalar `text: |`). 이 단계에서는 `detect_expected`만 라벨:

```bash
cd /Users/nsss/contract-review
python3 - <<'EOF'
import yaml
from pathlib import Path
EX = Path("samples/internal-standards/extracted")
CASES = Path("tests/goldset/cases")
# (번호, id, extracted 파일명 부분일치 키, 기대유형, 설명)
ROWS = [
    (16, "mal-ga-recruit", "GA에이전트_위촉계약서", "channel", "사내표준 GA에이전트 위촉"),
    (17, "mal-ga-std-consign", "표준위탁계약서,위탁계약부속약정서", "channel", "사내표준 개인보험대리점 위탁"),
    (18, "mal-trust", "보험금청구권신탁 계약서 개정안", "investment", "사내표준 보험금청구권신탁"),
    (19, "mal-it-svc", "이행보증보험有", "procurement", "사내표준 IT용역위탁"),
    (20, "mal-ad-online", "온라인 광고 계약서", "procurement", "사내표준 온라인 광고"),
    (21, "mal-ad-media", "__광고계약서", "procurement", "사내표준 언론사 광고"),
    (22, "mal-sponsor", "후원약정서", "alliance", "사내표준 후원약정"),
    (23, "mal-purchase", "물품(용역)구매약정서", "procurement", "사내표준 물품·용역 구매"),
    (24, "mal-edu-svc", "교육용역계약서(표준계약서)", "procurement", "사내표준 교육용역"),
    (25, "mal-ga-annex", "표준_자립GA부속약정서.", "channel", "사내표준 자립GA 부속약정"),
    (26, "mal-ga-transfer", "영업양수도_계약서", "channel", "사내표준 GA간 영업양수도"),
    (27, "mal-lease-lessor", "표준임대차계약서(당사임대인용)", None, "사내표준 임대차(임대인용)"),
]
# 케이스 12의 라벨을 임대차 기대값으로 재사용
lease_label = yaml.safe_load((CASES / "12-std-lease.yaml").read_text())["detect_expected"]
for n, cid, key, expected, desc in ROWS:
    hits = [p for p in EX.glob("*.txt") if key in p.name]
    assert len(hits) == 1, f"{cid}: 원료 파일 특정 실패 {hits}"
    text = hits[0].read_text()
    case = {"id": cid, "desc": f"{desc} — 표준서식 회귀(사내표준층)",
            "detect_expected": expected if expected is not None else lease_label,
            "text": text}
    out = CASES / f"{n:02d}-{cid}.yaml"
    header = ("# 사내표준층(3층 골드셋의 2층 확장) — 법무검토 완료 서식이므로 필수 알람은 원칙적으로 0.\n"
              f"# 원문: samples/internal-standards/ 참조. 라벨 확정: 트리아지(2026-07-28) 후.\n")
    out.write_text(header + yaml.dump(case, allow_unicode=True, default_flow_style=False, sort_keys=False))
    print("생성:", out.name, len(text), "chars")
EOF
```

주의: 28(edu-train)은 PDF 원문이라 스캐폴드에서 제외 — 케이스는 16~27의 12건이 기본이고, 필요 시 kordoc 등으로 PDF 추출이 되면 28을 추가한다(생략 시 이후 단계의 "27건"은 "26건"으로 읽음).

- [ ] **Step 2: 1차 실행 — 트리아지 표 산출**

Run: `python3 build/goldset.py`
Expected: 신규 케이스에서 감지 불일치·consider 다수 노출(실패 예상 — 이것이 트리아지 원료).
각 신규 케이스의 (감지 유형, consider 목록)을 표로 정리해 `verifications/goldset-triage-20260728.md`에 저장:

```bash
python3 build/goldset.py > verifications/goldset-triage-20260728.md 2>&1 || true
```

- [ ] **Step 3: 사용자 게이트 — 라벨·오탐 확정** (AskUserQuestion 또는 대화)

사용자와 함께 케이스별로: ① detect_expected 확정(불일치 시 최근접 유형 재선택 또는 `null`(미확정 폴백) 라벨 + detect_keywords 보강 여부) ② consider 항목을 {진성 공백(라벨 안 함) / 오탐(수정+exclude 라벨)}로 분류. 오탐 수정은 기존 관례를 따름: 모듈 오활성 → `activation: strong/confirm`, 문언 제도채택 → `absence_precondition`, 어휘 충돌 → 신호 제거.

- [ ] **Step 4: 확정 라벨·게이트 수정 반영 → 통과 확인**

Run: `python3 build/goldset.py`
Expected: `골드셋: 27/27 통과` (15 기존 + 12 신규). before/after는 Step 2 트리아지 파일과 대비.

- [ ] **Step 5: 전체 게이트 + Commit**

Run: `python3 -m pytest tests/ -q && node --test && python3 build/build_html.py && (cd dist && rm -f contract-review.zip && zip -9 -q contract-review.zip contract-review.html)`

```bash
git add tests/goldset/cases knowledge verifications/goldset-triage-20260728.md dist/
git commit -m "feat: 골드셋 사내표준층 12케이스 — 사내 표준서식 오탐 고정"
```

(커밋 본문에 트리아지에서 교정한 오탐 건수·내용 요약 기재)

---

### Task 4: recall·부속서류 어서션 + 보안관리약정서 케이스

**Files:**
- Modify: `build/goldset_runner.js` (force_type·subdoc_text 지원, subdoc_covered 출력)
- Modify: `build/goldset.py:52-86 score()` (addressed_must_include·subdoc_must_cover 채점)
- Create: `tests/goldset/cases/29-pii-agreement-recall.yaml`
- Create: `tests/goldset/cases/30-it-svc-with-pii-subdoc.yaml`

**Interfaces:**
- Consumes: `subDocCoverage(considerCps, subDocs, model)`·`buildModel(docs, activeModules)`·`segmentContract(text)` (src/matcher.js·segmenter.js — module.exports에 포함돼 있는지 확인, 없으면 exports에 추가), `analyze` 반환의 `checkpoints`·`results`
- Produces: 러너 출력 필드 `subdoc_covered: [cpId]`, 케이스 필드 `force_type`(감지 대신 강제 유형)·`subdoc_text`·`addressed_must_include[]`·`subdoc_must_cover[]`. Task 5의 케이스 31이 `ref_covered` 채점을 이어서 추가.

- [ ] **Step 1: goldset.py 채점 확장** — `score()`의 addressed 블록 아래 추가:

```python
        for cid in c.get("addressed_must_include") or []:
            if cid not in addressed:
                errs.append(f"반영검출 실패: {cid}가 addressed에 없음")
        subcov = set(r.get("subdoc_covered") or [])
        for cid in c.get("subdoc_must_cover") or []:
            if cid not in subcov:
                errs.append(f"부속커버 실패: {cid}가 subdoc_covered에 없음")
```

- [ ] **Step 2: 러너 확장** — `build/goldset_runner.js`:

`detected` 결정을 force_type 우선으로:

```js
  const detected = c.force_type || pickType(ranked);
```

`analyze` 호출 뒤, return 앞에:

```js
  // subdoc_text(선택): 부속서류 커버리지(#3) 재현 — app.js runAnalysis와 동일 경로.
  let subdocCovered = [];
  if (c.subdoc_text) {
    const considerCps = r.checkpoints.filter(function (cp) {
      return r.results.some(function (x) { return x.cpId === cp.id && x.coverage === "consider"; });
    });
    const model = buildModel(docs, active);
    const cov = subDocCoverage(considerCps,
      [{ name: "subdoc", clauses: segmentContract(String(c.subdoc_text)) }], model);
    subdocCovered = Object.keys(cov);
  }
```

require에 `buildModel, subDocCoverage` 추가, return 객체에 `subdoc_covered: subdocCovered,` 추가. `subDocCoverage`가 matcher.js exports에 없으면 exports에 추가.

- [ ] **Step 3: 케이스 29 — 약정서 recall.** 약정서(일반) 조문↔PRIV 대조(설계 §3):

| 약정서 조문 | check |
|---|---|
| 제2조 정보이전 범위·목적·기간 | PRIV-04 |
| 제3조 목적외 이용 금지 | PRIV-02, PRIV-14 |
| 제5조 재위탁 제한·승낙 | PRIV-05, PRIV-15, PRIV-21 |
| 제6조 기술·관리·물리적 보호조치 | PRIV-03, PRIV-19 |
| 제7조 활용 통제·접근 제한 | PRIV-06 |
| 제10조 관리·감독 | PRIV-07, PRIV-13 |
| 제12조 손해배상 | PRIV-08 |
| 제16조 교육 | PRIV-20 |

```yaml
# recall 케이스(#3): 보안관리약정서(일반)를 입력하면 X-PII 체크가 addressed로 잡혀야 함.
# 골드셋 최초의 반영(addressed) 검출 어서션 — 지금까지는 detect·consider(오탐) 중심이었음.
# 조문↔check 대조는 plans/2026-07-28-internal-standards-accuracy.md Task 4 참조.
id: pii-agreement-recall
desc: 보안관리약정서(일반) — X-PII 반영 검출(recall)
force_type: outsourcing
active_must_include: [X-PII]
addressed_must_include: [PRIV-02, PRIV-03, PRIV-04, PRIV-05, PRIV-06, PRIV-07, PRIV-08, PRIV-13, PRIV-14, PRIV-15, PRIV-19, PRIV-20, PRIV-21]
text: |
  <samples/internal-standards/extracted/pii-agreements__…(일반)….txt 전문 삽입>
```

- [ ] **Step 4: 케이스 30 — 본계약+약정서 부속서류.**

```yaml
# 부속서류 커버(#3) 재현: IT용역 본계약(X-PII 조항 없음)에 약정서를 부속서류로 첨부하면
# 주계약 consider였던 PRIV 항목이 subdoc_covered로 잡혀야 함.
id: it-svc-with-pii-subdoc
desc: IT용역 본계약 + 보안관리약정서 부속 — 부속서류 커버 검증
detect_expected: procurement
subdoc_must_cover: [PRIV-02, PRIV-03, PRIV-05]   # 1차 실행에서 실측 후 확장
text: |
  <케이스 19(mal-it-svc)와 동일 text>
subdoc_text: |
  <케이스 29와 동일 약정서 전문>
```

- [ ] **Step 5: 실행 — 실패 항목 분석·확정**

Run: `python3 build/goldset.py`
케이스 29·30의 실패 항목별로: 매칭이 닿아야 정상인 것(check 문구·trigger가 약정서 문언과 어긋난 경우 → 지식 보강)과 기대가 과했던 것(예: PRIV-21 재위탁 금지 규범이 약정서 제5조 '제한' 문언과 불일치 → 어서션에서 제외하고 케이스 주석에 사유 기재)을 구분해 확정. 전 항목 임의 삭제 금지 — 제외에는 주석 사유 필수.

- [ ] **Step 6: 통과 확인 + 전체 게이트 + Commit**

Run: `python3 build/goldset.py && python3 -m pytest tests/ -q && node --test`
Expected: `골드셋: 29/29 통과` (27+2).

```bash
git add build/goldset_runner.js build/goldset.py tests/goldset/cases/29-* tests/goldset/cases/30-*
git commit -m "feat: 골드셋 recall·부속커버 어서션 — 보안관리약정서 2케이스"
```

---

### Task 5: 표준 부속서류 레지스트리 + 참조 감지 (엔진·UI)

**Files:**
- Modify: `knowledge/common.yaml` (meta.standard_subdocs 신설)
- Modify: `build/validate.py:62-127 _validate()` (standard_subdocs 검증)
- Modify: `src/matcher.js` (detectSubdocRefs 추가·export)
- Modify: `src/app.js` (runAnalysis 배선 + 조항별·리포트 그룹 렌더)
- Modify: `src/style.css` (cov-refdoc 배지)
- Modify: `build/goldset_runner.js` (ref_covered 출력), `build/goldset.py` (refcover 채점)
- Create: `tests/subdocref.test.js`, `tests/goldset/cases/31-outsourcing-pii-ref.yaml`
- Test(파이썬): `tests/test_validate.py`에 standard_subdocs 검증 테스트 추가

**Interfaces:**
- Consumes: Task 4의 조문↔check 대조(covers 목록), app.js의 `state.subDocCov`(기계매칭 우선 규칙), 기존 `mustCovered` 분리 렌더 패턴(app.js:1084-1092·1220-1223)
- Produces: `detectSubdocRefs(fullText, defs) → [{id,title,signal,quote,covers}]`, `state.refCov = {cpId: {title,signal,quote}}`, 러너 출력 `ref_covered: [cpId]`, 케이스 필드 `refcover_must_include[]`

- [ ] **Step 1: 실패 테스트 — `tests/subdocref.test.js`**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const M = require("../src/matcher.js");

const DEFS = [{
  id: "SUBDOC-PII", title: "개인(신용)정보 보안관리약정서",
  ref_signals: ["보안관리약정서", "보안관리 약정", "개인(신용)정보보안관리약정"],
  covers: ["PRIV-02", "PRIV-03"],
}];

test("detectSubdocRefs: 참조 문구 감지 + 주변 quote", () => {
  const text = "제13조(별첨) 본 계약의 별첨으로 개인(신용)정보 보안관리약정서를 체결하여 계약의 일부로 한다.";
  const refs = M.detectSubdocRefs(text, DEFS);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].id, "SUBDOC-PII");
  assert.ok(refs[0].quote.includes("보안관리약정서"));
  assert.deepStrictEqual(refs[0].covers, ["PRIV-02", "PRIV-03"]);
});

test("detectSubdocRefs: 참조 없으면 빈 배열", () => {
  assert.deepStrictEqual(M.detectSubdocRefs("일반 위탁계약 본문", DEFS), []);
});

test("detectSubdocRefs: 한 서류는 첫 신호에서 1회만", () => {
  const text = "보안관리약정서… 보안관리 약정…";
  assert.strictEqual(M.detectSubdocRefs(text, DEFS).length, 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/subdocref.test.js`
Expected: FAIL — `detectSubdocRefs is not a function`

- [ ] **Step 3: matcher.js 구현** — `subDocCoverage` 함수 아래에 추가, exports에 `detectSubdocRefs` 등록:

```js
// 표준 부속서류 참조 감지(#4): 본문이 별첨 약정서 체결을 참조하면 그 서류가 커버하는
// check들을 "별첨 참조" 그룹으로 묶을 근거를 준다. addressed로 치지 않음 —
// N건 알람을 "약정서 체결·첨부 여부 확인" 1건으로 전환하는 용도. 증적: 참조 문구 quote.
function detectSubdocRefs(fullText, defs) {
  var out = [];
  var t = String(fullText || "");
  (defs || []).forEach(function (d) {
    var sigs = d.ref_signals || [];
    for (var i = 0; i < sigs.length; i++) {
      var idx = t.indexOf(sigs[i]);
      if (idx !== -1) {
        var s = Math.max(0, idx - 40), e = Math.min(t.length, idx + sigs[i].length + 40);
        out.push({ id: d.id, title: d.title, signal: sigs[i],
          quote: t.slice(s, e).replace(/\s+/g, " ").trim(), covers: (d.covers || []).slice() });
        break; // 서류당 첫 신호 1회
      }
    }
  });
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/subdocref.test.js` → PASS

- [ ] **Step 5: knowledge/common.yaml 레지스트리** — `meta:` 아래(modules와 같은 층위):

```yaml
  # 표준 부속서류 레지스트리(#4): 본계약이 별첨 체결을 참조하면 covers의 부재알람을
  # "별첨 참조 — 체결·첨부 여부 확인" 그룹으로 전환. 기계매칭(부속서류 업로드)이 항상 우선.
  standard_subdocs:
    - id: SUBDOC-PII
      title: 개인(신용)정보 보안관리약정서
      ref_signals: [보안관리약정서, 보안관리 약정, 개인(신용)정보보안관리약정, 정보보안관리약정]
      covers: [PRIV-02, PRIV-03, PRIV-04, PRIV-05, PRIV-06, PRIV-07, PRIV-08, PRIV-13, PRIV-14, PRIV-15, PRIV-19, PRIV-20, PRIV-21]
```

(covers는 Task 4 케이스 29에서 확정된 목록과 동일하게 맞춤)

- [ ] **Step 6: validate.py 검증 + 테스트** — `_validate()` 끝에 추가:

```python
    subdocs = common["meta"].get("standard_subdocs", [])
    if not isinstance(subdocs, list):
        raise ValidationError("meta.standard_subdocs는 리스트여야 함")
    for sd in subdocs:
        missing = {"id", "title", "ref_signals", "covers"} - sd.keys()
        if missing:
            raise ValidationError(f"standard_subdocs: {sorted(missing)} 필요")
        for cid in sd["covers"]:
            if cid not in seen_ids:
                raise ValidationError(f"standard_subdocs {sd['id']}: 존재하지 않는 check '{cid}'")
```

`tests/test_validate.py`에 추가(기존 테스트의 지식 픽스처 구성 관례를 따름):

```python
def test_standard_subdocs_unknown_check_rejected(tmp_path):
    # 기존 픽스처 헬퍼로 최소 지식 구성 후 meta.standard_subdocs에 미존재 check를 넣으면
    # ValidationError. 헬퍼가 없으면 이 파일의 기존 테스트가 쓰는 YAML 문자열 방식을 복제.
    ...  # 구현 시 기존 test_validate.py의 픽스처 패턴을 그대로 복제해 작성
```

Run: `python3 -m pytest tests/test_validate.py -q` → PASS

- [ ] **Step 7: app.js 배선** — `runAnalysis()`의 subDocCov 블록 다음에:

```js
  // 별첨 참조(#4): 부속서류 파일 미업로드분에 한해, 본문이 표준 부속서류 체결을 참조하면
  // covers에 속한 consider 항목을 "별첨 참조" 그룹으로 분류(기계매칭 subDocCov 우선).
  var fullText = state.clauses.map(function (cl) { return (cl.title ? cl.title + "\n" : "") + cl.body; }).join("\n\n");
  // ↑ matcher.js analyze의 fullText 구성과 동일해야 함 — 구현 시 analyze 내 표현식을 복사해 맞출 것.
  state.refCov = {};
  detectSubdocRefs(fullText, (CR.common.meta || {}).standard_subdocs || []).forEach(function (ref) {
    ref.covers.forEach(function (cpId) {
      if (!state.subDocCov[cpId]) state.refCov[cpId] = { title: ref.title, signal: ref.signal, quote: ref.quote };
    });
  });
```

렌더: 기존 부속서류 커버(#③) 분리 패턴을 그대로 확장 —
1) 조항별 보기(app.js:975 부근 subdoc-covered 그룹 아래)에 동형 그룹 추가: 헤더 `'<span class="badge cov-refdoc">◇ 별첨 참조</span> 별첨 약정서로 커버 예정'`, 힌트 `'본문이 표준 부속서류 체결을 정하고 있음 — 약정서 체결·첨부 여부만 확인하세요.'`, 각 항목에 `title="근거: " + refCov.quote`.
2) 리포트(app.js:1220 부근)에 동형 섹션 `"별첨 약정서 참조 (n)"` — 참조 quote 1줄 표기.
3) 검토 제안 카운트(app.js:953 부근)에서 refCov 항목은 별도 집계(`"별첨참조 " + n`).
4) `style.css`: `.cov-refdoc { … }` — 기존 `.cov-subdoc` 규칙 복제 후 색만 구분(중립 회청색).

- [ ] **Step 8: 러너·채점 확장 + 케이스 31**

러너(return 앞): 

```js
  // 별첨 참조(#4) 재현 — 기계매칭(subdoc_covered)이 우선.
  const refs = detectSubdocRefs(text, (common.meta || {}).standard_subdocs || []);
  const refCovered = [];
  refs.forEach(function (ref) {
    ref.covers.forEach(function (id) {
      if (consider.indexOf(id) !== -1 && subdocCovered.indexOf(id) === -1 && refCovered.indexOf(id) === -1)
        refCovered.push(id);
    });
  });
```

(러너에서 `consider` 배열을 return 전에 변수로 뽑아 재사용하도록 정리.) require에 `detectSubdocRefs` 추가, return에 `ref_covered: refCovered,` 추가.

goldset.py `score()`에:

```python
        refcov = set(r.get("ref_covered") or [])
        for cid in c.get("refcover_must_include") or []:
            if cid not in refcov:
                errs.append(f"별첨참조 실패: {cid}가 ref_covered에 없음")
```

케이스 31:

```yaml
# 별첨 참조(#4): 본계약이 보안관리약정서 별첨 체결을 정하면(파일 미첨부)
# X-PII 부재알람이 "별첨 참조" 그룹으로 전환돼야 함.
id: outsourcing-pii-ref
desc: 위탁 본계약 + 약정서 별첨 참조 — X-PII 알람의 별첨 참조 전환
detect_expected: outsourcing
refcover_must_include: [PRIV-02, PRIV-03, PRIV-05]
text: |
  업무위탁계약서

  제1조(목적) 갑은 을에게 보험계약 관리 지원 업무를 위탁하고 을은 이를 수탁하여 수행한다.
  제2조(위탁업무의 범위) 위탁업무는 계약 관리 자료 정리, 안내문 발송 지원으로 한다.
  제3조(개인정보의 보호) 갑과 을은 위탁업무와 관련한 고객 개인정보 및 신용정보의 보호에 관하여
  별첨 개인(신용)정보 보안관리약정서를 체결하며, 동 약정서는 본 계약의 일부를 구성한다.
  제4조(수수료) 갑은 을에게 월 처리 건수에 따라 위탁수수료를 지급한다.
  제5조(계약기간) 본 계약의 기간은 계약 체결일로부터 1년으로 한다.
```

- [ ] **Step 9: 통과 확인 + 전체 게이트 + Commit**

Run: `python3 build/goldset.py && python3 -m pytest tests/ -q && node --test && python3 build/build_html.py && (cd dist && rm -f contract-review.zip && zip -9 -q contract-review.zip contract-review.html)`
Expected: `골드셋: 30/30 통과`, 빌드 스모크 OK.
브라우저 수동 확인 1회: `dist/contract-review.html` 열어 케이스 31 본문 붙여넣기 → 분석 → "별첨 참조" 그룹·quote 표시 확인.

```bash
git add knowledge/common.yaml build/validate.py src/matcher.js src/app.js src/style.css build/goldset_runner.js build/goldset.py tests/subdocref.test.js tests/test_validate.py tests/goldset/cases/31-* dist/
git commit -m "feat: 표준 부속서류 레지스트리·별첨 참조 감지 — X-PII 알람 묶음 전환"
```

---

### Task 6: 형식 점검 모듈 — src/formal.js

**Files:**
- Create: `src/formal.js`
- Create: `tests/formal.test.js`
- Modify: `build/build_html.py:14-18` (JS_ORDER에 `"formal.js"`를 `"tags.js"` 뒤·`"app.js"` 앞에 삽입)
- Modify: `src/template.html` (`#checklist-modules` div 다음 줄에 `<div id="formal-bar" class="module-bar"></div>`)
- Modify: `src/app.js` (runAnalysis에서 checkFormal 호출 + renderFormalBar + 리포트 섹션)
- Modify: `src/style.css` (.formal-pass/.formal-warn)

**Interfaces:**
- Consumes: 계약서 원문 텍스트(app.js에서 btn-analyze가 detectType에 넘기는 것과 동일한 원문 변수 — 구현 시 grep "btn-analyze"로 확인)
- Produces: `Formal.checkFormal(text) → [{id, title, status: "pass"|"warn", detail}]` (브라우저 전역 `Formal` + node require 겸용)

- [ ] **Step 1: 실패 테스트 — `tests/formal.test.js`**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("../src/formal.js");

function byId(rs, id) { return rs.filter(function (r) { return r.id === id; })[0]; }

test("FORM-NAME: '미래에셋생명' 뒤 '보험' 누락 → warn", () => {
  const rs = F.checkFormal("갑 미래에셋생명㈜은 … 2026년 1월 2일 … ㈜상대");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "warn");
});

test("FORM-NAME: 정식 상호 → pass", () => {
  const rs = F.checkFormal("갑 미래에셋생명보험주식회사는 … 2026년 1월 2일 … ㈜상대");
  assert.strictEqual(byId(rs, "FORM-NAME").status, "pass");
});

test("FORM-BLANK: OOO·밑줄·0000.00.00·공란 일자 → warn(검출 내역 포함)", () => {
  const rs = F.checkFormal("을: OOO ___ 기간 0000.00.00 … 20  년  월  일");
  const b = byId(rs, "FORM-BLANK");
  assert.strictEqual(b.status, "warn");
  assert.ok(b.detail.includes("OOO"));
});

test("FORM-BLANK: 기입 완료 본문 → pass", () => {
  const rs = F.checkFormal("미래에셋생명보험㈜와 한빛시스템 주식회사는 2026년 1월 2일 체결한다");
  assert.strictEqual(byId(rs, "FORM-BLANK").status, "pass");
});

test("FORM-DATE: 완성 일자 없으면 warn", () => {
  const rs = F.checkFormal("계약을 체결한다. 이상.");
  assert.strictEqual(byId(rs, "FORM-DATE").status, "warn");
});

test("FORM-CORP: 법인 형태 표기 부재 → warn", () => {
  const rs = F.checkFormal("갑 홍길동과 을 김철수는 2026년 1월 2일 계약한다");
  assert.strictEqual(byId(rs, "FORM-CORP").status, "warn");
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/formal.test.js`
Expected: FAIL — `Cannot find module '../src/formal.js'`

- [ ] **Step 3: 구현 — `src/formal.js`**

```js
"use strict";
/* 형식 점검(#5) — 자체점검체크리스트의 형식 항목 중 룰로 확정 판정 가능한 것만.
   (원료: samples/internal-standards/ 체크리스트 13종의 공통 형식 항목)
   지식 YAML이 아닌 코드 상수 — 사규성 룰이라 법령 quote 검증 대상이 아님.
   오탈자·견적서 대조 등 룰로 불가한 항목은 범위 밖(스펙 후속 과제).
   브라우저 전역 Formal + node require 겸용. */
var Formal = (function () {
  var OUR_FULL = /미래에셋생명보험\s*(?:㈜|주식회사|\(주\))/;
  var OUR_STEM_BAD = /미래에셋생명(?!보험)/g; // '보험' 누락 오기
  var BLANKS = [
    { re: /OOO|○○○|◯◯◯/g, label: "OOO 자리표시" },
    { re: /_{3,}/g, label: "밑줄 빈칸" },
    { re: /0000\s*\.\s*00\s*\.\s*00/g, label: "0000.00.00 일자 미기입" },
    { re: /20\s+년\s+월\s+일/g, label: "체결일자 공란(년·월·일)" },
  ];
  var CORP_FORM = /㈜|주식회사|\(주\)|유한회사|유한책임회사|합자회사|사단법인|재단법인/;
  var DATE_FILLED = /\d{4}\s*[.년]\s*\d{1,2}\s*[.월]\s*\d{1,2}/;

  function checkFormal(text) {
    var t = String(text || "");
    var out = [];
    // FORM-NAME — 당사 상호(체크리스트: "당사 상호: 미래에셋생명보험㈜ 또는 …주식회사")
    var bad = t.match(OUR_STEM_BAD) || [];
    if (bad.length)
      out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "warn",
        detail: "'미래에셋생명' 뒤 '보험' 누락 의심 " + bad.length + "곳 — 정식 상호: 미래에셋생명보험㈜/주식회사" });
    else if (/미래에셋생명보험/.test(t) && !OUR_FULL.test(t))
      out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "warn",
        detail: "법인 형태(㈜·주식회사) 표기 확인 필요" });
    else
      out.push({ id: "FORM-NAME", title: "당사 상호 표기", status: "pass",
        detail: /미래에셋생명보험/.test(t) ? "정식 상호 확인" : "당사 상호 미등장" });
    // FORM-BLANK — 빈칸 잔존(체크리스트: "빈칸을 모두 정확히 채워넣었는가")
    var hits = [];
    BLANKS.forEach(function (b) {
      var m = t.match(b.re);
      if (m) hits.push(b.label + " ×" + m.length);
    });
    out.push(hits.length
      ? { id: "FORM-BLANK", title: "빈칸 잔존", status: "warn", detail: hits.join(", ") }
      : { id: "FORM-BLANK", title: "빈칸 잔존", status: "pass", detail: "자리표시·미기입 패턴 없음" });
    // FORM-DATE — 체결일자(체크리스트: "체결일자(년,월,일)가 정확히 표시")
    out.push(DATE_FILLED.test(t)
      ? { id: "FORM-DATE", title: "체결일자 기재", status: "pass", detail: "완성된 일자 표기 확인" }
      : { id: "FORM-DATE", title: "체결일자 기재", status: "warn", detail: "완성된 일자(YYYY.MM.DD/년월일) 미확인" });
    // FORM-CORP — 법인 형태(체크리스트: "'~주식회사' 등 법인 형태가 포함된 상호명 기재")
    out.push(CORP_FORM.test(t)
      ? { id: "FORM-CORP", title: "법인 형태 표기", status: "pass", detail: "법인 표기 존재" }
      : { id: "FORM-CORP", title: "법인 형태 표기", status: "warn", detail: "㈜·주식회사 등 법인 표기 미확인 — 당사자 상호 확인" });
    return out;
  }
  return { checkFormal: checkFormal };
})();
if (typeof module !== "undefined") module.exports = Formal;
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/formal.test.js` → PASS (6)

- [ ] **Step 5: 배선** — JS_ORDER(`"tags.js", "formal.js", "app.js"`), template.html의 `#checklist-modules` 다음 줄에 `<div id="formal-bar" class="module-bar"></div>`, app.js `runAnalysis()`에서 분석 원문으로 `state.formal = Formal.checkFormal(원문);` + 호출부에 `renderFormalBar();`:

```js
// 형식 점검(#5) 바 — 매칭 체크리스트와 분리(통과/확인 2상태, 판정 대상 아님).
function renderFormalBar() {
  var el = document.getElementById("formal-bar");
  if (!el) return;
  el.innerHTML = (state.formal || []).map(function (f) {
    return '<span class="formal-item ' + (f.status === "warn" ? "formal-warn" : "formal-pass") +
      '" title="' + esc(f.detail) + '">' + (f.status === "warn" ? "△ " : "✓ ") + esc(f.title) + "</span>";
  }).join("");
}
```

리포트: renderReport의 섹션 조립부(부속서류 커버 섹션 부근)에 warn 항목만 나열하는 "형식 점검" 섹션 추가(각 항목 `title — detail` 1줄). style.css:

```css
.formal-item { padding: 2px 8px; border-radius: 10px; font-size: .85em; margin-right: 6px; }
.formal-pass { background: var(--ok-bg, #e6f4ea); }
.formal-warn { background: var(--warn-bg, #fdf3d7); }
```

(기존 변수·팔레트가 있으면 그것을 사용 — style.css 상단 확인.)

- [ ] **Step 6: 전체 게이트 + 수동 확인 + Commit**

Run: `python3 -m pytest tests/ -q && node --test && python3 build/goldset.py | tail -1 && python3 build/build_html.py && (cd dist && rm -f contract-review.zip && zip -9 -q contract-review.zip contract-review.html)`
브라우저 수동 확인: 빈칸 있는 표준서식 원문 붙여넣기 → 형식 바에 △ 빈칸 잔존 표시.

```bash
git add src/formal.js tests/formal.test.js build/build_html.py src/template.html src/app.js src/style.css dist/
git commit -m "feat: 형식 점검 모듈 — 상호·빈칸·일자·법인표기 룰 검출"
```

---

### Task 7: 체크리스트 갭 분석 → 신규 체크 초안 (사용자 게이트)

**Files:**
- Create: `docs/superpowers/plans/2026-07-28-checklist-gap-analysis.md` (대조표)
- Modify: `knowledge/common.yaml` 또는 해당 `knowledge/types/*.yaml` (신규 체크 — 게이트 통과분만)

**Interfaces:**
- Consumes: Task 1 `extracted/*체크리스트*.txt` 13종, Task 2 리포트(`verifications/curation-report-20260728.md`)의 검토의견·게이트 후보, `knowledge/schema.md`의 체크 스키마(id/check/severity/basis/norm_type/sources/quote…)
- Produces: 신규 체크(verified:false) — 이후 검수 워크플로우(검수 탭 → apply_verification.py)의 대상

- [ ] **Step 1: 대조표 작성** — 13종 체크리스트에서 실체적 항목만 추출(형식 항목은 Task 6이 소화, "표준계약서 사용 여부"류 프로세스 항목은 제외 표기). 각 항목을 {기존 check 커버 / 부분 커버 / 미커버}로 분류한 표를 `2026-07-28-checklist-gap-analysis.md`에 작성. Task 2 리포트의 검토의견(SP-DEL-03 불가항력 보완 등)도 후보 행으로 포함. 최소 검토 대상(사전 조사에서 확인된 것): ① 계열사 계약 여부(내부통제·이해상충 — IT용역 체크리스트 5번) ② 이행(하자)보증보험 유무(IT용역 9번) ③ 별첨 서류 완비(IT용역 13번 — Task 5 레지스트리와 연계) ④ 계약서↔견적서 일치(룰 불가 — 후속 과제 표기).

- [ ] **Step 2: 사용자 게이트** — 대조표를 사용자에게 제시, 신규 체크로 승격할 항목·귀속 유형(공통 vs 유형별)·심각도 초안을 확정.

- [ ] **Step 3: 신규 체크 초안 반영** — 확정분을 스키마 v2에 맞게 추가. 법령 근거가 있으면 `basis: statute` + `sources[].verified: false`(사람 검수 대기), 실무 항목이면 `basis: practice`(severity 자동 '참고'). `severity`는 `derive_severity` 규칙 위반 시 경고가 나므로 규칙대로 기재.

- [ ] **Step 4: 전체 게이트 + Commit**

Run: `python3 -m pytest tests/ -q && python3 build/goldset.py | tail -1 && python3 build/build_html.py && (cd dist && rm -f contract-review.zip && zip -9 -q contract-review.zip contract-review.html)`
Expected: validate 통과(신규 체크 스키마 적합), 골드셋 30/30 유지(신규 체크가 오탐 유발 시 트리거·게이트 조정).

```bash
git add docs/superpowers/plans/2026-07-28-checklist-gap-analysis.md knowledge dist/
git commit -m "feat: 체크리스트 갭 분석 — 신규 체크 초안 N건 (verified:false)"
```

---

## Self-Review 기록

- 스펙 커버리지: §1→Task 2, §2→Task 1·3, §3→Task 4, §4→Task 5, §5→Task 6, §6→Task 7. 구현 순서 표(P1~P6)와 태스크 순서 일치.
- 타입 일관성: 러너 출력 필드(`subdoc_covered`·`ref_covered`)와 goldset.py 채점 키, 케이스 필드(`force_type`·`subdoc_text`·`addressed_must_include`·`subdoc_must_cover`·`refcover_must_include`) 교차 확인 완료. `detectSubdocRefs` 시그니처 Task 5 내 테스트·구현·러너 3곳 일치.
- 알려진 유보 2건(placeholder 아님 — 실행 시 확정이 설계인 지점): Task 3 라벨(사용자 게이트가 확정), Task 4 어서션 목록(실측 후 제외 시 주석 사유 필수 규칙 명시).
