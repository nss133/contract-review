/* Display-only composition. No analysis, verdict mutation, storage, or observers. */
var ReportLayout = (function () {
  "use strict";
  function counts(verdicts) {
    var out = { automatic: 0, reviewer: 0 };
    Object.keys(verdicts || {}).forEach(function (id) {
      var v = verdicts[id];
      if (!v || !v.verdict || v.needs_reconfirmation) return;
      out[v.origin === "auto" ? "automatic" : "reviewer"]++;
    });
    return out;
  }
  // Actual active judgments plus the completion gate's pending IDs. The gate
  // excludes some already-automatic checks, so its denominator is NOT coverage.
  // This is a composition count, never a percentage of legal safety/completeness.
  function distribution(pendingIds, verdicts) {
    var ids = Array.from(new Set((pendingIds || []).concat(Object.keys(verdicts || {}).filter(function(id) {
      var v = verdicts[id]; return v && v.verdict && !v.needs_reconfirmation;
    }))));
    var out = { automatic: 0, reviewer: 0, pending: 0, total: ids.length };
    ids.forEach(function (id) {
      var v = (verdicts || {})[id];
      if (!v || !v.verdict || v.needs_reconfirmation) out.pending++;
      else out[v.origin === "auto" ? "automatic" : "reviewer"]++;
    });
    return out;
  }
  function apply(root, model) {
    var shell = root.querySelector(".report-summary");
    if (!shell || shell.classList.contains("report-composed")) return;
    var doc = root.ownerDocument;
    function el(tag, cls, text) {
      var node = doc.createElement(tag); node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function move(selector, target) {
      var node = shell.querySelector(selector);
      if (node) target.appendChild(node);
      return node;
    }
    function chart() {
      var data = distribution(model.pendingIds, model.verdicts);
      var figure = el("figure", "report-coverage");
      var caption = el("figcaption", "coverage-heading");
      caption.appendChild(el("span", "coverage-kicker", "현재 판정 구성"));
      caption.appendChild(el("strong", "coverage-count", data.total ? data.total + "건" : "대상 없음"));
      caption.appendChild(el("span", "coverage-total", "완료 판정 + 남은 필수 판단"));
      figure.appendChild(caption);
      var parts = [{key:"automatic",label:"자동판정",color:"#043B72"},
        {key:"reviewer",label:"검토자 판정",color:"#00A9CE"},
        {key:"pending",label:"미판정·재확인",color:"#F58220"}];
      var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 600 28");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("class", "coverage-bar");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "판정 구성 " + data.total + "건 중 " + parts.map(function(p){return p.label + " " + data[p.key] + "건";}).join(", "));
      var offset = 0;
      parts.forEach(function(p) {
        if (!data[p.key]) return;
        var width = data[p.key] / data.total * 600;
        var rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(offset)); rect.setAttribute("y", "0");
        rect.setAttribute("width", String(width)); rect.setAttribute("height", "28");
        rect.setAttribute("fill", p.color); rect.setAttribute("data-category", p.key);
        svg.appendChild(rect); offset += width;
      });
      figure.appendChild(svg);
      var legend = el("dl", "coverage-legend");
      parts.forEach(function(p) {
        var item = el("div", "coverage-category " + p.key);
        item.appendChild(el("dt", "", p.label));
        item.appendChild(el("dd", "", data[p.key] + "건"));
        legend.appendChild(item);
      });
      figure.appendChild(legend);
      figure.appendChild(el("p", "coverage-note", "선택 항목의 완료 판정·검토의견도 포함합니다. 미판정 선택 항목은 제외합니다. 계약의 안전도·적정성 점수가 아닙니다."));
      return figure;
    }
    shell.classList.add("report-composed");
    var hero = el("header", "report-overview");
    var heading = el("div", "report-heading");
    move(":scope > h3", heading);
    heading.appendChild(el("h2", "report-contract-name", model.name || "계약서"));
    heading.appendChild(el("p", "report-subtitle", "계약 " + model.clauseCount + "개 조항 · 검토의견과 남은 판단을 한눈에 확인합니다."));
    hero.appendChild(heading);
    var status = el("div", "report-state " + (model.pending ? "is-pending" : "is-ready"));
    status.appendChild(el("strong", "", model.pending ? "추가 판단 " + model.pending + "건" : "검토 마치기 가능"));
    status.appendChild(el("span", "", model.pending ? "남은 판단 목록에서 해당 항목으로 이동하세요." : "필요한 판단이 정리되었습니다. 마치기를 눌러 저장하세요."));
    hero.appendChild(status);
    var actions = move(":scope > .report-actions", hero);
    if (actions) {
      var msg = actions.querySelector("#finish-msg");
      if (msg) { msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite"); }
    }
    shell.prepend(hero);
    var dashboard = el("section", "report-dashboard");
    dashboard.setAttribute("aria-label", "검토 현황 대시보드");
    dashboard.appendChild(chart());
    var tiles = move(":scope > .report-tiles", dashboard);
    var formalTile = tiles && tiles.querySelector('[data-anchor="rpt-sec-formal"]');
    if (formalTile && model.formalWarnings === 0) formalTile.classList.add("formal-clear");
    var n = counts(model.verdicts);
    var ledger = el("p", "report-verdict-ledger", "전체 체크항목 판정 · 자동 " + n.automatic + "건 / 검토자 " + n.reviewer + "건 — 선택 항목 포함, 재확인 대상 제외");
    if (tiles) dashboard.appendChild(ledger);
    hero.after(dashboard);
    var workspace = el("div", "report-workspace");
    var main = el("div", "report-main");
    var aside = el("aside", "report-next");
    aside.setAttribute("aria-label", "남은 판단과 검토 안내");
    move(":scope > .report-opinion", main);
    move("#rpt-sec-results", main);
    if (model.pending) {
      aside.appendChild(el("h3", "report-side-title", "다음으로 확인할 내용"));
      move(":scope > .report-pending-banner", aside);
    } else {
      var ready = el("section", "report-ready-card");
      ready.appendChild(el("h3", "", "남은 필수 판단 없음"));
      ready.appendChild(el("p", "", "종합의견을 확인한 뒤 검토를 마칠 수 있습니다. 이 표시는 계약에 위험이 없다는 뜻은 아닙니다."));
      var back = el("button", "ghost rpt-goto-review", "조항별 검토 다시 보기 →");
      back.type = "button"; ready.appendChild(back); aside.appendChild(ready);
    }
    ["#rpt-sec-pending", "#rpt-sec-external", "#rpt-sec-hold", "#rpt-sec-negotiate"].forEach(function (s) { move(s, aside); });
    workspace.appendChild(main); workspace.appendChild(aside); dashboard.after(workspace);
    var context = el("section", "report-context");
    var banners = Array.from(shell.querySelectorAll(":scope > .report-stance-banner"));
    if (banners.length) {
      context.appendChild(el("h3", "", "이번 검토의 관점·적용 범위"));
      banners.forEach(function (b) { context.appendChild(b); });
      workspace.after(context);
    }
    // Other original sections (comparison, formal checks, team tools) remain intact.
  }
  function markSaved(root) {
    var status = root && root.querySelector(".report-state.is-ready");
    if (!status) return;
    status.querySelector("strong").textContent = "검토 저장됨";
    status.querySelector("span").textContent = "검토 결과와 의견을 저장했습니다. 공유·회신용 파일은 내보내기로 받으세요.";
  }
  function markSaveFailed(root, message) {
    var status = root && root.querySelector(".report-state");
    if (!status) return;
    status.classList.add("is-save-error");
    status.querySelector("strong").textContent = "저장 확인 필요";
    status.querySelector("span").textContent = message;
  }
  return { apply: apply, counts: counts, distribution: distribution, markSaved: markSaved, markSaveFailed: markSaveFailed };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ReportLayout;
