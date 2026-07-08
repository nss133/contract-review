# 검수 보조 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 법무팀 검토자가 브라우저 "검수" 탭에서 quote↔DB원문을 대조해 항목별 판정(확인/보류/수정필요)하고, 그 결과를 JSON으로 내보내 빌드타임 스크립트가 지식 YAML에 verified:true로 반영하는 검수 워크플로우 구축.

**Architecture:** 오프라인 단일 HTML 안의 새 탭에서 판정(localStorage 누적) → verification.json 내보내기 → `build/apply_verification.py`가 YAML의 `verified: false`를 타겟 패치로 `true`로 승격 → 재빌드 시 "원문확인"(녹) 배지. 검수 로직은 순수 함수(src/verify.js)로 분리해 node --test.

**Tech Stack:** Vanilla ES5 JS(브라우저 인라인), Python 3(표준 라이브러리만 — YAML 타겟 텍스트 패치, pyyaml은 검증용), node --test, pytest.

**전제(실측):** statute source 177개(전부 verified:false), practice check 56개(sources 없음). 각 source 필드: law, article, clause, quote, text(DB원문), verified, status. 탭 구조: template.html의 `data-tab` 버튼 + `pane-<name>` 섹션, app.js `.tab` 클릭 핸들러. CR = `JSON.parse(document.getElementById("cr-data").textContent)` (구조 {common:{meta,checks}, types:[{meta,checks}]}). JS_ORDER = sim→clause_role→matcher_config→segmenter→matcher→docx→app. `node --test tests/`(디렉토리)는 Node24에서 실패 — `node --test tests/*.test.js` 사용. esc() 헬퍼 app.js에 존재. ruamel 미설치.

**스펙 대비 조정:** 스펙의 "verified_date를 YAML 기록"은 YAML diff 최소화를 위해 `data/verification_log.json`(감사 로그)에 기록하는 것으로 변경. YAML은 `verified: false`→`true` 라인만 바뀜.

---

## 파일 구조

```
src/verify.js              신규 — 순수 함수(buildVerifyItems·verifyProgress·filterItems·findHighlight·sourceKey·exportJson). 전역 Verify + module.exports
src/app.js                 수정 — renderVerify(검수 탭 DOM·판정 버튼·localStorage·내보내기)
src/template.html          수정 — 검수 탭 버튼 + pane-verify
src/style.css              수정 — 검수 화면 스타일(좌우 대조·하이라이트·판정버튼·진행률)
build/apply_verification.py 신규 — verification.json → YAML verified:true 타겟 패치 + 로그 + 수정필요 리포트
build/build_html.py        수정 — JS_ORDER에 verify.js 추가
tests/verify.test.js       신규 — verify.js 순수 함수
tests/test_apply_verification.py 신규 — apply 스크립트
```

테스트 명령: `python3 -m pytest tests/` / `node --test tests/*.test.js`

---

### Task 1: src/verify.js — 검수 순수 함수 (TDD)

**Files:**
- Create: `src/verify.js`
- Test: `tests/verify.test.js`

- [ ] **Step 1: 실패 테스트 작성 (tests/verify.test.js)**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const V = require("../src/verify.js");

const CR = {
  common: { meta: { type_id: "common", type_name: "공통" }, checks: [
    { id: "CMN-12", check: "손해배상 범위 조항이 있는가", severity: "참고", severity_basis: "임의규정임 — 민법 제393조", note: "",
      sources: [{ law: "민법", article: "제393조", clause: "제1항", quote: "통상의 손해를 그 한도로 한다", text: "제393조(손해배상의 범위) ① 채무불이행으로 인한 손해배상은 통상의 손해를 그 한도로 한다.", verified: false }] },
    { id: "CMN-99", check: "실무 항목", severity: "참고", severity_basis: "실무 관행", note: "", sources: [] },
  ]},
  types: [ { meta: { type_id: "nda", type_name: "NDA" }, checks: [
    { id: "NDA-15", check: "손해배상 조항이 있는가", severity: "필수", severity_basis: "강행규정(의무)임", note: "",
      sources: [{ law: "부정경쟁방지법", article: "제11조", clause: "", quote: "손해를 배상할 책임을 진다", text: "제11조(손해배상책임) 고의 또는 과실로 …손해를 배상할 책임을 진다.", verified: false }] },
  ]}]
};

