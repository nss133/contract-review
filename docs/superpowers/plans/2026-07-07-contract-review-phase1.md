# 계약서 리뷰 가이드 앱 Phase 1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지식 YAML → 빌드 → 오프라인 단일 HTML 앱 파이프라인을 업무위탁 계약 1종으로 end-to-end 완성한다.

**Architecture:** 빌드 타임(Python)에 지식 YAML을 검증하고 조문 DB·뉴스 DB에서 원문을 첨부한 뒤 JSON으로 HTML에 임베드한다. 런타임(브라우저 JS)은 조항 분할·키워드 매칭·모듈 스크리닝만 수행하며 네트워크 요청이 없다. 설계서: `docs/superpowers/specs/2026-07-07-contract-review-app-design.md`

**Tech Stack:** Python 3.14 (pyyaml, sqlite3, pytest), Vanilla JS (node:test로 로직 테스트), JSZip 3.10.1 (vendor, .docx 파싱)

**사전 확인된 사실 (2026-07-07 실측):**
- `laws_monitored.sqlite`의 `article_ref` 포맷은 `제3조` 형태 (정확 일치 쿼리 가능)
- `금융기관의 업무위탁 등에 관한 규정`, `개인정보 보호법(+시행령)`, `신용정보의 이용 및 보호에 관한 법률(+시행령·규칙)`, `전자금융감독규정`, `보험업법(+감독규정·시행령·규칙)` 모두 laws_monitored에 수록됨
- **파견법은 미수록** → M-DISPATCH 근거는 vault 확인 또는 `[원문 미확인]` 처리
- `fsc_guidelines.sqlite`의 law_name은 `FSC가이드라인:...` 형태로 지저분함 → LIKE 폴백 전용
- 뉴스 DB `items` 테이블: `id, title, url, published_at, summary, category, importance`
- 개발 환경: python3.14 + pyyaml + pytest9 + node24 확인 완료

---

## 파일 구조

```
contract-review/
├── knowledge/
│   ├── schema.md              # 지식 YAML 스키마 문서 (Task 2)
│   ├── common.yaml            # 공통 체크리스트 (Task 9)
│   └── types/
│       └── outsourcing.yaml   # 업무위탁 (Task 9)
├── build/
│   ├── config.py              # DB 경로 상수 (Task 4)
│   ├── validate.py            # YAML 로드·스키마 검증 (Task 3)
│   ├── enrich.py              # 조문 원문·뉴스 첨부 (Task 4)
│   └── build_html.py          # 조립·스모크 테스트 (Task 8)
├── src/
│   ├── template.html          # 앱 골격 + 플레이스홀더 (Task 7)
│   ├── style.css              # (Task 7)
│   ├── segmenter.js           # 조항 분할 — 순수 함수 (Task 5)
│   ├── matcher.js             # 유형감지·모듈제안·매칭·누락탐지 — 순수 함수 (Task 6)
│   ├── docx.js                # .docx 텍스트 추출 (Task 7)
│   └── app.js                 # UI 오케스트레이션 (Task 7)
├── vendor/jszip.min.js        # (Task 1)
├── tests/
│   ├── conftest.py            # 공용 픽스처 (Task 3)
│   ├── test_validate.py       # (Task 3)
│   ├── test_enrich.py         # (Task 4)
│   ├── test_build.py          # (Task 8)
│   ├── segmenter.test.js      # (Task 5)
│   └── matcher.test.js        # (Task 6)
├── samples/sample_outsourcing.txt  # E2E 수동 검증용 (Task 10)
└── dist/contract-review.html  # 산출물 (커밋 대상)
```

테스트 실행 명령 (전 과정 공통):
- Python: `cd /Users/nsss/contract-review && python3 -m pytest tests/ -v`
- JS: `cd /Users/nsss/contract-review && node --test tests/`

---

### Task 1: 리포 골격 + vendor

**Files:**
- Create: `.gitignore`, `vendor/jszip.min.js`, 빈 디렉토리들

- [ ] **Step 1: 디렉토리·gitignore 생성**

```bash
cd /Users/nsss/contract-review
mkdir -p knowledge/types build src tests vendor samples dist
cat > .gitignore <<'EOF'
__pycache__/
.pytest_cache/
.DS_Store
EOF
```

- [ ] **Step 2: JSZip 3.10.1 vendor 다운로드**

```bash
curl -sL https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js -o vendor/jszip.min.js
ls -la vendor/jszip.min.js   # 약 95KB 확인
head -c 200 vendor/jszip.min.js  # JSZip 배너 주석 확인
```

Expected: 파일 크기 90~100KB, 첫 줄에 `JSZip v3.10.1` 포함

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: 리포 골격 + JSZip vendor"
```

---

### Task 2: 지식 스키마 문서

**Files:**
- Create: `knowledge/schema.md`

- [ ] **Step 1: schema.md 작성**

```markdown
# 지식 YAML 스키마

## 파일 구성
- `common.yaml` — 모든 계약 공통 체크리스트
- `types/<type_id>.yaml` — 유형별 체크리스트

## 최상위 구조 (두 키 모두 필수)

meta:
  type_id: outsourcing        # 파일명과 일치. common.yaml은 "common"
  type_name: 업무위탁          # UI 표시명
  detect_keywords: [위탁, 수탁]  # 유형 자동 감지용 (common은 빈 리스트)
  modules:                    # 규제 레짐 모듈. 없으면 빈 리스트
    - id: M-PRIV              # 파일 내 유일
      name: 개인(신용)정보 처리위탁
      always_on: false        # true면 스크리닝 없이 항상 활성
      screening_question: 위탁 업무에 개인(신용)정보 처리가 포함되는가?
      suggest_keywords: [개인정보, 신용정보]   # 본문 검출 시 활성화 제안
checkpoints:
  - id: OUT-03                # 전역 유일. 유형약어-번호
    title: 재위탁 제한 및 사전 동의
    severity: 필수             # 필수 | 권장 | 참고
    module: M-PRIV            # 생략 시 유형 기본 (항상 포함)
    triggers:
      keywords: [재위탁, 재수탁]   # 조항 본문 포함 검사 (OR)
      patterns: []                # JS 정규식 문자열 (선택)
    absence_check: true       # true: 매칭 조항 없으면 "누락 의심" 보고
    guidance: >
      검토 지침. ~음/~슴 기술식 문체. 조문 인용 시 강행/임의/추정/간주 병기.
    legal_basis:
      - law: 금융기관의 업무위탁 등에 관한 규정   # DB law_name과 일치해야 원문 첨부됨
        article: 제3조                          # "제N조" / "제N조의M" 형태
        verified: false       # 사람이 원문 대조 후에만 true로 승격
    jid_refs: []              # 사내 판단 선례 라벨 (예: J-2026-0496)
    news_refs: []             # briefing.sqlite3 items.id

## 검증 규칙 (build/validate.py가 강제)
- checkpoint 필수 필드: id, title, severity, guidance
- id 전역 유일 / severity는 3값 중 하나 / module은 해당 파일 meta.modules에 선언된 id
- legal_basis 항목은 law·article·verified 필수
- verified: true인데 DB에 원문이 없으면 빌드 경고 + HTML에 [원문 미확인] 배지

