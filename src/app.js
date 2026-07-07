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
