"use strict";
/* UI 오케스트레이션. segmenter.js·matcher.js·docx.js가 먼저 인라인되어 전역 함수 사용 가능 */

var CR = JSON.parse(document.getElementById("cr-data").textContent);
var state = { text: "", clauses: [], typeId: null, activeModules: [], result: null };

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function typeDoc(typeId) {
  for (var i = 0; i < CR.types.length; i++)
    if (CR.types[i].meta.type_id === typeId) return CR.types[i];
  return null;
}
function allChecksForType(typeId) {
  var doc = typeDoc(typeId);
  return CR.common.checks.concat(doc ? doc.checks : []);
}
function findCheck(id) {
  var all = allChecksForType(state.typeId);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}
function primarySource(cp) {
  return (cp.sources && cp.sources[0]) || null;
}
// 짧은 라벨(있으면) 우선 — 해석 부담 완화(#4). 상세 질문은 check.
function cpLabel(cp) { return cp.label || cp.check; }
function hasLabel(cp) { return !!(cp.label && cp.label !== cp.check); }
// 라벨 우선 표기 HTML(cls 컨테이너 안). 라벨 없으면 check만.
function labelQ(cp) {
  if (hasLabel(cp)) return '<span class="lq-label">' + esc(cp.label) + '</span><span class="lq-detail">' + esc(cp.check) + "</span>";
  return esc(cp.check);
}

/* ---------- 증적 배지 ---------- */
function sourceBadgeInfo(src) {
  /* rank: 낮을수록 심각 — 행 배지는 전 source 중 최악을 표시 */
  switch (src.status) {
    case "quote_mismatch":
      return { cls: "mismatch", label: "문언 불일치", rank: 0 };
    case "missing":
      return { cls: "missing", label: "원문 미확인", rank: 0 };
    case "no_quote":
      return { cls: "ref", label: "참조", rank: 1 };
    case "quote_ok":
      // quote가 DB 원문에 문자적으로 일치함(빌드 시 기계 대조 통과). verified는 사람의 최종 사인오프.
      // 미사인오프를 "미대조"로 경고하던 것은 오해 소지 — 이미 원문 일치이므로 중립 표기.
      return src.verified
        ? { cls: "verified", label: "원문확인", rank: 3 }
        : { cls: "quote-ok", label: "원문 일치", rank: 3 };
    default:
      return { cls: "practice", label: "실무", rank: 4 };
  }
}
function evidenceBadgeInfo(cp) {
  var sources = cp.sources || [];
  if (!sources.length) return { cls: "practice", label: "실무" };
  var worst = null;
  sources.forEach(function (src) {
    var b = sourceBadgeInfo(src);
    if (!worst || b.rank < worst.rank) worst = b;
  });
  return worst;
}
function sourceBadgeHtml(src) {
  var b = sourceBadgeInfo(src);
  return '<span class="badge ' + b.cls + '">' + b.label + "</span>";
}
function evidenceCell(cp) {
  var src = primarySource(cp);
  var badge = evidenceBadgeInfo(cp);
  var lawText = src
    ? esc(src.law) + " " + esc(src.article) + (src.clause ? " " + esc(src.clause) : "")
    : "";
  return (lawText ? lawText + " " : "") + '<span class="badge ' + badge.cls + '">' + badge.label + "</span>" +
    (src ? sourceTypeBadgeHtml(src) : "");
}

/* ---------- coverage 배지 (계약 반영 축 — 증적 배지와 별개) ----------
   검토 보조 화법: 판정형("확정/미검출") 폐기. 짚음/확인권장/검토제안/기타. */
var COVERAGE_LABEL = {
  addressed: "✓ 반영",
  verify: "◑ 확인 권장",
  consider: "! 검토 제안",
  quiet: "·"
};
var COVERAGE_CLS = {
  addressed: "cov-addressed",
  verify: "cov-verify",
  consider: "cov-consider",
  quiet: "cov-quiet"
};
function coverageBadgeHtml(coverage) {
  if (!COVERAGE_LABEL[coverage] || coverage === "quiet") return "";
  return '<span class="badge ' + COVERAGE_CLS[coverage] + '">' + COVERAGE_LABEL[coverage] + "</span>";
}
/* source_type 배지 (법령 vs 자율규제 톤 구분) */
function sourceTypeBadgeHtml(src) {
  if (src && src.source_type === "self_regulation")
    return ' <span class="badge self-reg">자율규제</span>';
  return "";
}