## 검수 흐름
Claude 초안(verified: false) → 법무팀 검토자 원문 대조 → verified: true 승격 → 재빌드
```

- [ ] **Step 2: Commit**

```bash
git add knowledge/schema.md && git commit -m "docs: 지식 YAML 스키마 정의"
```

---

### Task 3: validate.py — 지식 로드·검증

**Files:**
- Create: `build/validate.py`, `tests/conftest.py`, `tests/test_validate.py`

- [ ] **Step 1: 공용 픽스처 작성 (conftest.py)**

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "build"))

import pytest

VALID_COMMON = """\
meta:
  type_id: common
  type_name: 공통
  detect_keywords: []
  modules: []
checkpoints:
  - id: CMN-01
    title: 손해배상
    severity: 필수
    triggers:
      keywords: [손해배상, 배상]
    absence_check: true
    guidance: 손해배상 조항의 상한·범위를 확인해야 함
    legal_basis: []
"""

VALID_TYPE = """\
meta:
  type_id: outsourcing
  type_name: 업무위탁
  detect_keywords: [위탁, 수탁]
  modules:
    - id: M-PRIV
      name: 개인정보 처리위탁
      always_on: false
      screening_question: 개인정보 처리가 포함되는가?
      suggest_keywords: [개인정보]
checkpoints:
  - id: OUT-01
    title: 재위탁 제한
    severity: 필수
    module: M-PRIV
    triggers:
      keywords: [재위탁]
    absence_check: true
    guidance: 재위탁 시 사전 동의 요건을 명시해야 함
    legal_basis:
      - law: 테스트법
        article: 제3조
        verified: true
"""


@pytest.fixture
def knowledge_dir(tmp_path):
    (tmp_path / "types").mkdir()
    (tmp_path / "common.yaml").write_text(VALID_COMMON)
    (tmp_path / "types" / "outsourcing.yaml").write_text(VALID_TYPE)
    return tmp_path
```

- [ ] **Step 2: 실패하는 테스트 작성 (test_validate.py)**

```python
import pytest
from validate import load_knowledge, ValidationError


def test_load_valid(knowledge_dir):
    k = load_knowledge(knowledge_dir)
    assert k["common"]["meta"]["type_id"] == "common"
    assert len(k["types"]) == 1
    assert k["types"][0]["checkpoints"][0]["id"] == "OUT-01"


def test_duplicate_id_rejected(knowledge_dir):
    dup = (knowledge_dir / "types" / "outsourcing.yaml").read_text().replace("OUT-01", "CMN-01")
    (knowledge_dir / "types" / "outsourcing.yaml").write_text(dup)
    with pytest.raises(ValidationError, match="중복"):
        load_knowledge(knowledge_dir)


def test_bad_severity_rejected(knowledge_dir):
    bad = (knowledge_dir / "common.yaml").read_text().replace("severity: 필수", "severity: 심각")
    (knowledge_dir / "common.yaml").write_text(bad)
    with pytest.raises(ValidationError, match="severity"):
        load_knowledge(knowledge_dir)


def test_unknown_module_rejected(knowledge_dir):
    bad = (knowledge_dir / "types" / "outsourcing.yaml").read_text().replace("module: M-PRIV", "module: M-NOPE")
    (knowledge_dir / "types" / "outsourcing.yaml").write_text(bad)
    with pytest.raises(ValidationError, match="module"):
        load_knowledge(knowledge_dir)


def test_missing_required_field_rejected(knowledge_dir):
    bad = (knowledge_dir / "common.yaml").read_text().replace("    title: 손해배상\n", "")
    (knowledge_dir / "common.yaml").write_text(bad)
    with pytest.raises(ValidationError, match="필수 필드"):
        load_knowledge(knowledge_dir)


def test_legal_basis_requires_verified(knowledge_dir):
    bad = (knowledge_dir / "types" / "outsourcing.yaml").read_text().replace("        verified: true\n", "")
    (knowledge_dir / "types" / "outsourcing.yaml").write_text(bad)
    with pytest.raises(ValidationError, match="legal_basis"):
        load_knowledge(knowledge_dir)
```

- [ ] **Step 3: 실패 확인**

Run: `python3 -m pytest tests/test_validate.py -v`
Expected: 전부 FAIL (`ModuleNotFoundError: No module named 'validate'`)

- [ ] **Step 4: validate.py 구현**

```python
"""지식 YAML 로드 및 스키마 검증. knowledge/schema.md가 규격 문서임."""
from pathlib import Path

import yaml

SEVERITIES = {"필수", "권장", "참고"}
REQUIRED_FIELDS = {"id", "title", "severity", "guidance"}


class ValidationError(Exception):
    pass


def load_knowledge(knowledge_dir):
    """common.yaml + types/*.yaml 로드·검증 → {"common": dict, "types": [dict]}"""
    kdir = Path(knowledge_dir)
    common = _load_file(kdir / "common.yaml")
    types = [_load_file(p) for p in sorted((kdir / "types").glob("*.yaml"))]
    _validate(common, types)
    return {"common": common, "types": types}


def _load_file(path):
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict) or "meta" not in data or "checkpoints" not in data:
        raise ValidationError(f"{path.name}: 최상위에 meta·checkpoints 키가 필요함")
    data["meta"].setdefault("modules", [])
    data["meta"].setdefault("detect_keywords", [])
    return data


def _validate(common, types):
    seen_ids = set()
    for doc in [common, *types]:
        fname = doc["meta"].get("type_id", "?")
        module_ids = {m["id"] for m in doc["meta"]["modules"]}
        for cp in doc["checkpoints"]:
            cid = cp.get("id", "?")
            missing = REQUIRED_FIELDS - cp.keys()
            if missing:
                raise ValidationError(f"{fname}/{cid}: 필수 필드 누락 {sorted(missing)}")
            if cp["id"] in seen_ids:
                raise ValidationError(f"중복 id: {cp['id']}")
            seen_ids.add(cp["id"])
            if cp["severity"] not in SEVERITIES:
                raise ValidationError(f"{cid}: severity 값 오류 '{cp['severity']}'")
            if "module" in cp and cp["module"] not in module_ids:
                raise ValidationError(f"{cid}: 선언되지 않은 module '{cp['module']}'")
            for lb in cp.get("legal_basis", []):
                if not {"law", "article", "verified"} <= set(lb.keys()):
                    raise ValidationError(f"{cid}: legal_basis에 law·article·verified 필요")
```

- [ ] **Step 5: 통과 확인**

Run: `python3 -m pytest tests/test_validate.py -v`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add build/validate.py tests/ && git commit -m "feat: 지식 YAML 검증기"
```

---

### Task 4: config.py + enrich.py — 조문·뉴스 원문 첨부

**Files:**
- Create: `build/config.py`, `build/enrich.py`, `tests/test_enrich.py`

- [ ] **Step 1: config.py 작성 (실제 DB 경로 상수)**

```python
"""실제 데이터 소스 경로. 테스트는 이 상수를 쓰지 않고 픽스처 DB를 주입함."""
from pathlib import Path

_ICLOUD = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/cursor"

LAW_DBS = [
    _ICLOUD / "comp_matching_auto/data/laws_monitored.sqlite",   # 1순위: 법령 조문
    _ICLOUD / "comp_matching_auto/data/fsc_guidelines.sqlite",   # 2순위: 금융위 가이드라인
    _ICLOUD / "comp_matching_auto/data/klia_regulations.sqlite", # 3순위: 협회 규정
]

NEWS_DB = _ICLOUD / "news clipping/data/briefing.sqlite3"
```

- [ ] **Step 2: 실패하는 테스트 작성 (test_enrich.py)**

```python
import sqlite3

import pytest
from enrich import enrich, lookup_article
from validate import load_knowledge


@pytest.fixture
def law_db(tmp_path):
    path = tmp_path / "laws.sqlite"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE law_articles (id INTEGER PRIMARY KEY, law_name TEXT, "
        "article_ref TEXT, text TEXT, mst TEXT, source TEXT, updated_at TEXT)"
    )
    conn.execute(
        "INSERT INTO law_articles (law_name, article_ref, text) "
        "VALUES ('테스트법', '제3조', '제3조(재위탁) 사전 동의를 받아야 한다.')"
    )
    conn.commit()
    conn.close()
    return path


@pytest.fixture
def news_db(tmp_path):
    path = tmp_path / "briefing.sqlite3"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, url TEXT, "
        "published_at TEXT, summary TEXT)"
    )
    conn.execute(
        "INSERT INTO items VALUES ('n1', '위탁 규정 개정 예고', 'http://x', '2026-06-01', '요약임')"
    )
    conn.commit()
    conn.close()
    return path


def test_lookup_exact(law_db):
    assert "사전 동의" in lookup_article("테스트법", "제3조", [law_db])