test("sourceKey: checkId#index", () => {
  assert.strictEqual(V.sourceKey("CMN-12", 0), "CMN-12#0");
});

test("buildVerifyItems: check 단위 그룹 + statute/practice 구분", () => {
  const items = V.buildVerifyItems(CR);
  assert.strictEqual(items.length, 3); // CMN-12, CMN-99, NDA-15
  const cmn12 = items.find((i) => i.checkId === "CMN-12");
  assert.strictEqual(cmn12.typeName, "공통");
  assert.strictEqual(cmn12.sources.length, 1);
  assert.strictEqual(cmn12.sources[0].index, 0);
  assert.strictEqual(cmn12.isPractice, false);
  assert.strictEqual(items.find((i) => i.checkId === "CMN-99").isPractice, true);
  assert.strictEqual(items.find((i) => i.checkId === "NDA-15").typeId, "nda");
});

test("verifyProgress: source 단위 집계, practice 제외", () => {
  const p0 = V.verifyProgress(V.buildVerifyItems(CR), {});
  assert.strictEqual(p0.total, 2); // statute source 2개 (practice 0개 제외)
  assert.strictEqual(p0.confirmed, 0);
  assert.strictEqual(p0.pending, 2);
  const p1 = V.verifyProgress(V.buildVerifyItems(CR), { "CMN-12#0": { decision: "확인" }, "NDA-15#0": { decision: "수정필요" } });
  assert.strictEqual(p1.confirmed, 1);
  assert.strictEqual(p1.needsfix, 1);
  assert.strictEqual(p1.pending, 0);
});

test("verifyProgress: 이미 verified인 source는 confirmed", () => {
  const cr2 = JSON.parse(JSON.stringify(CR));
  cr2.common.checks[0].sources[0].verified = true;
  const p = V.verifyProgress(V.buildVerifyItems(cr2), {});
  assert.strictEqual(p.confirmed, 1);
});

test("filterItems: 미검수만 / 유형별", () => {
  const items = V.buildVerifyItems(CR);
  const dec = { "CMN-12#0": { decision: "확인" } };
  const unrev = V.filterItems(items, dec, { mode: "unreviewed", typeId: "" });
  assert.ok(unrev.some((i) => i.checkId === "NDA-15"));
  assert.ok(!unrev.some((i) => i.checkId === "CMN-12")); // 확인됨 → 제외
  const nda = V.filterItems(items, dec, { mode: "all", typeId: "nda" });
  assert.deepStrictEqual(nda.map((i) => i.checkId), ["NDA-15"]);
});

test("findHighlight: quote를 text에서 찾아 구간 반환, 없으면 null", () => {
  const r = V.findHighlight("통상의 손해를 그 한도로 한다", "제393조(…) ① … 통상의 손해를 그 한도로 한다.");
  assert.ok(r && r[0] >= 0 && r[1] > r[0]);
  assert.strictEqual(V.findHighlight("존재하지 않는 문구", "원문 텍스트"), null);
});