/* ---------- 체크 카드 (조항별 보기·리포트 공용) ---------- */
function renderCheckCard(cp, hits) {
  var h = '<div class="cp-card"><h3><span class="sev sev-' + cp.severity + '" title="' +
    esc(cp.severity_basis || "") + '">' +
    esc(cp.severity) + "</span>" + esc(cp.id) + " <span class=\"norm-type\">" + esc(cp.norm_type) + "</span></h3>";
  h += '<p class="check-q">' + esc(cp.check) + "</p>";
  if (cp.severity_basis)
    h += '<p class="sev-basis">' + esc(cp.severity_basis) + "</p>";
  if (hits) {
    h += '<p class="hit">' + coverageBadgeHtml(hits.coverage) + " 관련 조항 — 점수 " + hits.score.toFixed(1) +
      ' <span class="reasons">' + esc((hits.reasons || []).join("; ")) + "</span></p>";
  }
  var src0 = primarySource(cp);
  if (src0 && src0.quote) {
    h += '<div class="quote-block"><p class="quote-label">원문 발췌</p><blockquote>“' +
      esc(src0.quote) + '”</blockquote></div>';
  }
  h += "<p>" + evidenceCell(cp) + "</p>";
  (cp.sources || []).forEach(function (src) {
    var label = esc(src.law) + " " + esc(src.article) + (src.clause ? " " + esc(src.clause) : "");
    h += '<details class="law"><summary>' + label + " " + sourceBadgeHtml(src) + sourceTypeBadgeHtml(src) + "</summary>";
    h += src.text ? "<pre>" + esc(src.text) + "</pre>" : "<p>원문 데이터 없음</p>";
    h += "</details>";
  });
  (cp.news || []).forEach(function (n) {
    h += '<details class="law"><summary>[동향] ' + esc(n.title) + " (" + esc(n.published_at) +
      ")</summary><p>" + esc(n.summary || "") + "</p></details>";
  });
  if (cp.note) h += '<p class="note">비고: ' + esc(cp.note) + "</p>";
  return h + "</div>";
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

/* ---------- 체크리스트 표 (주 탭) ---------- */
// 정렬 우선순위: 검토 제안 → 확인 권장 → 반영 → 기타(조용) → 미분석/비활성
var COVERAGE_RANK = { consider: 0, verify: 1, addressed: 2, quiet: 3 };
function resultFor(cp) {
  if (!state.result) return null;
  return state.result.results.filter(function (x) { return x.cpId === cp.id; })[0] || null;
}
function checkStatus(cp) {
  if (!state.result) return { cls: "", label: "—", coverage: null };
  var r = resultFor(cp);
  if (!r) return { cls: "", label: "—", coverage: null }; // 이번 분석에서 비활성 모듈 체크
  var cov = r.coverage;
  return { cls: COVERAGE_CLS[cov] || "", label: COVERAGE_LABEL[cov] || "", coverage: cov };
}

function renderModuleGuideBar(modules) {
  document.getElementById("checklist-modules").innerHTML = modules.map(function (m) {
    return '<span class="module-chip on">' + esc(m.name) + "</span>";
  }).join("");
}

function renderModuleFilterOptions(modules) {
  var sel = document.getElementById("filter-module");
  var prev = sel.value;
  var opts = ['<option value="">전체</option>'];
  modules.forEach(function (m) { opts.push('<option value="' + esc(m.id) + '">' + esc(m.name) + "</option>"); });
  opts.push('<option value="__none__">미분류</option>');
  sel.innerHTML = opts.join("");
  var stillExists = Array.prototype.some.call(sel.options, function (o) { return o.value === prev; });
  if (stillExists) sel.value = prev;
}

function renderChecklistRow(cp, st) {
  var rowCls = st.coverage === "consider" ? "row-consider" : "";
  var basis = cp.severity_basis || "";
  return '<tr class="cp-row ' + rowCls + '" data-id="' + esc(cp.id) + '">' +
    '<td class="match-cell ' + st.cls + '">' + esc(st.label) + "</td>" +
    "<td>" + esc(cp.id) + "</td>" +
    "<td>" + (hasLabel(cp)
      ? '<span class="cp-label">' + esc(cp.label) + '</span><span class="cp-detail-q">' + esc(cp.check) + "</span>"
      : esc(cp.check)) + "</td>" +
    '<td><span class="sev sev-' + cp.severity + '" title="' + esc(basis) + '">' + esc(cp.severity) + "</span>" +
    (basis ? '<span class="sev-basis-hint">' + esc(basis) + "</span>" : "") + "</td>" +
    "<td>" + esc(cp.norm_type) + "</td>" +
    "<td>" + evidenceCell(cp) + "</td>" +
    "</tr>" +
    '<tr class="cp-detail" hidden><td colspan="6"></td></tr>';
}

function renderDetail(cp) {
  var h = "";
  var src0 = primarySource(cp);
  if (src0 && src0.quote) {
    h += '<div class="quote-block"><p class="quote-label">원문 발췌</p><blockquote>“' +
      esc(src0.quote) + '”</blockquote></div>';
  }
  (cp.sources || []).forEach(function (src) {
    var label = esc(src.law) + " " + esc(src.article) + (src.clause ? " " + esc(src.clause) : "");
    h += '<details class="law"><summary>' + label + " " + sourceBadgeHtml(src) + sourceTypeBadgeHtml(src) + "</summary>";
    h += src.text ? "<pre>" + esc(src.text) + "</pre>" : "<p>원문 데이터 없음</p>";
    h += "</details>";
  });
  var r = resultFor(cp);
  if (r && r.tier !== "none" && r.best) {
    var clause = state.clauses[r.best.clauseIndex];
    var heading = clause ? clause.heading : ("조항#" + r.best.clauseIndex);
    h += '<div class="match-excerpt"><p class="hit">' + coverageBadgeHtml(r.coverage) + " " +
      esc(heading) + " — 원문 확인 권장 · 점수 " + r.best.score.toFixed(1) +
      '<br><span class="reasons">' + esc((r.best.reasons || []).join("; ")) + "</span></p>";
    h += "<pre>" + esc(clause ? clause.body : "") + "</pre>";
    if (r.ranked && r.ranked.length > 1) {
      h += '<p class="ranked-alt">다른 후보(점수순): ' + r.ranked.slice(1).map(function (rk) {
        var c = state.clauses[rk.clauseIndex];
        return esc(c ? c.heading : ("조항#" + rk.clauseIndex)) + " (" + rk.score.toFixed(1) + ")";
      }).join(", ") + "</p>";
    }
    h += "</div>";
  }
  if (cp.note) h += '<p class="note">비고: ' + esc(cp.note) + "</p>";
  return h || "<p>상세 정보 없음</p>";
}

function bindRowClicks() {
  document.querySelectorAll("#checklist-body tr.cp-row").forEach(function (tr) {
    tr.addEventListener("click", function () {
      var detail = tr.nextElementSibling;
      if (!detail || !detail.classList.contains("cp-detail")) return;
      var willOpen = detail.hidden;
      detail.hidden = !detail.hidden;
      tr.classList.toggle("expanded", !detail.hidden);
      if (willOpen && !detail.dataset.filled) {
        var cp = findCheck(tr.dataset.id);
        if (cp) {
          detail.querySelector("td").innerHTML = renderDetail(cp);
          detail.dataset.filled = "1";
        }
      }
    });
  });
}

function renderChecklist() {
  var typeId = document.getElementById("checklist-type").value;
  state.typeId = typeId;
  var doc = typeDoc(typeId);
  var allModules = (CR.common.meta.modules || []).concat(doc ? doc.meta.modules : []);
  renderModuleGuideBar(allModules);
  renderModuleFilterOptions(allModules);

  var base = allChecksForType(typeId);

  var modF = document.getElementById("filter-module").value;
  var sevF = document.getElementById("filter-severity").value;
  var matchF = document.getElementById("filter-match").value;
  var q = document.getElementById("filter-search").value.trim();

  function passFilter(cp, st) {
    if (modF) {
      if (modF === "__none__") { if (cp.module) return false; }
      else if (cp.module !== modF) return false;
    }
    if (sevF && cp.severity !== sevF) return false;
    // matchF: unmatched="검토 제안만"(consider) / matched="반영·확인만"(addressed·verify)
    if (matchF === "unmatched" && st.coverage !== "consider") return false;
    if (matchF === "matched" && st.coverage !== "addressed" && st.coverage !== "verify") return false;
    if (q) {
      var src = primarySource(cp);
      var hay = cp.check + " " + (src ? src.law + " " + src.article : "");
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  // coverage 우선(consider→verify→addressed→quiet→미분석) → 심각도순(필수→권장→참고) → score 내림차순
  var rows = base.map(function (cp) { return { cp: cp, st: checkStatus(cp) }; });
  if (state.result) {
    rows.sort(function (a, b) {
      var ra = COVERAGE_RANK[a.st.coverage]; if (ra === undefined) ra = 4;
      var rb = COVERAGE_RANK[b.st.coverage]; if (rb === undefined) rb = 4;
      if (ra !== rb) return ra - rb;
      var sva = SEV_RANK[a.cp.severity]; if (sva === undefined) sva = 3;
      var svb = SEV_RANK[b.cp.severity]; if (svb === undefined) svb = 3;
      if (sva !== svb) return sva - svb; // 같은 coverage 안에서 심각도(필수 먼저)
      var la = resultFor(a.cp), lb = resultFor(b.cp);
      var sa = la && la.best ? la.best.score : -1;
      var sb = lb && lb.best ? lb.best.score : -1;
      return sb - sa;
    });
  }
  rows = rows.filter(function (r) { return passFilter(r.cp, r.st); });

  document.getElementById("checklist-body").innerHTML =
    rows.map(function (r) { return renderChecklistRow(r.cp, r.st); }).join("") ||
    '<tr><td colspan="6" class="empty">조건에 맞는 항목 없음</td></tr>';

  bindRowClicks();
}

function initChecklistType() {
  var sel = document.getElementById("checklist-type");
  // 맨 앞 미확정 옵션(P3): 감지 점수 임계 미달 시 자동선택하지 않고 공통 검토만 — 오유형 체크리스트 로드 방지.
  sel.innerHTML = '<option value="">— 유형 미확정 (직접 선택) —</option>' + CR.types.map(function (t) {
    return '<option value="' + esc(t.meta.type_id) + '">' + esc(t.meta.type_name) + "</option>";
  }).join("");
  sel.addEventListener("change", function () {
    state.typeId = sel.value;
    if (!document.getElementById("analyze-setup").hidden) {
      renderScreening();
      if (_analyzedOnce) { runAnalysis(); return; } // 유형 변경 시 즉시 재검토
    }
    renderChecklist();
  });
  state.typeId = sel.value;
}

["filter-module", "filter-severity", "filter-match"].forEach(function (id) {
  document.getElementById(id).addEventListener("change", renderChecklist);
});
document.getElementById("filter-search").addEventListener("input", renderChecklist);

/* ---------- 분석 모드: 입력 ---------- */
// 파일 하나에서 텍스트 추출해 입력창에 넣기(파일 열기·드래그앤드롭 공용).
function loadContractFile(f) {
  if (!f) return;
  var err = document.getElementById("input-error");
  err.textContent = "파일에서 텍스트 추출 중… (" + f.name + ")";
  err.hidden = false;
  extractFileText(f).then(function (text) {
    document.getElementById("contract-text").value = text;
    err.hidden = true;
  }).catch(function (ex) {
    err.textContent = "파일 파싱 실패(" + ex.message + ") — 원본에서 텍스트를 복사해 붙여넣으세요. " +
      "(스캔 PDF·암호 문서·구형 hwp는 자동 추출이 안 됩니다)";
    err.hidden = false;
  });
}
document.getElementById("docx-file").addEventListener("change", function (e) {
  loadContractFile(e.target.files[0]);
});

// 부속 서류(#3) — 검토 대상 아닌 별도 서류. 필수 항목 커버 확인용.
state.subDocs = []; // [{name, text}]
function renderSubDocList() {
  var el = document.getElementById("subdoc-list");
  el.innerHTML = state.subDocs.map(function (d, i) {
    return '<span class="subdoc-chip">' + esc(d.name) +
      ' <button class="subdoc-x" data-i="' + i + '" title="제거">×</button></span>';
  }).join("");
  el.querySelectorAll(".subdoc-x").forEach(function (b) {
    b.addEventListener("click", function () {
      state.subDocs.splice(Number(b.dataset.i), 1);
      renderSubDocList();
      if (_analyzedOnce) runAnalysis();
    });
  });
}
document.getElementById("subdoc-file").addEventListener("change", function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  var err = document.getElementById("input-error");
  var chain = Promise.resolve();
  files.forEach(function (f) {
    chain = chain.then(function () {
      return extractFileText(f).then(function (text) {
        state.subDocs.push({ name: f.name, text: text });
      }).catch(function (ex) {
        err.textContent = "부속 서류 '" + f.name + "' 추출 실패(" + ex.message + ") — 건너뜀";
        err.hidden = false;
      });
    });
  });
  chain.then(function () {
    renderSubDocList();
    e.target.value = "";
    if (_analyzedOnce) runAnalysis();
  });
});
// 드래그앤드롭 — 드롭 존에 파일을 놓으면 추출.
(function () {
  var zone = document.getElementById("drop-zone");
  if (!zone) return;
  ["dragenter", "dragover"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("dragging"); });
  });
  ["dragleave", "dragend"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) {
      if (ev === "dragleave" && zone.contains(e.relatedTarget)) return;
      zone.classList.remove("dragging");
    });
  });
  zone.addEventListener("drop", function (e) {
    e.preventDefault();
    zone.classList.remove("dragging");
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadContractFile(f);
  });
})();

