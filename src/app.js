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

/* ---------- 증적 배지 ----------
   어휘 구분(2026-07-30 사용자 결정): '법령 ○○' = 체크 근거 법령의 대조 상태,
   '조항' = 계약서 본문. 검수 완료(verified) 상태는 정상값이므로 무배지 —
   이상(미대조·불일치·미수록)만 표시해 배지 소음을 없앰. */
function sourceBadgeInfo(src) {
  /* rank: 낮을수록 심각 — 행 배지는 전 source 중 최악을 표시. null = 정상(무배지). */
  switch (src.status) {
    case "quote_mismatch":
      return { cls: "mismatch", label: "법령 불일치", rank: 0 };
    case "missing":
      return { cls: "missing", label: "법령 미수록", rank: 0 };
    case "no_quote":
      return { cls: "ref", label: "참조", rank: 1 };
    case "quote_ok":
      // 기계 대조 통과 + 사람 사인오프(verified)면 정상 — 배지 생략.
      // 사인오프 전이면 '법령 미대조'로 검수 필요를 표시.
      return src.verified ? null : { cls: "quote-ok", label: "법령 미대조", rank: 2 };
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
    if (b && (!worst || b.rank < worst.rank)) worst = b;
  });
  return worst; // 전 source 정상이면 null(무배지)
}
function sourceBadgeHtml(src) {
  var b = sourceBadgeInfo(src);
  return b ? '<span class="badge ' + b.cls + '">' + b.label + "</span>" : "";
}
function evidenceCell(cp) {
  var src = primarySource(cp);
  var badge = evidenceBadgeInfo(cp);
  var lawText = src
    ? esc(src.law) + " " + esc(src.article) + (src.clause ? " " + esc(src.clause) : "")
    : "";
  return (lawText ? lawText + " " : "") +
    (badge ? '<span class="badge ' + badge.cls + '">' + badge.label + "</span>" : "") +
    (src ? sourceTypeBadgeHtml(src) : "");
}

/* ---------- coverage 배지 (계약 반영 축 — 증적 배지와 별개) ----------
   검토 보조 화법: 판정형("확정/미검출") 폐기. 팀 피드백(2026-07 "무슨 말인지
   모르겠다")에 따라 압축어("반영/제안/검토 제안") 대신 구체적으로 이해되는
   문구로 풀어씀 — 타일·섹션 제목·풋터 범례와 동일 어휘로 일관.
   내부 키·CSS 클래스명(verify/cov-verify)은 구조 변경 범위가 아니라 유지. */