test("exportJson: 판정 객체를 JSON 문자열로", () => {
  const s = V.exportJson({ "CMN-12#0": { decision: "확인", date: "2026-07-09" } });
  assert.strictEqual(JSON.parse(s)["CMN-12#0"].decision, "확인");
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/verify.test.js`
Expected: FAIL (`Cannot find module '../src/verify.js'`)

- [ ] **Step 3: src/verify.js 구현**

```js
"use strict";
/* 검수 화면 순수 로직. 브라우저 전역 Verify + node require 겸용. */
var Verify = (function () {
  function sourceKey(checkId, index) { return checkId + "#" + index; }

  function buildVerifyItems(CR) {
    var docs = [{ meta: CR.common.meta, checks: CR.common.checks }];
    (CR.types || []).forEach(function (t) { docs.push({ meta: t.meta, checks: t.checks }); });
    var items = [];
    docs.forEach(function (d) {
      var tn = (d.meta && d.meta.type_name) || (d.meta && d.meta.type_id) || "";
      var tid = (d.meta && d.meta.type_id) || "";
      (d.checks || []).forEach(function (cp) {
        var srcs = (cp.sources || []).map(function (s, i) {
          return { index: i, law: s.law, article: s.article, clause: s.clause || "",
                   quote: s.quote || "", text: s.text || "", verified: !!s.verified };
        });
        items.push({ checkId: cp.id, typeId: tid, typeName: tn, check: cp.check,
          severity: cp.severity, severityBasis: cp.severity_basis || "", note: cp.note || "",
          isPractice: srcs.length === 0, sources: srcs });
      });
    });
    return items;
  }

  function srcState(item, s, decisions) {
    if (s.verified) return "확인";
    var d = decisions[sourceKey(item.checkId, s.index)];
    return (d && d.decision) || "미검수";
  }

  function verifyProgress(items, decisions) {
    var total = 0, confirmed = 0, needsfix = 0, pending = 0;
    items.forEach(function (it) {
      it.sources.forEach(function (s) {
        total++;
        var st = srcState(it, s, decisions);
        if (st === "확인") confirmed++;
        else if (st === "수정필요") needsfix++;
        else pending++;
      });
    });
    return { total: total, confirmed: confirmed, needsfix: needsfix, pending: pending };
  }

  function filterItems(items, decisions, filter) {
    var mode = (filter && filter.mode) || "all";
    var typeId = (filter && filter.typeId) || "";
    return items.filter(function (it) {
      if (typeId && it.typeId !== typeId) return false;
      if (mode === "all") return true;
      if (it.sources.length === 0) return false; // practice는 all에서만
      return it.sources.some(function (s) {
        var st = srcState(it, s, decisions);
        if (mode === "unreviewed") return st === "미검수";
        if (mode === "needsfix") return st === "수정필요";
        if (mode === "confirmed") return st === "확인";
        return true;
      });
    });
  }

  function findHighlight(quote, text) {
    if (!quote || !text) return null;
    var i = text.indexOf(quote);
    if (i === -1) return null;
    return [i, i + quote.length];
  }

  function exportJson(decisions) {
    var out = {};
    Object.keys(decisions || {}).forEach(function (k) {
      var d = decisions[k];
      if (d && (d.decision === "확인" || d.decision === "수정필요")) out[k] = d;
    });
    return JSON.stringify(out, null, 2);
  }

  return { sourceKey: sourceKey, buildVerifyItems: buildVerifyItems, srcState: srcState,
    verifyProgress: verifyProgress, filterItems: filterItems, findHighlight: findHighlight, exportJson: exportJson };
})();

if (typeof module !== "undefined") module.exports = Verify;
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/verify.test.js`
Expected: 7 pass

- [ ] **Step 5: 전체 JS 회귀**

Run: `node --test tests/*.test.js`
Expected: 기존 71 + verify 7 = 78 pass

- [ ] **Step 6: Commit**

```bash
git add src/verify.js tests/verify.test.js
git commit -m "feat: 검수 순수 로직 (verify.js)"
```
마지막 줄에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.

---

### Task 2: build/apply_verification.py — 판정 JSON → YAML 승격 (TDD)

**Files:**
- Create: `build/apply_verification.py`
- Test: `tests/test_apply_verification.py`

- [ ] **Step 1: 실패 테스트 작성 (tests/test_apply_verification.py)**

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "build"))
import apply_verification as av

COMMON_YAML = """\
meta:
  type_id: common
  type_name: 공통
  detect_keywords: []
  modules: []
checks:
  - id: CMN-12
    check: 손해배상 범위 조항이 있는가
    severity: 참고
    norm_type: 임의
    basis: statute
    severity_basis: 임의규정임
    triggers:
      keywords: [손해배상]
    absence_check: true
    sources:
      - law: 민법
        article: 제393조
        verified: false
      - law: 민법
        article: 제394조
        verified: false
  - id: CMN-99
    check: 실무 항목
    severity: 참고
    norm_type: 실무
    basis: practice
    severity_basis: 실무
    triggers:
      keywords: [x]
    absence_check: false
    sources: []
"""


def _kdir(tmp_path):
    (tmp_path / "types").mkdir()
    (tmp_path / "common.yaml").write_text(COMMON_YAML)
    return tmp_path


def test_confirm_flips_verified(tmp_path):
    kdir = _kdir(tmp_path)
    dec = tmp_path / "v.json"
    dec.write_text(json.dumps({"CMN-12#0": {"decision": "확인", "date": "2026-07-09"}}))
    res = av.apply(dec, kdir=kdir, log_path=tmp_path / "log.json")
    text = (kdir / "common.yaml").read_text()
    # 첫 source만 true, 둘째는 false 유지
    lines = [l for l in text.splitlines() if "verified:" in l]
    assert lines[0].strip() == "verified: true"
    assert lines[1].strip() == "verified: false"
    assert res["applied"] == 1


def test_needsfix_not_applied_and_reported(tmp_path):
    kdir = _kdir(tmp_path)
    dec = tmp_path / "v.json"
    dec.write_text(json.dumps({"CMN-12#1": {"decision": "수정필요", "note": "조 재확인"}}))
    res = av.apply(dec, kdir=kdir, log_path=tmp_path / "log.json")
    text = (kdir / "common.yaml").read_text()
    assert "verified: true" not in text  # 미반영
    assert res["needsfix"] == [("CMN-12", "조 재확인")]


def test_idempotent(tmp_path):
    kdir = _kdir(tmp_path)
    dec = tmp_path / "v.json"
    dec.write_text(json.dumps({"CMN-12#0": {"decision": "확인"}}))
    av.apply(dec, kdir=kdir, log_path=tmp_path / "log.json")
    first = (kdir / "common.yaml").read_text()
    av.apply(dec, kdir=kdir, log_path=tmp_path / "log.json")
    assert (kdir / "common.yaml").read_text() == first  # 재적용해도 동일


def test_unknown_key_skipped(tmp_path):
    kdir = _kdir(tmp_path)
    dec = tmp_path / "v.json"
    dec.write_text(json.dumps({"NOPE-1#0": {"decision": "확인"}, "CMN-12#5": {"decision": "확인"}}))
    res = av.apply(dec, kdir=kdir, log_path=tmp_path / "log.json")
    assert res["applied"] == 0
    assert set(res["missing"]) == {"NOPE-1#0", "CMN-12#5"}


def test_log_written(tmp_path):
    kdir = _kdir(tmp_path)
    dec = tmp_path / "v.json"
    dec.write_text(json.dumps({"CMN-12#0": {"decision": "확인", "date": "2026-07-09"}}))
    logp = tmp_path / "log.json"
    av.apply(dec, kdir=kdir, log_path=logp)
    log = json.loads(logp.read_text())
    assert log["CMN-12#0"]["decision"] == "확인"


def test_result_valid_yaml(tmp_path):
    # 패치 후 load_knowledge가 여전히 유효하게 파싱되는지
    kdir = _kdir(tmp_path)
    dec = tmp_path / "v.json"
    dec.write_text(json.dumps({"CMN-12#0": {"decision": "확인"}}))
    av.apply(dec, kdir=kdir, log_path=tmp_path / "log.json")
    from validate import load_knowledge
    k = load_knowledge(kdir)
    assert k["common"]["checks"][0]["sources"][0]["verified"] is True
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_apply_verification.py -v`
Expected: FAIL (`No module named 'apply_verification'`)

- [ ] **Step 3: build/apply_verification.py 구현**

```python
"""검수 판정 JSON(verification.json) → 지식 YAML verified:true 승격.

사용: python3 build/apply_verification.py verification.json
- "확인" source: 해당 check의 sources[index]의 `verified: false` 라인을 `true`로 타겟 패치(포맷·주석 보존).
- "수정필요": YAML 미변경, 콘솔에 큐레이터 수정 목록 출력.
- 감사 로그: data/verification_log.json 병합.
- 멱등: 이미 true면 무변경. 존재하지 않는 key는 경고 후 스킵.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
KDIR_DEFAULT = ROOT / "knowledge"
LOG_DEFAULT = ROOT / "data" / "verification_log.json"

_ID_RE = re.compile(r"^\s*-?\s*id:\s*(\S+)\s*$")
_VER_RE = re.compile(r"^(\s*)verified:\s*(false|true)\s*$")


def _files(kdir):
    return [kdir / "common.yaml"] + sorted((kdir / "types").glob("*.yaml"))


def _flip_file(path, confirm):
    """confirm: set of (check_id, source_index). 반환: 적용된 (check_id, index) set."""
    lines = path.read_text().splitlines(keepends=True)
    out, applied = [], set()
    cur, src_i = None, -1
    for ln in lines:
        m = _ID_RE.match(ln)
        if m:
            cur, src_i = m.group(1), -1
        vm = _VER_RE.match(ln)
        if vm and cur is not None:
            src_i += 1
            if (cur, src_i) in confirm:
                ln = vm.group(1) + "verified: true\n"
                applied.add((cur, src_i))
        out.append(ln)
    new = "".join(out)
    if new != path.read_text():
        path.write_text(new)
    return applied


def apply(json_path, kdir=KDIR_DEFAULT, log_path=LOG_DEFAULT):
    kdir = Path(kdir)
    decisions = json.loads(Path(json_path).read_text())
    confirm, needsfix = set(), []
    for key, v in decisions.items():
        cid, _, idx = key.rpartition("#")
        dec = (v or {}).get("decision")
        if dec == "확인":
            confirm.add((cid, int(idx)))
        elif dec == "수정필요":
            needsfix.append((cid, (v or {}).get("note", "")))
    applied = set()
    for f in _files(kdir):
        applied |= _flip_file(f, confirm)
    missing = sorted(
        "{}#{}".format(c, i) for (c, i) in confirm if (c, i) not in applied
    )
    # 감사 로그 병합
    log = {}
    log_path = Path(log_path)
    if log_path.exists():
        try:
            log = json.loads(log_path.read_text())
        except Exception:
            log = {}
    for key, v in decisions.items():
        if (v or {}).get("decision") in ("확인", "수정필요"):
            log[key] = v
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log, ensure_ascii=False, indent=2))

    print("적용(verified:true): {}건".format(len(applied)))
    if needsfix:
        print("수정 필요(큐레이터 확인):")
        for cid, note in needsfix:
            print("  - {}: {}".format(cid, note))
    if missing:
        print("경고 — 존재하지 않는 key 스킵: {}".format(", ".join(missing)))
    print("재빌드하려면: python3 build/build_html.py")
    return {"applied": len(applied), "needsfix": needsfix, "missing": missing}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용: python3 build/apply_verification.py verification.json")
        sys.exit(1)
    apply(sys.argv[1])
```

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest tests/test_apply_verification.py -v`
Expected: 6 passed

- [ ] **Step 5: 전체 pytest 회귀**

Run: `python3 -m pytest tests/ -q`
Expected: 42 + 6 = 48 passed

- [ ] **Step 6: Commit**

```bash
git add build/apply_verification.py tests/test_apply_verification.py
git commit -m "feat: 검수 판정 적용 스크립트 (apply_verification)"
```
마지막 줄에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.

---

### Task 3: 빌드 통합 — JS_ORDER에 verify.js

**Files:**
- Modify: `build/build_html.py`

- [ ] **Step 1: JS_ORDER 수정**

`build/build_html.py`의 JS_ORDER를 아래로 (app.js 앞, docx.js 뒤에 verify.js):

```python
JS_ORDER = ["sim.js", "clause_role.js", "matcher_config.js", "segmenter.js", "matcher.js", "docx.js", "verify.js", "app.js"]
```

- [ ] **Step 2: 빌드·정적 확인**

Run: `python3 build/build_html.py`
Expected: `스모크 OK: check 218개`. 산출 HTML에 verify.js 인라인됐는지:
Run: `grep -c "buildVerifyItems" dist/contract-review.html`
Expected: 1 이상

- [ ] **Step 3: Commit**

```bash
git add build/build_html.py dist/contract-review.html
git commit -m "feat: 빌드에 verify.js 인라인"
```
마지막 줄 Co-Authored-By 추가.

---

### Task 4: UI — 검수 탭 (template + app.js + style.css)

DOM/브라우저 코드라 자동 테스트 대신 Task 5에서 브라우저 검증. 로직은 Task 1에서 테스트됨.

**Files:**
- Modify: `src/template.html`, `src/app.js`, `src/style.css`

- [ ] **Step 1: template.html — 검수 탭 버튼 + pane 추가**

`src/template.html`의 nav 탭 버튼들(`data-tab="report"` 다음)에 추가:

```html
    <button data-tab="verify" class="tab">검수</button>
```

그리고 `pane-report` 섹션 뒤(닫는 `</section>` 다음)에 추가:

```html
  <section id="pane-verify" class="pane">
    <div class="verify-bar">
      <span id="verify-progress" class="verify-progress"></span>
      <label>유형 <select id="verify-type"></select></label>
      <label>상태
        <select id="verify-filter">
          <option value="all">전체</option>
          <option value="unreviewed">미검수만</option>
          <option value="needsfix">수정 필요만</option>
          <option value="confirmed">확인됨</option>
        </select>
      </label>
      <button id="verify-export" class="primary">판정 내보내기</button>
    </div>
    <div id="verify-list"></div>
  </section>
```

- [ ] **Step 2: app.js — 검수 렌더·판정·내보내기 로직 추가**

`src/app.js` 맨 끝(파일 마지막)에 아래를 추가. `Verify`·`esc`·`CR` 전역 사용.

```js
/* ---------- 검수 탭 ---------- */
var VERIFY_KEY = "cr-verify-decisions";
var verifyDecisions = {};
try { verifyDecisions = JSON.parse(localStorage.getItem(VERIFY_KEY) || "{}"); } catch (e) {}
var verifyItems = Verify.buildVerifyItems(CR);

function saveVerify() { localStorage.setItem(VERIFY_KEY, JSON.stringify(verifyDecisions)); }

function initVerify() {
  var tsel = document.getElementById("verify-type");
  var types = [{ id: "", name: "전체 유형" }];
  if (CR.common.meta) types.push({ id: "common", name: CR.common.meta.type_name || "공통" });
  CR.types.forEach(function (t) { types.push({ id: t.meta.type_id, name: t.meta.type_name }); });
  tsel.innerHTML = types.map(function (t) {
    return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
  }).join("");
  tsel.addEventListener("change", renderVerify);
  document.getElementById("verify-filter").addEventListener("change", renderVerify);
  document.getElementById("verify-export").addEventListener("click", exportVerify);
  renderVerify();
}

var SEV_CLS = { "필수": "sev-필수", "권장": "sev-권장", "참고": "sev-참고" };
var DEC_LABEL = { "확인": "확인", "수정필요": "수정 필요", "보류": "보류" };

function renderVerify() {
  var p = Verify.verifyProgress(verifyItems, verifyDecisions);
  document.getElementById("verify-progress").textContent =
    "statute 근거 " + p.total + "개 · 확인 " + p.confirmed + " / 수정필요 " + p.needsfix + " / 미검수 " + p.pending;
  var filter = { mode: document.getElementById("verify-filter").value, typeId: document.getElementById("verify-type").value };
  var shown = Verify.filterItems(verifyItems, verifyDecisions, filter);
  document.getElementById("verify-list").innerHTML = shown.map(renderVerifyCard).join("") || "<p>해당 항목 없음</p>";
  bindVerifyButtons();
}

function renderVerifyCard(it) {
  if (it.isPractice) {
    return '<div class="verify-card practice"><h3><span class="sev ' + (SEV_CLS[it.severity] || "") + '">' +
      esc(it.severity) + "</span>" + esc(it.checkId) + " " + esc(it.check) +
      '</h3><p class="practice-note">실무 항목 — 법령 근거 없음(검수 대상 아님)</p></div>';
  }
  var h = '<div class="verify-card"><h3><span class="sev ' + (SEV_CLS[it.severity] || "") + '">' +
    esc(it.severity) + "</span>" + esc(it.checkId) + " " + esc(it.check) + "</h3>";
  if (it.severityBasis) h += '<p class="sev-basis">근거: ' + esc(it.severityBasis) + "</p>";
  if (it.note) h += '<p class="cp-note">' + esc(it.note) + "</p>";
  it.sources.forEach(function (s) {
    var key = Verify.sourceKey(it.checkId, s.index);
    var st = Verify.srcState(it, s, verifyDecisions);
    h += '<div class="verify-src">';
    h += '<div class="src-head">' + esc(s.law) + " " + esc(s.article) + (s.clause ? " " + esc(s.clause) : "") + "</div>";
    h += '<div class="compare">';
    h += '<div class="cmp-quote"><div class="cmp-label">발췌(quote)</div><blockquote>' + esc(s.quote) + "</blockquote></div>";
    h += '<div class="cmp-text"><div class="cmp-label">DB 원문</div><pre>' + highlightText(s.quote, s.text) + "</pre></div>";
    h += "</div>";
    if (s.verified) {
      h += '<div class="src-decided verified">이미 확인됨(verified)</div>';
    } else {
      h += '<div class="decide" data-key="' + esc(key) + '">' +
        ["확인", "보류", "수정필요"].map(function (d) {
          return '<button class="dec-btn' + (st === d ? " active dec-" + d : "") + '" data-dec="' + d + '">' + DEC_LABEL[d] + "</button>";
        }).join("") +
        '<input class="dec-note" data-key="' + esc(key) + '" placeholder="수정 필요 메모" value="' +
        esc((verifyDecisions[key] && verifyDecisions[key].note) || "") + '"></div>';
    }
    h += "</div>";
  });
  return h + "</div>";
}

function highlightText(quote, text) {
  var r = Verify.findHighlight(quote, text);
  if (!r) return esc(text);
  return esc(text.slice(0, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + "</mark>" + esc(text.slice(r[1]));
}

function bindVerifyButtons() {
  document.querySelectorAll("#verify-list .dec-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.parentNode.getAttribute("data-key");
      var dec = btn.getAttribute("data-dec");
      var note = (verifyDecisions[key] && verifyDecisions[key].note) || "";
      verifyDecisions[key] = { decision: dec, note: note, date: verifyToday() };
      saveVerify();
      renderVerify();
    });
  });
  document.querySelectorAll("#verify-list .dec-note").forEach(function (inp) {
    inp.addEventListener("change", function () {
      var key = inp.getAttribute("data-key");
      if (!verifyDecisions[key]) verifyDecisions[key] = { decision: "수정필요", date: verifyToday() };
      verifyDecisions[key].note = inp.value;
      saveVerify();
    });
  });
}

function verifyToday() {
  var d = new Date();
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}

function exportVerify() {
  var blob = new Blob([Verify.exportJson(verifyDecisions)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "verification.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

initVerify();
```

- [ ] **Step 3: style.css — 검수 화면 스타일 추가**

`src/style.css` 맨 끝에 추가:

```css
.verify-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.verify-progress { font-weight: 600; }
.verify-card { border: 1px solid #dde; border-radius: 8px; padding: 14px; margin-bottom: 14px; background: #fff; }
.verify-card.practice { opacity: .6; }
.verify-card h3 { margin: 0 0 6px; font-size: 15px; }
.verify-card .sev-basis { color: #556; font-size: 13px; margin: 2px 0; }
.verify-card .cp-note { color: #667; font-size: 13px; }
.verify-src { border-top: 1px solid #eef; margin-top: 10px; padding-top: 10px; }
.src-head { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cmp-label { font-size: 11px; color: #889; margin-bottom: 4px; }
.cmp-quote blockquote { margin: 0; padding: 8px 10px; background: #eef6ff; border-left: 3px solid #4a90d9; font-size: 13px; }
.cmp-text pre { margin: 0; padding: 8px 10px; background: #f7f8fa; border-radius: 4px; white-space: pre-wrap; font-size: 13px; max-height: 220px; overflow: auto; }
.cmp-text mark { background: #ffe08a; }
.decide { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.dec-btn { border: 1px solid #ccd; background: #fff; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.dec-btn.active.dec-확인 { background: #1f9d55; color: #fff; border-color: #1f9d55; }
.dec-btn.active.dec-보류 { background: #b9902a; color: #fff; border-color: #b9902a; }
.dec-btn.active.dec-수정필요 { background: #c0392b; color: #fff; border-color: #c0392b; }
.dec-note { flex: 1; min-width: 160px; padding: 5px 8px; border: 1px solid #ccd; border-radius: 6px; font-size: 13px; }
.src-decided.verified { margin-top: 8px; color: #1f9d55; font-weight: 600; font-size: 13px; }
@media (max-width: 720px) { .compare { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: node --check + 전역 충돌 확인**

Run: `node --check src/app.js && node --check src/verify.js`
Expected: 통과. app.js 신규 전역(verifyDecisions·verifyItems·initVerify·renderVerify·renderVerifyCard·highlightText·bindVerifyButtons·verifyToday·exportVerify·saveVerify·VERIFY_KEY·SEV_CLS·DEC_LABEL)이 기존 전역과 겹치지 않는지 눈으로 확인(SEV_CLS는 신규).

- [ ] **Step 5: DOM id 대조**

app.js가 추가로 참조하는 id(verify-type·verify-filter·verify-export·verify-progress·verify-list)가 template.html에 모두 있는지 grep 확인.

- [ ] **Step 6: Commit**

```bash
git add src/template.html src/app.js src/style.css
git commit -m "feat: 검수 탭 UI (좌우 대조·판정·내보내기)"
```
마지막 줄 Co-Authored-By 추가.

---

### Task 5: 풀빌드 + 브라우저 E2E + 라운드트립 검증 + 병합

**Files:** (검증·병합)

- [ ] **Step 1: 풀빌드**

Run: `python3 build/build_html.py`
Expected: 스모크 OK, check 218개. dist 갱신.

- [ ] **Step 2: 전체 테스트**

Run: `python3 -m pytest tests/ -q` (48 passed) 그리고 `node --test tests/*.test.js` (78 pass)

- [ ] **Step 3: 브라우저 E2E (Chrome MCP)**

`dist/contract-review.html` 열고 확인:
1. "검수" 탭 존재·클릭 → 진행률("statute 근거 177개 · …") 표시, 항목 카드 렌더
2. 한 항목의 좌(quote)·우(DB 원문) 나란히 표시, 원문에 발췌 하이라이트(`<mark>`)
3. "확인" 버튼 클릭 → 버튼 활성(녹), 진행률 확인 카운트 증가, 새로고침 후 유지(localStorage)
4. 필터 "미검수만"/"확인됨" 동작, 유형 필터 동작
5. practice 항목은 "실무 항목 — 법령 근거 없음" 표기, 판정 버튼 없음
6. "판정 내보내기" → verification.json 다운로드(내용에 확인 항목 포함)
7. 콘솔 에러 0, 외부 요청 0

- [ ] **Step 4: 라운드트립 검증 (핵심)**

브라우저에서 항목 1~2개 "확인" 후 내보낸 verification.json(또는 수동 작성)으로:
```bash
# 예: {"CMN-12#0":{"decision":"확인","date":"2026-07-09"}}
python3 build/apply_verification.py <다운로드한 verification.json>
python3 build/build_html.py
```
확인: 해당 항목의 knowledge YAML에서 `verified: true`로 바뀌고, 재빌드된 dist에서 그 항목 근거 배지가 "원문확인"(녹)으로 전환. `git diff knowledge/`가 verified 라인만 바뀌었는지(주석·포맷 보존) 확인. (검증 후 이 임시 verified 변경은 되돌리거나 유지 판단 — 실제 검수 전이면 `git checkout knowledge/`로 되돌림)

- [ ] **Step 5: dist 커밋 + 병합**

```bash
git add dist/contract-review.html
git commit -m "feat: 검수 화면 완성 — 풀빌드 (브라우저 검증)"
git switch main && git merge --ff-only verification-screen && git push origin main
```
커밋 메시지 Co-Authored-By 추가. Step 4에서 knowledge를 실제로 바꿨다면 되돌린 상태로 병합(검수는 실제 검토자가 진행).

---

## Self-Review

- 스펙 커버리지: 브라우저 검수 탭→Task 4 / quote↔원문 좌우 대조·하이라이트→Task 4(highlightText)+Task 1(findHighlight) / 3택 판정→Task 4 / localStorage 누적→Task 4 / 내보내기 JSON→Task 1(exportJson)+Task 4(exportVerify) / apply 스크립트(확인만 반영·수정필요 리포트·멱등·잘못된 키 스킵)→Task 2 / verified_date는 로그파일로(스펙 조정 명시)→Task 2 / practice 제외 표기→Task 1(isPractice)+Task 4 / 진행률·필터→Task 1+4 / 재빌드 배지 전환→Task 5 라운드트립 / 테스트(pytest·node·E2E)→각 Task.
- 타입 일관성: sourceKey 포맷 `id#index` — verify.js·app.js·apply_verification.py 3곳 동일. decision 값 {확인,보류,수정필요} 일관. exportJson은 확인·수정필요만 내보내고 apply가 동일 값 소비.
- 플레이스홀더 없음: 전 코드 블록 완전.
- 주의: apply의 `_ID_RE`는 check의 `id:`만 매칭(meta `type_id:`는 미매칭 — `id:` 앞에 `type_`이 있어 정규식 불일치). source별 `verified:` 순서 카운트로 index 매핑.