// 한 번의 "분석 시작"으로 유형 감지 → 모듈 스크리닝 → 검토까지 실행(군더더기 제거).
// 이후 유형·모듈을 조정하면 즉시 재검토됨(btn-run 없음).
document.getElementById("btn-analyze").addEventListener("click", function () {
  state.text = document.getElementById("contract-text").value;
  if (!state.text.trim()) return;
  state.clauses = segmentContract(state.text);
  // 유형 감지 v2(P3): 표제 가중·본문 캡 점수 + 임계(pickType). 미달이면 미확정("") — 오유형 체크리스트 로드 방지.
  var ranked = detectType(state.text, CR.types);
  state.detectRanked = ranked;
  var sel = document.getElementById("checklist-type");
  sel.value = pickType(ranked) || "";
  state.typeId = sel.value;
  renderScreening();
  renderTags();
  document.getElementById("analyze-setup").hidden = false;
  runAnalysis();
});

/* ---------- 자동 마킹 태그 (계약 세부 성격) ---------- */
// 계약서 앞부분(제목·전문 위주 500자)에서 성격 태그를 감지해 보조 배지로 표시.
// 유형과 독립 — 유형 선택 부담 없이 "이 계약은 렌탈·변경건·투자성" 등을 자동 마킹.
function renderTags() {
  var head = String(state.text || "").slice(0, 500);
  var tags = Tags.detectTags(head);
  var bar = document.getElementById("tag-bar");
  var html = _detectInfoHtml();
  if (tags.length) {
    html += (html ? " · " : "") + '<span class="tag-bar-label">자동 감지 성격:</span> ' +
      tags.map(function (t) { return '<span class="ctag">' + esc(t) + "</span>"; }).join(" ");
  }
  bar.innerHTML = html;
}
// 감지 근거 노출(P3): 왜 이 유형으로 봤는지(적중 키워드), 미확정이면 후보 제시 —
// 오감지를 사용자가 즉시 알아채고 수동 전환할 수 있게 하는 안전장치.
function _detectInfoHtml() {
  var ranked = state.detectRanked;
  if (!ranked || !ranked.length) return "";
  var top = ranked[0];
  var picked = pickType(ranked);
  if (picked) {
    var doc = typeDoc(picked);
    var name = doc ? doc.meta.type_name : picked;
    var kws = (top.hits || []).slice(0, 5).join("·");
    return '<span class="detect-info">감지 유형: <strong>' + esc(name) + "</strong>" +
      (kws ? ' <span class="detect-basis">(근거어: ' + esc(kws) + ")</span>" : "") +
      ' <span class="detect-hint">오감지면 유형을 직접 변경하세요</span></span>';
  }
  var cands = ranked.filter(function (r) { return r.score > 0; }).slice(0, 3)
    .map(function (r) {
      var d = typeDoc(r.typeId);
      return esc((d ? d.meta.type_name : r.typeId)) + "(" + r.score + ")";
    }).join(" · ");
  return '<span class="detect-info detect-undetermined">유형 미확정 — 공통 항목만 검토 중. ' +
    (cands ? "후보: " + cands + ". " : "") + "유형을 직접 선택하세요.</span>";
}

/* ---------- 분석 모드: 모듈 스크리닝 ---------- */
function renderScreening() {
  var doc = typeDoc(document.getElementById("checklist-type").value);
  if (!doc) {
    document.getElementById("screening").innerHTML = "";
    state.activeModules = [];
    return;
  }
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
      '" data-mid="' + esc(m.id) + '" title="' + esc(m.screening_question || "") + '">' +
      esc(m.name) + (sug ? " ⚡본문 검출" : "") + "</label>";
  }).join("");
  document.querySelectorAll("#screening .module-chip[data-mid]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var mid = chip.dataset.mid;
      var i = state.activeModules.indexOf(mid);
      if (i === -1) state.activeModules.push(mid); else state.activeModules.splice(i, 1);
      chip.classList.toggle("on");
      if (_analyzedOnce) runAnalysis(); // 모듈 조정 시 즉시 재검토
    });
  });
}