var COVERAGE_LABEL = {
  addressed: "✓ 계약서에 반영",
  verify: "△ 함께 살펴볼 항목",
  consider: "! 계약서에서 확인 안 됨",
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

/* ---------- 관리모드(#admin) — 골드셋 노출 토글 ----------
   팀 배포 기본 화면에서 골드셋 관련 UI를 숨김(팀원 혼란 제거). URL 해시를
   #admin으로 열면 표시 — 기능·코드는 그대로, body 클래스 + CSS로 표시만 제어.
   지식 검수 탭은 현행 유지(숨기지 않음). */
function applyAdminMode() {
  var on = location.hash === "#admin";
  document.body.classList.toggle("admin-mode", on);
  // 관리모드 해제 시 골드셋 탭이 열려 있으면 리포트로 복귀 — 숨은 탭의 pane 잔류 방지.
  var gs = document.querySelector('.tab[data-tab="goldset"]');
  if (!on && gs && gs.classList.contains("active"))
    document.querySelector('.tab[data-tab="report"]').click();
}
window.addEventListener("hashchange", applyAdminMode);
applyAdminMode();

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

/* 형식 점검(#5) 바 — 매칭 체크리스트와 분리(통과/확인 2상태, 판정 대상 아님). */
function renderFormalBar() {
  var el = document.getElementById("formal-bar");
  if (!el) return;
  el.innerHTML = (state.formal || []).map(function (f) {
    return '<span class="formal-item ' + (f.status === "warn" ? "formal-warn" : "formal-pass") +
      '" title="' + esc(f.detail) + '">' + (f.status === "warn" ? "△ " : "✓ ") + esc(f.title) + "</span>";
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
      esc(heading) + " — 매칭 조항 발췌 · 점수 " + r.best.score.toFixed(1) +
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
  // §5: 표 상세에도 판정 컨트롤 추가 — 체크리스트에서 보다가 탭 이동 없이 바로 판정 가능하게.
  if (state.result) h += verdictControlHtml(cp.id);
  return h || "<p>상세 정보 없음</p>";
}

// 체크리스트 행 펼침의 판정 컨트롤 재바인딩(판정 변경 시 그 행만 갱신 — 표 전체 재렌더 없이).
function _rebindChecklistDetail(tr) {
  var detail = tr.nextElementSibling;
  if (!detail) return;
  var cp = findCheck(tr.dataset.id);
  if (!cp) return;
  var td = detail.querySelector("td");
  td.innerHTML = renderDetail(cp);
  bindVerdictControls(td, function () { _rebindChecklistDetail(tr); });
}

function bindRowClicks() {
  document.querySelectorAll("#checklist-body tr.cp-row").forEach(function (tr) {
    tr.addEventListener("click", function (e) {
      // 판정 버튼·코멘트 입력 클릭은 행 접기/펼치기를 트리거하지 않음.
      if (e.target.closest && e.target.closest(".verdict-ctl")) return;
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
          bindVerdictControls(detail.querySelector("td"), function () { _rebindChecklistDetail(tr); });
        }
      }
    });
  });
}

function renderChecklist() {
  var typeId = document.getElementById("checklist-type").value;
  state.typeId = typeId;
  var doc = typeDoc(typeId);
  // 모듈 칩 이중 표시 해소(P1): 표시전용 칩 바 삭제 — 활성 모듈은 리포트 요약 바에서만.
  var allModules = (CR.common.meta.modules || []).concat(doc ? doc.meta.modules : []);
  renderModuleFilterOptions(allModules);

  var base = allChecksForType(typeId);

  var modF = document.getElementById("filter-module").value;
  var sevF = document.getElementById("filter-severity").value;
  var matchF = document.getElementById("filter-match").value;
  var q = document.getElementById("filter-search").value.trim();

  function passFilter(cp, st) {
    // verify(확인 권장)는 표에서 제외 — 하단 "제안사항" 패널로 이동(UX 재편: 누락 오인 방지).
    if (st.coverage === "verify") return false;
    if (modF) {
      if (modF === "__none__") { if (cp.module) return false; }
      else if (cp.module !== modF) return false;
    }
    if (sevF === "core") { if (cp.severity !== "필수" && cp.severity !== "권장") return false; }
    else if (sevF && cp.severity !== sevF) return false;
    // matchF: unmatched="검토 제안만"(consider) / matched="반영만"(addressed)
    if (matchF === "unmatched" && st.coverage !== "consider") return false;
    if (matchF === "matched" && st.coverage !== "addressed") return false;
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

/* ---------- 제안사항 패널 (체크리스트 표 하단) ----------
   coverage==="verify"(확인 권장) 항목을 표에서 빼는 대신 여기로 모음 — advisory 어조.
   판정형 어휘("누락"·"확인 권장") 금지, "~살펴보시길 제안" 톤 유지. */
function renderSuggestionItem(r) {
  var cp = _cpById(r.cpId);
  if (!cp) return "";
  return '<div class="compare-item suggestion-item">' +
    '<div class="ci-head"><span class="sev sev-' + cp.severity + '" title="' + esc(cp.severity_basis || "") + '">' +
    esc(cp.severity) + "</span><span class=\"ci-id\">" + esc(cp.id) + "</span></div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    (cp.severity_basis ? '<p class="ci-basis">' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">' + evidenceCell(cp) + "</p>" +
    evidenceLineHtml(cp, r) +
    verdictControlHtml(cp.id) +
    "</div>";
}
function renderSuggestions() {
  var box = document.getElementById("suggestions-body");
  if (!box || !state.result) return;
  var verify = state.result.results.filter(function (r) { return r.coverage === "verify"; });
  var main = verify.filter(function (r) { var c = _cpById(r.cpId); return c && c.severity !== "참고"; });
  var ref = verify.filter(function (r) { var c = _cpById(r.cpId); return c && c.severity === "참고"; });
  main.sort(function (a, b) {
    var ca = _cpById(a.cpId), cb = _cpById(b.cpId);
    var sa = SEV_RANK[ca && ca.severity]; if (sa === undefined) sa = 3;
    var sb = SEV_RANK[cb && cb.severity]; if (sb === undefined) sb = 3;
    return sa - sb;
  });
  var html = main.map(renderSuggestionItem).join("") ||
    (ref.length ? "" : '<p class="compare-empty">현재 함께 살펴볼 항목 없음</p>');
  if (ref.length) {
    html += '<details class="ref-fold"><summary>참고로 살펴볼 항목 ' + ref.length + '건 펼치기</summary>' +
      ref.map(renderSuggestionItem).join("") + "</details>";
  }
  box.innerHTML = html;
  bindVerdictControls(box, function () { renderSuggestions(); renderReport(); });
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
// 표준 부속서류 사용 체크(#B) — id → true/false 사용자 지정. 미지정(undefined)이면 자동 감지를 따름.
state.subdocUse = {};
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

/* ---------- 표준 부속서류 사용 체크(#B) ---------- */
// 자동 감지: (a) 본문이 약정서 체결을 참조하거나 (b) 해당 약정서가 부속서류 파일로 올라와 있으면 기본 ON.
function _subdocAutoOn(def) {
  if (detectSubdocRefs(state.text || "", [def]).length) return true;
  var sigs = (def.ref_signals || []).concat(def.title ? [def.title] : []);
  return (state.subDocs || []).some(function (d) {
    var hay = String(d.name || "") + "\n" + String(d.text || "");
    for (var i = 0; i < sigs.length; i++) if (hay.indexOf(sigs[i]) !== -1) return true;
    return false;
  });
}
// 유효 사용 여부: 사용자 지정(체크박스 토글)이 있으면 그것, 없으면 자동 감지.
function subdocInUse(def) {
  var u = state.subdocUse[def.id];
  return u === undefined ? _subdocAutoOn(def) : u;
}
// 자동 기재 코멘트 — 토글 OFF 시 판정·이 문구가 원형 그대로인 항목만 자동 생성분으로 보고 제거.
function subdocAutoComment(def) {
  return def.auto_comment || ("표준 " + def.title + " 체결로 반영 — 별첨 체결·간인 확인");
}

/* ---------- 분석 모드: 모듈 스크리닝 ---------- */
function renderScreening() {
  var doc = typeDoc(document.getElementById("checklist-type").value);
  // 횡단모듈(Phase C): common.meta.modules(X-* 풀)는 유형과 무관하게 스크리닝 —
  // 유형 미확정 계약에도 PII·하도급 등 횡단 검토가 실질 신호로 붙음.
  var modList = (CR.common.meta.modules || []).concat(doc ? doc.meta.modules : []);
  var chips = "", askQs = "";
  if (!modList.length) {
    state.activeModules = [];
  } else {
    var suggested = suggestModules(state.text, modList);
    state.activeModules = modList
      .filter(function (m) { return m.always_on || suggested.on.indexOf(m.id) !== -1; })
      .map(function (m) { return m.id; });
    chips = modList.map(function (m) {
      if (m.always_on)
        return '<span class="module-chip fixed">' + esc(m.name) + " (기본)</span>";
      var on = state.activeModules.indexOf(m.id) !== -1;
      var sug = suggested.on.indexOf(m.id) !== -1;
      var askMode = suggested.ask.indexOf(m.id) !== -1;
      return '<label class="module-chip' + (on ? " on" : "") + (sug ? " suggested" : "") + (askMode ? " ask" : "") +
        '" data-mid="' + esc(m.id) + '" title="' + esc(m.screening_question || "") + '">' +
        esc(m.name) + (sug ? " ⚡본문 검출" : "") + (askMode ? " ? 확인 필요" : "") + "</label>";
    }).join("");
    // 약신호 질문(②): 문언만으론 실제 취급 여부 판단 불가한 모듈(confirm) — 추측 대신 사람에게 물음.
    askQs = modList
      .filter(function (m) { return suggested.ask.indexOf(m.id) !== -1 && m.screening_question; })
      .map(function (m) {
        return '<div class="ask-q">? <strong>' + esc(m.name) + "</strong> — " + esc(m.screening_question) +
          ' <span class="ask-q-hint">(본문 언급이 적어 자동 판단 불가 — 해당되면 위 칩을 켜세요)</span></div>';
      }).join("");
  }
  // 표준 부속서류 사용 체크(#B): 본문 참조·파일 업로드 감지 시 기본 ON, 항상 수동 전환 가능.
  var subRows = ((CR.common.meta || {}).standard_subdocs || []).map(function (d) {
    return '<label class="subdoc-use"><input type="checkbox" class="subdoc-use-cb" data-sdid="' + esc(d.id) + '" name="subdoc-use-' + esc(d.id) + '"' +
      (subdocInUse(d) ? " checked" : "") + "> 『" + esc(d.title) + "』(표준서식) 체결 사용" +
      ' <span class="subdoc-use-hint">체크 시 약정서가 다루는 항목을 별첨 참조로 분류하고 미판정 항목에 이상없음을 자동 기재</span></label>';
  }).join("");
  document.getElementById("screening").innerHTML = chips + askQs + subRows;
  document.querySelectorAll("#screening .module-chip[data-mid]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var mid = chip.dataset.mid;
      var i = state.activeModules.indexOf(mid);
      if (i === -1) state.activeModules.push(mid); else state.activeModules.splice(i, 1);
      chip.classList.toggle("on");
      if (_analyzedOnce) runAnalysis(); // 모듈 조정 시 즉시 재검토
    });
  });
  document.querySelectorAll("#screening .subdoc-use-cb").forEach(function (cb) {
    cb.addEventListener("change", function () {
      state.subdocUse[cb.dataset.sdid] = cb.checked;
      if (_analyzedOnce) runAnalysis(); // 모듈 토글과 동일 — 즉시 재검토(자동 기재·해제 반영)
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

  // 별첨 참조(#4): 부속서류 파일 미업로드분에 한해, 본문이 표준 부속서류 체결을 참조하면
  // covers에 속한 consider 항목을 "별첨 참조" 그룹으로 분류(기계매칭 subDocCov 우선).
  var fullText = (state.clauses || []).map(function (cl) {
    return String(cl.heading || "") + " " + String(cl.body || "");
  }).join("\n"); // ↑ matcher.js analyze의 fullText 구성과 동일
  state.refCov = {};
  var subdocDefs = (CR.common.meta || {}).standard_subdocs || [];
  detectSubdocRefs(fullText, subdocDefs).forEach(function (ref) {
    if (state.subdocUse[ref.id] === false) return; // 검토자가 미사용 지정(#B) — 참조 문구가 있어도 그룹핑 억제
    ref.covers.forEach(function (cpId) {
      if (!state.subDocCov[cpId]) state.refCov[cpId] = { title: ref.title, signal: ref.signal, quote: ref.quote };
    });
  });
  // 사용 체크 ON(#B): 참조 문구가 없어도 수동 체크만으로 covers를 별첨 참조로 분류(기계매칭 subDocCov 우선 유지).
  subdocDefs.forEach(function (d) {
    if (!subdocInUse(d)) return;
    (d.covers || []).forEach(function (cpId) {
      if (!state.subDocCov[cpId] && !state.refCov[cpId])
        state.refCov[cpId] = { title: d.title, signal: "수동 체크", quote: "검토자 확인 — 표준 약정서 체결 사용" };
    });
  });

  // 형식 점검(#5): 상호·빈칸·일자·법인표기 룰 검출
  state.formal = Formal.checkFormal(state.text);

  loadVerdicts();
  _opinionEditing = false; // 재분석·해시 변경 시 종합 검토의견 편집 모드 해제
  applySubdocVerdicts();
  applyCompare(); // 아카이브 로드 상태면 현재 조항 기준 정렬·이관 후보 재산출
  renderArchiveBanner(); // 비교 미진입 시 레지스트리에서 전년 검토 후보 자동 안내
  renderClauses();
  bindVerdictIO();
  renderChecklist();
  renderSuggestions();
  renderFormalBar();
  renderReport();
  document.getElementById("analyze-result").hidden = false;
  document.getElementById("clauses-empty").hidden = true;
  document.getElementById("checklist-empty").hidden = true;
  document.getElementById("checklist-content").hidden = false;
  // 입력부 축소(P1): 분석 후엔 입력 패널을 숨기고 요약 바 한 줄로 대체 — "다시 분석"으로 재노출.
  document.getElementById("input-panel").hidden = true;
  document.getElementById("report-summary-bar").hidden = false;
  renderSummaryBar();
  if (!_analyzedOnce) {
    // 최초 분석에서만 리포트 탭으로 자동 랜딩(재검토 시 현재 탭 유지)
    document.querySelector('.tab[data-tab="report"]').click();
    _analyzedOnce = true;
  }
}

/* ---------- 분석 후 요약 바(P1) — 입력부 한 줄 축소 ---------- */
// 계약명 추정 — 본문 첫 비공백 줄(30자 절단). 요약 바·종합 검토의견 공용.
function _contractName() {
  var lines = String(state.text || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (t) return t.length > 30 ? t.slice(0, 30) + "…" : t;
  }
  return "계약서";
}
// "계약명 · n조항 · 감지: 유형" 표기.
function renderSummaryBar() {
  var line = document.getElementById("summary-line");
  if (!line || !state.clauses.length) return;
  var doc = typeDoc(state.typeId);
  line.textContent = _contractName() + " · " + state.clauses.length + "조항 · 감지: " +
    (doc ? doc.meta.type_name : "유형 미확정");
}

/* ---------- 종합 검토의견(P1 추가) — 결론 배너 대체 축 ----------
   자동 초안은 Verdict.composeOpinion(순수 로직)으로 판정 변경 시마다 재조립.
   사용자가 수정하면 계약 해시별 localStorage(cr-opinion-<해시>)에 persist — 수정본 우선. */
var _opinionEditing = false;   // 편집 모드(일시 상태 — 렌더 간 유지, 분석 시 해제)
var _lastOpinionText = "";     // 마지막 표시 문안 — 내보내기 meta 포함용
function opinionStoreLoad() {
  try { return JSON.parse(localStorage.getItem(Verdict.opinionKey(verdictHash)) || "null"); }
  catch (e) { return null; }
}
function opinionStoreSave(text) {
  localStorage.setItem(Verdict.opinionKey(verdictHash),
    JSON.stringify({ text: String(text || ""), edited: true, date: verdictToday() }));
}
function opinionStoreClear() {
  try { localStorage.removeItem(Verdict.opinionKey(verdictHash)); } catch (e) {}
}
// 문안 표시 HTML — ‘…’ 인용부(사용자 코멘트)만 형광 강조. 수정본에서도 인용 부호를 유지하면 강조 유지.
function opinionHtml(text) {
  return esc(text)
    .replace(/‘([^‘’]+)’/g, function (m, p) { return "‘<mark>" + p + "</mark>’"; })
    .replace(/\n/g, "<br>");
}
// 다시 분석 — 숨긴 입력 패널을 다시 열어 본문·부속서류 수정 후 재분석하게 함.
document.getElementById("btn-reanalyze").addEventListener("click", function () {
  var ip = document.getElementById("input-panel");
  ip.hidden = false;
  ip.open = true;
  ip.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- 검토의견 지식 루프(#4) — cpId 단위 누적 코퍼스 ----------
   여러 계약서 검토의견을 쌓아 판정 분포·코멘트 추천 제공. 저장키 cr-loop-corpus. */
var LOOP_KEY = "cr-loop-corpus";
var loopCorpus = Loop.emptyCorpus();
try { loopCorpus = JSON.parse(localStorage.getItem(LOOP_KEY)) || Loop.emptyCorpus(); } catch (e) {}
function saveCorpus() { localStorage.setItem(LOOP_KEY, JSON.stringify(loopCorpus)); }
// 빌드 내장 seed 코퍼스: 검수자가 반출한 판정·코멘트가 새 환경(다른 PC·localStorage 초기화)에서도
// 분포·추천으로 보이게 시작 시 병합. mergeCorpusBackup은 해시가 하나라도 겹치면 전체 스킵(멱등) —
// 재오픈·이미 같은 계약을 적재한 사용자 모두 이중 카운트 없음.
if (CR.curated_corpus) {
  loopCorpus = Loop.mergeCorpusBackup(loopCorpus, CR.curated_corpus);
  saveCorpus();
}

/* ── 팀 운영(P4) — 교환 단위는 판정파일(verdict JSON), 코퍼스는 로컬 집계 뷰 ──
   코퍼스끼리 병합하면 같은 계약이 이중 카운트되므로 코퍼스는 교환하지 않음.
   판정파일은 contract_hash로 멱등 병합(mergeIntoCorpus) — 공유폴더에 쌓고 일괄 반영.
   검토자 이름은 코멘트 귀속(loop 추천의 reviewers 표시)에 쓰임. */
var REVIEWER_KEY = "cr-reviewer";
function getReviewer() {
  try { return localStorage.getItem(REVIEWER_KEY) || ""; } catch (e) { return ""; }
}
function setReviewer(name) {
  try { localStorage.setItem(REVIEWER_KEY, String(name || "").trim()); } catch (e) {}
}
// 현재 계약서의 검토의견을 코퍼스에 적재(닫힌 루프의 ③단계).
function ingestCurrentToCorpus() {
  var meta = { type_id: state.typeId, date: verdictToday(), contract_hash: verdictHash, reviewer: getReviewer() };
  loopCorpus = Loop.mergeIntoCorpus(loopCorpus, Verdict.exportVerdicts(verdictStore, meta));
  saveCorpus();
}
// 판정파일(단수·복수) 일괄 반영 — 팀원들의 verdict JSON을 코퍼스에 병합. 멱등(같은 계약 재반영 무시).
function importVerdictFilesToCorpus(files, done) {
  var list = Array.prototype.slice.call(files || []);
  var okN = 0, failN = 0, pending = list.length;
  if (!pending) { done(0, 0); return; }
  list.forEach(function (f) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (obj && obj.verdicts) { loopCorpus = Loop.mergeIntoCorpus(loopCorpus, obj); okN++; }
        else failN++;
      } catch (e) { failN++; }
      if (--pending === 0) { saveCorpus(); done(okN, failN); }
    };
    reader.onerror = function () { failN++; if (--pending === 0) { saveCorpus(); done(okN, failN); } };
    reader.readAsText(f);
  });
}
// 코퍼스 백업 내보내기 — 브라우저 이동·유실 대비(교환용 아님: 병합 불가, 복원=통째 교체).
function exportCorpusBackup() {
  var blob = new Blob([JSON.stringify(loopCorpus, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "contract-review-corpus-backup.json";
  a.click(); URL.revokeObjectURL(url);
}
// 코퍼스 백업 복원 — 형태 검증 후 통째 교체.
function restoreCorpusBackup(file, done) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var obj = JSON.parse(reader.result);
      if (obj && obj.meta && obj.byCheck) { loopCorpus = obj; saveCorpus(); done(true); return; }
    } catch (e) {}
    done(false);
  };
  reader.readAsText(file);
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
// 사용 체크 상태를 검토의견에 반영(#B): ON → covers 중 현재 분석에 존재하는 미판정 항목에
// 이상없음+자동 코멘트 일괄 기재. OFF → 자동 기재분(판정·코멘트 원형 그대로)만 제거.
// 사람이 찍었거나 손댄 판정은 어느 방향에서도 불변.
function applySubdocVerdicts() {
  var present = {};
  ((state.result && state.result.results) || []).forEach(function (r) { present[r.cpId] = true; });
  var changed = false;
  ((CR.common.meta || {}).standard_subdocs || []).forEach(function (d) {
    var ids = (d.covers || []).filter(function (id) { return present[id]; });
    if (!ids.length) return;
    var cmt = subdocAutoComment(d);
    if (subdocInUse(d)) {
      var fill = Verdict.bulkVerdictComment(verdictStore, ids, "이상없음", cmt, verdictToday());
      if (fill.applied) { verdictStore = fill.store; changed = true; }
    } else {
      var rm = Verdict.revertBulkVerdict(verdictStore, ids, "이상없음", cmt);
      if (rm.removed) { verdictStore = rm.store; changed = true; }
    }
  });
  if (changed) saveVerdicts();
}
function verdictToday() {
  var d = new Date();
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}
var VERDICT_CLS = { "이상없음": "vd-ok", "검토의견": "vd-comment", "해당없음": "vd-na" };
// 지식 루프(#4) — 이 cpId의 과거 판정 분포 + 추천 코멘트. 없으면 빈 문자열.
// P2: 카드 높이 절약을 위해 1줄 요약(최빈 판정·비율)으로 접힘 — 접기 금지 원칙의 예외 허용 대상(spec §4.3).
function loopInfoHtml(cpId) {
  var st = Loop.checkStats(loopCorpus, cpId);
  if (!st) return "";
  var topV = Loop.VERDICTS[0];
  Loop.VERDICTS.forEach(function (v) { if (st.dist[v] > st.dist[topV]) topV = v; });
  var top = Loop.topComments(loopCorpus, cpId, 3);
  var summary = "과거 판정 " + st.n + "건 · " + topV.slice(0, 2) + " " + st.pct[topV] + "%" +
    (top.length ? " · 추천 의견 " + top.length : "") + (st.lowSample ? " (표본 적음)" : "");
  var h = '<details class="loop-info loop-fold"><summary>' + esc(summary) + "</summary>";
  h += '<span class="loop-dist">과거 판정(n=' + st.n + (st.lowSample ? ", 표본 적음" : "") + "): ";
  Loop.VERDICTS.forEach(function (v) {
    if (st.dist[v] > 0) h += '<span class="vd-badge ' + VERDICT_CLS[v] + '">' + v.slice(0, 2) + " " + st.pct[v] + "%</span>";
  });
  h += "</span>";
  if (top.length) {
    h += '<div class="loop-comments">자주 남긴 의견: ' + top.map(function (c) {
      return '<button class="loop-c" data-vcp="' + esc(cpId) + '" data-ct="' + esc(c.text) + '">' +
        esc(c.text) + " <span class=\"loop-c-n\">×" + c.count + "</span></button>";
    }).join("") + "</div>";
  }
  return h + "</details>";
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
// skipLoop: 같은 행 ③ 카드처럼 loop 힌트 중복 노출이 소음인 곳에서 생략.
function verdictControlHtml(cpId, skipLoop) {
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
    '" name="vd-note-' + esc(cpId) + '" aria-label="' + esc(ph) + '" placeholder="' + esc(ph) + '" value="' + esc(cur.comment || "") + '">';
  return '<div class="verdict-ctl">' + btns + comment + "</div>" + (skipLoop ? "" : loopInfoHtml(cpId));
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
  // 전년 검토 인용 수용(비교 모드) — 1클릭으로 전년 판정·코멘트 기재(date 오늘, 꼬리표 부착).
  root.querySelectorAll(".carry-accept").forEach(function (btn) {
    btn.addEventListener("click", function () {
      acceptCarry(btn.getAttribute("data-vcp"));
      if (reRender) reRender();
    });
  });
}

// 검토의견 내보내기/불러오기 (계약서 건별 JSON)
/* ---------- 앱 내장 골드셋(폐쇄망) — 스냅샷 저장·일괄 채점 ----------
   실계약은 반출 불가 → 케이스(본문 포함)는 폐쇄망 공유폴더에만 축적, 채점은 앱 안에서.
   반출은 summaryText(본문 0자)만. 순수 로직은 goldset.js. */
function _goldsetEnv() {
  return { CR: CR, segmentContract: segmentContract, detectType: detectType,
    pickType: pickType, suggestModules: suggestModules, analyze: analyze };
}
// 현재 검토(확인·교정 완료 상태)를 골드셋 케이스로 저장 — 리포트 탭 버튼.
function exportGoldsetCase() {
  if (!state.result) return;
  var ranked = state.detectRanked || [];
  var caseObj = Goldset.buildCase({
    text: state.text,
    typeId: state.typeId || null,
    autoDetected: pickType(ranked),
    activeModules: state.activeModules || [],
    results: state.result.results,
    subDocNames: (state.subDocs || []).map(function (d) { return d.name; }),
    date: verdictToday(),
    hash: verdictHash,
    checksCount: allChecksForType(state.typeId).length
  });
  var blob = new Blob([JSON.stringify(caseObj, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "goldset_" + (state.typeId || "undetermined") + "_" + verdictHash + "_" + verdictToday() + ".json";
  a.click(); URL.revokeObjectURL(url);
}
// 골드셋 페인 — 케이스 파일 복수 로드 → 일괄 채점 → 결과 표 + 반출 요약.
var _goldsetCases = [];
var _goldsetDiffs = [];
var _goldsetObserved = []; // diffs와 같은 인덱스 — G2 재저장(새 기준 갱신)에 필요한 관측값 보관
function _goldsetSyncEmptyState() {
  var empty = document.getElementById("goldset-empty");
  if (empty) empty.hidden = !!_goldsetCases.length;
}
function initGoldsetPane() {
  var files = document.getElementById("goldset-files");
  var runBtn = document.getElementById("goldset-run");
  var expBtn = document.getElementById("goldset-export");
  var status = document.getElementById("goldset-status");
  var gotoReport = document.getElementById("goldset-goto-report");
  if (gotoReport) {
    gotoReport.addEventListener("click", function () {
      document.querySelector('.tab[data-tab="report"]').click();
    });
  }
  _goldsetSyncEmptyState();
  if (!files) return;
  files.addEventListener("change", function () {
    var list = Array.prototype.slice.call(files.files || []);
    _goldsetCases = []; var pending = list.length, bad = 0;
    if (!pending) return;
    list.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(reader.result);
          if (obj && obj.format === "cr-goldset-case-v1" && obj.text) _goldsetCases.push(obj);
          else bad++;
        } catch (e) { bad++; }
        if (--pending === 0) {
          status.textContent = "케이스 " + _goldsetCases.length + "건 로드" + (bad ? " (형식 오류 " + bad + "건 제외)" : "");
          runBtn.disabled = !_goldsetCases.length;
          _goldsetSyncEmptyState();
        }
      };
      reader.readAsText(f);
    });
  });
  runBtn.addEventListener("click", function () {
    var env = _goldsetEnv();
    _goldsetObserved = _goldsetCases.map(function (c) { return Goldset.runCase(c, env); });
    _goldsetDiffs = _goldsetCases.map(function (c, i) { return Goldset.diffCase(c, _goldsetObserved[i]); });
    renderGoldsetResults();
    expBtn.disabled = false;
  });
  expBtn.addEventListener("click", function () {
    var txt = Goldset.summaryText(_goldsetDiffs, {
      checksCount: allChecksForType("").length, date: verdictToday()
    });
    var blob = new Blob([txt], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "goldset-summary_" + verdictToday() + ".txt";
    a.click(); URL.revokeObjectURL(url);
  });
}
// G2: "변화" 케이스의 관측 결과를 새 기준으로 저장(케이스 JSON 재생성 다운로드).
function _downloadGoldsetCase(caseObj) {
  var blob = new Blob([JSON.stringify(caseObj, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "goldset_" + caseObj.id + "_rebaseline_" + verdictToday() + ".json";
  a.click(); URL.revokeObjectURL(url);
}
function renderGoldsetResults() {
  var box = document.getElementById("goldset-results");
  var pass = _goldsetDiffs.filter(function (d) { return d.status === "통과"; }).length;
  var chg = _goldsetDiffs.filter(function (d) { return d.status === "변화"; }).length;
  var fail = _goldsetDiffs.filter(function (d) { return d.status === "실패"; }).length;
  var h = '<p class="goldset-sum">통과 <strong>' + pass + "</strong> · 변화 <strong>" + chg +
    "</strong> · 실패 <strong>" + fail + "</strong> / 총 " + _goldsetDiffs.length +
    ' <span class="report-actions-note">변화=지식 진화로 알람이 달라진 것일 수 있음 — 내용 확인 후 재저장하면 기준 갱신</span></p>';
  h += _goldsetDiffs.map(function (d, i) {
    var cls = d.status === "통과" ? "gs-pass" : d.status === "변화" ? "gs-change" : "gs-fail";
    var rows = "";
    if (!d.detectOk) rows += '<li>유형감지: 기대 <strong>' + esc(d.expectedType || "미확정") + "</strong> ≠ 실제 <strong>" + esc(d.observedType || "미확정") + "</strong></li>";
    function li(label, arr) { return arr.length ? "<li>" + label + ": " + esc(arr.join(", ")) + "</li>" : ""; }
    rows += li("모듈 신규활성", d.modules.added) + li("모듈 비활성화", d.modules.removed) +
      li("부재알람 신규", d.consider.added) + li("부재알람 사라짐", d.consider.removed) +
      li("반영 신규", d.addressed.added) + li("반영 사라짐", d.addressed.removed);
    var rebaseBtn = d.status === "변화"
      ? '<button type="button" class="ghost gs-rebase" data-gi="' + i + '">이 결과를 새 기준으로 저장</button>' : "";
    return '<div class="goldset-case ' + cls + '"><div class="gc-head"><span class="gc-status">' + d.status + "</span> " +
      esc(d.id) + (d.desc ? ' <span class="gc-desc">' + esc(d.desc) + "</span>" : "") + rebaseBtn + "</div>" +
      (rows ? "<ul>" + rows + "</ul>" : "") + "</div>";
  }).join("");
  box.innerHTML = h;
  box.querySelectorAll(".gs-rebase").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var i = Number(btn.getAttribute("data-gi"));
      var rebuilt = Goldset.rebuildCase(_goldsetCases[i], _goldsetObserved[i]);
      _downloadGoldsetCase(rebuilt);
    });
  });
}
initGoldsetPane();

// 파일명 금지문자 치환 — Windows·macOS 공용 안전 집합.
function _safeFileName(s) {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}
// 회신용 검토의견 파일 자동 명명 — 검토의견_<계약명>_<검토자>_<YYYYMMDD>.json.
// 계약명은 요약 바와 동일(_contractName), 검토자 미입력 시 생략. 원버튼·개별 내보내기 공용.
function verdictFileName() {
  var parts = ["검토의견", _safeFileName(_contractName()) || "계약서"];
  var rv = _safeFileName(getReviewer());
  if (rv) parts.push(rv);
  parts.push(verdictToday().replace(/-/g, ""));
  return parts.join("_") + ".json";
}
function exportVerdicts() {
  // subdoc_coverage(#3): 부속서류에서 매칭 확인된 항목은 기계 사실로 기록에 남김 —
  // 사람 판정(verdicts)과 별개 키. 데이터 축적 시 "부속서류로 충족되는 항목" 패턴의 원료.
  var meta = { type_id: state.typeId, date: verdictToday(), contract_hash: verdictHash, reviewer: getReviewer(),
    subdoc_coverage: state.subDocCov || {},
    opinion: _lastOpinionText }; // 종합 검토의견(표시 중 문안 — 수정본 우선)
  var blob = new Blob([JSON.stringify(Verdict.exportVerdicts(verdictStore, meta), null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = verdictFileName(); // 팀 회신용 자동 명명 — JSON 형식 자체는 불변(파일명만 변경)
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- 검토 마치기(원버튼) — 팀원 일상 마무리 액션 ----------
   ① 지식 반영(코퍼스 ingest — 해시 멱등이라 중복 클릭 안전)
   ② 검토 아카이브를 브라우저(레지스트리)에 등록 — 파일 다운로드 없이, 다음 해 자동 안내의 원천
   ③ 회신용 검토의견 파일 1개 다운로드(자동 명명)
   개별 버튼 3종은 "팀·지식 관리" 접힘에 유지(동작 불변) — 멘털 모델: 버튼 하나·파일 하나. */
function finishReview() {
  if (!state.result) return;
  ingestCurrentToCorpus();
  saveArchiveRegistry(Compare.registryPush(loadArchiveRegistry(), {
    name: _contractName(), date: verdictToday(), reviewer: getReviewer(),
    type_id: state.typeId || null, contract_hash: verdictHash, contract_text: state.text
  }));
  exportVerdicts();
  renderReport(); renderClauses(); renderSuggestions(); // 코퍼스 카운트·추천 갱신
  var msg = document.getElementById("finish-msg");
  if (msg) msg.textContent = "검토가 저장되었음 — 다운로드된 파일을 팀 취합 담당에게 회신해 주세요.";
}
// 일괄 판정(통과계약 모드) — 미판정만 채움(기판정=예외 보존은 Verdict.bulkVerdict가 보장).
function bindBulkVerdict() {
  function ids(coverages) {
    return (state.result ? state.result.results : [])
      .filter(function (r) { return coverages.indexOf(r.coverage) !== -1; })
      .map(function (r) { return r.cpId; });
  }
  function apply(coverages, verdict) {
    var r = Verdict.bulkVerdict(verdictStore, ids(coverages), verdict, verdictToday());
    verdictStore = r.store; saveVerdicts();
    // 전체 재렌더로 content-visibility 높이 추정이 초기화돼 스크롤이 튐 — 위치 복원(rAF로 확정 높이 반영 후 재보정).
    var y = window.scrollY;
    renderClauses(); renderSuggestions(); renderReport();
    window.scrollTo(0, y);
    requestAnimationFrame(function () { window.scrollTo(0, y); });
    var msg = document.getElementById("bulk-msg");
    if (msg) msg.textContent = r.applied + "건 " + verdict + " 처리(기판정 보존)";
  }
  var b1 = document.getElementById("bulk-consider-na");
  if (b1) b1.addEventListener("click", function () { apply(["consider"], "해당없음"); });
  var b2 = document.getElementById("bulk-consider-ok");
  if (b2) b2.addEventListener("click", function () { apply(["consider"], "이상없음"); });
  var b3 = document.getElementById("bulk-matched-ok");
  if (b3) b3.addEventListener("click", function () { apply(["addressed", "verify"], "이상없음"); });
}
bindBulkVerdict();

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
      renderSuggestions();
      renderReport();
    }).catch(function () { /* 파싱 실패 무시 */ });
    e.target.value = "";
  });
}

/* ---------- 재검토 비교 — 검토 아카이브 저장·불러오기·조항 정렬(스펙 2026-07-30) ----------
   아카이브 = 기존 verdict export 상위호환(+contract_text·meta.archive·meta.name).
   비교 계산은 순수 로직 Compare(compare.js) — 여기는 상태·렌더·이관 UI만. */
state.compare = null; // {meta, oldClauses, oldVerdicts, mapping, byNew, removed, counts, carry, carryById}
var ARCHIVE_NOTICE_KEY = "cr-archive-notice";

// 세그먼터 내부 라벨 치환 — 구 계약 표제 등 state.clauses 밖 heading에도 적용(어휘 규칙 공용).
function _headingText(h) {
  return (h === "(전문)" || h === "(전체)") ? "계약서 전반" : h;
}

// 검토 아카이브 저장 — 리포트 일상 액션. 계약 전문 포함이라 최초 1회 보관 위치 고지(제약 고지 ①).
function exportArchive() {
  if (!state.result) return;
  var name = prompt("아카이브 이름(계약명)", _contractName());
  if (name === null) return; // 취소
  try {
    if (!localStorage.getItem(ARCHIVE_NOTICE_KEY)) {
      alert("아카이브 파일에는 계약 본문 전문이 포함됩니다 — 폐쇄망 내부(공유폴더 등)에만 보관하세요.");
      localStorage.setItem(ARCHIVE_NOTICE_KEY, "1");
    }
  } catch (e) {}
  var meta = { type_id: state.typeId, date: verdictToday(), contract_hash: verdictHash,
    reviewer: getReviewer(), opinion: _lastOpinionText,
    archive: true, name: String(name || "").trim() || _contractName() };
  var obj = Verdict.exportVerdicts(verdictStore, meta);
  obj.contract_text = state.text;
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "review-archive_" + (state.typeId || "common") + "_" + verdictHash + "_" + verdictToday() + ".json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  // 파일 다운로드와 동시에 레지스트리 사본 등록 — 다음 해 분석 시 자동 안내의 원천.
  saveArchiveRegistry(Compare.registryPush(loadArchiveRegistry(), {
    name: meta.name, date: meta.date, reviewer: meta.reviewer,
    type_id: state.typeId || null, contract_hash: verdictHash, contract_text: state.text
  }));
}

function _setCompareMsg(text) {
  var el = document.getElementById("compare-load-msg");
  if (el) el.textContent = text || "";
}

// 아카이브 객체 적용 — 파일 불러오기·레지스트리 자동 안내(비교 시작) 공용 경로.
function applyArchiveObject(obj) {
  state.compare = {
    meta: obj.meta,
    oldClauses: segmentContract(obj.contract_text),
    oldVerdicts: Verdict.importVerdicts(obj),
    mapping: null
  };
  if (state.result) {
    applyCompare();
    renderClauses();
    renderReport();
    renderArchiveBanner(); // 비교 진입 — 자동 안내 배너 숨김
    document.querySelector('.tab[data-tab="clauses"]').click();
  } else {
    _setCompareMsg("아카이브 로드됨(" + (obj.meta.name || obj.meta.date || "") + ") — 분석 시작 시 비교 뷰가 열립니다.");
  }
}

// 아카이브 파일 불러오기 — 스키마 검증 후 적용. 분석 전이면 보류(분석 시 적용).
function loadArchiveFile(f) {
  if (!f) return;
  f.text().then(function (t) {
    var obj = JSON.parse(t);
    var ok = obj && obj.meta && typeof obj.contract_text === "string" &&
      obj.contract_text.trim() && obj.verdicts && typeof obj.verdicts === "object";
    if (!ok) throw new Error("format");
    applyArchiveObject(obj);
  }).catch(function () {
    _setCompareMsg("아카이브 형식이 아님 — '검토 아카이브 저장'으로 만든 .json 파일을 선택하세요.");
  });
}

/* ── 아카이브 레지스트리 — 저장 시 localStorage 사본 등록, 분석 시 전년 검토 자동 안내 ──
   검토자가 아카이브 존재를 모를 수 있음 → 앱이 후보를 찾아 배너로 제안(순수 로직은 Compare.registry*).
   판정(verdicts)은 사본에 안 담음 — 같은 PC의 cr-verdict-<해시> 저장분을 비교 시작 시 재사용. */
var ARCHIVE_REG_KEY = "cr-archive-registry";
var ARCHIVE_DISMISS_KEY = "cr-archive-dismiss"; // { <현재 계약 해시>: [무시한 후보 해시...] }
function loadArchiveRegistry() {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_REG_KEY)) || []; } catch (e) { return []; }
}
// QuotaExceededError 방어 — 실패 시 전 항목 본문 강등(지문만) → 최근 절반만 → 포기(안내 기능만 저하).
function saveArchiveRegistry(reg) {
  try { localStorage.setItem(ARCHIVE_REG_KEY, JSON.stringify(reg)); return; } catch (e) {}
  var slim = reg.map(function (e) {
    var c = {};
    for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k) && k !== "contract_text") c[k] = e[k];
    return c;
  });
  try { localStorage.setItem(ARCHIVE_REG_KEY, JSON.stringify(slim)); return; } catch (e2) {}
  try { localStorage.setItem(ARCHIVE_REG_KEY, JSON.stringify(slim.slice(-Math.ceil(slim.length / 2)))); } catch (e3) {}
}
function loadArchiveDismiss() {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_DISMISS_KEY)) || {}; } catch (e) { return {}; }
}
function addArchiveDismiss(curHash, candHash) {
  var d = loadArchiveDismiss();
  if (!d[curHash]) d[curHash] = [];
  if (d[curHash].indexOf(candHash) === -1) d[curHash].push(candHash);
  try { localStorage.setItem(ARCHIVE_DISMISS_KEY, JSON.stringify(d)); } catch (e) {}
}