def test_lookup_like_fallback(law_db):
    assert lookup_article("테스트", "제3조", [law_db]) is not None


def test_lookup_missing(law_db):
    assert lookup_article("없는법", "제1조", [law_db]) is None


def test_enrich_attaches_text_and_status(knowledge_dir, law_db):
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    lb = k["types"][0]["checkpoints"][0]["legal_basis"][0]
    assert lb["status"] == "verified"
    assert "사전 동의" in lb["text"]
    assert warnings == []


def test_enrich_warns_on_missing(knowledge_dir, law_db):
    p = knowledge_dir / "types" / "outsourcing.yaml"
    p.write_text(p.read_text().replace("테스트법", "없는법"))
    k = load_knowledge(knowledge_dir)
    warnings = enrich(k, [law_db], news_db=None)
    lb = k["types"][0]["checkpoints"][0]["legal_basis"][0]
    assert lb["status"] == "missing"
    assert len(warnings) == 1


def test_enrich_attaches_news(knowledge_dir, law_db, news_db):
    p = knowledge_dir / "common.yaml"
    p.write_text(p.read_text().replace("news_refs: []", "").replace(
        "    legal_basis: []", "    legal_basis: []\n    news_refs: [n1, nope]"))
    k = load_knowledge(knowledge_dir)
    enrich(k, [law_db], news_db=news_db)
    news = k["common"]["checkpoints"][0]["news"]
    assert len(news) == 1 and news[0]["title"] == "위탁 규정 개정 예고"
```

- [ ] **Step 3: 실패 확인**

Run: `python3 -m pytest tests/test_enrich.py -v`
Expected: FAIL (`No module named 'enrich'`)

- [ ] **Step 4: enrich.py 구현**

```python
"""체크포인트의 legal_basis·news_refs에 원본 DB의 원문을 첨부함.

status 의미:
- verified   : 사람이 원문 대조 완료(verified: true) + DB 원문 존재
- unverified : DB 원문은 찾았으나 사람 검수 전 → HTML에서 [원문 미대조] 배지
- missing    : DB에서 원문을 찾지 못함 → 빌드 경고 + [원문 미확인] 배지
"""
import sqlite3


def lookup_article(law, article, db_paths):
    """DB 우선순위 순회. 정확 일치 → LIKE 포함 폴백."""
    for db in db_paths:
        conn = sqlite3.connect(db)
        try:
            row = conn.execute(
                "SELECT text FROM law_articles WHERE law_name = ? AND article_ref = ?",
                (law, article),
            ).fetchone()
            if not row:
                row = conn.execute(
                    "SELECT text FROM law_articles WHERE law_name LIKE ? "
                    "AND article_ref = ? LIMIT 1",
                    (f"%{law}%", article),
                ).fetchone()
        finally:
            conn.close()
        if row:
            return row[0]
    return None