/* ---------- 분석 실행 ---------- */
// 유형·모듈 조건으로 검토 실행. 최초 분석 시작·유형변경·모듈토글 모두 이 함수를 호출(즉시 재검토).
var _analyzedOnce = false;
function runAnalysis() {
  if (!state.clauses.length) return;
  state.typeId = document.getElementById("checklist-type").value;
  var doc = typeDoc(state.typeId);
  var docs = [
    { checkpoints: CR.common.checks },
    { checkpoints: doc ? doc.checks : [] },
  ];
  state.result = analyze(state.clauses, docs, state.activeModules);

  // 부속 서류 커버리지(#3): consider(필수 부재)로 뜬 항목이 부속서류에서 다뤄지는지.
  state.subDocCov = {};
  if (state.subDocs && state.subDocs.length) {
    var considerCps = state.result.results
      .filter(function (x) { return x.coverage === "consider"; })
      .map(function (x) { return _cpById(x.cpId); })
      .filter(Boolean);
    if (considerCps.length) {
      var model = buildModel(docs, state.activeModules);
      var subs = state.subDocs.map(function (d) {
        return { name: d.name, clauses: segmentContract(d.text) };
      });
      state.subDocCov = subDocCoverage(considerCps, subs, model);
    }
  }
  loadVerdicts();
  renderClauses();
  bindVerdictIO();
  renderChecklist();
  renderReport();
  document.getElementById("analyze-result").hidden = false;
  document.getElementById("clauses-empty").hidden = true;
  document.getElementById("report-tab").disabled = false;
  if (!_analyzedOnce) {
    // 최초 분석에서만 탭 이동·입력패널 접기(재검토 시 현재 탭 유지)
    document.getElementById("input-panel").open = false;
    document.querySelector('.tab[data-tab="checklist"]').click();
    _analyzedOnce = true;
  }
}

/* ---------- 검토의견 지식 루프(#4) — cpId 단위 누적 코퍼스 ----------
   여러 계약서 검토의견을 쌓아 판정 분포·코멘트 추천 제공. 저장키 cr-loop-corpus. */
var LOOP_KEY = "cr-loop-corpus";
var loopCorpus = Loop.emptyCorpus();
try { loopCorpus = JSON.parse(localStorage.getItem(LOOP_KEY)) || Loop.emptyCorpus(); } catch (e) {}
function saveCorpus() { localStorage.setItem(LOOP_KEY, JSON.stringify(loopCorpus)); }
// 현재 계약서의 검토의견을 코퍼스에 적재(닫힌 루프의 ③단계).
function ingestCurrentToCorpus() {
  var meta = { type_id: state.typeId, date: verdictToday(), contract_hash: verdictHash };
  loopCorpus = Loop.mergeIntoCorpus(loopCorpus, Verdict.exportVerdicts(verdictStore, meta));
  saveCorpus();
}

/* ---------- 조항별 검토의견(verdict) — 계약서 건별 판정 축 ----------
   '검수'(verified: 지식 정확성)와 별개. 이 계약서의 이 항목이 이상없음/검토의견/해당없음.
   저장키 cr-verdict-<계약서해시>. */
var verdictStore = {};
var verdictHash = "";
function loadVerdicts() {
  verdictHash = hashText(state.text || "");
  try { verdictStore = JSON.parse(localStorage.getItem(Verdict.verdictKey(verdictHash)) || "{}"); }
  catch (e) { verdictStore = {}; }
}
function saveVerdicts() {
  localStorage.setItem(Verdict.verdictKey(verdictHash), JSON.stringify(verdictStore));
}
function applyVerdict(cpId, verdict, comment) {
  verdictStore = Verdict.setVerdict(verdictStore, cpId, verdict, comment, verdictToday());
  saveVerdicts();
}
function verdictToday() {
  var d = new Date();
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}
var VERDICT_CLS = { "이상없음": "vd-ok", "검토의견": "vd-comment", "해당없음": "vd-na" };
// 지식 루프(#4) — 이 cpId의 과거 판정 분포 + 추천 코멘트. 없으면 빈 문자열.
function loopInfoHtml(cpId) {
  var st = Loop.checkStats(loopCorpus, cpId);
  if (!st) return "";
  var h = '<div class="loop-info"><span class="loop-dist">과거 판정(n=' + st.n + (st.lowSample ? ", 표본 적음" : "") + "): ";
  Loop.VERDICTS.forEach(function (v) {
    if (st.dist[v] > 0) h += '<span class="vd-badge ' + VERDICT_CLS[v] + '">' + v.slice(0, 2) + " " + st.pct[v] + "%</span>";
  });
  h += "</span>";
  var top = Loop.topComments(loopCorpus, cpId, 3);
  if (top.length) {
    h += '<div class="loop-comments">자주 남긴 의견: ' + top.map(function (c) {
      return '<button class="loop-c" data-vcp="' + esc(cpId) + '" data-ct="' + esc(c.text) + '">' +
        esc(c.text) + " <span class=\"loop-c-n\">×" + c.count + "</span></button>";
    }).join("") + "</div>";
  }
  return h + "</div>";
}
// 코퍼스 큐레이션 신호 패널(③ 자동 강등 후보 서페이싱).
// 반복 해당없음(표본≥5·80%+)=조건부 강등 후보, 반복 이상없음=gold(알람 우선순위 하향 후보).
// 자동 반영 아님 — 큐레이터가 지식(yaml tier)에 반영할지 판단하는 제시용.
function curationPanelHtml() {
  var sig = Loop.curationSignals(loopCorpus, { minN: 5, ratio: 0.8 });
  if (!sig.conditional.length && !sig.gold.length) return "";
  function _name(cpId) {
    var cp = _cpById(cpId);
    return cp ? String(labelQ(cp)).replace(/<[^>]+>/g, " ").trim() : cpId;
  }
  var h = '<details class="curation-panel"><summary>지식 정규화 후보 (코퍼스 누적 신호)</summary>' +
    '<p class="curation-hint">실무 판정이 쌓여 도출된 후보. 자동 반영 아님 — 큐레이터가 지식 조정(tier 강등 등) 여부를 판단.</p>';
  if (sig.conditional.length) {
    h += '<div class="curation-group"><h5>조건부 강등 후보 (반복 해당없음)</h5><ul>' +
      sig.conditional.map(function (c) {
        return "<li>" + esc(_name(c.cpId)) + ' <span class="cur-stat">표본 ' + c.n + "건 · 해당없음 " + c.pct + "%</span></li>";
      }).join("") + "</ul></div>";
  }
  if (sig.gold.length) {
    h += '<div class="curation-group"><h5>안정 항목 (반복 이상없음)</h5><ul>' +
      sig.gold.map(function (c) {
        return "<li>" + esc(_name(c.cpId)) + ' <span class="cur-stat">표본 ' + c.n + "건 · 이상없음 " + c.pct + "%</span></li>";
      }).join("") + "</ul></div>";
  }
  return h + "</details>";
}
// cpId에 대한 판정 버튼 + 코멘트 입력 HTML. 현재 판정 활성 표시.
function verdictControlHtml(cpId) {
  var cur = verdictStore[cpId] || {};
  var btns = Verdict.VERDICTS.map(function (v) {
    var on = cur.verdict === v ? " active " + VERDICT_CLS[v] : "";
    return '<button class="vd-btn' + on + '" data-vcp="' + esc(cpId) + '" data-vd="' + esc(v) + '">' + esc(v) + "</button>";
  }).join("");
  // 판정이 있으면(이상없음·검토의견·해당없음 어느 것이든) 코멘트 입력 노출.
  // 해당없음도 "왜 해당 없는지", 이상없음도 "확인 근거"를 남길 수 있어야 함.
  var showComment = !!cur.verdict;
  var ph = cur.verdict === "해당없음" ? "해당 없는 이유(선택)"
    : cur.verdict === "이상없음" ? "확인 메모(선택)" : "검토의견 메모";
  var comment = '<input class="vd-note' + (showComment ? " show" : "") + '" data-vcp="' + esc(cpId) +
    '" placeholder="' + esc(ph) + '" value="' + esc(cur.comment || "") + '">';
  return '<div class="verdict-ctl">' + btns + comment + "</div>" + loopInfoHtml(cpId);
}
// 조항별 보기·리포트 공용 — 판정 버튼 클릭·코멘트 저장 바인딩. reRender: 저장 후 호출.
function bindVerdictControls(root, reRender) {
  root.querySelectorAll(".vd-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cp = btn.getAttribute("data-vcp"), v = btn.getAttribute("data-vd");
      var cur = verdictStore[cp] || {};
      // 같은 판정 다시 누르면 취소(토글)
      var next = cur.verdict === v ? "" : v;
      applyVerdict(cp, next, cur.comment || "");
      if (reRender) reRender();
    });
  });
  root.querySelectorAll(".vd-note").forEach(function (inp) {
    inp.addEventListener("change", function () {
      var cp = inp.getAttribute("data-vcp");
      var cur = verdictStore[cp] || {};
      // 코멘트만 입력하면 검토의견으로 자동 설정
      var v = cur.verdict || "검토의견";
      applyVerdict(cp, v, inp.value);
      if (reRender) reRender();
    });
  });
  // 추천 코멘트 클릭 → 코멘트 재사용(#4 루프 활용). 판정 없으면 검토의견으로.
  root.querySelectorAll(".loop-c").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cp = btn.getAttribute("data-vcp"), text = btn.getAttribute("data-ct");
      var cur = verdictStore[cp] || {};
      applyVerdict(cp, cur.verdict || "검토의견", text);
      if (reRender) reRender();
    });
  });
}

