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
      return src.verified
        ? { cls: "verified", label: "원문확인", rank: 3 }
        : { cls: "unverified", label: "원문 미대조", rank: 2 };
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
  return (lawText ? lawText + " " : "") + '<span class="badge ' + badge.cls + '">' + badge.label + "</span>";
}

/* ---------- 체크 카드 (조항별 보기·리포트 공용) ---------- */
function renderCheckCard(cp, hits) {
  var h = '<div class="cp-card"><h3><span class="sev sev-' + cp.severity + '">' +
    esc(cp.severity) + "</span>" + esc(cp.id) + " <span class=\"norm-type\">" + esc(cp.norm_type) + "</span></h3>";
  h += '<p class="check-q">' + esc(cp.check) + "</p>";
  if (hits) h += '<p class="hit">매칭: ' + esc(hits.keywords.concat(hits.patterns).join(", ")) + "</p>";
  var src0 = primarySource(cp);
  if (src0 && src0.quote) {
    h += '<div class="quote-block"><p class="quote-label">원문 발췌</p><blockquote>“' +
      esc(src0.quote) + '”</blockquote></div>';
  }
  h += "<p>" + evidenceCell(cp) + "</p>";
  (cp.sources || []).forEach(function (src) {
    var label = esc(src.law) + " " + esc(src.article) + (src.clause ? " " + esc(src.clause) : "");
    h += '<details class="law"><summary>' + label + " " + sourceBadgeHtml(src) + "</summary>";
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
function checkStatus(cp) {
  if (!state.result) return { cls: "", label: "—" };
  var active = state.result.checkpoints.some(function (c) { return c.id === cp.id; });
  if (!active) return { cls: "", label: "—" };
  var m = state.result.matches.filter(function (x) { return x.cpId === cp.id; })[0];
  if (m) {
    var clause = state.clauses[m.clauseIndex];
    var heading = clause ? clause.heading : ("조항#" + m.clauseIndex);
    return { cls: "matched", label: "✓ " + heading + " (추정)" };
  }
  if (cp.absence_check) return { cls: "unmatched", label: "✗ 미검출" };
  return { cls: "", label: "—" };
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

function renderChecklistRow(cp, st, pinned) {
  var rowCls = (pinned ? "row-missing " : "") + (st.cls === "matched" ? "row-matched" : "");
  return '<tr class="cp-row ' + rowCls + '" data-id="' + esc(cp.id) + '">' +
    '<td class="match-cell ' + st.cls + '">' + esc(st.label) + "</td>" +
    "<td>" + esc(cp.id) + "</td>" +
    "<td>" + esc(cp.check) + "</td>" +
    '<td><span class="sev sev-' + cp.severity + '">' + esc(cp.severity) + "</span></td>" +
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
    h += '<details class="law"><summary>' + label + " " + sourceBadgeHtml(src) + "</summary>";
    h += src.text ? "<pre>" + esc(src.text) + "</pre>" : "<p>원문 데이터 없음</p>";
    h += "</details>";
  });
  if (state.result) {
    var m = state.result.matches.filter(function (x) { return x.cpId === cp.id; })[0];
    if (m) {
      var clause = state.clauses[m.clauseIndex];
      h += '<div class="match-excerpt"><p class="hit">키워드 추정 매칭 — 원문 확인 필요 (매칭: ' +
        esc((m.hits.keywords || []).concat(m.hits.patterns || []).join(", ")) + ")</p>";
      h += "<pre>" + esc(clause ? clause.body : "") + "</pre></div>";
    }
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
  var missingIds = {};
  if (state.result) state.result.missing.forEach(function (m) { missingIds[m.id] = true; });

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
    if (matchF === "unmatched" && st.cls !== "unmatched") return false;
    if (matchF === "matched" && st.cls !== "matched") return false;
    if (q) {
      var src = primarySource(cp);
      var hay = cp.check + " " + (src ? src.law + " " + src.article : "");
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  var rows = [];
  base.filter(function (cp) { return missingIds[cp.id]; }).forEach(function (cp) {
    rows.push({ cp: cp, st: checkStatus(cp), pinned: true });
  });
  base.filter(function (cp) { return !missingIds[cp.id]; }).forEach(function (cp) {
    rows.push({ cp: cp, st: checkStatus(cp), pinned: false });
  });
  rows = rows.filter(function (r) { return passFilter(r.cp, r.st); });

  document.getElementById("checklist-body").innerHTML =
    rows.map(function (r) { return renderChecklistRow(r.cp, r.st, r.pinned); }).join("") ||
    '<tr><td colspan="6" class="empty">조건에 맞는 항목 없음</td></tr>';

  bindRowClicks();
}

function initChecklistType() {
  var sel = document.getElementById("checklist-type");
  sel.innerHTML = CR.types.map(function (t) {
    return '<option value="' + esc(t.meta.type_id) + '">' + esc(t.meta.type_name) + "</option>";
  }).join("");
  sel.addEventListener("change", function () {
    state.typeId = sel.value;
    if (!document.getElementById("analyze-setup").hidden) renderScreening();
    renderChecklist();
  });
  state.typeId = sel.value;
}

["filter-module", "filter-severity", "filter-match"].forEach(function (id) {
  document.getElementById(id).addEventListener("change", renderChecklist);
});
document.getElementById("filter-search").addEventListener("input", renderChecklist);

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
  var sel = document.getElementById("checklist-type");
  if (ranked[0] && ranked[0].score > 0) sel.value = ranked[0].typeId;
  state.typeId = sel.value;
  renderScreening();
  renderChecklist();
  document.getElementById("analyze-setup").hidden = false;
});

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
    });
  });
}

/* ---------- 분석 실행 ---------- */
document.getElementById("btn-run").addEventListener("click", function () {
  state.typeId = document.getElementById("checklist-type").value;
  var doc = typeDoc(state.typeId);
  var docs = [
    { checkpoints: CR.common.checks },
    { checkpoints: doc ? doc.checks : [] },
  ];
  state.result = analyze(state.clauses, docs, state.activeModules);
  renderClauses();
  renderChecklist();
  renderReport();
  document.getElementById("analyze-result").hidden = false;
  document.getElementById("clauses-empty").hidden = true;
  document.getElementById("report-tab").disabled = false;
  document.getElementById("input-panel").open = false;
  document.querySelector('.tab[data-tab="checklist"]').click();
});

/* ---------- 조항별 보기 (보조 탭) ---------- */
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
        return renderCheckCard(cp, m.hits);
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
    return '<div class="cp-card missing-item">' + renderCheckCard(cp, null) + "</div>";
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
      h += '<li><label><input type="checkbox" data-cp="' + esc(cp.id) + '"' + ck + "> " +
        esc(cp.id) + " " + esc(cp.check) + " — " + evidenceCell(cp) + "</label></li>";
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

initChecklistType();
renderChecklist();