// 레지스트리 후보로 즉시 비교 시작 — 판정·종합의견은 같은 PC의 저장분을 재사용.
function startCompareFromRegistry(entry) {
  var verdicts = {};
  try { verdicts = JSON.parse(localStorage.getItem(Verdict.verdictKey(entry.contract_hash)) || "{}"); } catch (e) {}
  var opinion = "";
  try {
    var op = JSON.parse(localStorage.getItem(Verdict.opinionKey(entry.contract_hash)) || "null");
    if (op) opinion = op.text || "";
  } catch (e) {}
  applyArchiveObject({
    meta: { type_id: entry.type_id, date: entry.date, contract_hash: entry.contract_hash,
      reviewer: entry.reviewer, opinion: opinion, archive: true, name: entry.name },
    contract_text: entry.contract_text,
    verdicts: verdicts
  });
}

// 전년 검토 자동 안내 배너 — 분석 완료 시 레지스트리에서 후보 탐색(비교 모드면 생략).
function renderArchiveBanner() {
  var el = document.getElementById("archive-banner");
  if (!el) return;
  if (!state.result || (state.compare && state.compare.mapping)) { el.hidden = true; el.innerHTML = ""; return; }
  var cands = Compare.registryFind(loadArchiveRegistry(),
    { typeId: state.typeId || "", hash: verdictHash, name: _contractName(), text: state.text },
    { exclude: loadArchiveDismiss()[verdictHash] || [] });
  if (!cands.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.innerHTML = '<span class="ab-lead">이 계약의 이전 검토로 보이는 아카이브가 있음 — 비교하여 달라진 조항만 살펴볼 수 있음.</span>' +
    cands.map(function (c) {
      var e = c.entry;
      return '<span class="ab-cand">「' + esc(e.name || "이름 없음") + "」(" + esc(e.date || "일자 미상") +
        (e.reviewer ? ", " + esc(e.reviewer) : "") + ")" +
        (e.contract_text ? "" : ' <span class="ab-note">본문이 정리되어 파일 선택이 필요함</span>') +
        ' <button class="ab-start" data-h="' + esc(e.contract_hash) + '">비교 시작</button>' +
        '<button class="ab-dismiss ghost" data-h="' + esc(e.contract_hash) + '">무시</button></span>';
    }).join("");
  el.hidden = false;
  el.querySelectorAll(".ab-start").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var h = btn.getAttribute("data-h");
      var hit = cands.filter(function (c) { return c.entry.contract_hash === h; })[0];
      if (!hit) return;
      if (hit.entry.contract_text) { startCompareFromRegistry(hit.entry); return; }
      // 용량 강등으로 지문만 남은 항목 — 아카이브 파일을 직접 선택하게 안내.
      _setCompareMsg("이 항목은 본문 사본이 정리됨 — 저장해 둔 아카이브 파일(.json)을 선택하세요.");
      var inp = document.getElementById("compare-file-bar");
      if (inp) inp.click();
    });
  });
  el.querySelectorAll(".ab-dismiss").forEach(function (btn) {
    btn.addEventListener("click", function () {
      addArchiveDismiss(verdictHash, btn.getAttribute("data-h"));
      renderArchiveBanner(); // 무시 반영 — 남은 후보 없으면 숨김
    });
  });
}
// 불러오기 입력은 정적 요소 — 1회 바인딩(중복 리스너 방지).
["compare-file", "compare-file-bar"].forEach(function (id) {
  var inp = document.getElementById(id);
  if (inp) inp.addEventListener("change", function (e) {
    loadArchiveFile(e.target.files[0]);
    e.target.value = "";
  });
});