// 검토의견 내보내기/불러오기 (계약서 건별 JSON)
function exportVerdicts() {
  var meta = { type_id: state.typeId, date: verdictToday(), contract_hash: verdictHash };
  var blob = new Blob([JSON.stringify(Verdict.exportVerdicts(verdictStore, meta), null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "contract-review-verdicts.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function bindVerdictIO() {
  var exp = document.getElementById("verdict-export");
  if (exp) exp.addEventListener("click", exportVerdicts);
  var imp = document.getElementById("verdict-import");
  if (imp) imp.addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (!f) return;
    f.text().then(function (t) {
      var obj = JSON.parse(t);
      verdictStore = Verdict.importVerdicts(obj);
      saveVerdicts();
      renderClauses();
      renderReport();
    }).catch(function () { /* 파싱 실패 무시 */ });
    e.target.value = "";
  });
}

/* ---------- 조항별 보기 (보조 탭) — 좌우대비 ---------- */
// 조항 하나에 대해: 좌 "반영된 검토항목"(그 조항이 best인 addressed) / 우 "추가 확인 제안"(verify).
// results를 best.clauseIndex로 역인덱싱하여 coverage별로 모음.
function _cpById(id) {
  var cps = state.result.checkpoints;
  for (var i = 0; i < cps.length; i++) if (cps[i].id === id) return cps[i];
  return null;
}
// 검토항목 1건 요약: 심각도(+근거 툴팁) · 질문 · reason · 근거.
function renderCompareItem(r) {
  var cp = _cpById(r.cpId);
  if (!cp) return "";
  var reasons = (r.best && r.best.reasons) || [];
  return '<div class="compare-item">' +
    '<div class="ci-head"><span class="sev sev-' + cp.severity + '" title="' + esc(cp.severity_basis || "") + '">' +
    esc(cp.severity) + "</span><span class=\"ci-id\">" + esc(cp.id) + "</span></div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    (reasons.length ? '<p class="ci-reason">' + esc(reasons.join("; ")) + "</p>" : "") +
    (cp.severity_basis ? '<p class="ci-basis">' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">' + evidenceCell(cp) + "</p>" +
    verdictControlHtml(cp.id) +
    "</div>";
}
// 검토 제안 항목 1건 — 부재 알람이라 조항 매핑 없음. 왜 봐야 하는지 + 판정·코멘트.
function renderConsiderItem(r) {
  var cp = _cpById(r.cpId);
  if (!cp) return "";
  return '<div class="compare-item consider-item">' +
    '<div class="ci-head"><span class="sev sev-' + cp.severity + '" title="' + esc(cp.severity_basis || "") + '">' +
    esc(cp.severity) + "</span><span class=\"ci-id\">" + esc(cp.id) + "</span></div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    (cp.severity_basis ? '<p class="ci-basis">왜 봐야 하는지: ' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">근거 ' + evidenceCell(cp) + "</p>" +
    verdictControlHtml(cp.id) +
    "</div>";
}
function renderClauses() {
  // ci -> { addressed:[r...], verify:[r...] }
  var byClause = {};
  var considerList = [];
  state.result.results.forEach(function (r) {
    if (r.coverage === "consider") { considerList.push(r); return; }
    if (!r.best || r.coverage === "quiet") return;
    var ci = r.best.clauseIndex;
    var g = byClause[ci] || (byClause[ci] = { addressed: [], verify: [] });
    if (r.coverage === "addressed") g.addressed.push(r);
    else if (r.coverage === "verify") g.verify.push(r);
  });
  // 심각도순(필수 먼저)
  considerList.sort(function (a, b) {
    var ca = _cpById(a.cpId), cb = _cpById(b.cpId);
    var sa = SEV_RANK[ca && ca.severity]; if (sa === undefined) sa = 3;
    var sb = SEV_RANK[cb && cb.severity]; if (sb === undefined) sb = 3;
    return sa - sb;
  });
  var listHtml = state.clauses.map(function (c) {
    var g = byClause[c.index] || { addressed: [], verify: [] };
    return '<div class="clause" data-ci="' + c.index + '"><strong>' + esc(c.heading) +
      '</strong><span class="cnt">' + esc(clauseCountText(c.index, g)) + "</span><pre>" +
      esc(c.body) + "</pre></div>";
  }).join("");
  // 검토 제안(계약서에서 확인 안 됨) — 특정 조항에 없는 부재 알람. 별도 진입 항목.
  if (considerList.length) {
    var mustN = considerList.filter(function (r) { var c = _cpById(r.cpId); return c && c.severity === "필수"; }).length;
    var opinN = considerList.filter(function (r) { var v = verdictStore[r.cpId]; return v && v.verdict === "검토의견"; }).length;
    var sub = (mustN ? "필수 " + mustN : "") + (opinN ? (mustN ? " · " : "") + "의견 " + opinN : "");
    listHtml += '<div class="clause clause-consider" data-ci="consider"><strong>⚠ 검토 제안 (계약서에서 확인 안 됨)</strong>' +
      '<span class="cnt">' + esc(sub) + "</span>" +
      '<pre>필수·권장 항목 중 계약서에서 매칭 조항을 찾지 못한 것들. 빠졌다는 뜻이 아니라 검토가 필요한 사항.</pre></div>';
  }
  document.getElementById("clause-list").innerHTML = listHtml;
  function showClause(ci) {
    var detail = document.getElementById("mapping-detail");
    if (ci === "consider") {
      // 검토 제안 전용 — 조항 매핑 없음. 각 항목에 판정·코멘트(오류 여부 검토).
      var items = considerList.map(renderConsiderItem).join("") ||
        '<p class="compare-empty">검토 제안 항목 없음</p>';
      detail.innerHTML =
        '<div class="consider-panel"><h3><span class="badge cov-consider">! 검토 제안</span> 계약서에서 확인되지 않은 항목</h3>' +
        '<p class="consider-hint">각 항목이 실제로 빠진 것인지(오류) 아니면 해당 없는지 검토하고 의견을 남기세요.</p>' +
        items + "</div>";
      bindVerdictControls(detail, function () { showClause("consider"); refreshClauseCounts(); renderReport(); });
      return;
    }
    var g = byClause[ci] || { addressed: [], verify: [] };
    var left = g.addressed.map(renderCompareItem).join("") ||
      '<p class="compare-empty">이 조항에서 반영으로 짚인 항목 없음</p>';
    var right = g.verify.map(renderCompareItem).join("") ||
      '<p class="compare-empty">추가 확인 제안 없음</p>';
    detail.innerHTML =
      '<div class="clause-compare">' +
      '<div class="compare-col addressed-col"><h3><span class="badge cov-addressed">✓ 반영</span> 이 조항에서 반영된 검토항목</h3>' + left + "</div>" +
      '<div class="compare-col verify-col"><h3><span class="badge cov-verify">◑ 확인 권장</span> 추가 확인 제안</h3>' + right + "</div>" +
      "</div>";
    // 판정 변경 시 이 조항만 다시 그림(활성 상태·코멘트 표시 갱신) + 조항 목록 카운트 갱신.
    bindVerdictControls(detail, function () { showClause(ci); refreshClauseCounts(); renderReport(); });
  }
  document.querySelectorAll(".clause").forEach(function (el) {
    el.addEventListener("click", function () {
      document.querySelectorAll(".clause").forEach(function (x) { x.classList.remove("sel"); });
      el.classList.add("sel");
      var ci = el.dataset.ci;
      showClause(ci === "consider" ? "consider" : Number(ci));
    });
  });
  // 조항 목록의 판정 카운트(의견 n) 갱신 — 판정 변경 후 호출.
  refreshClauseCounts = function () {
    document.querySelectorAll(".clause").forEach(function (el) {
      var raw = el.dataset.ci;
      if (raw === "consider") { // 검토 제안 항목 카운트(필수·의견)
        var mustN = considerList.filter(function (r) { var c = _cpById(r.cpId); return c && c.severity === "필수"; }).length;
        var opinN = considerList.filter(function (r) { var v = verdictStore[r.cpId]; return v && v.verdict === "검토의견"; }).length;
        var cntC = el.querySelector(".cnt");
        if (cntC) cntC.textContent = (mustN ? "필수 " + mustN : "") + (opinN ? (mustN ? " · " : "") + "의견 " + opinN : "");
        return;
      }
      var ci = Number(raw);
      var g = byClause[ci] || { addressed: [], verify: [] };
      var cntEl = el.querySelector(".cnt");
      if (cntEl) cntEl.textContent = clauseCountText(ci, g);
    });
  };
}
var refreshClauseCounts = function () {};
// 조항의 반영·확인 건수 + 검토의견 건수 텍스트.
function clauseCountText(ci, g) {
  var parts = [];
  if (g.addressed.length) parts.push("반영 " + g.addressed.length);
  if (g.verify.length) parts.push("확인 " + g.verify.length);
  var opinions = 0;
  g.addressed.concat(g.verify).forEach(function (r) {
    var v = verdictStore[r.cpId];
    if (v && v.verdict === "검토의견") opinions++;
  });
  if (opinions) parts.push("의견 " + opinions);
  return parts.join(" · ");
}

/* ---------- 종합 리포트 (긍정-먼저 검토 워크시트) ----------
   실패 목록이 아니라 검토 진행 현황: 반영된 항목을 먼저·크게, 확인·검토 제안을 뒤에.
   판정형 어휘 금지 — 짚어진/반영/확인 권장/검토 제안 화법. */
function hashText(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "cr-" + (h >>> 0).toString(36);
}
var SEV_RANK = { "필수": 0, "권장": 1, "참고": 2 };
function _sevSort(a, b) {
  var ra = SEV_RANK[a.severity]; if (ra === undefined) ra = 3;
  var rb = SEV_RANK[b.severity]; if (rb === undefined) rb = 3;
  return ra - rb;
}
function _clauseHeading(idx) {
  var c = state.clauses[idx];
  return c ? c.heading : ("조항#" + idx);
}
function _signoff(cp, saved) {
  var ck = saved[cp.id] ? " checked" : "";
  return '<label class="signoff"><input type="checkbox" data-cp="' + esc(cp.id) + '"' + ck +
    "> 검토 완료 표시</label>";
}
// 리포트에서 각 항목의 검토의견 배지(있으면).
function _verdictBadge(cpId) {
  var v = verdictStore[cpId];
  if (!v || !v.verdict) return "";
  return ' <span class="vd-badge ' + VERDICT_CLS[v.verdict] + '">' + esc(v.verdict) + "</span>";
}
function _reportTile(cov, n, label, sub) {
  return '<div class="tile tile-' + cov + '"><span class="tile-n">' + n + "</span>" +
    '<span class="tile-label">' + esc(label) + "</span>" +
    '<span class="tile-sub">' + esc(sub) + "</span></div>";
}
// 검토 제안(consider): 왜 봐야 하는지(severity_basis) + check 질문 + 근거 + sign-off.
function _considerItem(it, saved) {
  var cp = it.cp;
  return '<div class="report-item consider-item">' +
    '<div class="ri-head"><span class="sev sev-' + cp.severity + '" title="' +
    esc(cp.severity_basis || "") + '">' + esc(cp.severity) + "</span>" +
    '<span class="ri-q">' + labelQ(cp) + "</span>" + _verdictBadge(cp.id) + "</div>" +
    (cp.severity_basis ? '<p class="ri-why">왜 봐야 하는지: ' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ri-src">근거 ' + evidenceCell(cp) + "</p>" +
    _signoff(cp, saved) + "</div>";
}
// 확인 권장(verify): 관련 조항·이유 + sign-off.
function _verifyItem(it, saved) {
  var cp = it.cp, res = it.res;
  var loc = res.best ? _clauseHeading(res.best.clauseIndex) : "";
  var reasons = (res.best && res.best.reasons) || [];
  return '<div class="report-item verify-item">' +
    '<div class="ri-head"><span class="sev sev-' + cp.severity + '" title="' +
    esc(cp.severity_basis || "") + '">' + esc(cp.severity) + "</span>" +
    '<span class="ri-q">' + labelQ(cp) + "</span>" + _verdictBadge(cp.id) + "</div>" +
    (loc ? '<p class="ri-loc">관련 조항: ' + esc(loc) + "</p>" : "") +
    (reasons.length ? '<p class="ri-reason">' + esc(reasons.join("; ")) + "</p>" : "") +
    _signoff(cp, saved) + "</div>";
}
// 짚어진 항목(addressed): 어느 조항에서 반영됐는지 — 긍정 정보 노출.
function _addressedItem(it) {
  var cp = it.cp, res = it.res;
  var loc = res.best ? _clauseHeading(res.best.clauseIndex) : "";
  var reasons = (res.best && res.best.reasons) || [];
  return '<div class="report-item addressed-item">' +
    '<div class="ri-head"><span class="badge cov-addressed">✓ 반영</span>' +
    '<span class="ri-q">' + labelQ(cp) + "</span>" + _verdictBadge(cp.id) + "</div>" +
    (loc ? '<p class="ri-loc">' + esc(loc) + "에서 반영</p>" : "") +
    (reasons.length ? '<p class="ri-reason">' + esc(reasons.join("; ")) + "</p>" : "") +
    "</div>";
}
// 조항별 검토 현황(선택): 반영/확인 건수 요약.
function _clauseSummarySection(addressed, verify) {
  var byClause = {};
  addressed.concat(verify).forEach(function (it) {
    if (!it.res.best) return;
    var ci = it.res.best.clauseIndex;
    var g = byClause[ci] || (byClause[ci] = { a: 0, v: 0 });
    if (it.res.coverage === "addressed") g.a++; else g.v++;
  });
  var rows = state.clauses.map(function (c) {
    var g = byClause[c.index];
    if (!g) return "";
    var parts = [];
    if (g.a) parts.push("반영 " + g.a);
    if (g.v) parts.push("확인 " + g.v);
    return '<li><strong>' + esc(c.heading) + '</strong> <span class="cs-cnt">' +
      esc(parts.join(" · ")) + "</span></li>";
  }).filter(Boolean);
  if (!rows.length) return "";
  return '<details class="report-sec"><summary>조항별 검토 현황</summary>' +
    '<ul class="clause-summary">' + rows.join("") + "</ul></details>";
}
// 리포트 = 2단 구성(#5 재구성): 좌=계약서 문안+검토의견 코멘트 / 우=종합 서술형 리포트.
function renderReport() {
  var r = state.result;

  // 분류
  var addressed = [], verify = [], consider = [];
  r.results.forEach(function (res) {
    var cp = _cpById(res.cpId);
    if (!cp) return;
    var it = { cp: cp, res: res, severity: cp.severity };
    if (res.coverage === "addressed") addressed.push(it);
    else if (res.coverage === "verify") verify.push(it);
    else if (res.coverage === "consider") consider.push(it);
  });
  addressed.sort(_sevSort); verify.sort(_sevSort); consider.sort(_sevSort);
  // 필수 consider를 부속서류 커버 여부로 분리(#3).
  // '해당없음'으로 검토자가 판정한 항목은 부재 알람에서 제외 — 사람이 해당 없음을 이미 판단했으므로
  // 보완 필요로 다시 띄우지 않음(#①). 매칭 안 됐어도 검토자 판정이 우선.
  function _isNA(cp) { var v = verdictStore[cp.id]; return v && v.verdict === "해당없음"; }
  var subCov = state.subDocCov || {};
  var mustAll = consider.filter(function (it) { return it.severity === "필수" && !_isNA(it.cp); });
  var mustNA = consider.filter(function (it) { return it.severity === "필수" && _isNA(it.cp); }); // 검토자가 해당없음 판정
  var mustConsider = mustAll.filter(function (it) { return !subCov[it.cp.id]; }); // 진짜 미확인
  var mustCovered = mustAll.filter(function (it) { return subCov[it.cp.id]; });   // 부속서류 커버
  var recConsider = consider.filter(function (it) { return it.severity === "권장" && !_isNA(it.cp); });

  // 검토의견(코멘트)을 조항별로 모음 — 좌 컬럼용.
  var commentsByClause = {};   // clauseIndex -> [{cp, verdict, comment}]
  var unmapped = [];           // 조항 매핑 없는(consider) 의견
  r.results.forEach(function (res) {
    var v = verdictStore[res.cpId];
    if (!v || !v.verdict) return;
    if (v.verdict === "이상없음" && !v.comment) return; // 코멘트 없는 이상없음은 노이즈 — 생략
    var cp = _cpById(res.cpId);
    if (!cp) return;
    var rec = { cp: cp, verdict: v.verdict, comment: v.comment || "" };
    if (res.best && res.coverage !== "consider") {
      var ci = res.best.clauseIndex;
      (commentsByClause[ci] = commentsByClause[ci] || []).push(rec);
    } else {
      unmapped.push(rec);
    }
  });

  // ── 좌: 계약서 문안 + 검토의견 ─────────────────────────────
  var left = '<div class="report-doc"><h3>계약서 문안 · 검토의견</h3>';
  left += state.clauses.map(function (c) {
    var cs = commentsByClause[c.index] || [];
    var block = '<div class="rd-clause"><div class="rd-head">' + esc(c.heading) + "</div>" +
      '<pre class="rd-body">' + esc(c.body) + "</pre>";
    if (cs.length) {
      block += '<div class="rd-comments">' + cs.map(_commentLine).join("") + "</div>";
    }
    return block + "</div>";
  }).join("");
  if (unmapped.length) {
    left += '<div class="rd-clause rd-unmapped"><div class="rd-head">계약서 외 검토의견(부재 항목)</div>' +
      '<div class="rd-comments">' + unmapped.map(_commentLine).join("") + "</div></div>";
  }
  left += "</div>";

  // ── 우: 종합 서술형 리포트 ─────────────────────────────────
  // 필수 consider를 tier로 분리: core=계약 본질(우선 확인) / conditional=특수규제(적용 시)
  var mustCore = mustConsider.filter(function (it) { return it.cp.tier !== "conditional"; });
  var mustCond = mustConsider.filter(function (it) { return it.cp.tier === "conditional"; });

  // 결론(#1): 검토자가 직접 쓴 검토의견 위주로. 없으면 매칭 요약으로 폴백.
  var opinionCount = 0, okCount = 0, naCount = 0;
  r.results.forEach(function (res) {
    var v = verdictStore[res.cpId];
    if (!v || !v.verdict) return;
    if (v.verdict === "검토의견") opinionCount++;
    else if (v.verdict === "이상없음") okCount++;
    else if (v.verdict === "해당없음") naCount++;
  });
  var conclCls, conclText;
  if (opinionCount || okCount || naCount) {
    // 사람이 검토의견을 남긴 경우 — 그 내용 위주 서술.
    conclCls = opinionCount ? "concl-caution" : "concl-ok";
    var parts = [];
    if (okCount) parts.push(okCount + "개 항목을 확인함(이상없음)");
    if (opinionCount) parts.push(opinionCount + "개 항목에 검토의견을 개진함");
    if (naCount) parts.push(naCount + "개 항목은 해당 없음");
    conclText = parts.join(", ") + ".";
    if (mustCore.length) conclText += " 필수 " + mustCore.length + "개는 계약서에서 아직 확인되지 않아 보완 필요.";
    else if (mustNA.length && !mustCore.length) conclText += " 미확인 필수 항목은 검토자가 해당 없음으로 판정함 — 보완 불요.";
  } else if (mustCore.length) {
    conclCls = "concl-alert";
    conclText = "아직 검토의견 미기입. 계약 본질상 필요한 필수 항목 " + mustCore.length + "개가 계약서에서 확인되지 않음 — 우선 확인 필요.";
  } else if (recConsider.length || verify.length || mustCond.length) {
    conclCls = "concl-caution";
    conclText = "아직 검토의견 미기입. 필수(본질) 항목은 관련 조항에 닿음. 확인 권장 " + verify.length +
      "건" + (mustCond.length ? " · 특수규제 확인 " + mustCond.length + "건(적용 시)" : "") + "을 살펴볼 것.";
  } else {
    conclCls = "concl-ok";
    conclText = "계약서 전체적으로 특이사항 없음 — 필수·권장 항목이 모두 관련 조항에 닿음." +
      (mustCovered.length ? " (필수 " + mustCovered.length + "건은 부속 서류에서 커버됨)" : "");
  }

  var right = '<div class="report-summary"><h3>종합 리포트</h3>';
  right += '<div class="report-concl ' + conclCls + '"><span class="concl-label">결론</span>' + esc(conclText) + "</div>";

  // 검토의견 요약(활성 항목 기준)
  var activeVerdicts = {};
  r.results.forEach(function (res) { if (verdictStore[res.cpId]) activeVerdicts[res.cpId] = verdictStore[res.cpId]; });
  var vsum = Verdict.verdictSummary(activeVerdicts);
  if (vsum.total) {
    right += '<div class="report-verdict-summary">검토의견 기록: ' +
      '<span class="vd-badge vd-ok">이상없음 ' + vsum["이상없음"] + "</span>" +
      '<span class="vd-badge vd-comment">검토의견 ' + vsum["검토의견"] + "</span>" +
      '<span class="vd-badge vd-na">해당없음 ' + vsum["해당없음"] + "</span></div>";
  }

  // 특이사항: 검토의견 단 항목 + 필수 검토제안(보완 필요)
  var flagged = [];
  r.results.forEach(function (res) {
    var v = verdictStore[res.cpId];
    if (v && v.verdict === "검토의견") {
      var cp = _cpById(res.cpId);
      if (cp) flagged.push({ cp: cp, comment: v.comment, loc: res.best ? _clauseHeading(res.best.clauseIndex) : "" });
    }
  });
  if (flagged.length) {
    right += '<section class="report-sec-block"><h4>검토의견 개진 (' + flagged.length + ")</h4>";
    right += flagged.map(function (o) {
      return '<div class="opinion-item"><div class="ri-head"><span class="sev sev-' + o.cp.severity + '">' +
        esc(o.cp.severity) + '</span><span class="ri-q">' + labelQ(o.cp) + "</span></div>" +
        (o.loc ? '<p class="ri-loc">' + esc(o.loc) + "</p>" : "") +
        (o.comment ? '<p class="oi-comment">' + esc(o.comment) + "</p>" : "") + "</div>";
    }).join("") + "</section>";
  }

  function _mustItem(it) {
    return '<div class="report-item consider-item"><div class="ri-head"><span class="sev sev-필수">필수</span>' +
      '<span class="ri-q">' + labelQ(it.cp) + "</span></div>" +
      (it.cp.severity_basis ? '<p class="ri-why">' + esc(it.cp.severity_basis) + "</p>" : "") + "</div>";
  }
  // 보완 필요(core) — 계약 본질상 필요한 필수인데 계약서에서 미확인.
  if (mustCore.length) {
    right += '<section class="report-sec-block"><h4 class="h4-alert">보완 필요 — 필수 항목 미확인 (' + mustCore.length + ")</h4>";
    right += '<p class="sec-hint">이 유형 계약에 통상 필요한 필수 항목인데 계약서에서 매칭 조항을 못 찾음 — 확인 요.</p>';
    right += mustCore.map(_mustItem).join("") + "</section>";
  }
  // 특수 규제(conditional) — 전자금융감독규정 §60 등, 적용되는 경우에만 확인. 접힘.
  if (mustCond.length) {
    right += '<details class="report-sec"><summary>특수 규제 확인 (적용 시) ' + mustCond.length +
      "건 — 전자금융거래 관련 시스템 외주 등에만 해당</summary>";
    right += '<p class="sec-hint">이 계약이 해당 규제 대상(예: 전자금융거래 정보처리시스템 외주)일 때만 필수. 아니면 무시.</p>';
    right += mustCond.map(_mustItem).join("") + "</details>";
  }

  // 부속서류에서 커버됨(#3) — 필수 미확인이었으나 부속 서류에서 다뤄진 항목.
  if (mustCovered.length) {
    right += '<section class="report-sec-block"><h4 class="h4-covered">부속 서류에서 커버됨 (' + mustCovered.length + ")</h4>";
    right += '<p class="sec-hint">주 계약서엔 없으나 첨부한 부속 서류에서 다뤄지고 있어 누락 아님.</p>';
    right += mustCovered.map(function (it) {
      var cv = subCov[it.cp.id];
      return '<div class="report-item covered-item"><span class="sev sev-필수">필수</span> ' +
        '<span class="ri-q">' + labelQ(it.cp) + "</span>" +
        '<span class="covered-src">📎 ' + esc(cv.docName) + "</span></div>";
    }).join("") + "</section>";
  }

  // 확인 권장(접힘)
  right += '<details class="report-sec"><summary>확인 권장 ' + verify.length + "건 · 검토 제안(권장) " + recConsider.length + "건</summary>";
  right += verify.map(function (it) {
    return '<div class="report-item verify-item"><span class="sev sev-' + it.cp.severity + '">' + esc(it.cp.severity) +
      '</span> <span class="ri-q">' + labelQ(it.cp) + "</span>" +
      (it.res.best ? ' <span class="ri-loc-inline">(' + esc(_clauseHeading(it.res.best.clauseIndex)) + ")</span>" : "") + "</div>";
  }).join("");
  right += recConsider.map(function (it) {
    return '<div class="report-item consider-item"><span class="sev sev-권장">권장</span> <span class="ri-q">' + labelQ(it.cp) + "</span></div>";
  }).join("");
  if (!verify.length && !recConsider.length) right += '<p class="report-none">해당 없음.</p>';
  right += "</details>";

  right += '<div class="report-actions">' +
    '<button id="report-verdict-export" class="ghost">검토의견 내보내기</button>' +
    '<button id="report-loop-ingest" class="ghost">이 검토를 지식에 반영</button>' +
    '<span class="report-actions-note">누적 판정(코퍼스 ' + loopCorpus.meta.contract_count + '건)에 이 계약서 검토의견을 추가 — 다음 검토에 분포·추천으로 활용</span></div>';
  right += curationPanelHtml();
  right += "</div>";

  var body = document.getElementById("report-body");
  body.innerHTML = '<div class="report-split">' + left + right + "</div>";
  var rexp = document.getElementById("report-verdict-export");
  if (rexp) rexp.addEventListener("click", exportVerdicts);
  var ring = document.getElementById("report-loop-ingest");
  if (ring) ring.addEventListener("click", function () {
    ingestCurrentToCorpus();
    renderReport();      // 코퍼스 카운트·분포 갱신 반영
    renderClauses();     // 조항별 보기 추천도 갱신
  });
}
// 검토의견 한 줄 — 판정 배지 + 코멘트.
function _commentLine(rec) {
  var cls = VERDICT_CLS[rec.verdict] || "";
  return '<div class="rd-comment"><span class="vd-badge ' + cls + '">' + esc(rec.verdict) + "</span>" +
    '<span class="rd-c-label">' + esc(labelQ(rec.cp)).replace(/<[^>]+>/g, " ") + "</span>" +
    (rec.comment ? '<span class="rd-c-text">' + esc(rec.comment) + "</span>" : "") + "</div>";
}
// 인쇄 시 접힌 섹션도 펼쳐 요약 타일·검토 제안·확인 권장이 모두 나오게.
window.addEventListener("beforeprint", function () {
  document.querySelectorAll("#report-body details").forEach(function (d) {
    if (!d.open) { d.dataset.wasClosed = "1"; d.open = true; }
  });
});
window.addEventListener("afterprint", function () {
  document.querySelectorAll("#report-body details[data-was-closed]").forEach(function (d) {
    d.open = false; d.removeAttribute("data-was-closed");
  });
});

initChecklistType();
renderChecklist();

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