def lookup_news(item_id, news_db):
    conn = sqlite3.connect(news_db)
    try:
        row = conn.execute(
            "SELECT title, url, published_at, summary FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {"title": row[0], "url": row[1], "published_at": row[2], "summary": row[3]}


def enrich(knowledge, law_dbs, news_db=None):
    """knowledge dict를 제자리 수정. 경고 문자열 리스트 반환."""
    warnings = []
    for doc in [knowledge["common"], *knowledge["types"]]:
        for cp in doc["checkpoints"]:
            for lb in cp.get("legal_basis", []):
                text = lookup_article(lb["law"], lb["article"], law_dbs)
                if text:
                    lb["text"] = text
                    lb["status"] = "verified" if lb["verified"] else "unverified"
                else:
                    lb["status"] = "missing"
                    warnings.append(f"{cp['id']}: {lb['law']} {lb['article']} 원문 미발견")
            refs = cp.get("news_refs") or []
            if news_db and refs:
                cp["news"] = [n for n in (lookup_news(r, news_db) for r in refs) if n]
    return warnings
```

- [ ] **Step 5: 통과 확인**

Run: `python3 -m pytest tests/ -v`
Expected: 12 passed (validate 6 + enrich 6)

- [ ] **Step 6: Commit**

```bash
git add build/config.py build/enrich.py tests/test_enrich.py
git commit -m "feat: 조문·뉴스 원문 첨부 (enrich)"
```

---

### Task 5: segmenter.js — 조항 분할

**Files:**
- Create: `src/segmenter.js`, `tests/segmenter.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { segmentContract } = require("../src/segmenter.js");

test("제N조 패턴으로 분할한다", () => {
  const text = [
    "업무위탁계약서",
    "제1조 (목적) 이 계약은 업무위탁에 관한 사항을 정한다.",
    "제2조 (정의) 용어의 정의는 다음과 같다.",
    "추가 설명 줄",
    "제2조의2 (적용범위) 본 계약은 전 업무에 적용된다.",
  ].join("\n");
  const clauses = segmentContract(text);
  assert.strictEqual(clauses.length, 4); // (전문) + 제1조 + 제2조 + 제2조의2
  assert.strictEqual(clauses[0].heading, "(전문)");
  assert.match(clauses[1].heading, /제1조/);
  assert.match(clauses[2].body, /추가 설명 줄/);
  assert.match(clauses[3].heading, /제2조의2/);
  assert.strictEqual(clauses[3].index, 3);
});

test("숫자 헤딩(1. )으로도 분할한다", () => {
  const text = "1. 목적\n내용A\n2. 범위\n내용B";
  const clauses = segmentContract(text);
  assert.strictEqual(clauses.length, 2);
  assert.match(clauses[1].body, /내용B/);
});

test("패턴 미검출 시 전체를 단일 블록으로 반환한다", () => {
  const clauses = segmentContract("아무 구조 없는 텍스트입니다.\n둘째 줄.");
  assert.strictEqual(clauses.length, 1);
  assert.strictEqual(clauses[0].heading, "(전체)");
  assert.match(clauses[0].body, /둘째 줄/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/`
Expected: FAIL (`Cannot find module '../src/segmenter.js'`)

- [ ] **Step 3: segmenter.js 구현**

```js
"use strict";
/* 계약서 텍스트 → 조항 배열 [{heading, body, index}] */

var CR_HEADING_RES = [
  /^제\s*\d+\s*조(?:의\s*\d+)?(?:\s|\(|\[|$)/, // 제1조, 제2조의2 (제목 괄호 허용)
  /^\d+\.\s+/,                                  // "1. 목적" 형태
];

function segmentContract(text) {
  var lines = text.split(/\r?\n/);
  var clauses = [];
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    var isHeading = t && CR_HEADING_RES.some(function (re) { return re.test(t); });
    if (isHeading) {
      if (current) clauses.push(current);
      current = { heading: t, body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + lines[i];
    } else if (t) {
      current = { heading: "(전문)", body: lines[i] };
    }
  }
  if (current) clauses.push(current);
  if (clauses.length < 2) {
    return [{ heading: "(전체)", body: text, index: 0 }];
  }
  return clauses.map(function (c, idx) {
    return { heading: c.heading, body: c.body, index: idx };
  });
}

if (typeof module !== "undefined") module.exports = { segmentContract: segmentContract };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/`
Expected: 3 pass

- [ ] **Step 5: Commit**

```bash
git add src/segmenter.js tests/segmenter.test.js
git commit -m "feat: 조항 분할기 (segmenter)"
```

---

### Task 6: matcher.js — 유형 감지·모듈 제안·매칭·누락 탐지

**Files:**
- Create: `src/matcher.js`, `tests/matcher.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { detectType, suggestModules, analyze } = require("../src/matcher.js");

const TYPES = [
  { meta: { type_id: "outsourcing", detect_keywords: ["위탁", "수탁"] }, checkpoints: [] },
  { meta: { type_id: "nda", detect_keywords: ["비밀유지"] }, checkpoints: [] },
];

const OUT_DOC = {
  meta: {
    type_id: "outsourcing",
    modules: [
      { id: "M-CORE", name: "기본", always_on: true, suggest_keywords: [] },
      { id: "M-PRIV", name: "개인정보", always_on: false, suggest_keywords: ["개인정보"] },
    ],
  },
  checkpoints: [
    { id: "OUT-01", title: "재위탁", severity: "필수", module: "M-CORE",
      triggers: { keywords: ["재위탁"] }, absence_check: true, guidance: "g" },
    { id: "OUT-02", title: "처리위탁 문서화", severity: "필수", module: "M-PRIV",
      triggers: { keywords: ["개인정보"] }, absence_check: true, guidance: "g" },
    { id: "OUT-03", title: "손해배상 상한", severity: "권장",
      triggers: { keywords: [], patterns: ["손해\\s*배상"] }, absence_check: false, guidance: "g" },
  ],
};

test("detectType: 키워드 빈도로 유형 순위를 매긴다", () => {
  const ranked = detectType("이 업무위탁 계약에서 수탁자는...", TYPES);
  assert.strictEqual(ranked[0].typeId, "outsourcing");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("suggestModules: 본문 키워드로 모듈 활성화를 제안한다", () => {
  const s = suggestModules("개인정보 처리 업무 포함", OUT_DOC.meta.modules);
  assert.deepStrictEqual(s, ["M-PRIV"]);
  assert.deepStrictEqual(suggestModules("무관한 내용", OUT_DOC.meta.modules), []);
});

test("analyze: 활성 모듈 체크포인트만 매칭하고 누락을 탐지한다", () => {
  const clauses = [
    { heading: "제1조 (재위탁)", body: "재위탁 시 동의를 받는다", index: 0 },
    { heading: "제2조 (손해배상)", body: "손해 배상 책임을 진다", index: 1 },
  ];
  // M-PRIV 비활성 → OUT-02는 대상 제외
  const r1 = analyze(clauses, [OUT_DOC], ["M-CORE"]);
  assert.strictEqual(r1.checkpoints.length, 2); // OUT-01, OUT-03
  assert.deepStrictEqual(r1.matches.map((m) => m.cpId).sort(), ["OUT-01", "OUT-03"]);
  assert.strictEqual(r1.missing.length, 0);
  // M-PRIV 활성인데 개인정보 조항 없음 → OUT-02 누락 의심
  const r2 = analyze(clauses, [OUT_DOC], ["M-CORE", "M-PRIV"]);
  assert.deepStrictEqual(r2.missing.map((c) => c.id), ["OUT-02"]);
});

test("analyze: 정규식 패턴 트리거가 동작한다", () => {
  const clauses = [{ heading: "제2조", body: "손해   배상 범위", index: 0 }];
  const r = analyze(clauses, [OUT_DOC], ["M-CORE"]);
  assert.ok(r.matches.some((m) => m.cpId === "OUT-03"));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/`
Expected: matcher 테스트 4건 FAIL

- [ ] **Step 3: matcher.js 구현**

```js
"use strict";
/* 유형 감지·모듈 제안·체크포인트 매칭·누락 탐지. 전부 순수 함수 */

function detectType(text, types) {
  return types
    .map(function (t) {
      var score = (t.meta.detect_keywords || []).reduce(function (s, kw) {
        return s + (text.split(kw).length - 1);
      }, 0);
      return { typeId: t.meta.type_id, score: score };
    })
    .sort(function (a, b) { return b.score - a.score; });
}

function suggestModules(text, modules) {
  return modules
    .filter(function (m) { return !m.always_on; })
    .filter(function (m) {
      return (m.suggest_keywords || []).some(function (kw) { return text.indexOf(kw) !== -1; });
    })
    .map(function (m) { return m.id; });
}

function checkpointHits(clause, cp) {
  var hay = clause.heading + "\n" + clause.body;
  var kws = (cp.triggers && cp.triggers.keywords) || [];
  var pats = (cp.triggers && cp.triggers.patterns) || [];
  var hitKw = kws.filter(function (kw) { return hay.indexOf(kw) !== -1; });
  var hitPat = pats.filter(function (p) { return new RegExp(p).test(hay); });
  if (hitKw.length === 0 && hitPat.length === 0) return null;
  return { keywords: hitKw, patterns: hitPat };
}

function activeCheckpoints(doc, activeModules) {
  return doc.checkpoints.filter(function (cp) {
    return !cp.module || activeModules.indexOf(cp.module) !== -1;
  });
}

function analyze(clauses, docs, activeModules) {
  var cps = [];
  docs.forEach(function (d) { cps = cps.concat(activeCheckpoints(d, activeModules)); });
  var matches = [];
  cps.forEach(function (cp) {
    clauses.forEach(function (clause) {
      var hits = checkpointHits(clause, cp);
      if (hits) matches.push({ cpId: cp.id, clauseIndex: clause.index, hits: hits });
    });
  });
  var matchedIds = {};
  matches.forEach(function (m) { matchedIds[m.cpId] = true; });
  var missing = cps.filter(function (cp) { return cp.absence_check && !matchedIds[cp.id]; });
  return { checkpoints: cps, matches: matches, missing: missing };
}

if (typeof module !== "undefined")
  module.exports = {
    detectType: detectType,
    suggestModules: suggestModules,
    checkpointHits: checkpointHits,
    activeCheckpoints: activeCheckpoints,
    analyze: analyze,
  };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/`
Expected: 7 pass (segmenter 3 + matcher 4)

- [ ] **Step 5: Commit**

```bash
git add src/matcher.js tests/matcher.test.js
git commit -m "feat: 매칭 엔진 (matcher)"
```

---

### Task 7: UI — docx.js + template.html + style.css + app.js

브라우저 DOM 코드라 자동 테스트 대신 Task 8 빌드 후 Task 10에서 수동 검증한다.
로직은 이미 Task 5·6에서 테스트됨.

**Files:**
- Create: `src/docx.js`, `src/template.html`, `src/style.css`, `src/app.js`

- [ ] **Step 1: docx.js 작성**

```js
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
```

- [ ] **Step 2: template.html 작성**

플레이스홀더 4개(`/*__STYLE__*/`, `/*__VENDOR_JS__*/`, `/*__APP_JS__*/`, `__DATA_JSON__`)를 빌드가 치환한다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>계약서 리뷰 가이드 — 법무팀</title>
<style>/*__STYLE__*/</style>
</head>
<body>
<header class="topbar">
  <h1>계약서 리뷰 가이드</h1>
  <nav>
    <button data-tab="guide" class="tab active">가이드 열람</button>
    <button data-tab="analyze" class="tab">계약서 분석</button>
    <button data-tab="report" class="tab" id="report-tab" disabled>종합 리포트</button>
  </nav>
</header>

<main>
  <!-- 가이드 열람 모드 -->
  <section id="pane-guide" class="pane active">
    <div class="controls">
      <label>계약 유형 <select id="guide-type"></select></label>
      <input id="guide-search" type="search" placeholder="체크리스트·조문 검색">
    </div>
    <div id="guide-modules" class="module-bar"></div>
    <div id="guide-list"></div>
  </section>

  <!-- 계약서 분석 모드 -->
  <section id="pane-analyze" class="pane">
    <div id="analyze-input">
      <textarea id="contract-text" placeholder="계약서 텍스트를 붙여넣으세요"></textarea>
      <div class="input-actions">
        <label class="filebtn">.docx 열기<input id="docx-file" type="file" accept=".docx" hidden></label>
        <button id="btn-analyze" class="primary">분석 시작</button>
      </div>
      <p id="input-error" class="error" hidden></p>
    </div>
    <div id="analyze-setup" hidden>
      <label>계약 유형 <select id="analyze-type"></select></label>
      <div id="screening"></div>
      <button id="btn-run" class="primary">이 조건으로 검토</button>
    </div>
    <div id="analyze-result" class="split" hidden>
      <div id="clause-list" class="col"></div>
      <div id="mapping-detail" class="col"></div>
    </div>
  </section>

  <!-- 종합 리포트 -->
  <section id="pane-report" class="pane">
    <div id="report-body"></div>
    <button onclick="window.print()">인쇄</button>
  </section>
</main>

<footer class="disclaimer">
  본 도구는 규칙 기반 스크리닝 참고자료이며 법적 판단을 대체하지 않음.
  근거 배지: <span class="badge verified">원문확인</span>
  <span class="badge unverified">원문 미대조</span>
  <span class="badge missing">원문 미확인</span>
</footer>

<script id="cr-data" type="application/json">__DATA_JSON__</script>
<script>/*__VENDOR_JS__*/</script>
<script>/*__APP_JS__*/</script>
</body>
</html>
```

- [ ] **Step 3: style.css 작성**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
       color: #1a1a2e; background: #f5f6fa; }
.topbar { display: flex; align-items: center; gap: 24px; padding: 12px 20px;
          background: #1a1a2e; color: #fff; }
.topbar h1 { font-size: 17px; margin: 0; }
.tab { background: none; border: none; color: #aab; padding: 8px 14px;
       font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; }
.tab.active { color: #fff; border-bottom-color: #4ea1ff; }
.tab:disabled { opacity: .35; cursor: default; }
main { max-width: 1200px; margin: 0 auto; padding: 20px; }
.pane { display: none; }
.pane.active { display: block; }
.controls { display: flex; gap: 12px; margin-bottom: 12px; }
select, input[type=search], textarea { font: inherit; padding: 6px 10px;
  border: 1px solid #ccd; border-radius: 6px; }
textarea#contract-text { width: 100%; height: 260px; }
.primary { background: #2456e6; color: #fff; border: none; border-radius: 6px;
           padding: 9px 18px; font-size: 14px; cursor: pointer; }
.filebtn { display: inline-block; padding: 8px 14px; border: 1px dashed #99a;
           border-radius: 6px; cursor: pointer; font-size: 13px; }
.error { color: #c0392b; }
.module-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.module-chip { padding: 5px 12px; border-radius: 20px; border: 1px solid #bbc;
               background: #fff; font-size: 13px; cursor: pointer; }
.module-chip.on { background: #2456e6; color: #fff; border-color: #2456e6; }
.module-chip.suggested { border-color: #e67e22; box-shadow: 0 0 0 2px #f8c47155; }
.cp-card { background: #fff; border: 1px solid #e0e2ee; border-radius: 8px;
           padding: 14px 16px; margin-bottom: 10px; }
.cp-card h3 { margin: 0 0 6px; font-size: 15px; }
.sev { font-size: 12px; padding: 2px 8px; border-radius: 10px; margin-right: 6px; }
.sev-필수 { background: #fdecea; color: #c0392b; }
.sev-권장 { background: #fef5e7; color: #b9770e; }
.sev-참고 { background: #eaf2f8; color: #21618c; }
.badge { font-size: 11px; padding: 1px 7px; border-radius: 8px; }
.badge.verified { background: #e8f8f0; color: #1e8449; }
.badge.unverified { background: #fef5e7; color: #b9770e; }
.badge.missing { background: #fdecea; color: #c0392b; }
details.law { margin-top: 8px; font-size: 13px; }
details.law pre { white-space: pre-wrap; background: #f8f9fc; padding: 10px;
                  border-radius: 6px; max-height: 300px; overflow-y: auto; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.col { max-height: 75vh; overflow-y: auto; }
.clause { background: #fff; border: 1px solid #e0e2ee; border-radius: 8px;
          padding: 12px; margin-bottom: 8px; cursor: pointer; }
.clause.sel { border-color: #2456e6; box-shadow: 0 0 0 2px #2456e633; }
.clause .cnt { float: right; font-size: 12px; color: #2456e6; }
.clause pre { white-space: pre-wrap; font: 13px/1.6 inherit; margin: 6px 0 0; }
.missing-item { border-left: 4px solid #c0392b; }
.disclaimer { text-align: center; font-size: 12px; color: #667; padding: 16px;
              border-top: 1px solid #dde; margin-top: 30px; }
@media print { .topbar, .disclaimer, button { display: none; }
               .pane { display: none; } #pane-report { display: block; } }
```

- [ ] **Step 4: app.js 작성**

```js
"use strict";
/* UI 오케스트레이션. segmenter.js·matcher.js·docx.js가 먼저 인라인되어 전역 함수 사용 가능 */

var CR = JSON.parse(document.getElementById("cr-data").textContent);
var state = { text: "", clauses: [], typeId: null, activeModules: [], result: null };

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function typeDoc(typeId) {
  for (var i = 0; i < CR.types.length; i++)
    if (CR.types[i].meta.type_id === typeId) return CR.types[i];
  return null;
}

/* ---------- 탭 ---------- */
document.querySelectorAll(".tab").forEach(function (btn) {
  btn.addEventListener("click", function () {
    if (btn.disabled) return;
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("active"); });
    document.querySelectorAll(".pane").forEach(function (p) { p.classList.remove("active"); });
    btn.classList.add("active");
    document.getElementById("pane-" + btn.dataset.tab).classList.add("active");
  });
});

/* ---------- 체크포인트 카드 렌더 (가이드·매핑 공용) ---------- */
function renderCard(cp, hits) {
  var h = '<div class="cp-card"><h3><span class="sev sev-' + cp.severity + '">' +
    cp.severity + "</span>" + esc(cp.id) + " " + esc(cp.title) + "</h3>";
  if (hits) h += '<p class="hit">매칭: ' + esc(hits.keywords.concat(hits.patterns).join(", ")) + "</p>";
  h += "<p>" + esc(cp.guidance) + "</p>";
  (cp.legal_basis || []).forEach(function (lb) {
    var label = { verified: "원문확인", unverified: "원문 미대조", missing: "원문 미확인" }[lb.status];
    h += '<details class="law"><summary>' + esc(lb.law) + " " + esc(lb.article) +
      ' <span class="badge ' + lb.status + '">' + label + "</span></summary>";
    h += lb.text ? "<pre>" + esc(lb.text) + "</pre>" : "<p>원문 데이터 없음</p>";
    h += "</details>";
  });
  (cp.news || []).forEach(function (n) {
    h += '<details class="law"><summary>[동향] ' + esc(n.title) + " (" + esc(n.published_at) +
      ")</summary><p>" + esc(n.summary || "") + "</p></details>";
  });
  (cp.jid_refs || []).forEach(function (j) { h += '<p class="jid">사내 선례: ' + esc(j) + "</p>"; });
  return h + "</div>";
}

/* ---------- 가이드 열람 모드 ---------- */
var guideModules = [];
function initGuide() {
  var sel = document.getElementById("guide-type");
  sel.innerHTML = '<option value="common">공통 체크리스트</option>' +
    CR.types.map(function (t) {
      return '<option value="' + t.meta.type_id + '">' + esc(t.meta.type_name) + "</option>";
    }).join("");
  sel.addEventListener("change", renderGuide);
  document.getElementById("guide-search").addEventListener("input", renderGuide);
  renderGuide();
}
function renderGuide() {
  var typeId = document.getElementById("guide-type").value;
  var q = document.getElementById("guide-search").value.trim();
  var doc = typeId === "common" ? CR.common : typeDoc(typeId);
  var bar = document.getElementById("guide-modules");
  guideModules = doc.meta.modules.map(function (m) { return m.id; }); // 가이드 모드는 전 모듈 표시
  bar.innerHTML = doc.meta.modules.map(function (m) {
    return '<span class="module-chip on">' + esc(m.name) + "</span>";
  }).join("");
  var cps = doc.checkpoints.filter(function (cp) {
    if (!q) return true;
    var lawtext = (cp.legal_basis || []).map(function (l) { return l.law + (l.text || ""); }).join(" ");
    return (cp.title + cp.guidance + lawtext).indexOf(q) !== -1;
  });
  document.getElementById("guide-list").innerHTML =
    cps.map(function (cp) { return renderCard(cp, null); }).join("") ||
    "<p>검색 결과 없음</p>";
}

/* ---------- 분석 모드: 입력 ---------- */
document.getElementById("docx-file").addEventListener("change", function (e) {
  var f = e.target.files[0];
  if (!f) return;
  f.arrayBuffer().then(extractDocxText).then(function (text) {
    document.getElementById("contract-text").value = text;
    document.getElementById("input-error").hidden = true;
  }).catch(function (err) {
    var el = document.getElementById("input-error");
    el.textContent = ".docx 파싱 실패(" + err.message + ") — Word에서 텍스트로 복사해 붙여넣으세요.";
    el.hidden = false;
  });
});

document.getElementById("btn-analyze").addEventListener("click", function () {
  state.text = document.getElementById("contract-text").value;
  if (!state.text.trim()) return;
  state.clauses = segmentContract(state.text);
  var ranked = detectType(state.text, CR.types);
  var sel = document.getElementById("analyze-type");
  sel.innerHTML = CR.types.map(function (t) {
    return '<option value="' + t.meta.type_id + '">' + esc(t.meta.type_name) + "</option>";
  }).join("");
  if (ranked[0] && ranked[0].score > 0) sel.value = ranked[0].typeId;
  sel.addEventListener("change", renderScreening);
  renderScreening();
  document.getElementById("analyze-setup").hidden = false;
});

/* ---------- 분석 모드: 모듈 스크리닝 ---------- */
function renderScreening() {
  var doc = typeDoc(document.getElementById("analyze-type").value);
  var suggested = suggestModules(state.text, doc.meta.modules);
  state.activeModules = doc.meta.modules
    .filter(function (m) { return m.always_on || suggested.indexOf(m.id) !== -1; })
    .map(function (m) { return m.id; });
  document.getElementById("screening").innerHTML = doc.meta.modules.map(function (m) {
    if (m.always_on)
      return '<span class="module-chip on">' + esc(m.name) + " (기본)</span>";
    var on = state.activeModules.indexOf(m.id) !== -1;
    var sug = suggested.indexOf(m.id) !== -1;
    return '<label class="module-chip' + (on ? " on" : "") + (sug ? " suggested" : "") +
      '" data-mid="' + m.id + '" title="' + esc(m.screening_question || "") + '">' +
      esc(m.name) + (sug ? " ⚡본문 검출" : "") + "</label>";
  }).join("");
  document.querySelectorAll("#screening .module-chip[data-mid]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var mid = chip.dataset.mid;
      var i = state.activeModules.indexOf(mid);
      if (i === -1) state.activeModules.push(mid); else state.activeModules.splice(i, 1);
      chip.classList.toggle("on");
    });
  });
}

/* ---------- 분석 실행 ---------- */
document.getElementById("btn-run").addEventListener("click", function () {
  state.typeId = document.getElementById("analyze-type").value;
  var docs = [CR.common, typeDoc(state.typeId)];
  state.result = analyze(state.clauses, docs, state.activeModules);
  renderClauses();
  renderReport();
  document.getElementById("analyze-result").hidden = false;
  document.getElementById("report-tab").disabled = false;
});

function renderClauses() {
  var byClause = {};
  state.result.matches.forEach(function (m) {
    (byClause[m.clauseIndex] = byClause[m.clauseIndex] || []).push(m);
  });
  document.getElementById("clause-list").innerHTML = state.clauses.map(function (c) {
    var n = (byClause[c.index] || []).length;
    return '<div class="clause" data-ci="' + c.index + '"><strong>' + esc(c.heading) +
      '</strong><span class="cnt">' + (n ? "관련 " + n + "건" : "") + "</span><pre>" +
      esc(c.body) + "</pre></div>";
  }).join("");
  document.querySelectorAll(".clause").forEach(function (el) {
    el.addEventListener("click", function () {
      document.querySelectorAll(".clause").forEach(function (x) { x.classList.remove("sel"); });
      el.classList.add("sel");
      var ci = Number(el.dataset.ci);
      var cards = (byClause[ci] || []).map(function (m) {
        var cp = state.result.checkpoints.filter(function (c) { return c.id === m.cpId; })[0];
        return renderCard(cp, m.hits);
      });
      document.getElementById("mapping-detail").innerHTML =
        cards.join("") || "<p>이 조항에 매핑된 체크포인트 없음</p>";
    });
  });
}

/* ---------- 종합 리포트 ---------- */
function hashText(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "cr-" + (h >>> 0).toString(36);
}
function renderReport() {
  var key = hashText(state.text);
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
  var r = state.result;
  var h = "<h2>종합 리포트</h2>";
  h += "<h3>누락 의심 (" + r.missing.length + ")</h3>";
  h += r.missing.map(function (cp) {
    return '<div class="cp-card missing-item">' + renderCard(cp, null) + "</div>";
  }).join("") || "<p>누락 의심 항목 없음</p>";
  ["필수", "권장", "참고"].forEach(function (sev) {
    var ms = r.matches.filter(function (m) {
      var cp = r.checkpoints.filter(function (c) { return c.id === m.cpId; })[0];
      return cp.severity === sev;
    });
    var seen = {};
    h += "<h3>" + sev + " 확인 항목</h3><ul class='checklist'>";
    ms.forEach(function (m) {
      if (seen[m.cpId]) return; seen[m.cpId] = true;
      var cp = r.checkpoints.filter(function (c) { return c.id === m.cpId; })[0];
      var ck = saved[cp.id] ? " checked" : "";
      h += '<li><label><input type="checkbox" data-cp="' + cp.id + '"' + ck + "> " +
        esc(cp.id) + " " + esc(cp.title) + "</label></li>";
    });
    h += "</ul>";
  });
  var body = document.getElementById("report-body");
  body.innerHTML = h;
  body.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
    cb.addEventListener("change", function () {
      saved[cb.dataset.cp] = cb.checked;
      localStorage.setItem(key, JSON.stringify(saved));
    });
  });
}

initGuide();
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: 앱 UI (template, style, docx, app)"
```

---

### Task 8: build_html.py — 조립 + 스모크 테스트

**Files:**
- Create: `build/build_html.py`, `tests/test_build.py`

- [ ] **Step 1: 실패하는 테스트 작성 (test_build.py)**

```python
import json
import re

from build_html import build
from test_enrich import law_db  # noqa: F401  (픽스처 재사용)


def test_build_produces_single_html(knowledge_dir, law_db, tmp_path):
    out = tmp_path / "out.html"
    build(knowledge_dir, out, law_dbs=[law_db], news_db=None)
    html = out.read_text()
    assert "__DATA_JSON__" not in html
    assert "/*__" not in html
    assert "segmentContract" in html          # JS 인라인 확인
    assert "JSZip" in html                    # vendor 인라인 확인
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', html, re.S)
    data = json.loads(m.group(1))
    assert data["common"]["checkpoints"][0]["id"] == "CMN-01"
    lb = data["types"][0]["checkpoints"][0]["legal_basis"][0]
    assert lb["status"] == "verified" and "사전 동의" in lb["text"]


def test_build_escapes_script_close(knowledge_dir, law_db, tmp_path):
    p = knowledge_dir / "common.yaml"
    p.write_text(p.read_text().replace(
        "guidance: 손해배상 조항의 상한·범위를 확인해야 함",
        'guidance: "</script> 포함 텍스트"'))
    out = tmp_path / "out.html"
    build(knowledge_dir, out, law_dbs=[law_db], news_db=None)
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', out.read_text(), re.S)
    assert "</script>" not in m.group(1)      # JSON 안에서 조기 종료 없음
    assert json.loads(m.group(1))["common"]["checkpoints"][0]["guidance"].startswith("</script>")
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_build.py -v`
Expected: FAIL (`No module named 'build_html'`)

- [ ] **Step 3: build_html.py 구현**

```python
"""knowledge/ + src/ + vendor/ → dist/contract-review.html 단일 파일 조립."""
import json
import re
import sys
from pathlib import Path

import config
from enrich import enrich
from validate import load_knowledge

ROOT = Path(__file__).parent.parent
SRC = ROOT / "src"
JS_ORDER = ["segmenter.js", "matcher.js", "docx.js", "app.js"]


def build(knowledge_dir, out_path, law_dbs=None, news_db=None):
    k = load_knowledge(knowledge_dir)
    warnings = enrich(
        k,
        law_dbs if law_dbs is not None else config.LAW_DBS,
        news_db if news_db is not None else config.NEWS_DB,
    )
    for w in warnings:
        print(f"경고: {w}", file=sys.stderr)

    payload = {"common": k["common"], "types": k["types"]}
    # </script> 조기 종료 방지: JSON 문자열 내 </ 를 <\/ 로 (JSON 유효 이스케이프)
    data_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    html = (SRC / "template.html").read_text()
    html = html.replace("/*__STYLE__*/", (SRC / "style.css").read_text())
    html = html.replace("/*__VENDOR_JS__*/", (ROOT / "vendor" / "jszip.min.js").read_text())
    html = html.replace("/*__APP_JS__*/", "\n".join((SRC / f).read_text() for f in JS_ORDER))
    html = html.replace("__DATA_JSON__", data_json)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    _smoke(out)
    return out


def _smoke(path):
    html = path.read_text()
    assert "__DATA_JSON__" not in html and "/*__" not in html, "플레이스홀더 잔존"
    m = re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', html, re.S)
    assert m, "cr-data 스크립트 블록 없음"
    data = json.loads(m.group(1))
    n = len(data["common"]["checkpoints"]) + sum(len(t["checkpoints"]) for t in data["types"])
    assert n > 0, "체크포인트 0개"
    kb = len(html) // 1024
    print(f"스모크 OK: 체크포인트 {n}개, {kb}KB → {path}")


if __name__ == "__main__":
    build(ROOT / "knowledge", ROOT / "dist" / "contract-review.html")
```

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest tests/ -v && node --test tests/`
Expected: Python 14 passed, JS 7 pass

- [ ] **Step 5: Commit**

```bash
git add build/build_html.py tests/test_build.py
git commit -m "feat: 단일 HTML 빌드 파이프라인"
```

---

### Task 9: 지식 초안 — common.yaml + outsourcing.yaml

**Files:**
- Create: `knowledge/common.yaml`, `knowledge/types/outsourcing.yaml`

콘텐츠 작성 태스크임. 아래 절차와 인벤토리에 따라 Claude가 초안을 작성하되,
**법무 하네스 원칙을 적용**한다:

1. 각 체크포인트의 legal_basis 후보 조문을 실제 DB에서 조회해 **원문을 읽고 나서** guidance를 쓴다:
   ```bash
   sqlite3 "$HOME/Library/Mobile Documents/com~apple~CloudDocs/cursor/comp_matching_auto/data/laws_monitored.sqlite" \
     "SELECT article_ref, substr(text,1,300) FROM law_articles WHERE law_name='금융기관의 업무위탁 등에 관한 규정' ORDER BY id;"
   ```
2. 조문 원문과 대조해 작성했더라도 `verified: false`로 둔다 (true 승격은 법무팀 검토자 검수 후).
3. guidance는 ~음/~슴 기술식 문체. 조문 인용 시 강행/임의/추정/간주 규범 유형 병기.
4. DB에 없는 법령(파견법)은 legal_basis에 적되 빌드 경고를 감수하고 guidance에 `(조문 미확인 — vault 확인 필요)` 표기.
5. 인벤토리의 조번호는 **후보**임. DB 원문 확인 후 다르면 바로잡는다.

- [ ] **Step 1: 업무위탁 관련 법령 원문 일괄 조회**

위 sqlite3 쿼리로 다음 법령의 관련 조문을 훑는다:
`금융기관의 업무위탁 등에 관한 규정` 전체, `개인정보 보호법` 제26조, `개인정보 보호법 시행령` 제28조,
`신용정보의 이용 및 보호에 관한 법률` 제17조, `전자금융감독규정` 제60조·제14조의2,
`보험업법` 제83조·제102조.

- [ ] **Step 2: common.yaml 작성 (10개 내외)**

인벤토리 (CMN 시리즈, module 없음):

| id | title | severity | absence_check | triggers.keywords (초안) |
|---|---|---|---|---|
| CMN-01 | 당사자·계약 목적 특정 | 필수 | true | 목적, 당사자 |
| CMN-02 | 대금·지급조건·정산 | 필수 | true | 대금, 수수료, 지급, 정산 |
| CMN-03 | 계약기간·갱신 | 필수 | true | 계약기간, 유효기간, 갱신 |
| CMN-04 | 해지·해제 사유와 절차 | 필수 | true | 해지, 해제 |
| CMN-05 | 손해배상·책임 범위 | 필수 | true | 손해배상, 배상책임 |
| CMN-06 | 비밀유지 | 필수 | true | 비밀유지, 기밀, 비공개 |
| CMN-07 | 지식재산권 귀속 | 권장 | true | 지식재산, 저작권, 특허 |
| CMN-08 | 분쟁해결·관할 | 권장 | true | 관할, 분쟁, 중재 |
| CMN-09 | 권리의무 양도 금지 | 권장 | true | 양도, 이전 |
| CMN-10 | 완전합의·변경 방식 | 참고 | false | 완전합의, 서면 변경 |

완성 예시 (이 형식·문체·밀도로 전 항목 작성):

```yaml
meta:
  type_id: common
  type_name: 공통
  detect_keywords: []
  modules: []
checkpoints:
  - id: CMN-06
    title: 비밀유지
    severity: 필수
    triggers:
      keywords: [비밀유지, 기밀, 비공개, 영업비밀]
    absence_check: true
    guidance: >
      비밀정보의 정의·범위, 존속기간(계약 종료 후 잔존 여부), 위반 시 구제수단을
      확인해야 함. 금융회사는 고객정보가 포함될 수 있어 단순 영업비밀 조항으로
      갈음할 수 없으며, 개인정보 포함 시 관련 모듈 검토가 별도로 필요함.
      존속기간 무제한 조항은 유효성 다툼 여지가 있으므로 기간 명시를 권장함.
    legal_basis: []
    jid_refs: []
    news_refs: []
```

- [ ] **Step 3: 빌드로 common.yaml 검증**

임시로 빈 types 파일 없이 검증만:
Run: `python3 -c "import sys; sys.path.insert(0,'build'); from validate import _load_file; _load_file(__import__('pathlib').Path('knowledge/common.yaml')); print('OK')"`
Expected: OK

- [ ] **Step 4: outsourcing.yaml 작성 (모듈 6개 + 체크포인트 18개 내외)**

meta 초안:

```yaml
meta:
  type_id: outsourcing
  type_name: 업무위탁
  detect_keywords: [위탁, 수탁, 업무위탁, 위탁업무, 수탁자]
  modules:
    - id: M-CORE
      name: 업무위탁 기본(금융권)
      always_on: true
      screening_question: null
      suggest_keywords: []
    - id: M-PRIV
      name: 개인(신용)정보 처리위탁
      always_on: false
      screening_question: 위탁 업무에 개인(신용)정보 처리가 포함되는가?
      suggest_keywords: [개인정보, 신용정보, 정보주체, 고객정보]
    - id: M-IT
      name: IT·전산 외주
      always_on: false
      screening_question: 전산시스템·프로그램의 개발·운영·유지보수가 포함되는가?
      suggest_keywords: [전산, 시스템 개발, 유지보수, 소프트웨어, 서버]
    - id: M-CLOUD
      name: 클라우드·국외 위탁
      always_on: false
      screening_question: 클라우드 이용 또는 국외 처리 요소가 있는가?
      suggest_keywords: [클라우드, 국외, 해외 이전, AWS, Azure]
    - id: M-SOLICIT
      name: 보험모집 관련 위탁
      always_on: false
      screening_question: 보험모집·판매 관련 업무인가?
      suggest_keywords: [모집, 판매대리, 보험계약 체결, 중개]
    - id: M-DISPATCH
      name: 도급·파견 경계
      always_on: false
      screening_question: 수탁자 인력이 위탁자 사업장에 상주하며 지휘를 받는가?
      suggest_keywords: [상주, 파견, 근무 장소, 지휘, 감독]
```

체크포인트 인벤토리 (조번호는 후보 — Step 1 원문 확인 후 확정):

| id | module | title | severity | legal_basis 후보 |
|---|---|---|---|---|
| OUT-01 | M-CORE | 위탁 업무 범위 특정·본질적 업무 해당 여부 | 필수 | 업무위탁규정 제3조 |
| OUT-02 | M-CORE | 감독당국 보고·신고 절차 | 필수 | 업무위탁규정 제5조 |
| OUT-03 | M-CORE | 재위탁 제한·사전 동의 | 필수 | 업무위탁규정 관련조 |
| OUT-04 | M-CORE | 수탁자 관리·감독권, 자료접근·감사권 | 필수 | 업무위탁규정 관련조 |
| OUT-05 | M-CORE | 금융당국 검사 수인 의무 | 필수 | 업무위탁규정 관련조 |
| OUT-06 | M-CORE | 비상계획·업무연속성(BCP)·해지 시 이관 | 권장 | 업무위탁규정 관련조 |
| OUT-07 | M-CORE | 수탁자의 법령 준수 확약 | 권장 | — |
| OUT-08 | M-CORE | 위탁수수료 산정·정산의 적정성 | 권장 | — |
| OUT-09 | M-PRIV | 처리위탁 문서화 요건(위탁 목적 외 처리 금지 등) | 필수 | 개인정보 보호법 제26조 |
| OUT-10 | M-PRIV | 수탁자 교육·관리감독·위탁사실 공개 | 필수 | 개인정보 보호법 제26조 |
| OUT-11 | M-PRIV | 재위탁 시 위탁자 동의 | 필수 | 개인정보 보호법 시행령 제28조 |
| OUT-12 | M-PRIV | 개인신용정보 처리위탁 특칙 | 필수 | 신용정보법 제17조 |
| OUT-13 | M-IT | 전산 외주 보안 요건·외주인력 통제 | 필수 | 전자금융감독규정 제60조 |
| OUT-14 | M-IT | 장애·사고 시 책임 분담과 보고 체계 | 권장 | 전자금융감독규정 관련조 |
| OUT-15 | M-CLOUD | 클라우드 이용 요건(중요도 평가·보고) | 필수 | 전자금융감독규정 제14조의2 |
| OUT-16 | M-SOLICIT | 모집위탁 상대방 자격(모집종사자 등록) | 필수 | 보험업법 제83조 |
| OUT-17 | M-SOLICIT | 모집위탁 시 배상책임(사용자책임 특칙) | 필수 | 보험업법 제102조 |
| OUT-18 | M-DISPATCH | 도급·파견 경계(지휘명령 배제 문언) | 권장 | 파견법 (DB 미수록 — 미확인 표기) |

- [ ] **Step 5: 전체 검증 실행**

Run: `python3 -m pytest tests/ -v` (기존 테스트 회귀 없음)
Run: `python3 -c "import sys; sys.path.insert(0,'build'); from validate import load_knowledge; k=load_knowledge('knowledge'); print(sum(len(d['checkpoints']) for d in [k['common']]+k['types']), '개 체크포인트 OK')"`
Expected: 28개 내외 체크포인트 OK

- [ ] **Step 6: Commit**

```bash
git add knowledge/
git commit -m "feat: 지식 초안 — 공통 + 업무위탁 (verified:false, 검수 대기)"
```

---

### Task 10: 실 DB 풀 빌드 + E2E 수동 검증

**Files:**
- Create: `samples/sample_outsourcing.txt`, `dist/contract-review.html`

- [ ] **Step 1: E2E용 샘플 계약서 작성 (samples/sample_outsourcing.txt)**

```
업무위탁계약서

주식회사 미래에셋생명보험(이하 "갑")과 주식회사 테스트솔루션(이하 "을")은
콜센터 상담 업무 위탁에 관하여 다음과 같이 계약을 체결한다.

제1조 (목적) 이 계약은 갑이 을에게 위탁하는 보험계약 유지관리 상담 업무의
수행에 관한 사항을 정함을 목적으로 한다.

제2조 (위탁업무의 범위) 을이 수행할 업무는 고객 상담, 고객정보 조회 및
개인정보 처리 업무를 포함한다.

제3조 (계약기간) 이 계약의 유효기간은 계약 체결일로부터 1년으로 한다.

제4조 (위탁수수료) 갑은 을에게 월 1천만원의 수수료를 지급한다.

제5조 (재위탁 금지) 을은 갑의 사전 서면 동의 없이 위탁업무를 제3자에게
재위탁할 수 없다.

제6조 (비밀유지) 을은 업무 수행 중 알게 된 갑의 영업비밀을 누설하여서는
아니 된다.

제7조 (계약의 해지) 각 당사자는 상대방이 계약을 위반한 경우 계약을 해지할 수 있다.
```

의도된 검증 포인트: 개인정보 키워드 → M-PRIV 자동 제안 / 손해배상·관할 조항 없음 → 누락 의심 / 제5조 → OUT-03 매칭

- [ ] **Step 2: 실 DB 풀 빌드**

```bash
cd /Users/nsss/contract-review && python3 build/build_html.py
```

Expected: `스모크 OK: 체크포인트 28개(내외), ~500KB → dist/contract-review.html`. 경고는 파견법 관련만 허용.

- [ ] **Step 3: 브라우저 수동 검증 (체크리스트)**

`open dist/contract-review.html` 후 확인:

1. [가이드] 유형 선택 → 업무위탁 체크포인트 카드·모듈 칩·조문 원문 `<details>` 펼침 정상
2. [가이드] 검색어 "재위탁" → 해당 카드만 필터링
3. [분석] samples/sample_outsourcing.txt 붙여넣기 → 분석 시작 → 유형 자동감지 "업무위탁" 선택됨
4. [분석] M-PRIV 칩에 "⚡본문 검출" 제안 표시, 클릭으로 on/off 토글
5. [분석] 검토 실행 → 좌측 조항 7개+전문, 제5조 클릭 → 우측에 재위탁 체크포인트 카드
6. [리포트] 누락 의심에 손해배상(CMN-05)·관할(CMN-08) 포함, 체크박스 체크 → 새로고침 후 유지
7. [공통] 개발자도구 Network 탭에 외부 요청 0건, 하단 고지문 표시
8. [docx] 아무 .docx 하나 열기 → 텍스트 추출됨 (없으면 텍스트 붙여넣기 경로만 확인)

문제 발견 시 해당 Task로 돌아가 수정 후 재빌드.

- [ ] **Step 4: 전체 테스트 최종 실행**

Run: `python3 -m pytest tests/ -v && node --test tests/`
Expected: 전부 pass

- [ ] **Step 5: Commit + 검수 핸드오프**

```bash
git add samples/ dist/
git commit -m "feat: Phase 1 완성 — 업무위탁 E2E (검수 대기)"
```

이후 사람 작업: knowledge/의 각 legal_basis를 원문 대조 검수 → `verified: true` 승격 → `python3 build/build_html.py` 재빌드.

---

## Self-Review 결과

- 스펙 커버리지: §5 스키마→Task 2·3, §5-1 모듈→Task 6·9, 근거등급 관통→Task 4(status 3종)·Task 7(배지), §6 런타임 1~7→Task 5·6·7, 오류 처리(docx 실패 폴백·분할 실패 단일블록·외부요청 0건)→Task 5·7·10, §7 빌드 검증→Task 3·8, 업무위탁 1종·검수 흐름→Task 9·10. 가이드 모드 전문 검색은 체크포인트·조문 텍스트 검색으로 구현(Task 7 renderGuide) — 스펙 범위 내.
- 유형 감지에서 유형이 1개뿐인 Phase 1에서는 자동 감지가 자명하지만, Phase 2 확장을 위해 구조 유지.
- 타입 일관성: segmentContract/detectType/suggestModules/analyze 시그니처가 Task 5·6 정의와 Task 7 사용처 일치. enrich의 status 3값이 style.css 배지 클래스와 일치.