// 정렬·이관 후보 계산 — 분석(재분석 포함)마다 현재 조항 기준으로 재산출.
function applyCompare() {
  var cmp = state.compare;
  if (!cmp || !state.result) return;
  cmp.mapping = Compare.alignClauses(cmp.oldClauses, state.clauses);
  cmp.byNew = {};
  cmp.removed = [];
  cmp.counts = { same: 0, changed: 0, added: 0, removed: 0 };
  cmp.mapping.forEach(function (e) {
    if (e.newIdx !== null) cmp.byNew[e.newIdx] = e;
    if (e.kind === "removed") { cmp.removed.push(e); cmp.counts.removed++; }
    else if (e.kind === "added") cmp.counts.added++;
    else if (e.kind === "changed") cmp.counts.changed++;
    else cmp.counts.same++; // same·moved 합산 — 이동은 내용 동일
  });
  cmp.carry = Compare.carryVerdicts(cmp.oldVerdicts, cmp.mapping, state.result.results);
  cmp.carryById = {};
  cmp.carry.forEach(function (c) { cmp.carryById[c.cpId] = c; });
}

// 비교 해제 — 원래 3열(① ② ③)로 복귀. 자동 안내 배너는 재탐색(무시 기록은 유지됨).
function clearCompare() {
  state.compare = null;
  renderClauses();
  renderReport();
  renderArchiveBanner();
}

// diff 렌더 — esc 후 마크업 주입(토큰별 이스케이프 → 태그 감싸기 순서 고정, XSS 안전).
// 구 열: eq+del(취소선) / 신 열: eq+add(형광). 공백 정규화된 어절 나열이라 줄바꿈은 평탄화됨.
function _diffHtmlOld(ops) {
  return ops.filter(function (o) { return o.op !== "add"; }).map(function (o) {
    return o.op === "del" ? '<del class="cmp-del">' + esc(o.text) + "</del>" : esc(o.text);
  }).join(" ");
}
function _diffHtmlNew(ops) {
  return ops.filter(function (o) { return o.op !== "del"; }).map(function (o) {
    return o.op === "add" ? '<mark class="cmp-add">' + esc(o.text) + "</mark>" : esc(o.text);
  }).join(" ");
}

// 전년 인용 꼬리표 — 수용된 코멘트임을 기록(중복 부착 방지).
function _carryTail(comment) {
  var c = String(comment || "").trim();
  if (c.indexOf("(전년 인용)") !== -1) return c;
  return c ? c + " (전년 인용)" : "(전년 인용)";
}

// 전년 검토 인용 프리필 카드 — 자동 확정하지 않음: [수용] 1클릭 시에만 기재(date 오늘).
// 이관 후보가 아닌데 전년 판정이 있으면(변경·불확실 조항 등) 참고 표시만.
function carryHintHtml(cpId) {
  var cmp = state.compare;
  if (!cmp || !cmp.mapping) return "";
  var cur = verdictStore[cpId];
  var cand = cmp.carryById[cpId];
  if (cand) {
    if (cur && cur.verdict) return ""; // 기판정(수용 포함) — 프리필 숨김
    return '<div class="carry-card"><span class="badge carry-badge">전년 검토 인용</span>' +
      '<span class="vd-badge ' + VERDICT_CLS[cand.verdict] + '">' + esc(cand.verdict) + "</span>" +
      (cand.comment ? '<span class="carry-comment">‘' + esc(cand.comment) + "’</span>" : "") +
      '<span class="carry-date">(' + esc(cand.date || "전년") + ")</span>" +
      '<button class="carry-accept" data-vcp="' + esc(cpId) + '">수용</button>' +
      '<span class="carry-hint">인용이지 확정 아님 — 법령 개정 여부는 별도 확인</span></div>';
  }
  var old = cmp.oldVerdicts[cpId];
  if (old && old.verdict) {
    return '<p class="carry-ref">전년 검토 참고(이관 안 함 — 조항 변경·대응 불확실 등): ' +
      '<span class="vd-badge ' + VERDICT_CLS[old.verdict] + '">' + esc(old.verdict) + "</span>" +
      (old.comment ? " ‘" + esc(old.comment) + "’" : "") + "</p>";
  }
  return "";
}

// 수용 1클릭 — 전년 verdict·comment로 기재하되 date는 오늘, comment 끝 "(전년 인용)".
function acceptCarry(cpId) {
  var cmp = state.compare;
  var cand = cmp && cmp.carryById && cmp.carryById[cpId];
  if (!cand) return;
  applyVerdict(cpId, cand.verdict, _carryTail(cand.comment));
}

// 일괄 수용 — 미판정 후보만 채움(기판정 보존, 통과계약 모드와 동형).
function acceptAllCarry() {
  var cmp = state.compare;
  if (!cmp || !cmp.carry) return;
  var applied = 0;
  cmp.carry.forEach(function (cand) {
    var cur = verdictStore[cand.cpId];
    if (cur && cur.verdict) return; // 기판정 보존
    verdictStore = Verdict.setVerdict(verdictStore, cand.cpId, cand.verdict, _carryTail(cand.comment), verdictToday());
    applied++;
  });
  saveVerdicts();
  // 전체 재렌더 스크롤 보정 — bulk 판정과 동일 패턴.
  var y = window.scrollY;
  renderClauses(); renderSuggestions(); renderReport();
  window.scrollTo(0, y);
  requestAnimationFrame(function () { window.scrollTo(0, y); });
  var msg = document.getElementById("compare-msg");
  if (msg) msg.textContent = applied + "건 전년 판정 수용(기판정 보존)";
}

// 미수용 이관 후보 수 — 헤더 일괄 수용 버튼 라벨용.
function _pendingCarryCount() {
  var cmp = state.compare;
  if (!cmp || !cmp.carry) return 0;
  return cmp.carry.filter(function (cand) {
    var cur = verdictStore[cand.cpId];
    return !(cur && cur.verdict);
  }).length;
}

// 비교 모드 헤더 — 전년 검토 메타 + 동일·변경·신설·삭제 카운트 + 일괄 수용 + 해제 + 제약 고지 힌트.
function renderCompareHeader() {
  var el = document.getElementById("compare-header");
  if (!el) return;
  var cmp = state.compare;
  if (!cmp || !cmp.mapping) { el.hidden = true; el.innerHTML = ""; return; }
  var m = cmp.meta || {};
  var who = [m.name, m.date, m.reviewer].filter(Boolean).map(esc).join(", ");
  var pending = _pendingCarryCount();
  el.innerHTML = '<span class="cmp-title">전년 검토(' + (who || "메타 없음") + ") 대비:</span> " +
    '<span class="cmp-counts">동일 ' + cmp.counts.same + " · 변경 " + cmp.counts.changed +
    " · 신설 " + cmp.counts.added + " · 삭제 " + cmp.counts.removed + "</span>" +
    (pending ? '<button id="carry-accept-all" class="ghost">동일 조항 전년 판정 ' + pending + "건 일괄 수용</button>" : "") +
    '<button id="compare-off" class="ghost">비교 해제</button>' +
    '<span id="compare-msg" class="report-actions-note"></span>' +
    '<span class="cmp-hint">정렬은 보조 도구(대응 불확실 항목은 직접 확인) · 판정 이관은 인용이지 확정이 아님 — 법령 개정 여부 별도 확인</span>';
  el.hidden = false;
  var all = document.getElementById("carry-accept-all");
  if (all) all.addEventListener("click", acceptAllCarry);
  var off = document.getElementById("compare-off");
  if (off) off.addEventListener("click", clearCompare);
}

// 삭제 조항 최하단 블록 — 구 계약에만 있던 조항.
function renderRemovedBlock() {
  var el = document.getElementById("compare-removed-block");
  if (!el) return;
  var cmp = state.compare;
  if (!cmp || !cmp.mapping || !cmp.removed.length) { el.innerHTML = ""; return; }
  el.innerHTML = '<div class="removed-panel"><h3><span class="badge cmp-removed">삭제</span> 구 계약에만 있던 조항 (' +
    cmp.removed.length + ")</h3>" +
    '<p class="consider-hint">전년 계약에는 있었으나 이번 계약에서 대응 조항을 찾지 못함 — 의도된 삭제인지 확인하세요.</p>' +
    cmp.removed.map(function (e) {
      var c = cmp.oldClauses[e.oldIdx];
      return '<div class="removed-clause"><strong>' + esc(_headingText(c.heading)) + "</strong><pre>" + esc(c.body) + "</pre></div>";
    }).join("") + "</div>";
}

/* ---------- 조항별 보기 (보조 탭) — 좌우대비 ---------- */
// 조항 하나에 대해: 좌 "반영된 검토항목"(그 조항이 best인 addressed) / 우 "추가 확인 제안"(verify).
// results를 best.clauseIndex로 역인덱싱하여 coverage별로 모음.
function _cpById(id) {
  var cps = state.result.checkpoints;
  for (var i = 0; i < cps.length; i++) if (cps[i].id === id) return cps[i];
  return null;
}
// 근거 원문 한 줄 — verify 항목이 왜 떴는지(매칭 조항 표제 + 원문 발췌, 겹친 어휘 강조).
// 제안사항 패널·조항별 보기 verify 열 공용. best 매칭이 없으면 빈 문자열.
function evidenceLineHtml(cp, r) {
  if (!r || !r.best) return "";
  var clause = state.clauses[r.best.clauseIndex];
  if (!clause) return "";
  var ev = Evidence.evidenceSnippet(cp, clause, esc);
  if (!ev) return "";
  return '<p class="ci-evidence">근거: ' + esc(ev.heading) + ' “' + ev.snippet + '”</p>';
}
// 검토항목 1건 요약: 심각도(+근거 툴팁) · 질문 · reason · 근거.
// showEvidence: verify 항목에서만 근거 원문 라인을 덧붙임(addressed는 이미 조항 맥락 안이라 생략).
// P2: ✓반영/△제안이 한 컬럼(②)에 섞이므로 coverage 배지를 카드 머리에 표시.
function renderCompareItem(r, showEvidence) {
  var cp = _cpById(r.cpId);
  if (!cp) return "";
  var reasons = (r.best && r.best.reasons) || [];
  return '<div class="compare-item">' +
    '<div class="ci-head">' + coverageBadgeHtml(r.coverage) +
    '<span class="sev sev-' + cp.severity + '" title="' + esc(cp.severity_basis || "") + '">' +
    esc(cp.severity) + "</span><span class=\"ci-id\">" + esc(cp.id) + "</span></div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    (reasons.length ? '<p class="ci-reason">' + esc(reasons.join("; ")) + "</p>" : "") +
    (cp.severity_basis ? '<p class="ci-basis">' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">' + evidenceCell(cp) + "</p>" +
    (showEvidence ? evidenceLineHtml(cp, r) : "") +
    carryHintHtml(cp.id) + // 비교 모드: 전년 검토 인용 프리필(동일 조항) 또는 참고 표시(변경 조항)
    verdictControlHtml(cp.id) +
    "</div>";
}
// 검토 제안 항목 1건 — 부재 알람이라 조항 매핑 없음. 왜 봐야 하는지 + 판정·코멘트.
function renderConsiderItem(r) {
  var cp = _cpById(r.cpId);
  if (!cp) return "";
  // 부속서류 커버(#③): 주 계약서엔 없지만 부속서류에서 확인된 항목 — 배지로 구분(그냥 '검토 필요'로 보이지 않게).
  var sub = (state.subDocCov || {})[cp.id];
  var subBadge = sub ? ' <span class="badge cov-subdoc" title="부속서류에서 매칭 확인됨">✓ 부속서류 반영: ' + esc(sub.docName) + "</span>" : "";
  // 별첨 참조(#4): 본문이 표준 부속서류 체결을 참조하는 경우 — 기계매칭(sub)과 시각·의미상 구분.
  var ref = !sub && (state.refCov || {})[cp.id];
  var refBadge = ref ? ' <span class="badge cov-refdoc" title="근거: ' + esc(ref.quote) + '">◇ 별첨 참조: ' + esc(ref.title) + "</span>" : "";
  return '<div class="compare-item consider-item' + (sub ? " subdoc-covered" : "") + (ref ? " refdoc-covered" : "") + '">' +
    '<div class="ci-head"><span class="sev sev-' + cp.severity + '" title="' + esc(cp.severity_basis || "") + '">' +
    esc(cp.severity) + "</span><span class=\"ci-id\">" + esc(cp.id) + "</span>" + subBadge + refBadge + "</div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    (cp.severity_basis ? '<p class="ci-basis">왜 봐야 하는지: ' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">근거 ' + evidenceCell(cp) + "</p>" +
    carryHintHtml(cp.id) + // 비교 모드: 부재 알람도 체크 id 기준 전년 판정 인용(스펙 §판정 이관)
    verdictControlHtml(cp.id) +
    "</div>";
}
/* ---------- 조항별 검토(P2) — 삼단 연속 스크롤 ----------
   조항 행(row) 하나 = grid 3셀(① 계약서 원문 ② 검토된 내용 ③ 제안 사항).
   전 행을 한 번에 렌더 — 클릭 탐색·스크롤 동기화 코드 불요(행 단위 grid가 정렬을 구조적으로 보장).
   오프스크린 렌더 비용은 CSS content-visibility로 제거(§4.2 1차 전략).
   미니맵(조항 점프 목차)은 P2 스코프 아웃 — 100+조항 실사용에서 필요해지면 추가. */
var _clauseGroups = {};   // clauseIndex -> { addressed:[r], verify:[r] } — verify는 필수·권장 먼저 정렬
var _considerList = [];   // 부재 알람(consider) — 조항 무관, 최하단 전용 블록

// 판정 진행률 — 이번 분석 대상(quiet 제외) 중 판정 찍힌 수. 고정 헤더·리포트 타일 공용.
function verdictProgress() {
  var judgeable = 0, judged = 0;
  ((state.result && state.result.results) || []).forEach(function (res) {
    if (res.coverage === "quiet" || !_cpById(res.cpId)) return;
    judgeable++;
    var v = verdictStore[res.cpId];
    if (v && v.verdict) judged++;
  });
  return { judged: judged, judgeable: judgeable };
}

// 부재 알람의 판정 여부 — 판정을 찍은 항목은 알람에서 이탈(피드백 3차, 리포트 집계와 동일 원칙).
function _considerJudged(r) {
  var v = verdictStore[r.cpId];
  return !!(v && v.verdict);
}
// 미판정 알람 수 — 헤더 앵커·부재 알람 블록·considerCountText 공용(전면 일관).
function considerPendingCount() {
  return _considerList.filter(function (r) { return !_considerJudged(r); }).length;
}
// 검토 제안 카운트(미판정 필수·판정 완료·부속서류·별첨참조) — 헤더 앵커 툴팁·부재 알람 블록 부제 공용.
function considerCountText() {
  var pending = _considerList.filter(function (r) { return !_considerJudged(r); });
  var mustN = pending.filter(function (r) { var c = _cpById(r.cpId); return c && c.severity === "필수"; }).length;
  var doneN = _considerList.length - pending.length;
  var subN = pending.filter(function (r) { return (state.subDocCov || {})[r.cpId]; }).length;
  var refN = pending.filter(function (r) { return !(state.subDocCov || {})[r.cpId] && (state.refCov || {})[r.cpId]; }).length;
  var parts = [];
  if (mustN) parts.push("필수 " + mustN);
  if (doneN) parts.push("판정 완료 " + doneN);
  if (subN) parts.push("부속서류 " + subN);
  if (refN) parts.push("별첨참조 " + refN);
  return parts.join(" · ");
}

// 행 판정 상태 → 좌측 경계색 클래스(§4.3): 검토의견 있음(주황) > 전 항목 판정 완료(녹) > 그 외(무색).
function rowStatusCls(g) {
  var items = g.addressed.concat(g.verify);
  if (!items.length) return "";
  var judgedAll = true, hasOpinion = false;
  items.forEach(function (r) {
    var v = verdictStore[r.cpId];
    if (!v || !v.verdict) judgedAll = false;
    else if (v.verdict === "검토의견") hasOpinion = true;
  });
  if (hasOpinion) return " row-vd-comment";
  if (judgedAll) return " row-vd-done";
  return "";
}

// ③ 제안 사항 카드 — 이 조항에서 검토의견으로 판정 기재한 항목(상대방에 개진할 내용의 압축 뷰).
// 3버튼+코멘트는 유지하되 loop 힌트는 ② 카드에만(같은 행 중복 소음 방지).
function renderOpinionCard(r) {
  var cp = _cpById(r.cpId);
  if (!cp) return "";
  var v = verdictStore[r.cpId] || {};
  return '<div class="opinion-card">' +
    '<div class="ci-head"><span class="vd-badge vd-comment">검토의견</span>' +
    '<span class="sev sev-' + cp.severity + '">' + esc(cp.severity) + '</span>' +
    '<span class="ci-id">' + esc(cp.id) + "</span></div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    (v.comment ? '<p class="oc-comment">' + esc(v.comment) + "</p>" : "") +
    verdictControlHtml(cp.id, true) +
    "</div>";
}

// 조항 행 1개 — grid 3셀. ②③이 빈 셀은 흐린 placeholder 한 줄("—")로 행 리듬 유지.
// 검토항목이 전무한 세그먼트((전문)·표제부·서명란 등)는 접지 않고 본문을 흐리게(시각적 강등).
// 비교 모드: 구 계약 열 prepend + ②③ 통합(검토·제안) — 3열 유지(스펙 §UI).
function clauseRowHtml(c) {
  var g = _clauseGroups[c.index] || { addressed: [], verify: [] };
  var cards = g.addressed.map(function (r) { return renderCompareItem(r, false); })
    .concat(g.verify.map(function (r) { return renderCompareItem(r, true); })).join("");
  var opinions = g.addressed.concat(g.verify).filter(function (r) {
    var v = verdictStore[r.cpId];
    return v && v.verdict === "검토의견";
  }).map(renderOpinionCard).join("");
  var noItems = !g.addressed.length && !g.verify.length;
  // 검토항목 전무 세그먼트는 연속 빈 줄(표제부 여백 등)을 압축해 행 공간 확보 — 문언 자체는 불변.
  var body = noItems ? String(c.body).replace(/\n{3,}/g, "\n\n") : c.body;
  var cmp = state.compare && state.compare.mapping ? state.compare : null;
  if (!cmp) {
    return '<div class="clause-row' + (noItems ? " row-noitems" : "") + rowStatusCls(g) +
      '" data-ci="' + c.index + '">' +
      '<div class="cr-cell cr-src"><strong>' + esc(c.heading) + "</strong><pre>" + esc(body) + "</pre></div>" +
      '<div class="cr-cell cr-reviewed">' + (cards || '<p class="cr-empty">—</p>') + "</div>" +
      '<div class="cr-cell cr-opinions">' + (opinions || '<p class="cr-empty">—</p>') + "</div>" +
      "</div>";
  }
  // ── 비교 모드 행: 구 계약(전년) | 신 계약(현재, 변경분 하이라이트) | 검토·제안 ──
  var e = cmp.byNew[c.index];
  var badges = "";
  if (e) {
    if (e.kind === "added") badges += ' <span class="badge cmp-added">신설</span>';
    else if (e.kind === "changed") badges += ' <span class="badge cmp-changed">변경</span>';
    else if (e.kind === "moved") badges += ' <span class="badge cmp-moved">이동</span>';
    if (e.uncertain) badges += ' <span class="badge cmp-uncertain">대응 불확실</span>';
  }
  var oldCell, newBodyHtml = esc(body);
  if (!e || e.kind === "added") {
    oldCell = '<p class="cmp-ph">— (전년에 없음)</p>';
  } else if (e.kind === "changed") {
    var oc = cmp.oldClauses[e.oldIdx];
    var ops = Compare.diffWords(oc.body, body);
    oldCell = "<strong>" + esc(_headingText(oc.heading)) + "</strong><pre>" + _diffHtmlOld(ops) + "</pre>";
    newBodyHtml = _diffHtmlNew(ops);
  } else {
    // same·moved — 원문은 신 열에 있으므로 "(전년과 동일)" 플레이스홀더(접기 아님, 스펙 허용).
    var oc2 = cmp.oldClauses[e.oldIdx];
    oldCell = (e.kind === "moved" ? "<strong>" + esc(_headingText(oc2.heading)) + "</strong>" : "") +
      '<p class="cmp-ph">(전년과 동일)</p>';
  }
  return '<div class="clause-row' + (noItems ? " row-noitems" : "") + rowStatusCls(g) +
    '" data-ci="' + c.index + '">' +
    '<div class="cr-cell cr-old">' + oldCell + "</div>" +
    '<div class="cr-cell cr-src"><strong>' + esc(c.heading) + "</strong>" + badges + "<pre>" + newBodyHtml + "</pre></div>" +
    '<div class="cr-cell cr-reviewed">' + ((cards + opinions) || '<p class="cr-empty">—</p>') + "</div>" +
    "</div>";
}

// 행 안 판정 컨트롤 바인딩 — 판정 변경 시 그 행만 재렌더(전체 재렌더 금지: 성능·스크롤 위치 보존).
function bindRowControls(rowEl) {
  var ci = Number(rowEl.getAttribute("data-ci"));
  bindVerdictControls(rowEl, function () {
    rerenderRow(ci);
    refreshClauseCounts();
    renderSuggestions();
    renderReport();
  });
}
function rerenderRow(ci) {
  var old = document.querySelector('#clause-rows .clause-row[data-ci="' + ci + '"]');
  var c = state.clauses[ci];
  if (!old || !c) return;
  var tmp = document.createElement("div");
  tmp.innerHTML = clauseRowHtml(c);
  var next = tmp.firstChild;
  old.parentNode.replaceChild(next, old);
  bindRowControls(next);
}

// 부재 알람(검토 제안) 전용 블록 — 조항 무관 항목의 최하단 고정 영역.
// 부속서류 커버(#③)·별첨 참조(#4)는 '진짜 미확인'과 분리 — 반영/참조된 사실이
// 검토 필요처럼 보이지 않게. 우선순위: 기계매칭(subCov) > 별첨 참조(refCov).
function renderConsiderBlock() {
  var block = document.getElementById("consider-block");
  if (!_considerList.length) { block.innerHTML = ""; return; }
  var subCov = state.subDocCov || {};
  var refCov = state.refCov || {};
  // 판정 우선 분리(피드백 3차): 판정 찍힌 항목은 알람·커버 그룹에서 빼고 최하단 "판정 완료"로.
  // 카드의 판정 버튼은 유지 — 같은 판정을 다시 누르면 취소되어 알람으로 복귀.
  var pending = _considerList.filter(function (r) { return !_considerJudged(r); });
  var judgedList = _considerList.filter(_considerJudged);
  var uncovered = pending.filter(function (r) { return !subCov[r.cpId] && !refCov[r.cpId]; });
  var covered = pending.filter(function (r) { return subCov[r.cpId]; });
  var referenced = pending.filter(function (r) { return !subCov[r.cpId] && refCov[r.cpId]; });
  var items = uncovered.map(renderConsiderItem).join("") ||
    (judgedList.length
      ? '<p class="consider-done-line">모든 항목 확인 완료 — 알람에 떴던 항목의 판정을 마쳤음.</p>'
      : '<p class="compare-empty">확인 안 된 항목 없음</p>');
  var coveredHtml = covered.length
    ? '<h3 class="subdoc-covered-head"><span class="badge cov-subdoc">✓ 부속서류 반영</span> 부속 서류에서 확인된 항목</h3>' +
      '<p class="consider-hint">주 계약서엔 없지만 부속 서류에서 매칭 확인됨 — 커버 적정성만 확인하세요.</p>' +
      covered.map(renderConsiderItem).join("")
    : "";
  var referencedHtml = referenced.length
    ? '<h3 class="refdoc-covered-head"><span class="badge cov-refdoc">◇ 별첨 참조</span> 별첨 약정서로 커버 예정</h3>' +
      '<p class="consider-hint">본문이 표준 부속서류 체결을 정하고 있음 — 약정서 체결·첨부 여부만 확인하세요.</p>' +
      referenced.map(renderConsiderItem).join("")
    : "";
  var judgedHtml = judgedList.length
    ? '<h3 class="consider-done-head"><span class="badge cov-done">✓ 판정 완료</span> 검토자가 확인을 마친 항목 (' + judgedList.length + ")</h3>" +
      '<p class="consider-hint">판단 내용을 부기하고 처리된 항목 — 판정을 취소하면 다시 알람으로 돌아옴.</p>' +
      judgedList.map(renderConsiderItem).join("")
    : "";
  block.innerHTML =
    '<div class="consider-panel"><h3><span class="badge cov-consider">! 계약서에서 확인 안 됨</span> 누락인지 해당없음인지 판단이 필요한 항목' +
    '<span class="consider-sub">' + esc(considerCountText()) + "</span></h3>" +
    '<p class="consider-hint">각 항목이 실제로 빠진 것인지(오류) 아니면 해당 없는지 검토하고 의견을 남기세요 — 판정을 남기면 하단 "판정 완료"로 이동함.</p>' +
    items + coveredHtml + referencedHtml + judgedHtml + "</div>";
  bindVerdictControls(block, function () {
    renderConsiderBlock();
    refreshClauseCounts();
    renderSuggestions();
    renderReport();
  });
}

// 판정 변경 후 경량 갱신(구 refreshClauseCounts 개편) — 헤더 진행률·검토제안 앵커·행 좌측 상태색.
// 행 본문은 건드리지 않음(상태색은 클래스 토글만) — 스크롤 위치·입력 포커스 보존.
function refreshClauseCounts() {
  var p = verdictProgress();
  var prog = document.getElementById("clause-progress");
  if (prog) prog.textContent = "검토 진행 " + p.judged + " / " + p.judgeable;
  var anchor = document.getElementById("consider-anchor");
  if (anchor) {
    // 미판정만 카운트(피드백 3차) — 판정을 찍으면 즉시 감소, 전부 판정되면 완료 표기로 전환.
    var pendingN = considerPendingCount();
    anchor.hidden = !_considerList.length;
    anchor.textContent = pendingN ? "⚠ 확인 안 된 항목 " + pendingN + "건" : "✓ 알람 전부 판정 완료";
    anchor.classList.toggle("consider-anchor-done", !pendingN);
    anchor.title = considerCountText();
  }
  document.querySelectorAll("#clause-rows .clause-row").forEach(function (row) {
    var g = _clauseGroups[Number(row.dataset.ci)] || { addressed: [], verify: [] };
    row.classList.remove("row-vd-comment", "row-vd-done");
    var cls = rowStatusCls(g).trim();
    if (cls) row.classList.add(cls);
  });
  renderCompareHeader(); // 비교 모드: 일괄 수용 잔여 건수 갱신(비교 아니면 내부에서 숨김 처리)
}

// 행 점프 공용 — content-visibility로 오프스크린 행 높이가 추정치라 1회 스크롤은 목표가 어긋남.
// 즉시 점프 후 rAF로 재정렬(렌더되며 확정된 높이 반영)을 수 회 반복해 착지 보정.
function scrollToClauseEl(el) {
  el.scrollIntoView({ block: "start" });
  var tries = 0;
  (function settle() {
    if (tries++ >= 4) return;
    el.scrollIntoView({ block: "start" });
    requestAnimationFrame(settle);
  })();
}

// 검토제안 앵커 — 6,000px 스크롤 없이 최하단 부재 알람 블록으로 즉시 점프(정적 요소라 1회 바인딩).
(function () {
  var a = document.getElementById("consider-anchor");
  if (a) a.addEventListener("click", function () {
    var block = document.getElementById("consider-block");
    if (block) scrollToClauseEl(block);
  });
})();

// 리포트 딥링크(§2.3-3) — 조항별 검토 탭 활성 + 해당 조항 행으로 스크롤·하이라이트 플래시.
// ci: 조항 index(문자열 허용) 또는 "consider"(부재 알람 → 최하단 블록).
function gotoClause(ci) {
  document.querySelector('.tab[data-tab="clauses"]').click();
  var el = ci === "consider" ? document.getElementById("consider-block")
    : document.querySelector('#clause-rows .clause-row[data-ci="' + ci + '"]');
  if (!el) return;
  scrollToClauseEl(el);
  el.classList.remove("row-flash");
  void el.offsetWidth; // 연속 클릭 시 애니메이션 재트리거용 리플로우
  el.classList.add("row-flash");
}

function renderClauses() {
  // results를 best.clauseIndex로 역인덱싱 — coverage별 그룹
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
  // ② 카드 순서: 필수·권장 먼저, 참고 뒤 — 전부 펼침(접기는 클릭 부담이 커서 폐기, 2026-07-29 사용자 피드백).
  Object.keys(byClause).forEach(function (k) {
    byClause[k].verify.sort(function (a, b) {
      var ca = _cpById(a.cpId), cb = _cpById(b.cpId);
      return (ca && ca.severity === "참고" ? 1 : 0) - (cb && cb.severity === "참고" ? 1 : 0);
    });
  });
  // 부재 알람 심각도순(필수 먼저)
  considerList.sort(function (a, b) {
    var ca = _cpById(a.cpId), cb = _cpById(b.cpId);
    var sa = SEV_RANK[ca && ca.severity]; if (sa === undefined) sa = 3;
    var sb = SEV_RANK[cb && cb.severity]; if (sb === undefined) sb = 3;
    return sa - sb;
  });
  _clauseGroups = byClause;
  _considerList = considerList;

  // 비교 모드 전환 — 행 grid에 구 계약 열 prepend(grid-template-columns 전환) + 컬럼 안내 교체.
  var cmpOn = !!(state.compare && state.compare.mapping);
  var rowsEl = document.getElementById("clause-rows");
  rowsEl.classList.toggle("compare-mode", cmpOn);
  var colsHead = document.getElementById("clause-cols-head");
  if (colsHead) {
    colsHead.classList.toggle("compare-mode", cmpOn);
    colsHead.innerHTML = cmpOn
      ? "<span>구 계약(전년)</span><span>신 계약(현재)</span><span>검토 내용·의견</span>"
      : "<span>① 계약서 원문</span><span>② 검토된 내용</span><span>③ 남긴 검토의견</span>";
  }
  rowsEl.innerHTML = state.clauses.map(clauseRowHtml).join("");
  rowsEl.querySelectorAll(".clause-row").forEach(bindRowControls);
  renderConsiderBlock();
  renderCompareHeader();
  renderRemovedBlock();
  refreshClauseCounts();
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
  var h = c ? c.heading : ("조항#" + idx);
  // 세그먼터 내부 라벨("(전문)"=조항 분리 전 앞부분, "(전체)"=분리 실패)은 사용자에게
  // 무의미 — 계약 전체를 가리키는 표현으로 치환(2026-07-30 피드백).
  if (h === "(전문)" || h === "(전체)") return "계약서 전반";
  return h;
}
// 리포트에서 각 항목의 검토의견 배지(있으면).
function _verdictBadge(cpId) {
  var v = verdictStore[cpId];
  if (!v || !v.verdict) return "";
  return ' <span class="vd-badge ' + VERDICT_CLS[v.verdict] + '">' + esc(v.verdict) + "</span>";
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
  // 확인 권장(verify) 중 참고는 하단 별첨(ref-fold)으로 — 결론·본문 카운트는 필수·권장(verifyMain) 기준.
  var verifyMain = verify.filter(function (it) { return it.severity !== "참고"; });
  var verifyRef = verify.filter(function (it) { return it.severity === "참고"; });
  // 필수 consider를 부속서류 커버 여부로 분리(#3).
  // '해당없음'으로 검토자가 판정한 항목은 부재 알람에서 제외 — 사람이 해당 없음을 이미 판단했으므로
  // 보완 필요로 다시 띄우지 않음(#①). 매칭 안 됐어도 검토자 판정이 우선.
  function _isNA(cp) { var v = verdictStore[cp.id]; return v && v.verdict === "해당없음"; }
  // 판정 반영(팀 피드백 3차): 판정을 찍은 항목은 검토를 마친 것 — 알람(확인 안 된 항목)에서 이탈.
  // coverage(매칭 결과)는 불변, 표시·집계 레이어에서만 분리. 검토의견 판정분은 "검토의견 개진"
  // 구역이 담당하고, 이상없음·해당없음 판정분은 "판정 완료" 소구역으로 이동.
  function _verdictOf(cp) { var v = verdictStore[cp.id]; return (v && v.verdict) || ""; }
  var subCov = state.subDocCov || {};
  var refCov = state.refCov || {}; // 별첨 참조(#4) — 기계매칭(subCov) 우선
  var mustAll = consider.filter(function (it) { return it.severity === "필수" && !_isNA(it.cp); });
  var mustConsider = mustAll.filter(function (it) { return !subCov[it.cp.id] && !refCov[it.cp.id]; }); // 진짜 미확인
  var mustCovered = mustAll.filter(function (it) { return subCov[it.cp.id]; });   // 부속서류 커버(기계 사실 — 판정 무관 유지)
  var mustReferenced = mustAll.filter(function (it) { return !subCov[it.cp.id] && refCov[it.cp.id]; }); // 별첨 참조
  var recAll = consider.filter(function (it) { return it.severity === "권장"; });

  // ── 종합 검토 개요(P1): 계약 전문 좌측 컬럼 제거 — 단일 컬럼·페이지 스크롤 하나 ──
  // 전문 대조는 조항별 검토 탭이 담당. 인쇄는 이 개요를 그대로 출력.
  // 필수 consider를 tier로 분리: core=계약 본질(우선 확인) / conditional=특수규제(적용 시)
  var mustUncov = consider.filter(function (it) {
    return it.severity === "필수" && !subCov[it.cp.id] && !refCov[it.cp.id];
  }); // 미커버 필수(판정 포함 — 알람·판정완료 분리의 모수)
  var mustCoreAll = mustUncov.filter(function (it) { return it.cp.tier !== "conditional"; });
  var mustCondAll = mustUncov.filter(function (it) { return it.cp.tier === "conditional"; });
  // 알람 = 미판정만. 판정분은 verdict별 행선지로.
  var mustCore = mustCoreAll.filter(function (it) { return !_verdictOf(it.cp); });
  var mustCond = mustCondAll.filter(function (it) { return !_verdictOf(it.cp); });
  var recConsider = recAll.filter(function (it) { return !_verdictOf(it.cp); });
  var alarmJudged = mustCoreAll.concat(mustCondAll, recAll).filter(function (it) { return _verdictOf(it.cp); });
  var alarmDone = alarmJudged.filter(function (it) { return _verdictOf(it.cp) !== "검토의견"; }); // 이상없음·해당없음 → 판정 완료 소구역
  var alarmOpinN = alarmJudged.length - alarmDone.length; // 검토의견 → 개진 구역(중복 나열 안 함)

  // 형식 점검(#5) — warn만 타일·섹션 대상
  var formalWarns = (state.formal || []).filter(function (f) { return f.status === "warn"; });

  // 검토의견 요약(활성 항목 기준)
  var activeVerdicts = {};
  r.results.forEach(function (res) { if (verdictStore[res.cpId]) activeVerdicts[res.cpId] = verdictStore[res.cpId]; });
  var vsum = Verdict.verdictSummary(activeVerdicts);

  // 판정 진행 — 이번 분석 대상(quiet 제외) 중 판정 찍힌 수(조항별 검토 헤더와 공용 헬퍼)
  var prog = verdictProgress();
  var judgeable = prog.judgeable, judged = prog.judged;

  // 검토의견 개진 목록(2번 섹션·종합 검토의견 인용 공용). ci: 딥링크용 조항 index(부재 알람은 consider)
  var flagged = [];
  r.results.forEach(function (res) {
    var v = verdictStore[res.cpId];
    if (v && v.verdict === "검토의견") {
      var cp = _cpById(res.cpId);
      if (cp) flagged.push({ cp: cp, comment: v.comment,
        loc: res.best ? _clauseHeading(res.best.clauseIndex) : "",
        ci: res.best && res.coverage !== "consider" ? res.best.clauseIndex : "consider" });
    }
  });

  // 리포트 딥링크(§2.3-3) — 항목 클릭 시 조항별 검토 탭의 해당 조항 행으로 점프.
  function _gotoBtn(ci) {
    return ' <button class="rpt-goto" data-ci="' + esc(String(ci)) + '">조항 보기 →</button>';
  }

  var right = '<div class="report-summary"><h3>종합 리포트</h3>';

  // 종합 검토의견 — 기존 한 줄 결론 배너 대체. 자동 초안(판정 변경 시 즉시 재조립),
  // 사용자가 수정하면 수정본 우선 유지 + "자동 초안으로 재생성" 제공.
  var cmp = state.compare && state.compare.mapping ? state.compare : null;
  var savedOp = opinionStoreLoad();
  var opEdited = !!(savedOp && savedOp.edited);
  var opText = opEdited ? String(savedOp.text || "") : Verdict.composeOpinion({
    name: _contractName(),
    clauseCount: state.clauses.length,
    typeName: (typeDoc(state.typeId) || { meta: {} }).meta.type_name || null,
    mustCoreLabels: mustCore.map(function (it) { return cpLabel(it.cp); }),
    opinions: flagged.map(function (o) {
      return { label: cpLabel(o.cp), severity: o.cp.severity, loc: o.loc, comment: o.comment };
    }),
    formalWarnTitles: formalWarns.map(function (f) { return f.title; }),
    // 비교 모드(재검토): 전년 대비 요지 1문장 — 기존 호출 무영향(옵션 인자).
    compare: cmp ? { date: (cmp.meta || {}).date, changed: cmp.counts.changed,
      added: cmp.counts.added, removed: cmp.counts.removed } : undefined
  });
  _lastOpinionText = opText; // 내보내기(verdict JSON meta)용 캐시
  right += '<div class="report-opinion"><div class="ro-head"><span class="ro-label">종합 검토의견</span>' +
    '<span class="ro-mode">' + (opEdited ? "수정본" : "자동 초안") + "</span>" +
    (_opinionEditing ? "" :
      '<button id="opinion-edit" class="ghost">수정</button>' +
      (opEdited ? '<button id="opinion-regen" class="ghost">자동 초안으로 재생성</button>' : "")) +
    "</div>" +
    (_opinionEditing
      ? '<textarea id="opinion-textarea" class="ro-edit">' + esc(opText) + "</textarea>" +
        '<div class="ro-edit-actions"><button id="opinion-save" class="primary">저장</button>' +
        '<button id="opinion-cancel" class="ghost">취소</button></div>'
      : '<p class="ro-text">' + opinionHtml(opText) + "</p>") +
    "</div>";

  // 수치 타일(P1 신설) — 첫 스크린 한눈 파악. 클릭 시 해당 섹션으로 앵커 스크롤.
  // 색은 기존 coverage 체계 그대로(녹/청/황/적) — 신규 색 도입 없음.
  function _tile(anchor, cls, label, num, sub) {
    return '<button class="tile ' + cls + '" data-anchor="' + anchor + '">' +
      '<span class="tile-label">' + label + '</span><span class="tile-num">' + num + "</span>" +
      (sub ? '<span class="tile-sub">' + sub + "</span>" : "") + "</button>";
  }
  // 타일 문구 풀어쓰기(팀 피드백 2026-07): 압축어 라벨 폐기 — 설명형 라벨 + 한 줄 부연(작은 글씨).
  // 순서(피드백 2차): 반영 → 확인 안 됨 → 함께 살펴볼 — 하단 섹션 배치와 동일 논리(보완 필요가 상단).
  right += '<div class="report-tiles">' +
    _tile("rpt-sec-addressed", "tile-addressed", "✓ 계약서에 반영된 항목", addressed.length,
      "확인 필요 사항이 조항에 들어 있음") +
    _tile("rpt-sec-must", "tile-consider", "! 계약서에서 확인 안 된 항목", mustCore.length + recConsider.length,
      "필수 " + mustCore.length + "건 — 누락인지 해당없음인지 판단 필요") +
    _tile("rpt-sec-suggest", "tile-verify", "△ 함께 살펴볼 항목", verifyMain.length,
      "관련 조항이 있어 보임 — 참고 제안") +
    _tile("rpt-sec-formal", "tile-formal", "형식 확인 필요", formalWarns.length,
      "상호·빈칸·날짜 등") +
    _tile("rpt-sec-opinions", "tile-progress", "검토 진행률", judged + " / " + judgeable,
      "판정한 항목 / 판정 대상") +
    "</div>";

  function _mustItem(it) {
    return '<div class="report-item consider-item"><div class="ri-head"><span class="sev sev-필수">필수</span>' +
      '<span class="ri-q">' + labelQ(it.cp) + "</span>" + _gotoBtn("consider") + "</div>" +
      (it.cp.severity_basis ? '<p class="ri-why">' + esc(it.cp.severity_basis) + "</p>" : "") + "</div>";
  }
  // 1. 보완 필요(core) — 계약 본질상 필요한 필수인데 계약서에서 미확인·미판정. 항상 최상단.
  // 제목 옆에 미확인·판정 완료 진행 병기 — 판정을 찍으면 알람이 줄어드는 게 보이게(피드백 3차).
  var alarmProg = alarmJudged.length
    ? ' <span class="sec-progress">미확인 ' + (mustCore.length + mustCond.length + recConsider.length) +
      " · 판정 완료 " + alarmJudged.length + "</span>" : "";
  if (mustCore.length) {
    right += '<section id="rpt-sec-must" class="report-sec-block sec-consider"><h4 class="h4-alert">보완 필요 — 필수 항목 미확인 (' + mustCore.length + ")" + alarmProg + "</h4>";
    right += '<p class="sec-hint">이 유형 계약에 통상 필요한 필수 항목인데 계약서에서 매칭 조항을 못 찾음 — 확인 요. 판정을 남기면 아래 "판정 완료"로 이동함.</p>';
    right += mustCore.map(_mustItem).join("") + "</section>";
  } else if (alarmJudged.length) {
    // 알람이 전부 판정됨 — "남은 게 있나?" 불안 제거(완료색 한 줄).
    right += '<section id="rpt-sec-must" class="report-sec-block sec-done"><h4 class="h4-done">보완 필요 — 필수 항목 미확인 (0)' + alarmProg + "</h4>" +
      '<p class="report-done-line">모든 항목 확인 완료 — 알람에 떴던 항목의 판정을 마쳤음.</p></section>';
  } else {
    right += '<section id="rpt-sec-must" class="report-sec-block sec-consider"><h4>보완 필요 — 필수 항목 미확인 (0)</h4>' +
      '<p class="report-none">없음 — 필수(본질) 항목은 관련 조항·부속서류에 닿음.</p></section>';
  }

  // 1-1. 판정 완료 소구역 — 알람에 떴던 항목 중 검토자가 이상없음·해당없음으로 확인을 마친 것.
  // 알람색(노랑)이 아닌 완료색(초록). 판정 버튼 유지 — 같은 판정을 다시 누르면 취소되어 알람으로 복귀.
  if (alarmDone.length) {
    right += '<section class="report-sec-block sec-done"><h4 class="h4-done">판정 완료 — 검토자가 확인을 마친 항목 (' + alarmDone.length + ")</h4>";
    right += '<p class="sec-hint">판단 내용을 부기하고 이상없음·해당없음으로 처리한 항목' +
      (alarmOpinN ? ' — 검토의견 판정 ' + alarmOpinN + '건은 아래 "검토의견 개진" 구역에 있음' : "") +
      ". 판정을 취소하면 다시 알람으로 돌아감.</p>";
    right += alarmDone.map(function (it) {
      var v = verdictStore[it.cp.id] || {};
      return '<div class="report-item done-item"><div class="ri-head">' +
        '<span class="vd-badge ' + (VERDICT_CLS[v.verdict] || "") + '">' + esc(v.verdict || "") + "</span>" +
        '<span class="sev sev-' + it.cp.severity + '">' + esc(it.cp.severity) + "</span>" +
        '<span class="ri-q">' + labelQ(it.cp) + "</span></div>" +
        (v.comment ? '<p class="oi-comment">' + esc(v.comment) + "</p>" : "") +
        verdictControlHtml(it.cp.id, true) + "</div>";
    }).join("") + "</section>";
  }

  // 1-2. 변경·신설 조항(비교 모드 전용) — 전년 대비 달라진 조항의 딥링크 목록.
  if (cmp) {
    var diffEntries = cmp.mapping.filter(function (e) { return e.kind === "changed" || e.kind === "added"; });
    right += '<section id="rpt-sec-compare" class="report-sec-block sec-compare"><h4>변경·신설 조항 (' + diffEntries.length + ")</h4>";
    right += '<p class="sec-hint">전년(' + esc((cmp.meta || {}).date || "일자 미상") +
      ') 검토 대비 달라진 조항 — 이번 검토에서 우선 살펴볼 부분. 정렬은 보조 도구이며 대응 불확실 항목은 직접 확인 요.</p>';
    right += diffEntries.map(function (e) {
      var c = state.clauses[e.newIdx];
      return '<div class="report-item"><span class="badge ' +
        (e.kind === "added" ? "cmp-added" : "cmp-changed") + '">' + (e.kind === "added" ? "신설" : "변경") + "</span> " +
        '<span class="ri-q">' + esc(_clauseHeading(e.newIdx)) + "</span>" +
        (e.uncertain ? ' <span class="badge cmp-uncertain">대응 불확실</span>' : "") +
        _gotoBtn(e.newIdx) + "</div>";
    }).join("") || '<p class="report-none">변경·신설 조항 없음.</p>';
    if (cmp.counts.removed) {
      right += '<p class="sec-hint">삭제 ' + cmp.counts.removed +
        '건은 조항별 검토 탭 최하단 "구 계약에만 있던 조항"에서 확인.</p>';
    }
    right += "</section>";
  }

  // 2. 함께 살펴볼 항목 — 항목명·근거조항·원문발췌 + 판정 버튼(P1): 가벼운 계약은 리포트만으로 검토 완결.
  // (섹션 순서는 타일 순서와 동일 논리 — 확인 안 됨 → 함께 살펴볼 → 형식 → 검토의견, 반영은 하단 접힘)
  right += '<section id="rpt-sec-suggest" class="report-sec-block sec-verify"><h4>함께 살펴볼 항목 (' + verifyMain.length + ")" +
    (recConsider.length ? " · 확인 안 된 항목(권장) (" + recConsider.length + ")" : "") + "</h4>";
  right += '<p class="sec-hint">계약서 검토 시 이 부분들도 함께 살펴보시길 제안합니다 — 여기서 바로 판정을 남길 수 있습니다.</p>';
  right += verifyMain.map(function (it) {
    return '<div class="report-item verify-item"><span class="sev sev-' + it.cp.severity + '">' + esc(it.cp.severity) +
      '</span> <span class="ri-q">' + labelQ(it.cp) + "</span>" +
      (it.res.best ? ' <span class="ri-loc-inline">(' + esc(_clauseHeading(it.res.best.clauseIndex)) + ")</span>" +
        _gotoBtn(it.res.best.clauseIndex) : "") +
      evidenceLineHtml(it.cp, it.res) + verdictControlHtml(it.cp.id) + "</div>";
  }).join("");
  right += recConsider.map(function (it) {
    return '<div class="report-item consider-item"><span class="sev sev-권장">권장</span> <span class="ri-q">' + labelQ(it.cp) + "</span>" +
      _gotoBtn("consider") +
      (it.cp.severity_basis ? '<p class="ri-why">' + esc(it.cp.severity_basis) + "</p>" : "") +
      verdictControlHtml(it.cp.id) + "</div>";
  }).join("");
  if (!verifyMain.length && !recConsider.length) right += '<p class="report-none">해당 없음.</p>';
  right += "</section>";

  // 3. 부속서류에서 커버됨(#3) — 필수 미확인이었으나 부속 서류에서 다뤄진 항목.
  if (mustCovered.length) {
    right += '<section class="report-sec-block sec-covered"><h4 class="h4-covered">부속 서류에서 커버됨 (' + mustCovered.length + ")</h4>";
    right += '<p class="sec-hint">주 계약서엔 없으나 첨부한 부속 서류에서 다뤄지고 있어 누락 아님.</p>';
    right += mustCovered.map(function (it) {
      var cv = subCov[it.cp.id];
      return '<div class="report-item covered-item"><span class="sev sev-필수">필수</span> ' +
        '<span class="ri-q">' + labelQ(it.cp) + "</span>" +
        '<span class="covered-src">📎 ' + esc(cv.docName) + "</span></div>";
    }).join("") + "</section>";
  }

  // 별첨 약정서 참조(#4) — 필수 미확인이었으나 본문이 표준 부속서류 체결을 참조하는 항목.
  // 기계매칭(부속서류 업로드)과 달리 사람이 약정서 체결·첨부 여부를 확인해야 하는 그룹.
  if (mustReferenced.length) {
    right += '<section class="report-sec-block sec-refdoc"><h4 class="h4-refdoc">별첨 약정서 참조 (' + mustReferenced.length + ")</h4>";
    right += '<p class="sec-hint">본문이 표준 부속서류 체결을 정하고 있음 — 약정서 체결·첨부 여부만 확인하세요.</p>';
    right += mustReferenced.map(function (it) {
      var rv = refCov[it.cp.id];
      return '<div class="report-item refdoc-item"><span class="sev sev-필수">필수</span> ' +
        '<span class="ri-q">' + labelQ(it.cp) + "</span>" +
        '<span class="refdoc-src" title="' + esc(rv.quote) + '">◇ ' + esc(rv.title) + "</span></div>";
    }).join("") + "</section>";
  }

  // 4. 형식 점검 — warn 항목만 표시
  if (formalWarns.length) {
    right += '<section id="rpt-sec-formal" class="report-sec-block sec-formal"><h4>형식 점검</h4>';
    right += formalWarns.map(function (f) {
      return '<div class="report-item"><span class="ri-q">' + esc(f.title) + ' — ' + esc(f.detail) + "</span></div>";
    }).join("") + "</section>";
  }

  // 5. 검토의견 개진 — 판정 찍은 내용 요약(검토 진행률 타일의 착지 구역). 앵커 안정성을 위해 항상 렌더.
  right += '<section id="rpt-sec-opinions" class="report-sec-block sec-opinions"><h4>검토의견 개진 (' + flagged.length + ")</h4>";
  if (vsum.total) {
    right += '<div class="report-verdict-summary">검토의견 기록: ' +
      '<span class="vd-badge vd-ok">이상없음 ' + vsum["이상없음"] + "</span>" +
      '<span class="vd-badge vd-comment">검토의견 ' + vsum["검토의견"] + "</span>" +
      '<span class="vd-badge vd-na">해당없음 ' + vsum["해당없음"] + "</span></div>";
  }
  right += flagged.map(function (o) {
    return '<div class="opinion-item"><div class="ri-head"><span class="sev sev-' + o.cp.severity + '">' +
      esc(o.cp.severity) + '</span><span class="ri-q">' + labelQ(o.cp) + "</span></div>" +
      (o.loc ? '<p class="ri-loc">' + esc(o.loc) + _gotoBtn(o.ci) + "</p>" : '<p class="ri-loc">' + _gotoBtn(o.ci).trim() + "</p>") +
      (o.comment ? '<p class="oi-comment">' + esc(o.comment) + "</p>" : "") + "</div>";
  }).join("") || '<p class="report-none">아직 개진한 검토의견 없음.</p>';
  right += "</section>";

  // 6. 접힘 — 특수 규제(적용 시)·참고 별첨·반영 상세. 저빈도 정보를 하단에 모음.
  if (mustCond.length) {
    right += '<details class="report-sec"><summary>특수 규제 확인 (적용 시) ' + mustCond.length +
      "건 — 전자금융거래 관련 시스템 외주 등에만 해당</summary>";
    right += '<p class="sec-hint">이 계약이 해당 규제 대상(예: 전자금융거래 정보처리시스템 외주)일 때만 필수. 아니면 무시.</p>';
    right += mustCond.map(_mustItem).join("") + "</details>";
  }
  // 참고 항목 별첨 — 법적 의무 아닌 실무 참고 사항이라 본문 흐름을 방해하지 않도록 분리.
  if (verifyRef.length) {
    right += '<details class="ref-fold"><summary>참고 항목 (' + verifyRef.length + ") — 법적 의무 아님, 실무 참고</summary>";
    right += verifyRef.map(function (it) {
      return '<div class="report-item verify-item"><span class="sev sev-참고">참고</span> <span class="ri-q">' + labelQ(it.cp) + "</span>" +
        (it.res.best ? ' <span class="ri-loc-inline">(' + esc(_clauseHeading(it.res.best.clauseIndex)) + ")</span>" : "") +
        evidenceLineHtml(it.cp, it.res) + "</div>";
    }).join("");
    right += "</details>";
  }
  // 반영 상세(접힘) — 타일 앵커 대상. 어떤 항목이 어느 조항에 닿았는지.
  right += '<details class="report-sec sec-addressed" id="rpt-sec-addressed"><summary>✓ 계약서에 반영된 항목 (' + addressed.length + ") — 확인 필요 사항이 어느 조항에 들어 있는지</summary>";
  right += addressed.map(function (it) {
    return '<div class="report-item addressed-item"><span class="sev sev-' + it.cp.severity + '">' + esc(it.cp.severity) +
      '</span> <span class="ri-q">' + labelQ(it.cp) + "</span>" +
      (it.res.best ? ' <span class="ri-loc-inline">(' + esc(_clauseHeading(it.res.best.clauseIndex)) + ")</span>" : "") +
      _verdictBadge(it.cp.id) + "</div>";
  }).join("") || '<p class="report-none">해당 없음.</p>';
  right += "</details>";

  // 일상 액션 = 원버튼 [검토 마치기] 하나(팀 피드백: 저장 3종 혼란 제거) + 인쇄.
  // 개별 저장 버튼(내보내기·아카이브·지식 반영)과 관리 액션(골드셋 저장·판정파일 반영·
  // 코퍼스 백업/복원·정규화 후보)은 "팀·지식 관리" 접힘으로 격리(전문가용, 동작 불변).
  // 인쇄 시 접힘은 자동 펼침 대상에서 제외(admin-fold).
  right += '<div class="report-actions">' +
    '<button id="report-finish" class="primary">검토 마치기</button>' +
    '<button id="report-print" class="ghost">인쇄</button>' +
    '<span id="finish-msg" class="report-actions-note">지식 반영 + 브라우저에 아카이브 등록 + 회신용 검토의견 파일 1개 다운로드</span></div>';
  right += '<details class="report-sec admin-fold"><summary>팀·지식 관리</summary>';
  right += '<div class="report-actions">' +
    '<button id="report-verdict-export" class="ghost">검토의견 내보내기</button>' +
    '<button id="report-archive-export" class="ghost">검토 아카이브 저장</button>' +
    '<span class="report-actions-note">아카이브 = 계약 전문 + 판정 + 종합의견(파일로도 받기) — 다음 해 재검토 시 "이전 검토와 비교"로 불러옴</span></div>';
  right += '<div class="report-actions">' +
    '<label class="reviewer-label">검토자 <input id="reviewer-name" placeholder="이름(코멘트 귀속)" value="' + esc(getReviewer()) + '"></label>' +
    '<button id="report-loop-ingest" class="ghost">이 검토를 지식에 반영</button>' +
    '<button id="report-goldset-snapshot" class="ghost">골드셋 케이스로 저장</button>' +
    '<span class="report-actions-note">누적 판정(코퍼스 ' + loopCorpus.meta.contract_count + '건)에 이 계약서 검토의견을 추가 — 다음 검토에 분포·추천으로 활용</span></div>';
  // 팀 취합(P4): 판정파일이 교환 단위(멱등 병합) — 공유폴더의 팀원 판정파일을 일괄 반영.
  right += '<div class="report-actions team-actions">' +
    '<label class="ghost file-btn">판정파일 일괄 반영<input id="corpus-verdict-files" type="file" accept=".json" multiple hidden></label>' +
    '<button id="corpus-backup" class="ghost">코퍼스 백업</button>' +
    '<label class="ghost file-btn">코퍼스 복원<input id="corpus-restore" type="file" accept=".json" hidden></label>' +
    '<span id="team-actions-msg" class="report-actions-note">팀원들의 검토의견 JSON을 코퍼스에 병합 — 같은 계약 재반영은 무시됨(멱등)</span></div>';
  right += curationPanelHtml();
  right += "</details>";
  right += "</div>";

  var body = document.getElementById("report-body");
  body.innerHTML = right;
  // 수치 타일 앵커(P1): 클릭 시 해당 섹션으로 페이지 스크롤 — 접힘 섹션은 먼저 펼침.
  body.querySelectorAll(".tile[data-anchor]").forEach(function (t) {
    t.addEventListener("click", function () {
      var sec = document.getElementById(t.getAttribute("data-anchor"));
      if (!sec) return;
      if (sec.tagName === "DETAILS") sec.open = true;
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  // 리포트 딥링크(§2.3-3): "조항 보기 →" — 조항별 검토 탭의 해당 행(또는 부재 알람 블록)으로 점프.
  body.querySelectorAll(".rpt-goto").forEach(function (btn) {
    btn.addEventListener("click", function () { gotoClause(btn.getAttribute("data-ci")); });
  });
  // 제안 섹션 판정(P1): 리포트에서 바로 판정 — 저장 후 리포트(타일 수치 포함)·다른 뷰 갱신.
  bindVerdictControls(body, function () { renderReport(); renderClauses(); renderSuggestions(); });
  // 종합 검토의견 — 수정(편집 모드 전환)·저장(persist)·취소·자동 초안 재생성.
  var oedit = document.getElementById("opinion-edit");
  if (oedit) oedit.addEventListener("click", function () { _opinionEditing = true; renderReport(); });
  var osave = document.getElementById("opinion-save");
  if (osave) osave.addEventListener("click", function () {
    opinionStoreSave(document.getElementById("opinion-textarea").value);
    _opinionEditing = false;
    renderReport();
  });
  var ocancel = document.getElementById("opinion-cancel");
  if (ocancel) ocancel.addEventListener("click", function () { _opinionEditing = false; renderReport(); });
  var oregen = document.getElementById("opinion-regen");
  if (oregen) oregen.addEventListener("click", function () { opinionStoreClear(); renderReport(); });
  var rprint = document.getElementById("report-print");
  if (rprint) rprint.addEventListener("click", function () { window.print(); });
  var rfin = document.getElementById("report-finish");
  if (rfin) rfin.addEventListener("click", finishReview);
  var rvIn = document.getElementById("reviewer-name");
  if (rvIn) rvIn.addEventListener("change", function () { setReviewer(rvIn.value); });
  var rexp = document.getElementById("report-verdict-export");
  if (rexp) rexp.addEventListener("click", exportVerdicts);
  var aexp = document.getElementById("report-archive-export");
  if (aexp) aexp.addEventListener("click", exportArchive);
  var gsnap = document.getElementById("report-goldset-snapshot");
  if (gsnap) gsnap.addEventListener("click", exportGoldsetCase);
  var ring = document.getElementById("report-loop-ingest");
  if (ring) ring.addEventListener("click", function () {
    ingestCurrentToCorpus();
    renderReport();      // 코퍼스 카운트·분포 갱신 반영
    renderClauses();     // 조항별 보기 추천도 갱신
    renderSuggestions(); // 제안사항 패널 추천도 갱신
  });
  var vfiles = document.getElementById("corpus-verdict-files");
  if (vfiles) vfiles.addEventListener("change", function () {
    importVerdictFilesToCorpus(vfiles.files, function (okN, failN) {
      renderReport(); renderClauses(); renderSuggestions(); // 먼저 다시 그린 뒤 메시지 기입(renderReport가 DOM을 교체하므로)
      var msg = document.getElementById("team-actions-msg");
      if (msg) msg.textContent = "반영 완료: " + okN + "건 병합" + (failN ? ", 실패 " + failN + "건(형식 오류)" : "") +
        " — 코퍼스 " + loopCorpus.meta.contract_count + "건";
    });
  });
  var cbk = document.getElementById("corpus-backup");
  if (cbk) cbk.addEventListener("click", exportCorpusBackup);
  var crs = document.getElementById("corpus-restore");
  if (crs) crs.addEventListener("change", function () {
    if (!crs.files.length) return;
    restoreCorpusBackup(crs.files[0], function (ok) {
      if (ok) { renderReport(); renderClauses(); renderSuggestions(); }
      var msg = document.getElementById("team-actions-msg");
      if (msg) msg.textContent = ok ? "코퍼스 복원 완료 — " + loopCorpus.meta.contract_count + "건" : "복원 실패: 코퍼스 백업 파일이 아님";
    });
  });
}
// 인쇄 시 접힌 섹션도 펼쳐 특수 규제·참고 별첨·반영 상세가 모두 나오게.
// 팀·지식 관리 접힘(admin-fold)은 산출물이 아니므로 제외.
window.addEventListener("beforeprint", function () {
  document.querySelectorAll("#report-body details").forEach(function (d) {
    if (d.classList.contains("admin-fold")) return;
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
  // V4: 유형별 미검수 카운트를 옵션 라벨에 병기 — 유형 필터가 검토 맥락과 무관하게 초기화돼도
  // "이 유형에 아직 볼 게 있는지"가 라벨만으로 보이게.
  tsel.innerHTML = types.map(function (t) {
    var scoped = t.id ? verifyItems.filter(function (it) { return it.typeId === t.id; }) : verifyItems;
    var cnt = Verify.verifyProgress(scoped, verifyDecisions).pending;
    return '<option value="' + esc(t.id) + '">' + esc(t.name) + (cnt ? " (미검수 " + cnt + ")" : "") + "</option>";
  }).join("");
  tsel.addEventListener("change", renderVerify);
  document.getElementById("verify-filter").addEventListener("change", renderVerify);
  document.getElementById("verify-export").addEventListener("click", exportVerify);
  renderVerify();
}

var SEV_CLS = { "필수": "sev-필수", "권장": "sev-권장", "참고": "sev-참고" };
var DEC_LABEL = { "확인": "확인", "수정필요": "수정 필요", "보류": "보류" };

// 진행 바(V3): 숫자가 곧 필터 — 클릭하면 해당 상태로 즉시 전환.
function verifyProgressHtml(p) {
  function seg(mode, label, n) {
    return '<button type="button" class="verify-prog-seg" data-vmode="' + mode + '">' + label + " " + n + "</button>";
  }
  return "statute 근거 " + p.total + "개 · " +
    seg("confirmed", "확인", p.confirmed) + " / " +
    seg("needsfix", "수정필요", p.needsfix) + " / " +
    seg("unreviewed", "미검수", p.pending);
}

function renderVerify() {
  var filterSel = document.getElementById("verify-filter");
  var typeSel = document.getElementById("verify-type");
  var filter = { mode: filterSel.value, typeId: typeSel.value };
  var p = Verify.verifyProgress(verifyItems, verifyDecisions);
  document.getElementById("verify-progress").innerHTML = verifyProgressHtml(p);
  document.querySelectorAll("#verify-progress .verify-prog-seg").forEach(function (btn) {
    btn.addEventListener("click", function () {
      filterSel.value = btn.getAttribute("data-vmode");
      renderVerify();
    });
  });
  // V2: 실무 항목(검수 대상 아님)은 목록에서 빼고 한 줄 집계로만 노출.
  var pcount = Verify.practiceCount(verifyItems, filter);
  var pnote = document.getElementById("verify-practice-note");
  pnote.textContent = pcount ? "실무 항목 " + pcount + "건(검수 대상 아님) — 별도 필터로 확인 가능" : "";
  var shown = Verify.filterItems(verifyItems, verifyDecisions, filter);
  var listEl = document.getElementById("verify-list");
  // V1: 미검수 필터에서 대상이 0건이면 소음(전량 렌더) 대신 완료 요약 카드.
  if (filter.mode === "unreviewed" && shown.length === 0 && p.pending === 0) {
    var last = Verify.lastReviewDate(verifyDecisions);
    listEl.innerHTML = '<div class="verify-done-card">statute 근거 ' + p.total + '개 전건 검수 완료' +
      (last ? " · 최근 검수일 " + esc(last) : "") +
      (p.needsfix ? ' · <button type="button" class="linklike" data-vmode="needsfix">수정필요 ' + p.needsfix + "건 보기</button>" : "") +
      "</div>";
    var b = listEl.querySelector(".linklike");
    if (b) b.addEventListener("click", function () { filterSel.value = "needsfix"; renderVerify(); });
  } else {
    listEl.innerHTML = shown.map(renderVerifyCard).join("") || "<p>해당 항목 없음</p>";
  }
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
        '<input class="dec-note" data-key="' + esc(key) + '" name="dec-note-' + esc(key) + '" aria-label="수정 필요 메모" placeholder="수정 필요 메모" value="' +
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
