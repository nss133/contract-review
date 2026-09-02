"use strict";
/* UI 오케스트레이션. segmenter.js·matcher.js·docx.js가 먼저 인라인되어 전역 함수 사용 가능 */

var CR = JSON.parse(document.getElementById("cr-data").textContent);
if (CR.tag_match_mode && ["off", "shadow", "assist"].indexOf(CR.tag_match_mode) !== -1)
  MatcherConfig.TAG_MATCH_MODE = CR.tag_match_mode;
// stance = 검토 국면(party 기본 | beneficiary 수익자·투자자), baseClauses = 원계약 조항(변경합의서 검토 시)
// docTitle = 문서 제목(유형·모듈·체크 게이트의 최상위 신호), partyContext = 당사 호칭·지위
var state = { text: "", clauses: [], typeId: null, activeModules: [], result: null,
  stance: "party", baseText: "", baseClauses: [], docTitle: "", partyRoles: [], partyContext: null, fileName: "",
  scopeAnswers: {}, scopeAssessments: {}, scopeModuleOverrides: {}, legalAlerts: [],
  // 계약서 유형 분류 피드백: 같은 계약서에서 최초 자동분류와 검토자의 최종 선택을 분리 보존한다.
  // 최종값은 내보내는 시점의 typeId를 사용하므로 분석 후 유형을 바꿔도 비교 기록에 반영된다.
  typeDecision: null,
  // 수동 재지정(11.7차): cpId → clauseIndex. 자동 매칭이 엉뚱한 조항에 붙었을 때
  // 검토자가 올바른 조항으로 옮긴 기록. 재분석해도 유지되도록 계약서 해시별 저장.
  reassign: {},
  // 자동 Top1 조항이 실제 의견 대상이라는 검토자의 명시 확인. '이상없음' 판정과는 별도 축이다.
  matchConfirm: {},
  // 체크리스트에 종속되지 않는 자유 의견과 문서 완결성 룰의 사람 판정.
  findingStore: { manual: {}, decisions: {} }, integrityFindings: [],
  // 폐쇄망 계약검토 이력에서 사용자가 명시적으로 선택한 참고 건. 자동판정에는 쓰지 않고
  // 내보내기 계보와 입력 사전채움 근거로만 보존한다.
  historyRef: null };
var LOCAL_LLM_KEY = "cr-local-llm-enabled";
var LOCAL_LLM_MODEL_KEY = "cr-local-llm-model";
var MOTION_PREFERENCE_KEY = "cr-motion-preference-v1";
var _motionPreference = "auto";
var _localLlmSeq = 0;
var _localLlmTimer = null;
var _experimentLlmRunning = false;
var _llmAcceptedDrafts = {}; // contractHash::cpId → 채택 당시 LLM 분석. 재분석 후에도 효용 관측 보존.

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// 영구 실행기의 srcdoc iframe에서 구동될 때는 about:srcdoc 대신 실행기 위치를 사용한다.
// 관리모드 hash와 localhost 로컬 AI 판정이 직접실행과 동일하게 동작하게 한다.
function appRuntimeLocation() {
  try {
    if (window.parent && window.parent !== window && window.parent.location)
      return window.parent.location;
  } catch (e) {}
  return window.location;
}
function typeDoc(typeId) {
  for (var i = 0; i < CR.types.length; i++)
    if (CR.types[i].meta.type_id === typeId) return CR.types[i];
  return null;
}
function allChecksForType(typeId) {
  var doc = typeDoc(typeId);
  var docs = [CR.common].concat(doc ? [doc] : []).concat(scopeSourceDocs());
  var seen = {}, out = [];
  docs.forEach(function (source) {
    (source.checks || []).forEach(function (cp) {
      if (!seen[cp.id]) { seen[cp.id] = true; out.push(cp); }
    });
  });
  return out;
}
function findCheck(id) {
  var all = allChecksForType(state.typeId);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}
function primarySource(cp) {
  return (cp.sources && cp.sources[0]) || null;
}
// matcher의 탐색문(check)과 사람의 판정 질문(decision_question)을 분리한다.
function decisionQuestion(cp) { return cp.decision_question || cp.check; }
function cpLabel(cp) { return cp.label || decisionQuestion(cp); }
function hasLabel(cp) { return !!(cp.label && cp.label !== decisionQuestion(cp)); }
function labelQ(cp) {
  var q = decisionQuestion(cp);
  if (hasLabel(cp)) return '<span class="lq-label">' + esc(cp.label) + '</span><span class="lq-detail">' + esc(q) + "</span>";
  return esc(q);
}
function decisionGuidanceHtml(cp) {
  if (!cp.pass_guidance && !cp.opinion_guidance) return "";
  return '<div class="decision-guide">' +
    (cp.pass_guidance ? '<span><strong>이상없음</strong> ' + esc(cp.pass_guidance) + '</span>' : '') +
    (cp.opinion_guidance ? '<span><strong>검토의견</strong> ' + esc(cp.opinion_guidance) + '</span>' : '') +
    '</div>';
}
function actionRationaleHtml(cp) {
  return cp && cp.action_rationale
    ? '<p class="ci-action-rationale">이렇게 안내한 이유: ' + esc(cp.action_rationale) + '</p>' : '';
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
  // 법령 조문 호버 플로팅(2026-08-19 피드백): 근거가 된 조문 내용을 그 자리에서 확인 —
  // "강행규정이니까 매칭했다"는 안내만 보고 법을 다시 찾아보게 하지 않기 위함.
  // 발췌(quote)를 우선, 없으면 DB 원문 앞부분. 데이터는 이미 빌드 시 내장돼 있어 표시만 추가.
  if (lawText) {
    var popBody = String(src.quote || "").trim();
    if (!popBody && src.text) popBody = String(src.text).trim().slice(0, 600) +
      (String(src.text).trim().length > 600 ? "…" : "");
    if (popBody) {
      lawText = '<span class="law-ref" tabindex="0">' + lawText +
        '<span class="law-pop"><span class="law-pop-head">' + esc(src.law) + " " + esc(src.article) +
        (src.clause ? " " + esc(src.clause) : "") + "</span>" + esc(popBody) + "</span></span>";
    }
  }
  return (lawText ? lawText + " " : "") +
    (badge ? '<span class="badge ' + badge.cls + '">' + badge.label + "</span>" : "") +
    (src ? sourceTypeBadgeHtml(src) : "");
}

/* ---------- coverage 배지 (계약 반영 축 — 증적 배지와 별개) ----------
   검토 보조 화법: 판정형("확정/미검출") 폐기. 팀 피드백(2026-07 "무슨 말인지
   모르겠다")에 따라 압축어("반영/제안/검토 제안") 대신 구체적으로 이해되는
   문구로 풀어씀 — 타일·섹션 제목·풋터 범례와 동일 어휘로 일관.
   내부 키·CSS 클래스명(verify/cov-verify)은 구조 변경 범위가 아니라 유지. */
/* '원문'이라는 말이 "법령 원문"과 헷갈린다는 피드백(2026-08-18) — 계약서 쪽은 '문구'로 통일. */
var COVERAGE_LABEL = {
  addressed: "✓ 계약서에 관련 문구 있음",
  verify: "△ 관련 문구인지 확인 필요",
  consider: "! 적용·보완 판단 필요",
  base_covered: "✓ 원계약에 관련 문구 있음",   // 변경합의서 국면 — 변경본엔 없으나 원계약이 다룸
  quiet: "·"
};
var COVERAGE_CLS = {
  addressed: "cov-addressed",
  verify: "cov-verify",
  consider: "cov-consider",
  base_covered: "cov-base",
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

/* ---------- 표준 문안 참고 (표시 전용) ----------
   knowledge/std_refs.yaml → build_html.attach_std_refs가 check.std_refs로 join한
   공개 표준계약 문서(계약예규·공정위 표준하도급계약서)의 조항 발췌.
   판정·severity·매칭·골드셋 채점에 일절 관여하지 않음 — "표준 문서는 이렇게 정하고
   있음"을 보여주는 회색 인용 블록일 뿐임(판정 어휘 금지). 1건이면 바로 노출,
   2건 이상이면 첫 건 + 나머지는 details 접힘. */
function stdRefLine(ref) {
  return '<p class="std-ref-line">참고 — ' + esc(ref.doc) + " " + esc(ref.art) +
    '<span class="std-ref-date"> (' + esc(ref.doc_date) + ')</span>: “' + esc(ref.quote) + '”</p>';
}
function stdRefsHtml(cp) {
  var refs = (cp && cp.std_refs) || [];
  if (!refs.length) return "";
  var h = '<div class="std-refs"><p class="std-ref-label">표준 문안 참고 — 표준 문서는 이렇게 정하고 있음</p>' +
    stdRefLine(refs[0]);
  if (refs.length > 1) {
    h += '<details class="std-ref-more"><summary>표준 문안 ' + (refs.length - 1) + "건 더 보기</summary>" +
      refs.slice(1).map(stdRefLine).join("") + "</details>";
  }
  return h + "</div>";
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
  h += stdRefsHtml(cp); // 표시 전용 — 판정·severity 무영향
  if (cp.note) h += '<p class="note">비고: ' + esc(cp.note) + "</p>";
  return h + "</div>";
}

/* ---------- 탭 ---------- */
var _paneTransitionSeq = 0;
function systemReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
function reducedMotion() {
  return MotionPreference.isReduced(_motionPreference, systemReducedMotion());
}
function renderMotionStatus() {
  var el = document.getElementById("motion-status");
  if (!el) return;
  var info = MotionPreference.status(_motionPreference, systemReducedMotion());
  el.textContent = info.label;
  el.title = info.reason + " 인터넷 연결 여부와는 무관합니다.";
  el.classList.toggle("is-reduced", info.reduced);
}
function applyMotionPreference(value, persist) {
  _motionPreference = MotionPreference.normalize(value);
  document.body.setAttribute("data-motion", _motionPreference);
  var select = document.getElementById("motion-preference");
  if (select) select.value = _motionPreference;
  if (persist) {
    try { localStorage.setItem(MOTION_PREFERENCE_KEY, _motionPreference); } catch (e) {}
  }
  renderMotionStatus();
}
function initMotionPreference() {
  var stored = "auto";
  try { stored = localStorage.getItem(MOTION_PREFERENCE_KEY) || "auto"; } catch (e) {}
  applyMotionPreference(stored, false);
  var select = document.getElementById("motion-preference");
  if (select) select.addEventListener("change", function () {
    applyMotionPreference(select.value, true);
  });
  if (window.matchMedia) {
    var media = window.matchMedia("(prefers-reduced-motion: reduce)");
    var refresh = function () { if (_motionPreference === "auto") renderMotionStatus(); };
    if (media.addEventListener) media.addEventListener("change", refresh);
    else if (media.addListener) media.addListener(refresh);
  }
}
function activatePane(name, opts) {
  opts = opts || {};
  var btn = document.querySelector('.tab[data-tab="' + name + '"]');
  var pane = document.getElementById("pane-" + name);
  if (!btn || !pane || btn.disabled) return;
  var current = document.querySelector(".pane.active");
  var same = current === pane;
  document.querySelectorAll(".tab").forEach(function (b) {
    var on = b === btn;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".pane").forEach(function (p) {
    p.classList.toggle("active", p === pane);
    if (p !== pane) p.classList.remove("pane-enter");
  });
  if (same || opts.animate === false || reducedMotion()) return;
  var seq = ++_paneTransitionSeq;
  pane.classList.add("pane-enter");
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (seq === _paneTransitionSeq) pane.classList.remove("pane-enter");
    });
  });
}
document.querySelectorAll(".tab").forEach(function (btn) {
  btn.addEventListener("click", function () {
    if (btn.disabled) return;
    activatePane(btn.dataset.tab);
  });
});

/* ---------- 관리모드(#admin) — 골드셋 노출 토글 ----------
   팀 배포 기본 화면에서 골드셋 관련 UI를 숨김(팀원 혼란 제거). URL 해시를
   #admin으로 열면 표시 — 기능·코드는 그대로, body 클래스 + CSS로 표시만 제어.
   지식 검수 탭은 현행 유지(숨기지 않음). */
function applyAdminMode() {
  var runtimeLoc = appRuntimeLocation();
  var on = runtimeLoc.hash === "#admin" || runtimeLoc.hash === "#admin-contribution";
  document.body.classList.toggle("admin-mode", on);
  // 관리모드 해제 시 골드셋 탭이 열려 있으면 리포트로 복귀 — 숨은 탭의 pane 잔류 방지.
  var gs = document.querySelector('.tab[data-tab="goldset"]');
  if (!on && gs && gs.classList.contains("active"))
    document.querySelector('.tab[data-tab="report"]').click();
  if (runtimeLoc.hash === "#admin-contribution" && gs && !gs.classList.contains("active")) gs.click();
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
      ? '<span class="cp-label">' + esc(cp.label) + '</span><span class="cp-detail-q">' + esc(decisionQuestion(cp)) + "</span>"
      : esc(decisionQuestion(cp))) + "</td>" +
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
  h += stdRefsHtml(cp); // 표시 전용 — 판정·severity 무영향
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
      var hay = cp.check + " " + decisionQuestion(cp) + " " + (src ? src.law + " " + src.article : "");
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
    decisionGuidanceHtml(cp) +
    actionRationaleHtml(cp) +
    (cp.severity_basis ? '<p class="ci-basis">' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">' + evidenceCell(cp) + "</p>" +
    evidenceLineHtml(cp, r) +
    stdRefsHtml(cp) + // 표시 전용 — 판정·severity 무영향
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
    (ref.length ? "" : '<p class="compare-empty">현재 계약서 문구 확인이 필요한 항목 없음</p>');
  if (ref.length) {
    html += '<details class="ref-fold"><summary>참고로 살펴볼 항목 ' + ref.length + '건 펼치기</summary>' +
      ref.map(renderSuggestionItem).join("") + "</details>";
  }
  box.innerHTML = html;
  bindVerdictControls(box, function (cpId) {
    withVerdictAnchor("#suggestions-body", cpId, renderSuggestions);
    renderReport();
  });
}

// 유형 select는 입력 탭(input-type)과 리포트 조정부(checklist-type) 두 곳에 있음 —
// 어느 쪽을 바꾸든 같은 상태를 가리키도록 값을 미러링한다(11차: 입력 단계 선택 노출).
var TYPE_SELECT_IDS = ["checklist-type", "input-type"];
function _typeOptionsHtml() {
  // 맨 앞 미확정 옵션(P3): 감지 점수 임계 미달 시 자동선택하지 않고 공통 검토만 — 오유형 체크리스트 로드 방지.
  return '<option value="">— 유형 미확정 (직접 선택) —</option>' + CR.types.map(function (t) {
    return '<option value="' + esc(t.meta.type_id) + '">' + esc(t.meta.type_name) + "</option>";
  }).join("");
}
function syncTypeSelects(value) {
  TYPE_SELECT_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (el && el.value !== value) el.value = value;
  });
}
// 유형 변경 단일 처리 — 두 select와 입력 탭 모듈 칩까지 함께 갱신.
function onTypeChanged(value) {
  state.typeId = value;
  syncTypeSelects(value);
  renderInputScreening();
  if (!document.getElementById("analyze-setup").hidden) {
    renderScreening();
    if (_analyzedOnce) { runAnalysis(); return; } // 유형 변경 시 즉시 재검토
  }
  renderChecklist();
}
function captureInitialTypeDecision() {
  var hash = hashText(state.text || "");
  if (state.typeDecision && state.typeDecision.contract_hash === hash) return;
  var ranked = state.detectRanked || [];
  state.typeDecision = {
    contract_hash: hash,
    initial_auto_type_id: pickType(ranked) || null,
    candidates: ranked.slice(0, 3).map(function (r) {
      return { type_id: r.typeId || null, score: Number(r.score || 0),
        hits: (r.hits || []).slice(0, 6), suppressed: !!r.suppressed };
    })
  };
}
function currentTypeDecision() {
  captureInitialTypeDecision();
  var initial = state.typeDecision && state.typeDecision.initial_auto_type_id || null;
  var finalType = state.typeId || null;
  var outcome = finalType
    ? (initial ? (initial === finalType ? "auto_accepted" : "reviewer_changed") : "reviewer_selected_after_undetermined")
    : "undetermined";
  return {
    format: "cr-type-classification-v1",
    initial_auto_type_id: initial,
    final_type_id: finalType,
    outcome: outcome,
    reviewer_changed: outcome === "reviewer_changed",
    candidates: JSON.parse(JSON.stringify((state.typeDecision && state.typeDecision.candidates) || []))
  };
}
function initChecklistType() {
  TYPE_SELECT_IDS.forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = _typeOptionsHtml();
    sel.addEventListener("change", function () { onTypeChanged(sel.value); });
  });
  state.typeId = document.getElementById("checklist-type").value;
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
    state.fileName = f.name || ""; // 파일명도 유형 신호(2026-08-19 피드백) — 수동 편집 시 해제
    state.scopeAnswers = {};
    state.scopeModuleOverrides = {};
    state.subdocUse = {}; state.subdocUseHash = ""; // 계약별 체결 확인값이므로 새 계약에 이월하지 않음
    err.hidden = true;
    refreshInputSetup(); // 파일 적재 즉시 국면·유형·모듈 추정 프리필(11차)
  }).catch(function (ex) {
    err.textContent = "파일 파싱 실패(" + ex.message + ") — 원본에서 텍스트를 복사해 붙여넣으세요. " +
      "(스캔 PDF·암호 문서·구형 hwp는 자동 추출이 안 됩니다)";
    err.hidden = false;
  });
}
document.getElementById("docx-file").addEventListener("change", function (e) {
  loadContractFile(e.target.files[0]);
});

/* ---------- 입력 단계 검토 설정(11차) ---------- */
// 본문이 바뀌면 국면·유형·모듈 추정을 다시 돌려 프리필. 검토자가 이미 국면을 손댔으면
// 자동 추정으로 덮지 않음(사람의 지정이 기계 추정보다 우선).
var _stanceTouched = false;
function refreshInputSetup() {
  state.text = document.getElementById("contract-text").value;
  loadSubdocUse();
  var note = document.getElementById("stance-auto");
  if (!state.text.trim()) {
    state.scopeAssessments = {};
    state.legalAlerts = [];
    if (note) note.hidden = true;
    document.getElementById("input-type-auto").textContent = "";
    renderInputScreening();
    return;
  }
  // ⓪ 문서 제목·당사 지위 — 이후 모든 게이트의 입력(11.1차)
  state.docTitle = extractDocTitle(state.text);
  state.partyContext = detectPartyContext(state.text);
  state.partyRoles = state.partyContext.roles;
  // ① 국면 추정
  var st = detectStance(state.text);
  if (!_stanceTouched && st.stance !== state.stance) {
    state.stance = st.stance;
    var radio = document.querySelector('input[name="stance"][value="' + st.stance + '"]');
    if (radio) radio.checked = true;
  }
  // 읽어낸 문서 제목·당사 지위를 노출 — 게이트가 이 값들로 동작하므로 검토자가 확인할 수 있어야 함.
  var dt = document.getElementById("doc-title-info");
  if (dt) {
    var bits = [];
    if (state.docTitle) bits.push("문서 제목: <strong>" + esc(state.docTitle) + "</strong>");
    else bits.push('<span class="setup-warn">문서 제목을 못 읽음</span> — 제목 줄이 있으면 유형·체크 분류가 정확해집니다');
    if (state.fileName) bits.push("파일명: <strong>" + esc(state.fileName) + "</strong> (유형 신호로 사용)");
    if (state.partyRoles.length) bits.push("계약상 당사 지위: <strong>" + esc(state.partyRoles.join("·")) + "</strong>");
    if (state.partyContext.ourAliases.length)
      bits.push("계약상 당사 호칭: <strong>" + esc(state.partyContext.ourAliases.join("·")) + "</strong>");
    dt.innerHTML = bits.join(" · ");
    dt.hidden = false;
  }
  if (note) {
    if (st.stance === "beneficiary") {
      note.innerHTML = '자동 추정: <strong>수익자·투자자</strong> 국면 ' +
        '<span class="detect-basis">(근거어: ' + esc(st.hits.slice(0, 5).join("·")) + ')</span> — ' +
        '이 국면에서는 보험업 자산운용·모집 등 <em>당사가 수범자가 아닌</em> 규제 체크가 빠집니다. 다르면 위에서 바꾸세요.';
      note.hidden = false;
    } else if (_stanceTouched) {
      note.hidden = true;
    } else {
      note.textContent = "자동 추정: 계약 당사자 국면 — 당사 준수사항을 점검합니다.";
      note.hidden = false;
    }
  }
  // ② 유형 추정 — 프리필만, 확정은 검토자 몫. 제목·파일명이 강신호로 가산됨.
  var ranked = detectType(state.text, CR.types, state.docTitle, state.fileName);
  state.detectRanked = ranked;
  var picked = pickType(ranked) || "";
  if (!_analyzedOnce) {
    state.typeId = picked;
    syncTypeSelects(picked);
  }
  var auto = document.getElementById("input-type-auto");
  if (auto) {
    var top = ranked[0];
    auto.textContent = picked
      ? "자동 감지 (근거어: " + (top.hits || []).slice(0, 4).join("·") + ")"
      : "자동 감지 실패 — 유형을 직접 고르면 해당 체크리스트가 붙습니다";
    // 용역 성질결정(12차) — 도급형/위임형에 따라 하자담보 부재알람이 달라지므로 판별 결과를 노출.
    if (picked === "procurement") {
      var svcN = detectServiceNature(state.text);
      if (svcN.nature) {
        auto.textContent += " · 용역 성질: " +
          (svcN.nature === "completion" ? "결과완성형(도급)" : "사무처리형(위임)") +
          " (근거어: " + svcN.hits.slice(0, 3).join("·") + ")";
      }
    }
  }
  // ③ 모듈 칩
  updateScopeAssessments();
  renderInputScreening();
}
document.getElementById("contract-text").addEventListener("input", function () {
  // 사람이 본문을 직접 손대면 파일명은 더 이상 이 내용을 대표하지 않을 수 있음(다른 계약 붙여넣기 등)
  // — 오래된 파일명이 유형을 오도하는 것보다 신호를 버리는 쪽이 안전.
  state.fileName = "";
  // 적용범위 사람 보정은 계약별 판단이다. 본문이 바뀌면 이전 계약의 보정값을 이월하지 않는다.
  state.scopeAnswers = {};
  state.scopeModuleOverrides = {};
  state.subdocUse = {}; state.subdocUseHash = ""; // 본문이 바뀌면 기존 계약의 약정서 체결 확인을 다시 받음
  clearTimeout(refreshInputSetup._t);
  refreshInputSetup._t = setTimeout(refreshInputSetup, 300); // 타이핑 중 과호출 방지
});
document.querySelectorAll('input[name="stance"]').forEach(function (r) {
  r.addEventListener("change", function () {
    if (!r.checked) return;
    _stanceTouched = true;
    state.stance = r.value;
    document.getElementById("stance-auto").hidden = true;
    renderInputScreening();
    if (_analyzedOnce) { renderScreening(); runAnalysis(); } // 국면 변경 = 적용 규제 변경 → 즉시 재검토
  });
});

// 원계약 첨부(11차) — 변경합의서 검토 시 원계약을 전제로 삼음.
document.getElementById("base-file").addEventListener("change", function (e) {
  var f = e.target.files[0];
  if (!f) return;
  var st = document.getElementById("base-status");
  st.textContent = "원계약에서 텍스트 추출 중… (" + f.name + ")";
  extractFileText(f).then(function (text) {
    state.baseText = text;
    state.baseClauses = segmentContract(text);
    st.innerHTML = '원계약 <strong>' + esc(f.name) + "</strong> (" + state.baseClauses.length +
      "개 조항) — 이 내용을 전제로 검토하며, 변경된 부분에 의견을 집중합니다.";
    document.getElementById("base-clear").hidden = false;
    e.target.value = "";
    if (_analyzedOnce) runAnalysis();
  }).catch(function (ex) {
    st.textContent = "원계약 추출 실패(" + ex.message + ") — 원본에서 텍스트를 복사해 본문에 함께 넣어주세요.";
    e.target.value = "";
  });
});
document.getElementById("base-clear").addEventListener("click", function () {
  state.baseText = "";
  state.baseClauses = [];
  document.getElementById("base-status").textContent =
    "변경합의서·개정합의서를 검토할 때 원계약을 넣으면, 원계약에 이미 있는 조항을 “빠진 항목”으로 잡지 않습니다.";
  document.getElementById("base-clear").hidden = true;
  if (_analyzedOnce) runAnalysis();
});

// 부속 서류(#3) — 검토 대상 아닌 별도 서류. 필수 항목 커버 확인용.
state.subDocs = []; // [{name, text}]
// 표준 부속서류 사용 체크(#B) — id → true/false 사용자 지정. true만 검토자 확인으로 인정.
state.subdocUse = {};
state.subdocUseHash = "";
var SUBDOC_USE_KEY_PREFIX = "cr-subdoc-confirm-v1-";
function loadSubdocUse() {
  var hash = hashText(state.text || "");
  if (state.subdocUseHash === hash) return;
  state.subdocUseHash = hash;
  try {
    var saved = JSON.parse(localStorage.getItem(SUBDOC_USE_KEY_PREFIX + hash) || "{}");
    state.subdocUse = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch (e) { state.subdocUse = {}; }
}
function saveSubdocUse() {
  var hash = hashText(state.text || "");
  state.subdocUseHash = hash;
  try { localStorage.setItem(SUBDOC_USE_KEY_PREFIX + hash, JSON.stringify(state.subdocUse || {})); } catch (e) {}
}
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
  // 파일명·본문 자동 감지 결과를 입력 단계와 분석 후 조정 화면에 즉시 반영.
  renderInputSubdocUse();
  if (_analyzedOnce) renderScreening();
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
// 11차: 입력 단계에서 검토자가 지정한 국면·유형·모듈이 있으면 그것을 그대로 사용 —
// 자동 감지로 덮어쓰지 않음(사람의 지정이 기계 추정보다 우선).
var _analysisPresentationSeq = 0;
var ANALYSIS_PHASES = [
  "문서 구조를 파악하고 있습니다",
  "계약 유형과 당사자 지위를 확인하고 있습니다",
  "적용할 체크항목을 선별하고 있습니다",
  "체크항목과 관련 계약조항을 연결하고 있습니다"
];
function setAnalysisPhase(index) {
  var box = document.getElementById("analysis-progress");
  var text = document.getElementById("analysis-progress-text");
  if (!box || !text) return;
  box.hidden = false;
  text.textContent = ANALYSIS_PHASES[index] || "분석 결과를 정리했습니다";
  box.querySelectorAll("[data-analysis-step]").forEach(function (step) {
    var n = Number(step.getAttribute("data-analysis-step"));
    step.classList.toggle("done", n < index);
    step.classList.toggle("active", n === index);
  });
}
function finishAnalysisPresentation(seq) {
  var btn = document.getElementById("btn-analyze");
  var box = document.getElementById("analysis-progress");
  if (seq !== _analysisPresentationSeq) return;
  btn.disabled = false;
  btn.textContent = "다시 분석";
  if (box) box.hidden = true;
}
function prepareResultReveal(tabName) {
  var pane = document.getElementById("pane-" + tabName);
  if (!pane || reducedMotion()) return;
  pane.querySelectorAll(".reveal-row").forEach(function (row) { row.classList.remove("reveal-row"); });
  if (tabName === "clauses") {
    Array.prototype.slice.call(pane.querySelectorAll("#clause-rows .clause-row"), 0, 6)
      .forEach(function (row) { row.classList.add("reveal-row"); });
  }
  pane.classList.add("is-result-entering");
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      pane.classList.remove("is-result-entering");
      window.setTimeout(function () {
        pane.querySelectorAll(".reveal-row").forEach(function (row) { row.classList.remove("reveal-row"); });
      }, 1150);
    });
  });
}
document.getElementById("btn-analyze").addEventListener("click", function () {
  state.text = document.getElementById("contract-text").value;
  if (!state.text.trim()) return;
  var btn = document.getElementById("btn-analyze");
  var seq = ++_analysisPresentationSeq;
  btn.disabled = true;
  btn.textContent = "분석 중…";
  state.clauses = segmentContract(state.text);
  refreshInputSetup(); // 마지막 타이핑 직후 클릭해도 현재 본문으로 유형 후보를 다시 계산
  captureInitialTypeDecision();
  state.typeId = document.getElementById("input-type").value;
  syncTypeSelects(state.typeId);
  renderScreening();
  renderTags();
  document.getElementById("analyze-setup").hidden = false;
  setAnalysisPhase(0);
  if (reducedMotion()) {
    runAnalysis({ landing: true, reveal: false });
    finishAnalysisPresentation(seq);
    return;
  }
  var phase = 1;
  var timer = setInterval(function () {
    if (seq !== _analysisPresentationSeq) { clearInterval(timer); return; }
    if (phase < ANALYSIS_PHASES.length) {
      setAnalysisPhase(phase++);
      return;
    }
    clearInterval(timer);
    runAnalysis({ landing: true, reveal: true });
    window.setTimeout(function () { finishAnalysisPresentation(seq); }, 720);
  }, 250);
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
// 자동 감지는 체크박스를 켜지 않고 검토자에게 후보만 제안한다. 계약서의 단순 참조나
// 비슷한 파일명만으로 실제 체결·적용 범위까지 확정하면 과잉 자동판정이 되기 때문이다.
function _subdocSuggestion(def) {
  if (detectSubdocRefs(state.text || "", [def]).length)
    return { kind: "contract_reference", text: "계약서에서 약정서 참조를 찾았습니다. 실제 체결·사용이면 체크하세요." };
  var sigs = (def.ref_signals || []).concat(def.title ? [def.title] : []);
  var uploaded = (state.subDocs || []).some(function (d) {
    var hay = String(d.name || "") + "\n" + String(d.text || "");
    for (var i = 0; i < sigs.length; i++) if (hay.indexOf(sigs[i]) !== -1) return true;
    return false;
  });
  return uploaded
    ? { kind: "uploaded_candidate", text: "업로드한 부속서류에서 약정서 후보를 찾았습니다. 적용 대상·체결 상태를 확인해 체크하세요." }
    : { kind: "", text: "체결·사용하는 경우 체크하세요." };
}
// 유효 사용 여부는 검토자의 명시적 체크만 인정한다. 자동 감지는 위 제안 문구에만 사용한다.
function subdocInUse(def) {
  return state.subdocUse[def.id] === true;
}
function _subdocConfirmedForCp(cpId) {
  return ((CR.common.meta || {}).standard_subdocs || []).some(function (d) {
    return subdocInUse(d) && (d.covers || []).indexOf(cpId) !== -1;
  });
}
function _confirmedSubdocChecks() {
  var out = {};
  ((CR.common.meta || {}).standard_subdocs || []).forEach(function (d) {
    if (!subdocInUse(d)) return;
    (d.covers || []).forEach(function (cpId) { out[cpId] = true; });
  });
  return out;
}
// 자동 기재 코멘트 — 토글 OFF 시 판정·이 문구가 원형 그대로인 항목만 자동 생성분으로 보고 제거.
function subdocAutoComment(def) {
  return def.auto_comment || ("표준 " + def.title + " 체결로 반영 — 별첨 체결·간인 확인");
}
function subdocUseRowsHtml(scope) {
  return ((CR.common.meta || {}).standard_subdocs || []).map(function (d) {
    var suggestion = _subdocSuggestion(d);
    return '<label class="subdoc-use"><input type="checkbox" class="subdoc-use-cb" data-sdid="' + esc(d.id) +
      '" name="' + esc(scope) + '-subdoc-use-' + esc(d.id) + '"' + (subdocInUse(d) ? " checked" : "") +
      '> 『' + esc(d.title) + '』(표준서식) 체결 사용' +
      (suggestion.kind ? ' <span class="subdoc-suggest">자동 후보</span>' : '') +
      ' <span class="subdoc-use-hint">' + esc(suggestion.text) +
      ' 체크하면 세부 항목을 일괄 반영하고 검토 화면에는 하나의 묶음으로 표시합니다.</span></label>';
  }).join("") || '<span class="setup-auto">선택 가능한 표준 부속서류 없음</span>';
}
function bindSubdocUseControls(root, syncOther) {
  if (!root) return;
  root.querySelectorAll(".subdoc-use-cb").forEach(function (cb) {
    cb.addEventListener("change", function () {
      state.subdocUse[cb.dataset.sdid] = cb.checked;
      saveSubdocUse();
      if (syncOther) syncOther();
      if (_analyzedOnce) runAnalysis();
    });
  });
}
function renderInputSubdocUse() {
  var box = document.getElementById("input-subdoc-use");
  if (!box) return;
  box.innerHTML = subdocUseRowsHtml("input");
  bindSubdocUseControls(box, function () { renderScreening(); });
}

/* ---------- 분석 모드: 모듈 스크리닝 ---------- */
// 현재 유형·국면에서 스크리닝 대상이 되는 모듈 목록.
// 횡단모듈(Phase C): common.meta.modules(X-* 풀)는 유형과 무관하게 스크리닝 —
// 유형 미확정 계약에도 PII·하도급 등 횡단 검토가 실질 신호로 붙음.
// 국면 예외 사유(11.1차) — 상대방이 미래에셋 계열사면 수익자 국면에서도 계열사 이슈를 살림.
function stanceCtx() {
  return { affiliate_party: hasAffiliateParty(state.text) };
}
// 스크리닝 공용 옵션 — 국면·문서 제목·예외사유를 한 번에 전달.
function screenOpts() {
  return { stance: state.stance, docTitle: state.docTitle || "", stanceCtx: stanceCtx(),
    scopeAssessments: state.scopeAssessments || {} };
}
function updateScopeAssessments() {
  state.legalAlerts = LegalConstraints.assess(
    state.text, CR.legal_constraints || { rules: [] },
    { docTitle: state.docTitle || "", fileName: state.fileName || "" });
  state.scopeAssessments = ScopeAssessment.assessAll(
    state.text, CR.regulatory_scopes || { scopes: {} }, state.scopeAnswers || {},
    { docTitle: state.docTitle || "", fileName: state.fileName || "",
      scopeEffects: LegalConstraints.scopeEffects(state.legalAlerts) });
  return state.scopeAssessments;
}
function applyScopeModuleDecisions() {
  Object.keys(state.scopeAssessments || {}).forEach(function (sid) {
    var a = state.scopeAssessments[sid];
    if (!a || state.scopeModuleOverrides[a.module_id] !== undefined) return;
    var i = state.activeModules.indexOf(a.module_id);
    if (a.status === "applicable" && i === -1) state.activeModules.push(a.module_id);
    if (a.status !== "applicable" && i !== -1) state.activeModules.splice(i, 1);
  });
}
function scopeSourceDocs() {
  var seen = {}, docs = [];
  Object.keys(state.scopeAssessments || {}).forEach(function (sid) {
    var a = state.scopeAssessments[sid];
    if (!a || state.activeModules.indexOf(a.module_id) === -1 || !a.check_source_type) return;
    if (a.check_source_type === state.typeId || seen[a.check_source_type]) return;
    var doc = typeDoc(a.check_source_type);
    if (doc) { seen[a.check_source_type] = true; docs.push(doc); }
  });
  return docs;
}
function analysisDocs() {
  var doc = typeDoc(state.typeId);
  return [CR.common].concat(doc ? [doc] : []).concat(scopeSourceDocs())
    .map(function (source) { return { checkpoints: source.checks || [] }; });
}

var SCOPE_FACTOR_LABELS = {
  financial_business_purpose: "금융업 영위 목적",
  continuous_use: "계속적 활용",
  simple_backoffice_exclusion: "단순 후선·집행용역"
};
var SCOPE_VALUE_LABELS = { yes: "예", no: "아니오", unknown: "불명확" };
var SCOPE_STATUS_LABELS = {
  applicable: "적용", non_applicable: "비적용", needs_confirmation: "확인 필요"
};
var SCOPE_CONCLUSION_LABELS = {
  applicable: "이 계약에 적용됨",
  non_applicable: "이 계약에는 적용되지 않음",
  needs_confirmation: "이 계약에 적용되는지 확인 필요"
};
var SCOPE_CONFIDENCE_LABELS = { high: "신뢰도 높음", medium: "신뢰도 중간", low: "신뢰도 낮음" };
function legalAlertsHtml() {
  if (!(state.legalAlerts || []).length) return "";
  return state.legalAlerts.map(function (alert) {
    var evidence = [];
    Object.keys(alert.evidence || {}).forEach(function (group) {
      (alert.evidence[group] || []).forEach(function (item) {
        if (evidence.indexOf(item) === -1) evidence.push(item);
      });
    });
    var sources = (alert.sources || []).map(function (src) {
      return (src.law || "") + " " + (src.article || "");
    }).filter(Boolean).join(" · ");
    return '<details class="legal-alert legal-alert-' + esc(alert.severity || "확인") + '" open>' +
      '<summary><strong>별도 준법 확인</strong><span class="legal-alert-label">' + esc(alert.label) + '</span>' +
      '<span class="legal-alert-severity">' + esc(alert.severity || "확인") + '</span></summary>' +
      '<p>' + esc(alert.summary) + '</p><p class="legal-alert-reason">' + esc(alert.reason) + '</p>' +
      (evidence.length ? '<p class="legal-alert-evidence">근거: ' + esc(evidence.join(" · ")) + '</p>' : '') +
      (sources ? '<p class="legal-alert-source">판단기준: ' + esc(sources) + '</p>' : '') +
      '</details>';
  }).join("");
}
function scopeCardsHtml() {
  var registry = (CR.regulatory_scopes && CR.regulatory_scopes.scopes) || {};
  var cards = Object.keys(state.scopeAssessments || {}).map(function (sid) {
    var a = state.scopeAssessments[sid], cfg = registry[sid] || {}, answers = state.scopeAnswers[sid] || {};
    var evidence = [];
    Object.keys(a.factors || {}).forEach(function (key) {
      (a.factors[key].evidence || []).forEach(function (word) {
        if (evidence.indexOf(word) === -1) evidence.push(word);
      });
    });
    (a.scope_evidence || []).forEach(function (word) {
      if (evidence.indexOf(word) === -1) evidence.push(word);
    });
    var rowKeys = a.status === "needs_confirmation" && (a.review_factors || []).length
      ? a.review_factors : Object.keys(SCOPE_FACTOR_LABELS);
    var rows = rowKeys.map(function (key) {
      var f = a.factors[key] || { value: "unknown", source: "document", evidence: [] };
      var q = (cfg.questions || {})[key] || "";
      return '<div class="scope-factor"><div><strong>' + esc(SCOPE_FACTOR_LABELS[key]) + '</strong>' +
        '<span class="scope-auto">자동: ' + esc(SCOPE_VALUE_LABELS[f.value] || f.value) +
        (f.evidence.length ? ' · ' + esc(f.evidence.join("·")) : '') + '</span><small>' + esc(q) + '</small></div>' +
        '<select class="scope-answer" data-scope="' + esc(sid) + '" data-factor="' + esc(key) + '">' +
        '<option value=""' + (!answers[key] ? ' selected' : '') + '>자동판정 사용</option>' +
        '<option value="yes"' + (answers[key] === "yes" ? ' selected' : '') + '>예</option>' +
        '<option value="no"' + (answers[key] === "no" ? ' selected' : '') + '>아니오</option>' +
        '<option value="unknown"' + (answers[key] === "unknown" ? ' selected' : '') + '>불명확</option></select></div>';
    }).join("");
    var src = cfg.source || {};
    var isOpen = a.status === "needs_confirmation" ? " open" : "";
    return '<details class="scope-card scope-' + esc(a.status) + '"' + isOpen + '><summary><strong>' + esc(a.label) +
      '</strong><span class="scope-conclusion">' + esc(SCOPE_CONCLUSION_LABELS[a.status] || "") + '</span>' +
      '<span class="scope-confidence">자동판정 · ' + esc(SCOPE_CONFIDENCE_LABELS[a.confidence] || "") + '</span>' +
      '<span class="scope-status">' + esc(SCOPE_STATUS_LABELS[a.status] || a.status) + '</span>' +
      '<span class="scope-edit-hint">판정 수정</span></summary>' +
      '<p class="scope-reason">' + esc(a.reason) + '</p>' +
      (evidence.length ? '<p class="scope-evidence">근거어: ' + esc(evidence.join(" · ")) + '</p>' : '') +
      '<div class="scope-factors">' + rows + '</div>' +
      '<p class="scope-source">판단기준: ' + esc(src.law || "") + ' ' + esc(src.article || "") +
      ' · 자동판정은 검토자가 위 요소별로 수정할 수 있습니다.</p></details>';
  }).join("");
  return legalAlertsHtml() + cards;
}
function bindScopeControls(root) {
  if (!root) return;
  root.querySelectorAll(".scope-answer").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var sid = sel.dataset.scope, key = sel.dataset.factor;
      if (!state.scopeAnswers[sid]) state.scopeAnswers[sid] = {};
      if (sel.value) state.scopeAnswers[sid][key] = sel.value;
      else delete state.scopeAnswers[sid][key];
      updateScopeAssessments();
      var assessed = state.scopeAssessments[sid];
      if (assessed) delete state.scopeModuleOverrides[assessed.module_id];
      applyScopeModuleDecisions();
      renderInputScreening();
      if (_analyzedOnce) { renderScreening(); runAnalysis(); }
    });
  });
}
function currentModuleList() {
  var doc = typeDoc(state.typeId);
  return (CR.common.meta.modules || []).concat(doc ? doc.meta.modules : [])
    // 국면 게이트(11차): 당사가 수범자가 아닌 국면에서는 그 규제 모듈 자체를 후보에서 제외.
    // 본문에 문구가 있어도(신탁계약의 "자산운용"·"모집") 의무주체가 제3자면 당사 검토항목이 아님.
    .filter(function (m) { return moduleAllowedInStance(m, state.stance, stanceCtx()); });
}
// 입력 탭 모듈 칩(11차) — 분석 전에 자동 추정값을 보여주고 검토자가 조정.
// 상태(state.activeModules)는 리포트 조정부와 공유하므로 양쪽 표시가 항상 일치.
function renderInputScreening() {
  var box = document.getElementById("input-screening");
  if (!box) return;
  renderInputSubdocUse();
  if (state.text.trim()) { updateScopeAssessments(); applyScopeModuleDecisions(); }
  var modList = currentModuleList();
  if (!state.text.trim() || !modList.length) {
    box.innerHTML = '<span class="setup-auto">계약서 본문을 넣으면 적용 모듈이 자동 추정됩니다.</span>';
    return;
  }
  var suggested = suggestModules(state.text, modList, screenOpts());
  // 아직 분석 전이면 자동 추정값으로 초기화, 분석 후엔 검토자가 조정한 현재값을 유지.
  if (!_analyzedOnce) {
    state.activeModules = modList
      .filter(function (m) { return m.always_on || suggested.on.indexOf(m.id) !== -1; })
      .map(function (m) { return m.id; });
  }
  box.innerHTML = scopeCardsHtml() + modList.map(function (m) {
    if (m.scope_rule) return ""; // 적용범위 카드가 결론·수정 UI를 전담 — 중복 모듈 칩은 숨김.
    if (m.always_on)
      return '<span class="module-chip fixed">' + esc(m.name) + " (기본)</span>";
    var on = state.activeModules.indexOf(m.id) !== -1;
    var sug = suggested.on.indexOf(m.id) !== -1;
    var askMode = suggested.ask.indexOf(m.id) !== -1;
    return '<label class="module-chip' + (on ? " on" : "") + (sug ? " suggested" : "") + (askMode ? " ask" : "") +
      '" data-mid="' + esc(m.id) + '" title="' + esc(m.screening_question || "") + '">' +
      esc(m.name) + (sug ? " ⚡본문 검출" : "") + (askMode ? " ? 확인 필요" : "") + "</label>";
  }).join("");
  bindScopeControls(box);
  box.querySelectorAll(".module-chip[data-mid]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      toggleModule(chip.dataset.mid);
      chip.classList.toggle("on");
      renderScreening(); // 리포트 조정부 칩 상태 동기화
    });
  });
}
// 모듈 토글 단일 처리 — 두 패널이 공유.
function toggleModule(mid) {
  var i = state.activeModules.indexOf(mid);
  if (i === -1) state.activeModules.push(mid); else state.activeModules.splice(i, 1);
  Object.keys(state.scopeAssessments || {}).forEach(function (sid) {
    if (state.scopeAssessments[sid].module_id === mid)
      state.scopeModuleOverrides[mid] = state.activeModules.indexOf(mid) !== -1;
  });
  if (_analyzedOnce) runAnalysis(); // 모듈 조정 시 즉시 재검토
}
// 직전 렌더의 모듈 후보 id — 국면·유형 변경으로 후보 집합이 바뀐 것을 감지해
// 사라진 모듈은 끄고 새로 생긴 모듈은 자동 제안을 적용하는 데 쓴다.
var _prevModuleIds = [];
function renderScreening() {
  updateScopeAssessments();
  applyScopeModuleDecisions();
  var modList = currentModuleList();
  var chips = "", askQs = "";
  if (!modList.length) {
    state.activeModules = [];
  } else {
    var suggested = suggestModules(state.text, modList, screenOpts());
    // 분석 전(입력 단계 지정 포함)에만 자동값으로 덮음 — 분석 후 조정값은 보존.
    if (!_analyzedOnce) {
      state.activeModules = modList
        .filter(function (m) { return m.always_on || suggested.on.indexOf(m.id) !== -1; })
        .map(function (m) { return m.id; });
    } else {
      // 분석 후라도 국면·유형이 바뀌면 모듈 집합 자체가 달라짐 — 후보에서 사라진 모듈은
      // 활성 목록에서 제거하고, 새로 후보가 된 모듈은 자동 제안값을 따른다.
      // (검토자가 손댄 토글은 후보로 남아 있는 한 그대로 보존)
      var ids = modList.map(function (m) { return m.id; });
      var kept = state.activeModules.filter(function (id) { return ids.indexOf(id) !== -1; });
      modList.forEach(function (m) {
        var wasCandidate = _prevModuleIds.indexOf(m.id) !== -1;
        if (!wasCandidate && (m.always_on || suggested.on.indexOf(m.id) !== -1) && kept.indexOf(m.id) === -1)
          kept.push(m.id);
      });
      state.activeModules = kept;
    }
    _prevModuleIds = modList.map(function (m) { return m.id; });
    chips = modList.map(function (m) {
      if (m.scope_rule) return ""; // 적용범위 카드와 같은 규정명을 중복 노출하지 않음.
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
      .filter(function (m) { return !m.scope_rule && suggested.ask.indexOf(m.id) !== -1 && m.screening_question; })
      .map(function (m) {
        return '<div class="ask-q">? <strong>' + esc(m.name) + "</strong> — " + esc(m.screening_question) +
          ' <span class="ask-q-hint">(본문 언급이 적어 자동 판단 불가 — 해당되면 위 칩을 켜세요)</span></div>';
      }).join("");
  }
  // 표준 부속서류 사용 체크(#B): 입력 단계와 같은 상태를 공유하며, 분석 후에도 조정 가능.
  var subRows = subdocUseRowsHtml("report");
  var screening = document.getElementById("screening");
  screening.innerHTML = scopeCardsHtml() + chips + askQs + subRows;
  bindScopeControls(screening);
  document.querySelectorAll("#screening .module-chip[data-mid]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      toggleModule(chip.dataset.mid);
      chip.classList.toggle("on");
      renderInputScreening(); // 입력 탭 칩 상태 동기화
    });
  });
  bindSubdocUseControls(screening, renderInputSubdocUse);
}

/* ---------- 분석 실행 ---------- */
// 유형·모듈 조건으로 검토 실행. 최초 분석 시작·유형변경·모듈토글 모두 이 함수를 호출(즉시 재검토).
var _analyzedOnce = false;
function runAnalysis(opts) {
  opts = opts || {};
  if (!state.clauses.length) return;
  var wasAnalyzed = _analyzedOnce;
  var activeTab = document.querySelector(".tab.active");
  var activeTabName = activeTab && activeTab.getAttribute("data-tab");
  var scrollY = window.scrollY;
  state.typeId = document.getElementById("checklist-type").value;
  captureInitialTypeDecision();
  updateScopeAssessments();
  applyScopeModuleDecisions();
  var docs = analysisDocs();
  state.result = analyze(state.clauses, docs, {
    modules: state.activeModules,
    stance: state.stance,
    baseClauses: state.baseClauses || [],
    docTitle: state.docTitle || "",     // 문서 성격 게이트(requires_doc_title)
    partyRoles: state.partyRoles || [], // 당사 지위 게이트(party_roles)
    partyContext: state.partyContext || null // 의무주체·회사 유불리 판정
  });
  snapshotRuleMatches(); // 사람 재지정 전에 원래 자동 Top1·coverage를 불변 원자료로 고정

  // 부속 서류 커버리지(#3): consider(필수 부재)로 뜬 항목이 부속서류에서 다뤄지는지.
  state.subDocCov = {};
  if (state.subDocs && state.subDocs.length) {
    var considerCps = state.result.results
      .filter(function (x) { return x.coverage === "consider"; })
      .map(function (x) { return _cpById(x.cpId); })
      .filter(Boolean);
    if (considerCps.length) {
      var model = buildModel(docs, state.activeModules, state.stance);
      var subs = state.subDocs.map(function (d) {
        return { name: d.name, clauses: segmentContract(d.text) };
      });
      state.subDocCov = subDocCoverage(considerCps, subs, model);
    }
  }

  // 별첨 참조(#4): 본문의 참조는 사실 증거로 보존하되 사용 확정으로 취급하지 않는다.
  // 검토자가 위 체크박스를 명시적으로 켜기 전에는 완료 판정·수정 불필요 판정을 만들지 않는다.
  var fullText = (state.clauses || []).map(function (cl) {
    return String(cl.heading || "") + " " + String(cl.body || "");
  }).join("\n"); // ↑ matcher.js analyze의 fullText 구성과 동일
  state.refCov = {};
  var subdocDefs = (CR.common.meta || {}).standard_subdocs || [];
  detectSubdocRefs(fullText, subdocDefs).forEach(function (ref) {
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

  // 형식 점검(#5): 당사 고유명사(상호·대표자·주소) 근사 오기 룰 검출 — 일반 오타·빈칸은 범위 밖
  state.formal = Formal.checkFormal(state.text);

  loadVerdicts();
  loadFindings();
  state.integrityFindings = Integrity.analyze(state.text, state.clauses, {
    subdocs: state.subDocs || []
  }).items;
  _verdictEditPins = {}; // 새 분석 컨텍스트에서는 저장된 이상없음 항목을 정상적으로 ②에 배치
  loadReassign(); // 수동 재지정 맵(11.7차)
  loadMatchConfirm(); // 자동 Top1을 검토자가 명시 확인한 기록
  _opinionEditing = false; // 재분석·해시 변경 시 종합 검토의견 편집 모드 해제
  applySubdocVerdicts();
  applyAutoVerdicts(); // 참고=확정 매칭, 권장=문장 요건 충족 → 이상없음 자동 기재(12차)
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
  document.getElementById("report-empty").hidden = true;
  document.getElementById("report-summary-bar").hidden = false;
  renderSummaryBar();
  // 최초 분석 버튼만 결과 탭으로 이동한다. 유형·모듈·부속서류 조정에 따른 재분석은
  // 사용자가 보고 있던 탭과 스크롤을 보존한다.
  if (!wasAnalyzed || opts.landing) {
    var landTab = pendingReviewCount() > 0 ? "clauses" : "report";
    if (opts.reveal !== false) prepareResultReveal(landTab);
    activatePane(landTab);
  } else if (activeTabName) {
    activatePane(activeTabName, { animate: false });
    window.scrollTo(0, scrollY);
    requestAnimationFrame(function () { window.scrollTo(0, scrollY); });
  }
  _analyzedOnce = true;
  if (localLlmEnabled()) scheduleLocalLlmReview();
}

/* ---------- 선택형 로컬 AI 교차검토 ---------- */
function localLlmEnabled() {
  var cb = document.getElementById("local-llm-enabled");
  return !!(cb && cb.checked);
}
function _setLocalLlmStatus(text, cls) {
  ["local-llm-status", "local-llm-header-status"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || "";
    el.className = "local-ai-status" + (cls ? " " + cls : "");
    if (id === "local-llm-header-status") el.hidden = !localLlmEnabled() || !state.result;
  });
  var rerun = document.getElementById("local-llm-rerun");
  if (rerun) rerun.hidden = !localLlmEnabled() || !state.result;
}
function _clearLocalLlmFindings() {
  ((state.result && state.result.results) || []).forEach(function (r) { delete r.localLlm; });
}
function scheduleLocalLlmReview() {
  _localLlmSeq++;
  var seq = _localLlmSeq;
  if (_localLlmTimer) clearTimeout(_localLlmTimer);
  _clearLocalLlmFindings();
  _setLocalLlmStatus("대기 중", "running");
  _localLlmTimer = setTimeout(function () { runLocalLlmReview(seq); }, 250);
}
function runLocalLlmReview(seq) {
  if (!localLlmEnabled() || !state.result || seq !== _localLlmSeq) return;
  var model = LocalLLM.getModel();
  var items = LocalLLM.buildBatch(state.result.results, state.result.checkpoints, state.clauses,
    model === "qwen3:14b" ? 2 : 12);
  if (!items.length) { _setLocalLlmStatus("검토 후보 없음", "ready"); return; }
  _setLocalLlmStatus(model + " 검토 중 · " + items.length + "건", "running");
  LocalLLM.review(window.fetch.bind(window), appRuntimeLocation(), items).then(function (response) {
    if (seq !== _localLlmSeq || !state.result) return;
    LocalLLM.attach(state.result.results, response);
    _setLocalLlmStatus("교차검토 " + response.findings.length + "건 · " +
      (response.duration_ms ? (response.duration_ms / 1000).toFixed(1) + "초" : "완료"), "ready");
    renderClauses();
    renderSuggestions();
  }).catch(function () {
    if (seq !== _localLlmSeq) return;
    _setLocalLlmStatus("연결 실패", "error");
  });
}
function initLocalLlm() {
  var cb = document.getElementById("local-llm-enabled");
  var rerun = document.getElementById("local-llm-rerun");
  var modelSelect = document.getElementById("local-llm-model");
  if (!cb) return;
  try {
    cb.checked = localStorage.getItem(LOCAL_LLM_KEY) === "1";
    if (modelSelect) modelSelect.value = LocalLLM.setModel(localStorage.getItem(LOCAL_LLM_MODEL_KEY) || LocalLLM.MODEL);
  } catch (e) {}
  if (modelSelect) modelSelect.addEventListener("change", function () {
    LocalLLM.setModel(modelSelect.value);
    try { localStorage.setItem(LOCAL_LLM_MODEL_KEY, modelSelect.value); } catch (e) {}
    if (cb.checked && state.result) scheduleLocalLlmReview();
  });
  cb.addEventListener("change", function () {
    try { localStorage.setItem(LOCAL_LLM_KEY, cb.checked ? "1" : "0"); } catch (e) {}
    if (!cb.checked) {
      _localLlmSeq++;
      _clearLocalLlmFindings();
      _setLocalLlmStatus("꺼짐", "");
      if (state.result) { renderClauses(); renderSuggestions(); }
      return;
    }
    LocalLLM.health(window.fetch.bind(window), appRuntimeLocation()).then(function (h) {
      if (!h.available) {
        _setLocalLlmStatus(h.reason === "local_server_required" ? "로컬 서버로 실행 필요" : "Ollama 연결 안 됨", "error");
        return;
      }
      var available = h.available_models || [];
      if (available.length && available.indexOf(LocalLLM.getModel()) === -1) {
        _setLocalLlmStatus(LocalLLM.getModel() + " 다운로드 필요", "error");
        return;
      }
      _setLocalLlmStatus(LocalLLM.getModel() + " 연결됨", "ready");
      if (state.result) scheduleLocalLlmReview();
    });
  });
  if (rerun) rerun.addEventListener("click", function () { if (localLlmEnabled()) scheduleLocalLlmReview(); });
  if (cb.checked) cb.dispatchEvent(new Event("change"));
  else _setLocalLlmStatus("꺼짐", "");
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
  // 검토 국면·원계약 전제는 결과 해석의 전제조건이라 요약 줄에 항상 노출(11차).
  var parts = [_contractName(), state.clauses.length + "조항",
    "유형: " + (doc ? doc.meta.type_name : "미확정")];
  if (state.stance === "beneficiary") parts.push("국면: 수익자·투자자");
  if (state.baseClauses && state.baseClauses.length)
    parts.push("원계약 전제(" + state.baseClauses.length + "조항)");
  line.textContent = parts.join(" · ");
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
// 다시 분석 — 계약서 입력 탭으로 이동(본문·부속서류가 보존되어 있어 수정 후 재분석).
document.getElementById("btn-reanalyze").addEventListener("click", function () {
  document.querySelector('.tab[data-tab="input"]').click();
});

/* ---------- 검토의견 지식 루프(#4) — cpId 단위 누적 코퍼스 ----------
   여러 계약서 검토의견을 쌓아 판정 분포·코멘트 추천 제공. 저장키 cr-loop-corpus. */
var LOOP_KEY = "cr-loop-corpus";
var LOOP_RESET_KEY = "cr-loop-corpus-reset";
var LOOP_RESET_VERSION = "2026-08-06-empty";
var loopCorpus = Loop.emptyCorpus();
try {
  // 구·신 누적 코퍼스 초기화: 요청한 기준일 이후 한 번만 기존 localStorage seed를 제거한다.
  if (localStorage.getItem(LOOP_RESET_KEY) !== LOOP_RESET_VERSION) {
    localStorage.removeItem(LOOP_KEY);
    localStorage.setItem(LOOP_RESET_KEY, LOOP_RESET_VERSION);
  }
  loopCorpus = Loop.normalizeCorpus(JSON.parse(localStorage.getItem(LOOP_KEY)) || Loop.emptyCorpus());
} catch (e) {}
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
  var meta = { type_id: state.typeId, date: verdictToday(), contract_hash: verdictHash, reviewer: getReviewer(),
    app_version: CR.app_version || "", stance: state.stance, party_roles: state.partyRoles || [],
    party_context: state.partyContext || null, active_modules: state.activeModules || [] };
  loopCorpus = Loop.mergeIntoCorpus(loopCorpus,
    currentVerdictExport(meta));
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
  // 폐쇄망 무반응 보고(2026-08-20): ① 파일명에 날짜·건수를 박아 "(3)" 같은 중복 사본과
  // 구버전 혼동 방지 ② anchor를 DOM에 붙였다 떼고 revoke를 지연 — 일부 브라우저·보안환경에서
  // 미부착 anchor 클릭/즉시 revoke가 다운로드를 조용히 무산시킴 ③ 성공 메시지 표기 —
  // 종전엔 아무 피드백이 없어 다운로드가 조용히 저장되면 "반응 없음"으로 읽혔음.
  a.href = url;
  a.download = "contract-review-corpus-backup_" + verdictToday() + "_" +
    (loopCorpus.meta.contract_count || 0) + "건.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  var msg = document.getElementById("team-actions-msg");
  if (msg) msg.textContent = "코퍼스 백업 파일 생성됨(계약 " + (loopCorpus.meta.contract_count || 0) +
    "건, 기준일 " + (loopCorpus.meta.updated || "-") + ") — 저장이 안 보이면 브라우저 다운로드 목록(Ctrl+J)과 차단 아이콘을 확인하세요";
}
// 코퍼스 백업 복원 — 형태 검증 후 통째 교체.
function restoreCorpusBackup(file, done) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var obj = JSON.parse(reader.result);
      if (obj && obj.meta && obj.byCheck) {
        loopCorpus = Loop.normalizeCorpus(obj);
        saveCorpus();
        done(true);
        return;
      }
    } catch (e) {}
    done(false);
  };
  reader.readAsText(file);
}

/* ---------- 조항별 검토의견(verdict) — 계약서 건별 판정 축 ----------
   '검수'(verified: 지식 정확성)와 별개. 이 계약서의 이 항목이 이상없음(사유 선택)/검토의견.
   저장키 cr-verdict-<계약서해시>. */
var verdictStore = {};
var verdictHash = "";
// 이상없음 판정 직후 사유·메모 입력을 마칠 때까지 ③ 작업 칸에 카드를 고정한다.
// 저장 데이터가 아니라 현재 편집 세션의 UI 상태이므로 재분석·새로고침 시 초기화된다.
var _verdictEditPins = {};
function loadVerdicts() {
  verdictHash = hashText(state.text || "");
  try { verdictStore = JSON.parse(localStorage.getItem(Verdict.verdictKey(verdictHash)) || "{}"); }
  catch (e) { verdictStore = {}; }
  // 구 '해당없음' 판정 자동 이관(11.3차) — 이상없음 + 사유 '해당사항 없음'.
  verdictStore = Verdict.migrateStore(verdictStore);
}
function saveVerdicts() {
  localStorage.setItem(Verdict.verdictKey(verdictHash), JSON.stringify(verdictStore));
}
function findingKey(hash) { return "cr-findings-" + hash; }
function loadFindings() {
  try { state.findingStore = Findings.normalizeStore(JSON.parse(localStorage.getItem(findingKey(verdictHash)) || "{}")); }
  catch (e) { state.findingStore = Findings.emptyStore(); }
}
function saveFindings() {
  localStorage.setItem(findingKey(verdictHash), JSON.stringify(Findings.normalizeStore(state.findingStore)));
}
function applyVerdict(cpId, verdict, comment, reason, origin) {
  verdictStore = Verdict.setVerdict(verdictStore, cpId, verdict, comment, verdictToday(), reason, origin || "manual");
  saveVerdicts();
}
// 이상없음의 사유만 변경(판정 유지).
function applyReason(cpId, reason) {
  verdictStore = Verdict.setReason(verdictStore, cpId, reason);
  saveVerdicts();
}
function applyActionDisposition(cpId, disposition) {
  verdictStore = Verdict.setActionDisposition(verdictStore, cpId, disposition);
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
      var fill = Verdict.bulkVerdictComment(verdictStore, ids, "이상없음", cmt, verdictToday(), "", "subdoc");
      if (fill.applied) { verdictStore = fill.store; changed = true; }
    } else {
      var rm = Verdict.revertBulkVerdict(verdictStore, ids, "이상없음", cmt);
      if (rm.removed) { verdictStore = rm.store; changed = true; }
    }
  });
  if (changed) saveVerdicts();
}
// 자동 판정(12차, 2026-08-19~20 피드백): "자동판정이 더 공격적이어야 한다"는 지시에 따라
// 심각도별로 차등 적용. verify(매칭 불확실)는 어느 심각도든 자동 기재하지 않음 —
// 틀린 이상없음은 누락이라 실패 비용이 비대칭이므로 확정 매칭(addressed)만 대상.
//   참고: auto_clear 미선언 체크는 확정 매칭이면 자동 이상없음. 선언 체크는 문장 요건도 통과해야 함
//   권장: 확정 매칭 + 문장 요건 충족(auto_clear — 키워드·숫자·긍정 종결을 한 문장에서 확인)이면 자동 이상없음
//   필수: 자동 기재 안 함 — 문장 요건 충족 시 "빠른 확인" 원클릭 제안만
// 사람이 찍었거나 손댄 판정은 불변(origin이 manual로 바뀜). 재분석으로 자격을 잃은
// 자동 기재분은 origin 기준으로 회수(코멘트가 문장 인용이라 계약서마다 달라 origin이 유일한 기준).
var AUTO_REF_COMMENT = "참고 항목 — 관련 문구가 계약서에서 확인되어 자동 기재됨";
function _autoClearOk(r) { return !!(r && r.autoClear && r.autoClear.ok); }
function _autoClearComment(r) {
  var s = String((r.autoClear && r.autoClear.sentence) || "");
  if (s.length > 100) s = s.slice(0, 100) + "…";
  return "요건 문장 확인 — “" + s + "” (자동 기재)";
}
function _autoPerspectiveComment(r) {
  return String((r.perspective && r.perspective.reason) || "당사 관점상 수정 불필요") + " (자동 기재)";
}
// 필수 항목의 원클릭 확인 대상 여부 — 자동 기재는 하지 않되 빠른 확인으로 제안.
function _sentenceQuick(r) {
  var cp = _cpById(r.cpId);
  return !!(cp && cp.severity === "필수" && r.coverage === "addressed" && _autoClearOk(r));
}
function applyAutoVerdicts() {
  var qualify = {}; // cpId → {comment, reason}
  ((state.result && state.result.results) || []).forEach(function (r) {
    var cp = _cpById(r.cpId);
    if (!Verdict.canAutoPass(cp, r)) return;
    if (r.perspective && r.perspective.auto_pass)
      qualify[r.cpId] = { comment: _autoPerspectiveComment(r), reason: "회사에 유리·불리하지 않음" };
    else if (cp.severity === "참고" && !cp.auto_clear)
      qualify[r.cpId] = { comment: AUTO_REF_COMMENT, reason: "반영되어 있음" };
    else qualify[r.cpId] = { comment: _autoClearComment(r), reason: "반영되어 있음" };
  });
  var changed = false;
  var rm = Verdict.revertAutoVerdicts(verdictStore, Object.keys(qualify));
  if (rm.removed) { verdictStore = rm.store; changed = true; }
  Object.keys(qualify).forEach(function (cpId) {
    var cur = verdictStore[cpId];
    if (cur && cur.verdict) return; // 기판정 보존(사람 판정·기존 자동 기재 모두)
    verdictStore = Verdict.setVerdict(verdictStore, cpId, "이상없음", qualify[cpId].comment,
      verdictToday(), qualify[cpId].reason, "auto");
    changed = true;
  });
  if (changed) saveVerdicts();
}
function verdictToday() {
  var d = new Date();
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}
var VERDICT_CLS = { "이상없음": "vd-ok", "검토의견": "vd-comment" };
// 지식 루프(#4) — 이 cpId의 과거 판정 분포 + 추천 코멘트. 없으면 빈 문자열.
// P2: 카드 높이 절약을 위해 1줄 요약(최빈 판정·비율)으로 접힘 — 접기 금지 원칙의 예외 허용 대상(spec §4.3).
function loopInfoHtml(cpId) {
  var st = Loop.checkStats(loopCorpus, cpId);
  if (!st) return "";
  var topV = Loop.VERDICTS[0];
  Loop.VERDICTS.forEach(function (v) { if (st.dist[v] > st.dist[topV]) topV = v; });
  var top = Loop.topComments(loopCorpus, cpId, 3);
  var summary = "과거 검토 " + st.n + "건 · " + topV.slice(0, 2) + " " + st.pct[topV] + "%" +
    (top.length ? " · 추천 의견 " + top.length : "") + (st.lowSample ? " (표본 적음)" : "");
  var h = '<details class="loop-info loop-fold"><summary>' + esc(summary) + "</summary>";
  h += '<span class="loop-dist">과거 검토(n=' + st.n + (st.lowSample ? ", 표본 적음" : "") + "): ";
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
  var sum = Loop.corpusSummary(loopCorpus);
  var signatureMap = {};
  [CR.common].concat(CR.types || []).forEach(function (doc) {
    (doc && doc.checks || []).forEach(function (cp) {
      signatureMap[cp.id] = cp.tag_signature || {};
    });
  });
  var tagProposals = Loop.tagLearningProposals(loopCorpus, signatureMap,
    { minN: 5, support: 0.8, minNegative: 3 });
  function _name(cpId) {
    var cp = _cpById(cpId);
    return cp ? String(labelQ(cp)).replace(/<[^>]+>/g, " ").trim() : cpId;
  }
  function _pct(v) { return v == null ? "-" : Math.round(v * 100) + "%"; }
  var h = '<details class="curation-panel"><summary>정확도·검토효율 현황</summary>' +
    '<div class="corpus-metrics">' +
      '<div><b>' + sum.contracts + '</b><span>누적 계약서</span></div>' +
      '<div><b>' + sum.verdicts + '</b><span>누적 판정</span></div>' +
      '<div><b>' + _pct(sum.issue_rate) + '</b><span>검토의견 비율</span></div>' +
      '<div><b>' + sum.route_checks.detailed + '</b><span>정밀검토 항목</span></div>' +
      '<div><b>' + sum.route_checks.applicability + '</b><span>적용성 확인 항목</span></div>' +
      '<div><b>' + sum.route_checks.quick + '</b><span>빠른확인 항목</span></div>' +
    '</div>' +
    '<div class="matching-metrics"><b>조항 매칭 검증</b> · 표본 ' + sum.matching.observed + '건';
  if (sum.matching.observed) {
    h += ' · Top1 정확도 ' + _pct(sum.matching.top1_accuracy) +
      ' · Top3 포함률 ' + _pct(sum.matching.top3_recall) +
      ' · 사람 재지정률 ' + _pct(sum.matching.reassignment_rate);
  } else {
    h += '<span class="curation-hint"> · 다음 검토부터 조항 확인·재지정 기록이 누적됩니다.</span>';
  }
  h += '</div>';
  var ts = Loop.typeClassificationStats(loopCorpus);
  h += '<div class="matching-metrics"><b>계약 유형 분류</b> · 비교 표본 ' + ts.observed + '건';
  if (ts.auto_evaluable) {
    h += ' · 자동 일치율 ' + _pct(ts.accuracy) + ' · 검토자 변경 ' + ts.corrected + '건';
  }
  if (ts.rescued_from_undetermined)
    h += ' · 자동 미확정 후 사람 선택 ' + ts.rescued_from_undetermined + '건';
  if (!ts.observed)
    h += '<span class="curation-hint"> · 이번 버전부터 최초 자동분류와 최종 유형을 함께 축적합니다.</span>';
  h += '</div>';
  var ad = sum.action_disposition;
  h += '<div class="matching-metrics"><b>계약서 반영 안내와 실제 처리 비교</b> · 처리 결과 표본 ' + ad.observed + '건';
  if (ad.evaluable) {
    h += ' · 비교 가능 ' + ad.evaluable + '건 · 안내 일치율 ' + _pct(ad.agreement_rate) +
      ' · 수정 안내가 과했을 가능성 ' + ad.unnecessary_modify_candidates + '건' +
      ' · 수정 안내가 빠졌을 가능성 ' + ad.missed_modify_candidates + '건';
  } else {
    h += '<span class="curation-hint"> · 계약서 수정 요청·문구 삭제 요청·별도 자료 확인 등의 실제 처리 결과가 누적되면 일치율을 계산합니다.</span>';
  }
  h += '</div><p class="curation-hint">안내 일치율은 결과를 비교할 수 있는 표본만 사용합니다. 회사 유불리 검토와 추가 확인 후 결정은 정답률 분모에서 제외합니다. 판정 분포로 검토 경로를 조정하되 자동 확정하지 않습니다. 아래 후보는 큐레이터가 지식 조건을 조정할 때 사용하는 누적 신호입니다.</p>';
  var la = sum.llm_assistance;
  h += '<div class="matching-metrics"><b>로컬 AI 효용</b> · 분석 ' + la.analyzed + '건' +
    ' · 초안 제시 ' + la.draft_offered + '건 · 채택 ' + la.draft_accepted + '건' +
    (la.draft_offered ? ' (' + _pct(la.acceptance_rate) + ')' : '') +
    (la.draft_accepted ? ' · 무수정 채택 ' + la.accepted_unchanged + '건 (' + _pct(la.unchanged_rate) + ')' : '') +
    '</div>';
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
  if (!sig.conditional.length && !sig.gold.length) {
    h += '<p class="curation-empty">표본 기준을 충족한 지식 정규화 후보가 아직 없습니다.</p>';
  }
  function _tagName(facet, tag) {
    var def = CR.tag_taxonomy && CR.tag_taxonomy.facets &&
      CR.tag_taxonomy.facets[facet] && CR.tag_taxonomy.facets[facet][tag];
    return def && def.label ? def.label : tag;
  }
  var approvedN = tagProposals.filter(function (p) {
    return p.decision && p.decision.decision === "approved";
  }).length;
  h += '<div class="curation-group tag-learning-group"><h5>구조태그 개선 후보</h5>' +
    '<p class="curation-hint">검토자가 확인·재지정한 정답 조항이 5건 이상 쌓이고 같은 태그가 80% 이상 반복될 때만 제시합니다. 승인안은 다음 배포의 회귀테스트를 통과한 뒤 반영됩니다.</p>';
  if (tagProposals.length) {
    h += tagProposals.map(function (p) {
      var decision = p.decision && p.decision.decision || "";
      var add = p.additions.map(function (x) {
        return _tagName(x.facet, x.tag) + " " + Math.round(x.ratio * 100) + "%";
      }).join(" · ");
      var avoid = p.avoid.map(function (x) {
        return _tagName(x.facet, x.tag) + " " + Math.round(x.ratio * 100) + "%";
      }).join(" · ");
      return '<div class="tag-proposal"><div><b>' + esc(_name(p.cpId)) + '</b>' +
        '<span class="cur-stat">표본 ' + p.n + '건 · 재지정 ' + p.reassigned + '건</span></div>' +
        (add ? '<p>추가 후보: ' + esc(add) + '</p>' : '') +
        (avoid ? '<p>혼동 태그 후보: ' + esc(avoid) + '</p>' : '') +
        '<div class="tag-proposal-actions"><button class="ghost tag-proposal-decision" data-key="' + esc(p.key) +
        '" data-decision="approved">' + (decision === "approved" ? "승인됨" : "승인") + '</button>' +
        '<button class="ghost tag-proposal-decision" data-key="' + esc(p.key) +
        '" data-decision="held">' + (decision === "held" ? "보류됨" : "보류") + '</button></div></div>';
    }).join("");
    if (approvedN) h += '<button id="tag-proposals-export" class="ghost">승인한 태그 개선안 내보내기 (' + approvedN + ')</button>';
  } else {
    h += '<p class="curation-empty">아직 표본 기준을 충족한 구조태그 개선 후보가 없습니다.</p>';
  }
  h += '</div>';
  return h + "</details>";
}

function currentTagProposals() {
  var signatureMap = {};
  [CR.common].concat(CR.types || []).forEach(function (doc) {
    (doc && doc.checks || []).forEach(function (cp) { signatureMap[cp.id] = cp.tag_signature || {}; });
  });
  return Loop.tagLearningProposals(loopCorpus, signatureMap,
    { minN: 5, support: 0.8, minNegative: 3 });
}
function exportApprovedTagProposals() {
  var approved = currentTagProposals().filter(function (p) {
    return p.decision && p.decision.decision === "approved";
  });
  if (!approved.length) return;
  var payload = { format: "cr-tag-proposals-v1", generated: verdictToday(),
    app_version: CR.app_version || "", profile_version: ContractTags.PROFILE_VERSION || "",
    reviewer: getReviewer(), regression_required: ["shadow", "assist"], proposals: approved };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "tag-improvement-approved_" + verdictToday().replace(/-/g, "") + ".json";
  a.click(); URL.revokeObjectURL(url);
}
// cpId에 대한 판정 버튼 + 코멘트 입력 HTML. 현재 판정 활성 표시.
// skipLoop: 같은 행 ③ 카드처럼 loop 힌트 중복 노출이 소음인 곳에서 생략.
function verdictControlHtml(cpId, skipLoop) {
  var cur = verdictStore[cpId] || {};
  var systemResult = resultFor(_cpById(cpId));
  var suggestedAction = systemResult ? actionForResult(systemResult) : null;
  // 2행 배치(11.5차 사용자 요청): 판정 1건이 한 줄을 차지하고, 그 줄에 딸린 입력(사유·메모)이
  // 옆에 붙음. 종전 1행 나열은 어느 입력이 어느 판정에 딸린 것인지 읽히지 않았음.
  //   [이상없음] [사유 선택 ▾] [확인 메모]
  //   [검토의견] [검토의견 메모]
  var rows = Verdict.VERDICTS.map(function (v) {
    var on = cur.verdict === v ? " active " + VERDICT_CLS[v] : "";
    var btn = '<button class="vd-btn' + on + '" data-vcp="' + esc(cpId) + '" data-vd="' + esc(v) + '">' + esc(v) + "</button>";
    var side = "";
    if (v === "이상없음") {
      // 사유 선택 — 구 '해당없음' 독립 판정을 대체. 이상없음 선택 시에만 활성.
      var disabled = cur.verdict === "이상없음" ? "" : " disabled";
      side += '<select class="vd-reason" data-vcp="' + esc(cpId) + '" name="vd-reason-' + esc(cpId) +
        '" aria-label="이상없음 사유"' + disabled + ">" +
        '<option value="">사유 선택(선택사항)</option>' +
        Verdict.OK_REASONS.map(function (rs) {
          return '<option value="' + esc(rs) + '"' + (cur.reason === rs ? " selected" : "") + ">" + esc(rs) + "</option>";
        }).join("") + "</select>";
      side += '<input class="vd-note' + (cur.verdict === "이상없음" ? " show" : "") + '" data-vcp="' + esc(cpId) +
        '" data-vfor="이상없음" name="vd-note-ok-' + esc(cpId) + '" aria-label="확인 메모"' +
        ' placeholder="확인 메모(선택)" value="' +
        esc(cur.verdict === "이상없음" ? (cur.comment || "") : "") + '"' + disabled + ">";
    } else {
      var dis2 = cur.verdict === "검토의견" ? "" : " disabled";
      side += '<input class="vd-note' + (cur.verdict === "검토의견" ? " show" : "") + '" data-vcp="' + esc(cpId) +
        '" data-vfor="검토의견" name="vd-note-op-' + esc(cpId) + '" aria-label="검토의견 메모"' +
        ' placeholder="검토의견 메모" value="' +
        esc(cur.verdict === "검토의견" ? (cur.comment || "") : "") + '"' + dis2 + ">";
    }
    return '<div class="vd-row">' + btn + '<span class="vd-side">' + side + "</span></div>";
  }).join("");
  // 자동 기재분 표시(투명성): 사람이 손대면 origin이 바뀌거나 보존 규칙이 지켜지므로 배지는 auto에만.
  var autoNote = cur.origin === "auto"
    ? '<span class="vd-auto-note">자동 기재 — 판정 버튼으로 해제·변경 가능</span>' : "";
  var editDone = cur.verdict === "이상없음" && _verdictEditPins[cpId]
    ? '<button class="ghost vd-edit-done" data-vcp="' + esc(cpId) + '">입력 완료 → ②로 이동</button>' : "";
  // 실제 처리 결과는 검토 자체의 필수 입력이 아니라 정확도 측정용 피드백이다.
  // 본 검토 흐름과 혼동하지 않도록 기본 접힘으로 두되, 이미 입력한 항목은 다시 찾기 쉽게 펼친다.
  var actionGuidance = suggestedAction && suggestedAction.action !== "no_action"
    ? '<div class="vd-action-guidance">권장 처리: ' + esc(suggestedAction.label) + '</div>' : "";
  var feedbackSummary = '정확도 개선용 피드백 <span>(선택사항' +
    (cur.action_disposition ? ' · 입력됨' : '') + ')</span>';
  var actionSelect = '<details class="vd-feedback"' + (cur.action_disposition ? " open" : "") + '>' +
    '<summary>' + feedbackSummary + '</summary>' +
    '<div class="vd-action-row"><label>실제 처리 결과 <select class="vd-action" data-vcp="' + esc(cpId) + '"' +
    (cur.verdict ? "" : " disabled") + '><option value="">선택</option>' +
    Verdict.ACTION_DISPOSITIONS.map(function (a) {
      return '<option value="' + esc(a) + '"' + (cur.action_disposition === a ? " selected" : "") + '>' +
        esc(Verdict.ACTION_DISPOSITION_LABELS[a] || a) + '</option>';
    }).join("") + '</select></label>' +
    '<span class="vd-feedback-note">선택하지 않아도 검토 완료와 리포트에는 영향이 없습니다.</span>' +
    (!cur.verdict ? '<span class="vd-feedback-note">먼저 이상없음 또는 검토의견을 선택해 주세요.</span>' : '') +
    '</div></details>';
  return '<div class="verdict-ctl vc-rows">' + rows + actionGuidance + actionSelect + autoNote + editDone + "</div>" +
    (skipLoop ? "" : loopInfoHtml(cpId));
}
// 판정 직후 재렌더로 카드·행 높이가 바뀌면 화면이 밀려 "다음 조항으로 휙 넘어간" 것처럼
// 보인다(2026-08-18 피드백). 재렌더 전에 판정한 컨트롤의 뷰포트 위치를 기억했다가,
// 재렌더 후 같은 컨트롤이 같은 화면 위치에 오도록 스크롤을 보정한다.
// rootSel: 보이는 탭의 컨테이너로 한정(같은 cpId 컨트롤이 숨은 탭에도 렌더되므로).
function withVerdictAnchor(rootSel, cpId, rerenderFn) {
  var sel = rootSel + ' .vd-btn[data-vcp="' + cpId + '"]';
  var el = cpId ? document.querySelector(sel) : null;
  var top = el ? el.getBoundingClientRect().top : null;
  rerenderFn();
  if (top === null) return;
  requestAnimationFrame(function () {
    var el2 = document.querySelector(sel);
    if (!el2) return;
    var r2 = el2.getBoundingClientRect();
    // 카드가 닫힌 접힘(② 확인 완료) 안으로 이동하면 rect가 0 — 보정하지 않음(현 위치 유지).
    if (!r2.top && !r2.height) return;
    window.scrollBy(0, r2.top - top);
  });
}
// 조항별 보기·리포트 공용 — 판정 버튼 클릭·코멘트 저장 바인딩.
// reRender(cpId): 저장 후 호출 — cpId는 스크롤 앵커 보정용(무시해도 무방).
function bindVerdictControls(root, reRender) {
  function focusVisible(selector) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetParent !== null) { nodes[i].focus(); return; }
    }
  }
  root.querySelectorAll(".local-ai-use-draft").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cpId = btn.getAttribute("data-vcp");
      var result = ((state.result && state.result.results) || []).filter(function (r) { return r.cpId === cpId; })[0];
      var draft = result && result.localLlm && result.localLlm.draft_comment;
      if (!draft) return;
      result.localLlm.draft_accepted = true;
      result.localLlm.draft_accepted_at = verdictToday();
      _llmAcceptedDrafts[(verdictHash || "") + "::" + cpId] = JSON.parse(JSON.stringify(result.localLlm));
      applyVerdict(cpId, "검토의견", draft, "", "llm_draft");
      if (reRender) reRender(cpId);
    });
  });
  root.querySelectorAll(".vd-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cp = btn.getAttribute("data-vcp"), v = btn.getAttribute("data-vd");
      var cur = verdictStore[cp] || {};
      // 같은 판정 다시 누르면 취소(토글)
      var next = cur.verdict === v ? "" : v;
      if (next === "이상없음") _verdictEditPins[cp] = true;
      else delete _verdictEditPins[cp];
      // 다른 판정으로 전환하면 그 판정의 메모가 따로 있으므로 코멘트는 승계하지 않음.
      // 같은 판정 재선택(취소)이거나 동일 판정 유지면 기존 코멘트·사유 보존.
      var keep = (next === cur.verdict);
      applyVerdict(cp, next, keep ? (cur.comment || "") : "", keep ? cur.reason : "");
      if (reRender) reRender(cp);
      // 이상없음 사유부터 바로 입력할 수 있게 새로 그린 동일 컨트롤로 포커스를 돌린다.
      if (next === "이상없음") requestAnimationFrame(function () {
        focusVisible('.vd-reason[data-vcp="' + cp + '"]');
      });
    });
  });
  root.querySelectorAll(".vd-reason").forEach(function (sel) {
    sel.addEventListener("change", function () {
      applyReason(sel.getAttribute("data-vcp"), sel.value);
      if (reRender) reRender(sel.getAttribute("data-vcp"));
      requestAnimationFrame(function () {
        focusVisible('.vd-note[data-vcp="' + sel.getAttribute("data-vcp") + '"][data-vfor="이상없음"]');
      });
    });
  });
  root.querySelectorAll(".vd-action").forEach(function (sel) {
    sel.addEventListener("change", function () {
      applyActionDisposition(sel.getAttribute("data-vcp"), sel.value);
      if (reRender) reRender(sel.getAttribute("data-vcp"));
    });
  });
  root.querySelectorAll(".vd-edit-done").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cp = btn.getAttribute("data-vcp");
      delete _verdictEditPins[cp];
      if (reRender) reRender(cp);
    });
  });
  root.querySelectorAll(".vd-note").forEach(function (inp) {
    function saveNote() {
      var cp = inp.getAttribute("data-vcp");
      var cur = verdictStore[cp] || {};
      // 행별 메모(11.5차): 각 입력은 자기 행의 판정에 속함 — 코멘트만 입력해도
      // 그 행의 판정으로 확정된다(이상없음 줄 메모 → 이상없음).
      var v = inp.getAttribute("data-vfor") || cur.verdict || "검토의견";
      applyVerdict(cp, v, inp.value, v === "이상없음" ? cur.reason : "");
    }
    // 긴 문서에서 다른 조작으로 재렌더되더라도 타이핑 내용이 사라지지 않도록 지연 저장한다.
    inp.addEventListener("input", function () {
      clearTimeout(inp._saveTimer);
      inp._saveTimer = setTimeout(saveNote, 250);
    });
    inp.addEventListener("change", function () {
      clearTimeout(inp._saveTimer);
      saveNote();
      if (reRender) reRender(inp.getAttribute("data-vcp"));
    });
  });
  // 추천 코멘트 클릭 → 코멘트 재사용(#4 루프 활용). 판정 없으면 검토의견으로.
  root.querySelectorAll(".loop-c").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cp = btn.getAttribute("data-vcp"), text = btn.getAttribute("data-ct");
      var cur = verdictStore[cp] || {};
      applyVerdict(cp, cur.verdict || "검토의견", text);
      if (reRender) reRender(cp);
    });
  });
  // 전년 검토 인용 수용(비교 모드) — 1클릭으로 전년 판정·코멘트 기재(date 오늘, 꼬리표 부착).
  root.querySelectorAll(".carry-accept").forEach(function (btn) {
    btn.addEventListener("click", function () {
      acceptCarry(btn.getAttribute("data-vcp"));
      if (reRender) reRender(btn.getAttribute("data-vcp"));
    });
  });
}

// 검토의견 내보내기/불러오기 (계약서 건별 JSON)
/* ---------- 앱 내장 골드셋(폐쇄망) — 스냅샷 저장·일괄 채점 ----------
   실계약은 반출 불가 → 케이스(본문 포함)는 폐쇄망 공유폴더에만 축적, 채점은 앱 안에서.
   반출은 summaryText(본문 0자)만. 순수 로직은 goldset.js. */
function _goldsetEnv() {
  return { CR: CR, segmentContract: segmentContract, detectType: detectType,
    pickType: pickType, suggestModules: suggestModules, analyze: analyze,
    assessScopes: ScopeAssessment.assessAll };
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
  if (state.historyRef) caseObj.history_reference = {
    review_id: state.historyRef.review_id || "", id_quality: state.historyRef.id_quality || ""
  };
  var blob = new Blob([JSON.stringify(caseObj, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "goldset_" + (state.typeId || "undetermined") + "_" + verdictHash + "_" + verdictToday() + ".json";
  a.click(); URL.revokeObjectURL(url);
}

/* ---------- LLM 매칭 실험 — 누적 코퍼스와 분리된 문서별 반출 ---------- */
function _experimentDownload(obj, suffix) {
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = (verdictHash || "document") + "_" + suffix + ".json";
  a.click();
  URL.revokeObjectURL(url);
}
function exportExperimentPredictions() {
  if (!state.result) return;
  var obj = Experiment.buildPredictions({
    documentId: verdictHash, contractHash: verdictHash, typeId: state.typeId,
    generated: verdictToday(), appVersion: CR.app_version || "", model: LocalLLM.getModel(),
    results: state.result.results, checkpoints: state.result.checkpoints, clauses: state.clauses
  });
  _experimentDownload(obj, "matching-predictions");
  var reviewed = obj.items.filter(function (item) { return item.llm_reviewed; }).length;
  var msg = document.getElementById("experiment-actions-msg");
  if (msg) msg.textContent = "예측 반출 완료 · LLM 쌍대 채점 가능 " + reviewed + "/" + obj.items.length + "건";
}
function exportExperimentGoldTemplate() {
  if (!state.result) return;
  var obj = Experiment.buildGoldTemplate({
    documentId: verdictHash, contractHash: verdictHash, typeId: state.typeId,
    created: verdictToday(), results: state.result.results,
    checkpoints: state.result.checkpoints, clauses: state.clauses
  });
  _experimentDownload(obj, "matching-gold");
  var msg = document.getElementById("experiment-actions-msg");
  if (msg) msg.textContent = "블라인드 골드 템플릿 반출 완료 · 규칙·LLM 예측값 미포함";
}
function runFullExperimentLlmReview() {
  if (!state.result || _experimentLlmRunning) return;
  _experimentLlmRunning = true;
  _localLlmSeq++;
  var seq = _localLlmSeq;
  _clearLocalLlmFindings();
  var batches = LocalLLM.buildBatches(
    state.result.results, state.result.checkpoints, state.clauses,
    LocalLLM.getModel() === "qwen3:14b" ? 2 : 4
  );
  var total = batches.reduce(function (n, batch) { return n + batch.length; }, 0);
  var completed = 0;
  var duration = 0;
  var msg = document.getElementById("experiment-actions-msg");
  if (!total) {
    if (msg) msg.textContent = "AI 채점 후보 없음 · 규칙 Top-3가 있는 addressed/verify 항목만 대상";
    _experimentLlmRunning = false;
    return;
  }
  if (msg) msg.textContent = "실험 전체 AI 채점 시작 · 첫 응답까지 약 10~30초 · 0/" + total + "건";
  _setLocalLlmStatus("실험 전체 채점 중 · 0/" + total + "건", "running");

  batches.reduce(function (chain, batch) {
      return chain.then(function () {
        if (seq !== _localLlmSeq || !state.result) throw new Error("cancelled");
        _setLocalLlmStatus("실험 전체 채점 중 · " + completed + "/" + total + "건", "running");
        return LocalLLM.review(window.fetch.bind(window), appRuntimeLocation(), batch).then(function (response) {
          LocalLLM.attach(state.result.results, response);
          completed += response.findings.length;
          duration += response.duration_ms || 0;
          var progress = document.getElementById("experiment-actions-msg");
          if (progress) progress.textContent = "실험 전체 AI 채점 중 · " + completed + "/" + total + "건";
        });
      });
    }, Promise.resolve()).then(function () {
    if (seq !== _localLlmSeq || !state.result) return;
    renderClauses();
    renderSuggestions();
    renderReport();
    _setLocalLlmStatus("실험 채점 " + completed + "/" + total + "건 완료", "ready");
    var done = document.getElementById("experiment-actions-msg");
    if (done) done.textContent = "실험 전체 AI 채점 완료 · " + completed + "/" + total + "건 · " +
      (duration ? (duration / 1000).toFixed(1) + "초" : "시간 미기록");
  }).catch(function (err) {
    if (seq !== _localLlmSeq || (err && err.message === "cancelled")) return;
    _setLocalLlmStatus("실험 채점 실패", "error");
    var failed = document.getElementById("experiment-actions-msg");
    if (failed) failed.textContent = "실험 AI 채점 실패 · localhost 서버와 Ollama " + LocalLLM.getModel() + " 상태를 확인하세요";
  }).then(function () {
    _experimentLlmRunning = false;
  });
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
      li("확인권장 신규", d.verify.added) + li("확인권장 사라짐", d.verify.removed) +
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

/* LLM 기여 분석 — 규칙/Hybrid 예측과 사람이 확정한 골드를 같은 document_id로 쌍대 비교. */
var _llmContributionPredictions = [];
var _llmContributionGolds = [];
var _llmContributionCurrent = null;
function _readExperimentFiles(fileList, expectedFormat, done) {
  var files = Array.prototype.slice.call(fileList || []), objects = [], bad = 0;
  if (!files.length) { done(objects, bad); return; }
  var pending = files.length;
  files.forEach(function (file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (obj && obj.format === expectedFormat && obj.meta && obj.meta.document_id) objects.push(obj);
        else bad++;
      } catch (e) { bad++; }
      if (--pending === 0) done(objects, bad);
    };
    reader.onerror = function () { bad++; if (--pending === 0) done(objects, bad); };
    reader.readAsText(file);
  });
}
function _syncContributionControls(message) {
  var btn = document.getElementById("llm-contrib-run");
  var status = document.getElementById("llm-contrib-status");
  if (btn) btn.disabled = !_llmContributionCurrent &&
    (!_llmContributionPredictions.length || !_llmContributionGolds.length);
  if (status) status.textContent = message || ("예측 " + _llmContributionPredictions.length +
    "건 · 사람 정답 " + _llmContributionGolds.length + "건 선택");
}
function _renderCurrentContributionLabels() {
  var box = document.getElementById("llm-contrib-labels");
  if (!box || !_llmContributionCurrent) return;
  var gold = _llmContributionCurrent.gold;
  var reviewed = {};
  _llmContributionCurrent.prediction.items.forEach(function (item) {
    if (item.llm_reviewed) reviewed[item.check_id] = true;
  });
  var labels = gold.labels.filter(function (label) { return reviewed[label.check_id]; });
  if (!labels.length) {
    box.innerHTML = '<p class="curation-empty">LLM이 분석한 항목이 없습니다. 리포트에서 ‘실험 전체 AI 채점’을 먼저 실행하세요.</p>';
    return;
  }
  var options = '<option value="">정답 선택</option><option value="none">관련 조항 없음</option>' +
    gold.clauses.map(function (clause) {
      return '<option value="' + clause.clause_index + '">#' + clause.clause_index + " " + esc(clause.heading || "표제 없음") + "</option>";
    }).join("");
  box.innerHTML = '<p class="verify-scope-note"><strong>사람 정답 입력:</strong> 각 항목의 직접 근거 조항 하나를 선택하세요. 해당 조항이 없으면 ‘관련 조항 없음’을 선택합니다.</p>' +
    '<div class="llm-label-list">' + labels.map(function (label) {
      return '<label class="llm-label-row"><span><b>' + esc(label.check_id) + '</b>' + esc(label.check) +
        '</span><select data-contrib-check="' + esc(label.check_id) + '">' + options + '</select></label>';
    }).join("") + "</div>";
  box.querySelectorAll("select[data-contrib-check]").forEach(function (select) {
    select.addEventListener("change", function () {
      var label = gold.labels.filter(function (x) { return x.check_id === select.getAttribute("data-contrib-check"); })[0];
      if (!label) return;
      if (select.value === "") { label.applicable = null; label.direct_clause_indices = []; }
      else {
        label.applicable = true;
        label.direct_clause_indices = select.value === "none" ? [] : [Number(select.value)];
      }
      var answered = labels.filter(function (x) { return x.applicable !== null; }).length;
      _syncContributionControls("사람 정답 " + answered + "/" + labels.length + "건 입력 · 입력한 항목부터 계산할 수 있습니다.");
    });
  });
}
function _startCurrentContribution() {
  if (!state.result) {
    _syncContributionControls("먼저 계약서를 넣고 분석을 실행하세요.");
    return;
  }
  var prediction = Experiment.buildPredictions({
    documentId: verdictHash, contractHash: verdictHash, typeId: state.typeId,
    generated: verdictToday(), appVersion: CR.app_version || "", model: LocalLLM.getModel(),
    results: state.result.results, checkpoints: state.result.checkpoints, clauses: state.clauses
  });
  var gold = Experiment.buildGoldTemplate({
    documentId: verdictHash, contractHash: verdictHash, typeId: state.typeId,
    created: verdictToday(), results: state.result.results,
    checkpoints: state.result.checkpoints, clauses: state.clauses
  });
  _llmContributionCurrent = { prediction: prediction, gold: gold };
  _renderCurrentContributionLabels();
  _syncContributionControls("각 항목에서 사람이 정답 조항을 선택하세요.");
}
function _contributionPairs() {
  if (_llmContributionCurrent) {
    return { rows: Experiment.scoreDocument(_llmContributionCurrent.prediction,
      _llmContributionCurrent.gold), documents: 1 };
  }
  var goldByDoc = {}, rows = [], matchedDocs = {};
  _llmContributionGolds.forEach(function (gold) { goldByDoc[String(gold.meta.document_id)] = gold; });
  _llmContributionPredictions.forEach(function (prediction) {
    var id = String(prediction.meta.document_id), gold = goldByDoc[id];
    if (!gold) return;
    matchedDocs[id] = true;
    rows = rows.concat(Experiment.scoreDocument(prediction, gold));
  });
  return { rows: rows, documents: Object.keys(matchedDocs).length };
}
function renderLlmContribution(rows, documents) {
  var box = document.getElementById("llm-contrib-results");
  if (!box) return;
  var sum = Experiment.summarize(rows);
  function pct(v) { return Math.round((v || 0) * 1000) / 10 + "%"; }
  var names = { improved: "규칙 오답 → LLM 정답", harmed: "규칙 정답 → LLM 오답",
    same_correct: "둘 다 정답", same_wrong: "둘 다 오답" };
  var h = '<div class="llm-contrib-grid">' +
    '<div><b>' + documents + '</b><span>대조 문서</span></div>' +
    '<div><b>' + sum.n + '</b><span>채점 항목</span></div>' +
    '<div><b>' + pct(sum.delta_accuracy) + '</b><span>정확도 차이</span></div>' +
    '<div><b>' + (sum.net_improved >= 0 ? "+" : "") + sum.net_improved + '</b><span>순개선</span></div>' +
    '<div><b>' + pct(sum.baseline_accuracy) + '</b><span>규칙 정확도</span></div>' +
    '<div><b>' + pct(sum.hybrid_accuracy) + '</b><span>LLM 보조 정확도</span></div>' +
    '<div><b>' + sum.improved + '</b><span>LLM이 교정</span></div>' +
    '<div><b>' + sum.harmed + '</b><span>LLM이 악화</span></div></div>';
  if (!rows.length) {
    box.innerHTML = h + '<p class="curation-empty">같은 document_id이면서 사람 판정과 LLM 분석이 모두 완료된 항목이 없습니다.</p>';
    return;
  }
  h += '<table class="llm-contrib-table"><thead><tr><th>결과</th><th>문서·항목</th><th>규칙</th><th>LLM 보조</th><th>사람 정답</th></tr></thead><tbody>';
  h += rows.map(function (row) {
    var cls = row.outcome === "improved" ? "lc-improved" : row.outcome === "harmed" ? "lc-harmed" : "";
    function clause(v) { return v === null || v === undefined ? "관련 조항 없음" : "조항 #" + v; }
    var gold = row.gold_clause_indices.length ? row.gold_clause_indices.map(function (x) { return "#" + x; }).join(", ") : "관련 조항 없음";
    return '<tr><td class="' + cls + '">' + names[row.outcome] + '</td><td><b>' + esc(row.document_id) + " · " + esc(row.check_id) +
      '</b><br><span class="report-actions-note">' + esc(row.check) + '</span></td><td>' + clause(row.rule_clause_index) +
      '</td><td>' + clause(row.llm_clause_index) + '</td><td>' + gold + '</td></tr>';
  }).join("") + "</tbody></table>";
  box.innerHTML = h;
}
function initLlmContribution() {
  var predictions = document.getElementById("llm-contrib-predictions");
  var golds = document.getElementById("llm-contrib-golds");
  var run = document.getElementById("llm-contrib-run");
  var current = document.getElementById("llm-contrib-current");
  if (!predictions || !golds || !run) return;
  predictions.addEventListener("change", function () {
    _readExperimentFiles(predictions.files, Experiment.PREDICTION_FORMAT, function (objects, bad) {
      _llmContributionPredictions = objects;
      _llmContributionCurrent = null;
      _syncContributionControls("예측 " + objects.length + "건 선택" + (bad ? " · 형식 오류 " + bad + "건" : ""));
    });
  });
  golds.addEventListener("change", function () {
    _readExperimentFiles(golds.files, Experiment.GOLD_FORMAT, function (objects, bad) {
      _llmContributionGolds = objects;
      _llmContributionCurrent = null;
      _syncContributionControls("사람 정답 " + objects.length + "건 선택" + (bad ? " · 형식 오류 " + bad + "건" : ""));
    });
  });
  if (current) current.addEventListener("click", _startCurrentContribution);
  run.addEventListener("click", function () {
    var paired = _contributionPairs();
    renderLlmContribution(paired.rows, paired.documents);
    _syncContributionControls("대조 완료 · 문서 " + paired.documents + "건 · 항목 " + paired.rows.length + "건");
  });
}
initLlmContribution();

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
function currentSystemAssessments() {
  if (!state.result) return null;
  return Assessment.build(state.result.results, state.result.checkpoints, state.clauses || [], {
    generated: verdictToday(), contract_hash: verdictHash, type_id: state.typeId,
    engine_version: CR.app_version || "",
    stance: state.stance,
    party_roles: state.partyRoles || [],
    party_context: state.partyContext || null,
    active_modules: state.activeModules || [],
    scope_assessments: state.scopeAssessments || {},
    scope_answers: state.scopeAnswers || {},
    legal_alerts: state.legalAlerts || [],
    data_relationship: state.result.dataRelationship || null,
    tag_engine: CR.tag_engine || null,
    subdoc_coverage: state.subDocCov || {},
    ref_coverage: state.refCov || {},
    confirmed_subdoc_checks: _confirmedSubdocChecks()
  });
}
function currentMatchingObservations() {
  var items = {};
  var observedCache = {};
  function observedAt(index) {
    if (typeof index !== "number" || !state.clauses[index]) return null;
    if (observedCache[index]) return observedCache[index];
    try {
      observedCache[index] = ContractTags.values(
        ContractTags.analyzeClause(state.clauses[index], state.docTitle || ""));
      return observedCache[index];
    } catch (e) { return null; }
  }
  ((state.result && state.result.results) || []).forEach(function (r) {
    var target = state.reassign && state.reassign[r.cpId];
    var contractWide = target === REASSIGN_CONTRACT;
    var reassigned = typeof target === "number";
    var ruleBest = r.ruleBest || null;
    var confirmed = !!(state.matchConfirm && state.matchConfirm[r.cpId] && ruleBest);
    var humanIndex = contractWide ? null : (reassigned ? target : (confirmed ? ruleBest.clauseIndex : null));
    var ruleIndex = ruleBest ? ruleBest.clauseIndex : null;
    var humanObserved = observedAt(humanIndex);
    items[r.cpId] = {
      check_id: r.cpId,
      coverage: r.coverage || "",
      rule_clause_index: ruleIndex,
      candidate_clauses: (r.ranked || []).slice(0, 3).map(function (hit) {
        return { clause_index: hit.clauseIndex, match_score: Math.round((hit.score || 0) * 100) / 100 };
      }),
      human_clause_index: humanIndex,
      human_evidence_source: contractWide ? "contract_wide" : (reassigned ? "reassigned" : (confirmed ? "confirmed_match" : "none")),
      opinion_scope: contractWide ? "contract" : "clause",
      // 계약 원문은 넣지 않고 정답·오답 조항의 구조태그만 누적한다. 표본 기준을 넘은
      // 반복 패턴은 사람 승인용 signature 개선 후보가 된다.
      tag_observation: humanObserved ? {
        profile_version: ContractTags.PROFILE_VERSION || "",
        human_observed: humanObserved,
        rule_observed: reassigned && typeof ruleIndex === "number" ? observedAt(ruleIndex) : null
      } : null,
      perspective: r.perspective || null
    };
  });
  return { format: "cr-matching-observations-v2", contract_hash: verdictHash,
    type_id: state.typeId || null, stance: state.stance,
    party_context: state.partyContext || null, active_modules: state.activeModules || [], items: items };
}
function currentLlmAssistance() {
  var items = {};
  ((state.result && state.result.results) || []).forEach(function (r) {
    var accepted = _llmAcceptedDrafts[(verdictHash || "") + "::" + r.cpId];
    var a = r.localLlm || accepted;
    if (!a) return;
    if (accepted) {
      a = JSON.parse(JSON.stringify(a));
      a.draft_accepted = true;
      a.draft_comment = accepted.draft_comment || a.draft_comment;
    }
    var v = verdictStore[r.cpId] || {};
    var draft = String(a.draft_comment || "");
    items[r.cpId] = {
      check_id: r.cpId,
      analyzed: true,
      model: a.model || LocalLLM.getModel(),
      relation: a.relation || "",
      completeness: a.completeness || "",
      present_elements: (a.present_elements || []).slice(),
      missing_elements: (a.missing_elements || []).slice(),
      draft_offered: !!draft,
      draft_comment: draft,
      draft_accepted: !!a.draft_accepted,
      final_verdict: v.verdict || "",
      final_comment: v.comment || "",
      final_comment_unchanged: !!a.draft_accepted && draft === String(v.comment || "")
    };
  });
  return { format: "cr-llm-assistance-v1", contract_hash: verdictHash,
    type_id: state.typeId || null, items: items };
}
function currentVerdictExport(meta) {
  var obj = Verdict.exportVerdicts(verdictStore, meta, currentSystemAssessments());
  if (state.historyRef) obj.history_reference = {
    format: "cr-review-history-reference-v1",
    review_id: state.historyRef.review_id || "",
    id_quality: state.historyRef.id_quality || "",
    selected_at: state.historyRef.selected_at || "",
    db_type: state.historyRef.db_type || "",
    mapped_type_id: state.historyRef.mapped_type_id || ""
  };
  obj.type_classification = currentTypeDecision();
  obj.subdoc_confirmation = { format: "cr-subdoc-confirmation-v1",
    confirmed_ids: Object.keys(state.subdocUse || {}).filter(function (id) { return state.subdocUse[id] === true; }) };
  obj.reassign = JSON.parse(JSON.stringify(state.reassign || {}));
  obj.match_confirmation = JSON.parse(JSON.stringify(state.matchConfirm || {}));
  obj.matching_observations = currentMatchingObservations();
  obj.llm_assistance = currentLlmAssistance();
  obj.manual_findings = JSON.parse(JSON.stringify((state.findingStore && state.findingStore.manual) || {}));
  obj.finding_decisions = JSON.parse(JSON.stringify((state.findingStore && state.findingStore.decisions) || {}));
  obj.document_integrity = { format: "cr-document-integrity-v1",
    items: JSON.parse(JSON.stringify(state.integrityFindings || [])) };
  obj.contract_requirement_outcomes = { format: "cr-contract-requirement-v1", items: {} };
  ((state.result && state.result.results) || []).forEach(function (r) {
    var cp = _cpById(r.cpId), v = verdictStore[r.cpId] || {};
    if (!cp) return;
    var action = actionForResult(r);
    obj.contract_requirement_outcomes.items[r.cpId] = {
      requirement: effectiveContractRequirement(cp), coverage: r.coverage || "",
      text_effect: action.text_effect, implementation_channel: action.implementation_channel,
      contract_action: action.action, action_reason_code: action.reason_code,
      action_evidence_state: action.evidence_state,
      verdict: v.verdict || "", reason: v.reason || ""
    };
  });
  return obj;
}
function exportVerdicts() {
  // subdoc_coverage(#3): 부속서류에서 매칭 확인된 항목은 기계 사실로 기록에 남김 —
  // 사람 판정(verdicts)과 별개 키. 데이터 축적 시 "부속서류로 충족되는 항목" 패턴의 원료.
  var meta = { type_id: state.typeId, date: verdictToday(), contract_hash: verdictHash, reviewer: getReviewer(),
    subdoc_coverage: state.subDocCov || {},
    app_version: CR.app_version || "",
    stance: state.stance, party_roles: state.partyRoles || [], party_context: state.partyContext || null,
    active_modules: state.activeModules || [],
    opinion: _lastOpinionText }; // 종합 검토의견(표시 중 문안 — 수정본 우선)
  var blob = new Blob([JSON.stringify(currentVerdictExport(meta), null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = verdictFileName(); // 팀 회신용 자동 명명 — JSON 형식 자체는 불변(파일명만 변경)
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- 검토 마치기(원버튼) — 팀원 일상 마무리 액션 ----------
   마치기 = 축적까지(피드백 4차): ① 지식 반영(코퍼스 ingest — 해시 멱등이라 중복 클릭 안전)
   ② 검토 아카이브를 브라우저(레지스트리)에 등록 — 다음 해 자동 안내의 원천.
   파일 생성·공유는 별개 작업 — 옆의 [검토의견 파일로 내보내기] 버튼이 담당(다운로드 없음).
   개별 버튼 3종은 "팀·지식 관리" 접힘에 유지(동작 불변). */
function finishReview() {
  if (!state.result) return;
  ingestCurrentToCorpus();
  captureHistoryBenchmark();
  saveArchiveRegistry(Compare.registryPush(loadArchiveRegistry(), {
    name: _contractName(), date: verdictToday(), reviewer: getReviewer(),
    type_id: state.typeId || null, contract_hash: verdictHash, contract_text: state.text,
    stance: state.stance, party_context: state.partyContext || null, active_modules: state.activeModules || [],
    history_review_id: state.historyRef && state.historyRef.review_id || ""
  }));
  renderReport(); renderClauses(); renderSuggestions(); // 코퍼스 카운트·추천 갱신
  var msg = document.getElementById("finish-msg");
  if (msg) msg.textContent = "검토가 저장되었음. 검토 결과·코멘트는 다음 검토의 추천에 활용됨.";
}
// 일괄 판정(통과계약 모드) — 미판정만 채움(기판정=예외 보존은 Verdict.bulkVerdict가 보장).
function bindBulkVerdict() {
  function ids(coverages) {
    return (state.result ? state.result.results : [])
      .filter(function (r) { return coverages.indexOf(r.coverage) !== -1; })
      .map(function (r) { return r.cpId; });
  }
  function applyIds(cpIds, verdict, reason) {
    var r = Verdict.bulkVerdict(verdictStore, cpIds, verdict, verdictToday(), reason);
    verdictStore = r.store; saveVerdicts();
    // 전체 재렌더로 content-visibility 높이 추정이 초기화돼 스크롤이 튐 — 위치 복원(rAF로 확정 높이 반영 후 재보정).
    var y = window.scrollY;
    renderClauses(); renderSuggestions(); renderReport();
    window.scrollTo(0, y);
    requestAnimationFrame(function () { window.scrollTo(0, y); });
    var msg = document.getElementById("bulk-msg");
    if (msg) msg.textContent = r.applied + "건 " + verdict + (reason ? "(" + reason + ")" : "") +
      " 처리(기존 검토 결과 보존)";
  }
  function apply(coverages, verdict, reason) { applyIds(ids(coverages), verdict, reason); }
  var b1 = document.getElementById("bulk-consider-na");
  // 11.3차: 구 "전부 해당없음"을 "이상없음 + 사유 해당사항 없음"으로 대체.
  if (b1) b1.addEventListener("click", function () { apply(["consider"], "이상없음", "해당사항 없음"); });
  var b2 = document.getElementById("bulk-consider-ok");
  if (b2) b2.addEventListener("click", function () { apply(["consider"], "이상없음"); });
  var b3 = document.getElementById("bulk-matched-ok");
  if (b3) b3.addEventListener("click", function () { apply(["addressed", "verify"], "이상없음"); });
  var quick = document.getElementById("quick-review-ok");
  if (quick) quick.addEventListener("click", function () {
    // 빠른 확인 = 코퍼스 반복 확인 항목 + 문장 요건 충족 필수 항목(12차 — 자동 기재 대신 원클릭)
    var quickIds = (state.result ? state.result.results : []).filter(function (r) {
      return reviewRouteFor(r).route === "quick" || _sentenceQuick(r);
    }).map(function (r) { return r.cpId; });
    applyIds(quickIds, "이상없음", "반영되어 있음");
  });
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
      state.reassign = normalizeReassignMap(obj && obj.reassign);
      state.matchConfirm = normalizeMatchConfirmMap(obj && obj.match_confirmation);
      state.findingStore = Findings.normalizeStore({ manual: obj && obj.manual_findings,
        decisions: obj && obj.finding_decisions });
      saveVerdicts();
      saveReassign();
      saveMatchConfirm();
      saveFindings();
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
    app_version: CR.app_version || "",
    stance: state.stance, party_roles: state.partyRoles || [], party_context: state.partyContext || null,
    active_modules: state.activeModules || [],
    archive: true, name: String(name || "").trim() || _contractName() };
  var obj = currentVerdictExport(meta);
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
    type_id: state.typeId || null, contract_hash: verdictHash, contract_text: state.text,
    stance: state.stance, party_context: state.partyContext || null, active_modules: state.activeModules || []
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
  applyVerdict(cpId, cand.verdict, _carryTail(cand.comment), "", "prior_review");
}

// 일괄 수용 — 미판정 후보만 채움(기판정 보존, 통과계약 모드와 동형).
function acceptAllCarry() {
  var cmp = state.compare;
  if (!cmp || !cmp.carry) return;
  var applied = 0;
  cmp.carry.forEach(function (cand) {
    var cur = verdictStore[cand.cpId];
    if (cur && cur.verdict) return; // 기판정 보존
    verdictStore = Verdict.setVerdict(verdictStore, cand.cpId, cand.verdict, _carryTail(cand.comment), verdictToday(), "", "prior_review");
    applied++;
  });
  saveVerdicts();
  // 전체 재렌더 스크롤 보정 — bulk 판정과 동일 패턴.
  var y = window.scrollY;
  renderClauses(); renderSuggestions(); renderReport();
  window.scrollTo(0, y);
  requestAnimationFrame(function () { window.scrollTo(0, y); });
  var msg = document.getElementById("compare-msg");
  if (msg) msg.textContent = applied + "건 전년 검토 결과 수용(기존 검토 결과 보존)";
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
    (pending ? '<button id="carry-accept-all" class="ghost">동일 조항 전년 검토 결과 ' + pending + "건 일괄 수용</button>" : "") +
    '<button id="compare-off" class="ghost">비교 해제</button>' +
    '<span id="compare-msg" class="report-actions-note"></span>' +
    '<span class="cmp-hint">정렬은 보조 도구(대응 불확실 항목은 직접 확인) · 검토 결과 이관은 인용이지 확정이 아님 — 법령 개정 여부 별도 확인</span>';
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
function _assessmentForResult(r) {
  if (r.coverage === "addressed") return "evidence_found";
  if (r.coverage === "verify") return "possible_evidence";
  if (r.coverage === "consider") return "evidence_not_found";
  if (r.coverage === "base_covered") return "evidence_in_base";
  return "not_surfaced";
}
function _actionContext() {
  return { subdoc_coverage: state.subDocCov || {}, ref_coverage: state.refCov || {},
    confirmed_subdoc_checks: _confirmedSubdocChecks() };
}
function actionForResult(r) {
  return ActionRouter.route(_cpById(r && r.cpId), r, _actionContext());
}
function contractActionBadgeHtml(r) {
  if (!r) return "";
  var a = actionForResult(r);
  if (!a || a.action === "no_action") return "";
  var title = {
    add_or_modify: "필요한 문구가 확인되지 않아 추가 또는 수정 검토가 필요합니다.",
    remove: "있으면 안 되는 문구가 확인되어 삭제 또는 수정 검토가 필요합니다.",
    verify_elsewhere: "계약 본문이 아니라 부속서류·증빙·내부 운영자료에서 확인할 항목입니다.",
    negotiate: "법령상 필수 문구는 아니며 회사에 유리한 조건으로 협의할지 검토하는 항목입니다.",
    hold: a.reason_code === "possible_text_requires_confirmation"
      ? "관련 문구를 일부 찾았습니다. 현재 문구만으로 충분한지 확인하세요."
      : "이 항목을 계약서에 반영해야 하는지 확인하세요."
  }[a.action] || "";
  return ' <span class="badge contract-action action-' + esc(a.action) + '" title="' + esc(title) + '">' +
    esc(a.label) + "</span>";
}
function reviewRouteFor(r) {
  return Loop.reviewRoute(loopCorpus, r.cpId, _assessmentForResult(r));
}
function reviewRouteHtml(r) {
  var route = reviewRouteFor(r);
  if (route.route === "standard") {
    // 문장 요건 충족 필수 항목(12차) — 코퍼스 이력이 없어도 빠른 확인으로 안내.
    if (_sentenceQuick(r)) {
      return '<span class="review-route route-quick" title="요건 문장이 확인되어 원클릭 확인 대상">빠른 확인</span>';
    }
    return "";
  }
  var labels = { detailed: "정밀 검토", applicability: "적용성 확인", quick: "빠른 확인" };
  return '<span class="review-route route-' + route.route + '" title="' + esc(route.reason) + '">' +
    labels[route.route] + "</span>";
}
function implementationChannelBadgeHtml(cp) {
  var label = {
    external_evidence: "동의서·고지자료 확인",
    contract_or_internal_control: "계약 또는 내부통제 확인",
    standard_subdoc: "표준 부속서류 확인",
    contract: "계약 문구 확인",
    internal_control: "내부통제·운영자료 확인",
    monitoring_evidence: "평가·점검자료 확인",
    cooperation_control: "계약상 협조·통제 확인",
    statutory_duty: "법령 직접의무 확인"
  }[cp && cp.implementation_channel];
  return label ? ' <span class="badge evidence-channel">' + esc(label) + "</span>" : "";
}
function contractRequirementBadgeHtml(cp) {
  var req = ActionRouter.effectiveRequirement(cp);
  // 표준 보안관리약정·특약으로 충족할 수 있는 항목은 주계약 본문에만
  // 문구를 넣어야 한다는 뜻이 아니다. 조치 라우팅과 모순되지 않게
  // 문서화 위치를 본문 또는 부속서류로 명시한다.
  if (req === "express" && cp && cp.implementation_channel === "standard_subdoc") {
    return ' <span class="badge contract-requirement req-' + esc(req) +
      '" title="주계약 본문 또는 표준 부속서류·특약에서 문서화 여부를 확인">본문·부속서류 문서화</span>';
  }
  var label = {
    express: "계약서에 문구 필요",
    derived: "필요 시 협조문구 반영",
    recommended: "회사 유불리 검토",
    none: "계약서 문구 필수 아님",
    unclassified: "반영 필요 여부 확인"
  }[req];
  return label ? ' <span class="badge contract-requirement req-' + esc(req) + '">' +
    esc(label) + "</span>" : "";
}
function _reviewRouteRank(r) {
  var rank = { detailed: 0, applicability: 1, standard: 2, quick: 3 };
  return rank[reviewRouteFor(r).route];
}
function tagTraceHtml(r) {
  var trace = r && r.best && r.best.tagTrace;
  if (!trace) return "";
  var facetLabel = { topics: "쟁점", actors: "의무주체", actions: "행위", objects: "대상",
    modalities: "의무형태", conditions: "조건", provisions: "근거조문" };
  function tagLabel(facet, id) {
    var def = CR.tag_taxonomy && CR.tag_taxonomy.facets && CR.tag_taxonomy.facets[facet] &&
      CR.tag_taxonomy.facets[facet][id];
    return def && def.label ? def.label : id;
  }
  var matched = [], key;
  for (key in (trace.matches || {})) {
    if ((trace.matches[key] || []).length) matched.push((facetLabel[key] || key) + ": " +
      trace.matches[key].map(function (id) { return tagLabel(key, id); }).join(", "));
  }
  var missing = trace.missing || [], conflicts = trace.conflicts || [];
  var evidence = (trace.evidence || []).slice(0, 3).map(function (item) {
    var ev = item.evidence && item.evidence[0];
    return ev ? (facetLabel[item.facet] || item.facet) + ": “" + ev.text + "”" : "";
  }).filter(Boolean);
  var mode = MatcherConfig.TAG_MATCH_MODE === "shadow" ? "기록만" : "매칭 보조";
  var frame = trace.bestFrame;
  var frameState = trace.comparisonBasis === "proposition_frame"
    ? (trace.eligible ? "같은 항·문장 확인" : "같은 항·문장 미확인") : "조항 전체 비교";
  return '<details class="tag-trace"><summary>구조태그 ' + mode + ' · ' + frameState +
    ' · 누락 ' + missing.length + ' · 충돌 ' + conflicts.length + '</summary>' +
    (trace.aggregateEligible && !trace.eligible ? '<p><b>판정 이유</b> 필요한 표현이 조항 안에는 있으나 같은 항·문장에 함께 있지 않아 가점하지 않았습니다.</p>' : '') +
    (frame && frame.text ? '<p><b>판정 근거 문장</b> “' + esc(frame.text) + '”</p>' : '') +
    (matched.length ? '<p><b>일치</b> ' + esc(matched.join(" / ")) + '</p>' : '') +
    (missing.length ? '<p><b>같은 문장에서 확인되지 않은 요소</b> ' + esc(missing.map(function (x) { return facetLabel[x] || x; }).join(", ")) + '</p>' : '') +
    (conflicts.length ? '<p><b>충돌</b> ' + esc(conflicts.map(function (x) {
      var required = x.required || x.expected || "요구";
      var observed = Array.isArray(x.observed) ? x.observed.join(", ") : x.observed;
      return tagLabel(x.facet, required) + "↔" + tagLabel(x.facet, observed);
    }).join(", ")) + '</p>' : '') +
    (evidence.length ? '<p><b>근거</b> ' + esc(evidence.join(" / ")) + '</p>' : '') +
    '</details>';
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
    esc(cp.severity) + "</span><span class=\"ci-id\">" + esc(cp.id) + "</span>" + reviewRouteHtml(r) +
    contractActionBadgeHtml(r) + implementationChannelBadgeHtml(cp) + contractRequirementBadgeHtml(cp) + "</div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    decisionGuidanceHtml(cp) +
    actionRationaleHtml(cp) +
    (reasons.length ? '<p class="ci-reason">' + esc(reasons.join("; ")) + "</p>" : "") +
    tagTraceHtml(r) +
    localLlmHtml(r) +
    (cp.severity_basis ? '<p class="ci-basis">' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">' + evidenceCell(cp) + "</p>" +
    (showEvidence ? evidenceLineHtml(cp, r) : "") +
    carryHintHtml(cp.id) + // 비교 모드: 전년 검토 인용 프리필(동일 조항) 또는 참고 표시(변경 조항)
    reassignControlHtml(r) + // 오부착 대응(11.7차): 이 항목이 실제로 반영된 조항을 지정
    verdictControlHtml(cp.id) +
    "</div>";
}
function localLlmHtml(r) {
  var a = r && r.localLlm;
  if (!a) return "";
  var needsReview = a.relation !== "direct" || a.completeness !== "complete" ||
    a.selected_clause_index !== (r.best && r.best.clauseIndex);
  var relation = { direct: "직접 규정", reference_only: "참조 언급", unrelated: "관련성 낮음" }[a.relation] || "판단 불가";
  var completeness = { complete: "핵심요소 있음", partial: "일부 요소 확인", unclear: "충족도 불명확" }[a.completeness] || "";
  var alt = a.selected_clause_index !== (r.best && r.best.clauseIndex)
    ? " · 다른 후보 " + esc((state.clauses[a.selected_clause_index] || {}).heading || ("조항#" + a.selected_clause_index)) : "";
  var details = "";
  if ((a.present_elements || []).length) details += '<span class="local-ai-elements"><b>확인 요소</b> ' + esc(a.present_elements.join(" · ")) + "</span>";
  if ((a.missing_elements || []).length) details += '<span class="local-ai-elements missing"><b>부족·확인 요소</b> ' + esc(a.missing_elements.join(" · ")) + "</span>";
  var draft = a.draft_comment
    ? '<span class="local-ai-draft"><b>검토의견 초안</b> ' + esc(a.draft_comment) +
      ' <button class="ghost local-ai-use-draft" data-vcp="' + esc(r.cpId) + '">' +
      (a.draft_accepted ? "초안 다시 적용" : "초안 사용") + "</button></span>" : "";
  return '<div class="local-ai-note' + (needsReview ? " review" : "") + '"><span class="local-ai-badge">로컬 AI' +
    (needsReview ? " 재확인" : " 교차확인") + "</span>" + esc(relation + " · " + completeness) + alt +
    (a.reason ? " — " + esc(a.reason) : "") + details + draft + "</div>";
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
  var judged = _considerJudged(r);
  return '<div class="compare-item consider-item' + (sub ? " subdoc-covered" : "") + (ref ? " refdoc-covered" : "") +
    (judged ? " consider-judged" : "") + '">' +
    '<div class="ci-head"><span class="sev sev-' + cp.severity + '" title="' + esc(cp.severity_basis || "") + '">' +
    esc(cp.severity) + "</span><span class=\"ci-id\">" + esc(cp.id) + "</span>" + reviewRouteHtml(r) + contractActionBadgeHtml(r) + implementationChannelBadgeHtml(cp) + contractRequirementBadgeHtml(cp) + subBadge + refBadge + "</div>" +
    '<p class="ci-q">' + labelQ(cp) + "</p>" +
    decisionGuidanceHtml(cp) +
    (cp.severity_basis ? '<p class="ci-basis">왜 봐야 하는지: ' + esc(cp.severity_basis) + "</p>" : "") +
    '<p class="ci-src">근거 ' + evidenceCell(cp) + "</p>" +
    stdRefsHtml(cp) + // 표시 전용 — 부재를 짚을 때 표준 문서의 대응 문안을 함께 보여줌(판정 무영향)
    carryHintHtml(cp.id) + // 비교 모드: 부재 알람도 체크 id 기준 전년 판정 인용(스펙 §판정 이관)
    // 부재 알람에도 재지정 제공(11.7차) — "없다"고 떴지만 실제로는 어느 조항에 있는 경우,
    // 그 조항을 지정하면 알람이 해소되고 해당 조항 아래로 이동한다.
    reassignControlHtml(r) +
    verdictControlHtml(cp.id) +
    "</div>";
}
/* ---------- 조항별 검토(P2) — 삼단 연속 스크롤 ----------
   조항 행(row) 하나 = grid 3셀(① 계약서 원문 ② 확인 완료(접힘) ③ 검토할 항목·의견 — 12차 재편).
   전 행을 한 번에 렌더 — 클릭 탐색·스크롤 동기화 코드 불요(행 단위 grid가 정렬을 구조적으로 보장).
   오프스크린 렌더 비용은 CSS content-visibility로 제거(§4.2 1차 전략).
   미니맵(조항 점프 목차)은 P2 스코프 아웃 — 100+조항 실사용에서 필요해지면 추가. */
var _clauseGroups = {};   // clauseIndex -> { addressed:[r], verify:[r] } — verify는 필수·권장 먼저 정렬
var _considerList = [];   // 부재 알람(consider) — 조항 무관, 최하단 전용 블록

// 명시적 판단이 필요한 항목만 완료 게이트에 포함한다. 계약서에 이미 반영된 항목과 일반 권장
// 항목까지 모두 클릭하도록 강제하지 않는다. 과거 이슈·반복 비적용은 심각도와 무관하게 유지.
function _requiresDecision(res) {
  var cp = _cpById(res.cpId);
  if (!cp) return false;
  // 약정서 후보·본문 참조는 검토자 확인 전까지 완료로 세지 않는다. 명시 체크 후에는
  // applySubdocVerdicts가 묶음 판정을 생성하므로 여기서 별도 클릭을 요구하지 않는다.
  if (res.coverage === "consider" &&
      ((state.subDocCov || {})[res.cpId] || (state.refCov || {})[res.cpId]) &&
      !_subdocConfirmedForCp(res.cpId)) return true;
  var action = actionForResult(res);
  if (ActionRouter.requiresDecision(action)) return true;
  if (["consider", "verify"].indexOf(res.coverage) === -1) return false;
  var route = reviewRouteFor(res).route;
  if (route === "detailed" || route === "applicability") return true;
  return cp.severity === "필수";
}

// 검토 완료 진행 — 명시적 사람 판정이 필요한 항목만 분모로 사용한다.
function verdictProgress() {
  var judgeable = 0, judged = 0;
  ((state.result && state.result.results) || []).forEach(function (res) {
    if (!_requiresDecision(res)) return;
    judgeable++;
    var v = verdictStore[res.cpId];
    if (v && v.verdict) judged++;
  });
  return { judged: judged, judgeable: judgeable };
}

// 검토 필요 잔여(2026-08-03 재설계) — 미검토 알람(부재, 필수·권장) + 미검토 함께 살펴볼(verify 필수·권장).
// 랜딩 분기·리포트 soft gate 배너·검토 마치기 게이트·완료 CTA 공용. 리포트 집계와 동일 규칙:
// 부속서류·별첨 커버 필수는 알람 아님, 참고 심각도는 잔여로 세지 않음.
function pendingReviewCount() {
  var n = 0;
  ((state.result && state.result.results) || []).forEach(function (res) {
    if (!_requiresDecision(res)) return;
    var v = verdictStore[res.cpId];
    if (v && v.verdict) return;
    n++;
  });
  var decisions = (state.findingStore && state.findingStore.decisions) || {};
  (state.integrityFindings || []).forEach(function (f) {
    if (f.confidence === "high" && !decisions[f.id]) n++;
  });
  return n;
}

// 부재 알람의 판정 여부 — 판정을 찍은 항목은 알람에서 이탈(피드백 3차, 리포트 집계와 동일 원칙).
function _considerJudged(r) {
  var v = verdictStore[r.cpId];
  return !!(v && v.verdict);
}
// 미판정 알람 수 — 헤더 앵커·부재 알람 블록·considerCountText 공용(전면 일관).
function considerPendingCount() {
  return _considerList.filter(function (r) { return _requiresDecision(r) && !_considerJudged(r); }).length;
}
function actionQueuePendingCount() {
  return ((state.result && state.result.results) || []).filter(function (r) {
    var v = verdictStore[r.cpId];
    return actionForResult(r).action === "verify_elsewhere" && !(v && v.verdict);
  }).length;
}

// 미검토 '함께 살펴볼'(verify 필수·권장) — 항목 수 + 해당 조항 행 목록(스트립 앵커 순환 점프용).
function verifyPendingInfo() {
  var count = 0, rows = [];
  Object.keys(_clauseGroups).map(Number).sort(function (a, b) { return a - b; }).forEach(function (ci) {
    var pend = (_clauseGroups[ci].verify || []).filter(function (r) {
      if (!_requiresDecision(r)) return false;
      var v = verdictStore[r.cpId];
      return !(v && v.verdict);
    });
    if (pend.length) { count += pend.length; rows.push(ci); }
  });
  return { count: count, rows: rows };
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
  if (doneN) parts.push("검토 완료 " + doneN);
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

// 구조화 태그의 첫 쟁점축으로 고밀도 카드만 시각적으로 묶는다. 카드를 숨기거나
// 판정을 합치지 않고 공통 표제만 추가하므로, 한 조항의 다대다 검토 의미는 보존된다.
function _primaryIssueLabel(r) {
  var cp = _cpById(r && r.cpId);
  var sig = cp && cp.tag_signature;
  var id = sig && sig.topics && sig.topics[0];
  var def = id && CR.tag_taxonomy && CR.tag_taxonomy.facets &&
    CR.tag_taxonomy.facets.topics && CR.tag_taxonomy.facets.topics[id];
  return def && def.label ? def.label : "기타 검토";
}
function renderIssueGroupedCards(items) {
  if (items.length < 4) return items.map(function (x) { return renderCompareItem(x.r, x.ev); }).join("");
  var groups = {}, order = [];
  items.forEach(function (item) {
    var label = _primaryIssueLabel(item.r);
    if (!groups[label]) { groups[label] = []; order.push(label); }
    groups[label].push(item);
  });
  if (order.length === 1 && order[0] === "기타 검토")
    return items.map(function (x) { return renderCompareItem(x.r, x.ev); }).join("");
  return order.map(function (label) {
    return '<section class="tag-issue-group"><h4><span class="tag-issue-dot"></span>' +
      esc(label) + '<small>' + groups[label].length + '건</small></h4>' +
      groups[label].map(function (x) { return renderCompareItem(x.r, x.ev); }).join("") + "</section>";
  }).join("");
}

/* ---------- 체크리스트 독립 자유 의견 + 문서 완결성 확인 ---------- */
var _findingEditor = null; // {id?, hostCi:null|number, defaultCi:null|number}
var FINDING_CATEGORY_LABEL = { general: "종합", structure: "구조", reference: "인용",
  consistency: "정합성", attachment: "별첨", wording: "문언", other: "기타" };
function _manualFindings() { return Findings.manualList(state.findingStore); }
function _manualForClause(ci) {
  return _manualFindings().filter(function (f) {
    if (f.scope === "contract") return false;
    return (f.anchors || []).some(function (a) { return a.document === "main" && a.clause_index === ci; });
  });
}
function _manualFindingCardHtml(f) {
  var locs = (f.anchors || []).map(function (a) { return a.heading || _clauseHeading(a.clause_index); }).filter(Boolean);
  return '<article class="manual-finding-card" data-finding-id="' + esc(f.id) + '">' +
    '<div class="manual-finding-head"><span class="badge finding-source-badge">직접 의견</span>' +
    '<span class="sev sev-' + esc(f.severity) + '">' + esc(f.severity) + '</span>' +
    '<strong>' + esc(f.title || "검토의견") + '</strong></div>' +
    (locs.length > 1 ? '<p class="manual-finding-loc">연결 조항: ' + esc(locs.join(" · ")) + '</p>' : '') +
    (f.comment ? '<p class="manual-finding-comment">' + esc(f.comment) + '</p>' : '') +
    '<div class="manual-finding-actions"><button class="ghost manual-finding-edit" data-id="' + esc(f.id) + '">수정</button>' +
    '<button class="ghost manual-finding-delete" data-id="' + esc(f.id) + '">삭제</button></div></article>';
}
function _findingEditorHtml(hostCi) {
  if (!_findingEditor || _findingEditor.hostCi !== hostCi) return "";
  var existing = _findingEditor.id && (state.findingStore.manual || {})[_findingEditor.id];
  var scope = existing ? existing.scope : (typeof _findingEditor.defaultCi === "number" ? "clause" : "contract");
  var selected = {};
  ((existing && existing.anchors) || []).forEach(function (a) { if (a.clause_index !== null) selected[a.clause_index] = true; });
  if (!existing && typeof _findingEditor.defaultCi === "number") selected[_findingEditor.defaultCi] = true;
  var opts = state.clauses.map(function (c) {
    return '<option value="' + c.index + '"' + (selected[c.index] ? ' selected' : '') + '>' +
      esc(_clauseHeading(c.index)) + '</option>';
  }).join("");
  var category = existing ? existing.category : "general";
  var severity = existing ? existing.severity : "일반";
  return '<form class="manual-finding-form" data-id="' + esc(existing ? existing.id : "") + '">' +
    '<div class="finding-form-grid"><label>의견 범위<select class="mf-scope">' +
    '<option value="contract"' + (scope === "contract" ? ' selected' : '') + '>계약 전반</option>' +
    '<option value="clause"' + (scope === "clause" ? ' selected' : '') + '>특정 조항</option>' +
    '<option value="cross_clause"' + (scope === "cross_clause" ? ' selected' : '') + '>복수 조항</option></select></label>' +
    '<label>중요도<select class="mf-severity">' + Findings.SEVERITIES.map(function (s) {
      return '<option' + (s === severity ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join("") + '</select></label>' +
    '<label>분류<select class="mf-category">' + Findings.CATEGORIES.map(function (c) {
      return '<option value="' + c + '"' + (c === category ? ' selected' : '') + '>' + esc(FINDING_CATEGORY_LABEL[c] || c) + '</option>';
    }).join("") + '</select></label></div>' +
    '<label>제목<input class="mf-title" maxlength="100" placeholder="예: 거래 구조 전반 확인" value="' + esc(existing ? existing.title : "") + '"></label>' +
    '<label>검토의견<textarea class="mf-comment" rows="3" required placeholder="체크리스트에 없는 사항도 자유롭게 기록할 수 있습니다.">' +
      esc(existing ? existing.comment : "") + '</textarea></label>' +
    '<label class="mf-anchor-label">연결 조항 <select class="mf-anchors" multiple size="4">' + opts + '</select>' +
      '<small>특정·복수 조항일 때 선택합니다. 복수 선택: Ctrl/⌘ + 클릭</small></label>' +
    '<div class="manual-finding-actions"><button class="primary" type="submit">의견 저장</button>' +
    '<button class="ghost manual-finding-cancel" type="button">취소</button></div></form>';
}
function bindFindingControls(root) {
  if (!root) return;
  root.querySelectorAll(".manual-finding-add").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var raw = btn.getAttribute("data-ci");
      var ci = raw === "" || raw === null ? null : Number(raw);
      _findingEditor = { hostCi: ci, defaultCi: ci };
      renderClauses();
    });
  });
  root.querySelectorAll(".manual-finding-edit").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var f = (state.findingStore.manual || {})[btn.getAttribute("data-id")];
      if (!f) return;
      var ci = f.scope === "contract" ? null : ((f.anchors[0] || {}).clause_index);
      _findingEditor = { id: f.id, hostCi: typeof ci === "number" ? ci : null, defaultCi: ci };
      renderClauses();
    });
  });
  root.querySelectorAll(".manual-finding-delete").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!window.confirm("이 직접 검토의견을 삭제할까요?")) return;
      state.findingStore = Findings.remove(state.findingStore, btn.getAttribute("data-id"));
      saveFindings(); _findingEditor = null; renderClauses(); renderReport();
    });
  });
  root.querySelectorAll(".manual-finding-cancel").forEach(function (btn) {
    btn.addEventListener("click", function () { _findingEditor = null; renderClauses(); });
  });
  root.querySelectorAll(".manual-finding-form").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var scope = form.querySelector(".mf-scope").value;
      var anchors = Array.prototype.slice.call(form.querySelector(".mf-anchors").selectedOptions).map(function (o) {
        var ci = Number(o.value), c = state.clauses[ci];
        return { document: "main", clause_index: ci, heading: c ? c.heading : "" };
      });
      if (scope === "contract") anchors = [];
      else if (scope === "clause") anchors = anchors.slice(0, 1);
      if (scope !== "contract" && !anchors.length) { window.alert("의견을 연결할 조항을 선택하세요."); return; }
      var out = Findings.upsert(state.findingStore, { id: form.getAttribute("data-id"), scope: scope,
        severity: form.querySelector(".mf-severity").value, category: form.querySelector(".mf-category").value,
        title: form.querySelector(".mf-title").value, comment: form.querySelector(".mf-comment").value,
        anchors: anchors, reviewer: getReviewer(), date: verdictToday() }, verdictHash);
      if (!out.id) return;
      state.findingStore = out.store; saveFindings(); _findingEditor = null;
      renderClauses(); renderReport();
    });
  });
  root.querySelectorAll(".integrity-decision").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var card = btn.closest(".integrity-card");
      var comment = card && card.querySelector(".integrity-comment");
      state.findingStore = Findings.decide(state.findingStore, btn.getAttribute("data-id"),
        btn.getAttribute("data-decision"), { comment: comment ? comment.value : "", reviewer: getReviewer(), date: verdictToday() });
      saveFindings(); renderClauses(); renderReport();
    });
  });
  root.querySelectorAll(".integrity-goto").forEach(function (btn) {
    btn.addEventListener("click", function () { gotoClause(btn.getAttribute("data-ci")); });
  });
}

// ③ 제안 사항 카드 — 이 조항에서 검토의견으로 판정 기재한 항목(상대방에 개진할 내용의 압축 뷰).
// 3버튼+코멘트는 유지하되 loop 힌트는 ② 카드에만(같은 행 중복 소음 방지).
// (renderOpinionCard는 3분할 재편(12차)으로 폐기 — 검토의견 카드는 ③ 검토할 항목 칸의
//  본 카드(renderCompareItem)가 판정 컨트롤과 함께 담당)

// 조항 행 1개 — grid 3셀. ②③이 빈 셀은 흐린 placeholder 한 줄("—")로 행 리듬 유지.
// 검토항목이 전무한 세그먼트((전문)·표제부·서명란 등)는 접지 않고 본문을 흐리게(시각적 강등).
// 비교 모드: 구 계약 열 prepend + ②③ 통합(검토·제안) — 3열 유지(스펙 §UI).
function clauseRowHtml(c) {
  var g = _clauseGroups[c.index] || { addressed: [], verify: [] };
  var all = g.addressed.map(function (r) { return { r: r, ev: false }; })
    .concat(g.verify.map(function (r) { return { r: r, ev: true }; }));
  // 3분할 재편(12차, 2026-08-19 사용자 결정): ② 확인 완료(이상없음 — 자동·수동)는 1줄
  // 요약으로 접고, ③ 검토할 항목(미판정 + 검토의견)에 실제 작업 공간을 준다.
  // 종전 ③(남긴 검토의견)이 거의 늘 빈 칸이던 문제 해소. 접기 금지 원칙(2026-07-30)의
  // 예외 — 완료분 접힘은 사용자 본인의 제안·승인 사항.
  var done = all.filter(function (x) {
    var v = verdictStore[x.r.cpId];
    return Verdict.reviewColumn(v, !!_verdictEditPins[x.r.cpId]) === "done";
  });
  var needs = all.filter(function (x) {
    var v = verdictStore[x.r.cpId];
    return Verdict.reviewColumn(v, !!_verdictEditPins[x.r.cpId]) === "needs";
  });
  var autoN = done.filter(function (x) {
    var v = verdictStore[x.r.cpId];
    return v.origin === "auto";
  }).length;
  var doneCards = renderIssueGroupedCards(done);
  var doneHtml = done.length
    ? '<details class="done-fold" open><summary>✓ 확인 완료 ' + done.length + "건" +
      (autoN ? " (자동 " + autoN + "건)" : "") + " — 펼치기</summary>" + doneCards + "</details>"
    : '<p class="cr-empty">—</p>';
  var manual = _manualForClause(c.index);
  var needCards = renderIssueGroupedCards(needs) + manual.map(_manualFindingCardHtml).join("") +
    _findingEditorHtml(c.index) +
    '<button class="ghost manual-finding-add clause-finding-add" data-ci="' + c.index + '">+ 이 조항에 직접 의견</button>';
  var noItems = !g.addressed.length && !g.verify.length && !manual.length;
  // 검토항목 전무 세그먼트는 연속 빈 줄(표제부 여백 등)을 압축해 행 공간 확보 — 문언 자체는 불변.
  var body = noItems ? String(c.body).replace(/\n{3,}/g, "\n\n") : c.body;
  var cmp = state.compare && state.compare.mapping ? state.compare : null;
  if (!cmp) {
    return '<div class="clause-row' + (noItems ? " row-noitems" : "") + rowStatusCls(g) +
      '" data-ci="' + c.index + '">' +
      '<div class="cr-cell cr-src"><strong>' + esc(c.heading) + "</strong><pre>" + esc(body) + "</pre></div>" +
      '<div class="cr-cell cr-reviewed">' + doneHtml + "</div>" +
      '<div class="cr-cell cr-opinions">' + (needCards || '<p class="cr-empty">—</p>') + "</div>" +
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
    '<div class="cr-cell cr-reviewed">' + ((needCards + (done.length ? doneHtml : "")) || '<p class="cr-empty">—</p>') + "</div>" +
    "</div>";
}

// 행 안 판정 컨트롤 바인딩 — 판정 변경 시 그 행만 재렌더(전체 재렌더 금지: 성능·스크롤 위치 보존).
function bindRowControls(rowEl) {
  var ci = Number(rowEl.getAttribute("data-ci"));
  bindReassign(rowEl); // 오부착 재지정(11.7차)
  bindFindingControls(rowEl);
  bindVerdictControls(rowEl, function (cpId) {
    withVerdictAnchor("#clause-rows", cpId, function () { rerenderRow(ci); });
    refreshClauseCounts();
    renderSuggestions();
    renderReport();
  });
}
function rerenderRow(ci) {
  var old = document.querySelector('#clause-rows .clause-row[data-ci="' + ci + '"]');
  var c = state.clauses[ci];
  if (!old || !c) return;
  // 완료 접힘(② 칸)의 펼침 상태 보존 — 판정 클릭마다 접히면 흐름이 끊김.
  var foldEl = old.querySelector(".done-fold");
  var foldOpen = !!(foldEl && foldEl.open);
  var tmp = document.createElement("div");
  tmp.innerHTML = clauseRowHtml(c);
  var next = tmp.firstChild;
  var nextFold = next.querySelector(".done-fold");
  if (nextFold) nextFold.open = foldEl ? foldOpen : true;
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
  // 판정을 남겨도 카드를 다른 그룹이나 최하단으로 이동시키지 않는다. 위치가 유지되어야
  // 판정 직후 같은 자리에서 메모를 이어 쓸 수 있다.
  var uncovered = _considerList.filter(function (r) { return !subCov[r.cpId] && !refCov[r.cpId]; });
  var covered = _considerList.filter(function (r) { return subCov[r.cpId]; });
  var referenced = _considerList.filter(function (r) { return !subCov[r.cpId] && refCov[r.cpId]; });
  var items = uncovered.map(renderConsiderItem).join("") || '<p class="compare-empty">확인할 항목 없음</p>';
  function bundleRows(rows, kind) {
    if (!rows.length) return "";
    var groups = {}, order = [];
    rows.forEach(function (r) {
      var cov = kind === "subdoc" ? subCov[r.cpId] : refCov[r.cpId];
      var title = String((cov && (cov.docName || cov.title)) || "개인(신용)정보 보안관리약정서");
      if (!groups[title]) { groups[title] = []; order.push(title); }
      groups[title].push(r);
    });
    return order.map(function (title) {
      var list = groups[title];
      var confirmed = list.every(function (r) { return _subdocConfirmedForCp(r.cpId); });
      var badge = confirmed
        ? (kind === "subdoc" ? "✓ 부속서류 사용 확인" : "✓ 표준약정서 사용 확인")
        : (kind === "subdoc" ? "◇ 업로드 서류 확인 필요" : "◇ 약정서 참조 확인 필요");
      var hint = confirmed
        ? "검토자가 이 약정서의 체결·사용을 확인했습니다. 세부 항목은 묶음으로 반영됩니다."
        : (kind === "subdoc"
          ? "업로드한 서류에서 관련 문구를 찾았습니다. 적용 대상·체결 상태를 확인한 뒤 위 약정서 사용 항목을 체크하세요."
          : "계약서에서 약정서 참조를 찾았습니다. 실제 체결·첨부·작성항목 완성 여부를 확인한 뒤 위 약정서 사용 항목을 체크하세요.");
      return '<details class="subdoc-bundle ' + (confirmed ? "bundle-confirmed" : "bundle-referenced") + '">' +
        '<summary><span class="badge ' + (confirmed ? "cov-subdoc" : "cov-refdoc") + '">' + badge +
        '</span><strong>' + esc(title) + '</strong><span class="bundle-count">' + list.length +
        '개 항목</span><span class="bundle-action">세부내역</span></summary>' +
        '<p class="consider-hint">' + hint + '</p><div class="subdoc-bundle-items">' +
        list.map(renderConsiderItem).join("") + "</div></details>";
    }).join("");
  }
  var coveredHtml = bundleRows(covered, "subdoc");
  var referencedHtml = bundleRows(referenced, "referenced");
  block.innerHTML =
    '<div class="consider-panel"><h3><span class="badge cov-consider">! 적용·보완 판단 필요</span> 계약 적용 여부 또는 내용 보완을 판단할 항목' +
    '<span class="consider-sub">' + esc(considerCountText()) + "</span></h3>" +
    '<p class="consider-hint">판정을 남겨도 항목 위치는 바뀌지 않습니다. 같은 자리에서 확인 메모나 검토의견을 이어 작성하세요.</p>' +
    items + coveredHtml + referencedHtml + "</div>";
  bindReassign(block); // 오부착 재지정(11.7차) — 부재 알람에서도 실제 조항 지정 가능
  bindVerdictControls(block, function (cpId) {
    withVerdictAnchor("#consider-block", cpId, renderConsiderBlock);
    refreshClauseCounts();
    renderSuggestions();
    renderReport();
  });
}

// 판정 변경 후 경량 갱신(구 refreshClauseCounts 개편) — 헤더 진행률·검토제안 앵커·행 좌측 상태색.
// 행 본문은 건드리지 않음(상태색은 클래스 토글만) — 스크롤 위치·입력 포커스 보존.
function refreshClauseCounts() {
  var p = verdictProgress();
  var totalPending = pendingReviewCount();
  var prog = document.getElementById("clause-progress");
  if (prog) prog.textContent = totalPending === 0
    ? "필요한 검토 완료"
    : "추가 검토 " + totalPending + "건 남음";
  var anchor = document.getElementById("consider-anchor");
  if (anchor) {
    // 미판정만 카운트(피드백 3차) — 판정을 찍으면 즉시 감소, 전부 판정되면 완료 표기로 전환.
    var pendingN = considerPendingCount();
    anchor.hidden = !_considerList.length;
    anchor.textContent = pendingN ? "적용·보완 판단 " + pendingN + "건" : "✓ 필요한 검토 완료";
    anchor.classList.toggle("consider-anchor-done", !pendingN);
    anchor.title = considerCountText();
  }
  var aa = document.getElementById("action-anchor");
  if (aa) {
    var actionN = actionQueuePendingCount();
    aa.hidden = !actionN;
    aa.textContent = "별도 자료 확인 " + actionN + "건";
  }
  // 요약 스트립(2026-08-03): 살펴볼 앵커·형식 경고·완료 CTA — 판정 변경 시마다 갱신.
  var va = document.getElementById("verify-anchor");
  if (va) {
    var vp = verifyPendingInfo();
    va.hidden = !vp.count;
    va.textContent = "문구 확인 " + vp.count + "건";
  }
  var ff = document.getElementById("formal-flag");
  if (ff) {
    var fwN = (state.formal || []).filter(function (f) { return f.status === "warn"; }).length;
    ff.hidden = !fwN;
    ff.textContent = "형식 경고 " + fwN + "건";
  }
  var cta = document.getElementById("review-done-cta");
  if (cta) cta.hidden = !(state.result && pendingReviewCount() === 0);
  var quick = document.getElementById("quick-review-ok");
  if (quick) {
    var quickN = ((state.result && state.result.results) || []).filter(function (r) {
      var v = verdictStore[r.cpId];
      return (reviewRouteFor(r).route === "quick" || _sentenceQuick(r)) && !(v && v.verdict);
    }).length;
    quick.hidden = !quickN;
    quick.textContent = "빠른 확인 " + quickN + "건 → 이상없음";
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
  var actionAnchor = document.getElementById("action-anchor");
  if (actionAnchor) actionAnchor.addEventListener("click", function () {
    var actionBlock = document.getElementById("action-queue-block");
    if (actionBlock) scrollToClauseEl(actionBlock);
  });
  var a = document.getElementById("consider-anchor");
  if (a) a.addEventListener("click", function () {
    var block = document.getElementById("consider-block");
    if (block) scrollToClauseEl(block);
  });
})();

// 리포트 특정 섹션으로 이동 — 리포트 탭 활성 후 스크롤(스트립 형식 경고·타일 외부 진입용).
function gotoReportSection(id) {
  document.querySelector('.tab[data-tab="report"]').click();
  var sec = document.getElementById(id);
  if (!sec) return;
  if (sec.tagName === "DETAILS") sec.open = true;
  sec.scrollIntoView({ block: "start" });
}

// 요약 스트립 정적 바인딩(2026-08-03) — 살펴볼 앵커는 미검토 verify 조항 행을 순환 점프,
// 형식 경고는 리포트 형식 섹션으로, 완료 CTA는 종합 리포트로.
(function () {
  var va = document.getElementById("verify-anchor");
  var cycleAt = -1;
  if (va) va.addEventListener("click", function () {
    var rows = verifyPendingInfo().rows;
    if (!rows.length) return;
    cycleAt = (cycleAt + 1) % rows.length;
    gotoClause(rows[cycleAt]);
  });
  var ff = document.getElementById("formal-flag");
  if (ff) ff.addEventListener("click", function () { gotoReportSection("rpt-sec-formal"); });
  var cta = document.getElementById("review-done-cta");
  if (cta) cta.addEventListener("click", function () {
    document.querySelector('.tab[data-tab="report"]').click();
    window.scrollTo(0, 0);
  });
})();

// 리포트 딥링크(§2.3-3) — 조항별 검토 탭 활성 + 해당 조항 행으로 스크롤·하이라이트 플래시.
// ci: 조항 index(문자열 허용), "consider"(부재 알람), "action"(별도 자료 확인).
function gotoClause(ci) {
  document.querySelector('.tab[data-tab="clauses"]').click();
  var el = ci === "consider" ? document.getElementById("consider-block")
    : ci === "action" ? document.getElementById("action-queue-block")
    : document.querySelector('#clause-rows .clause-row[data-ci="' + ci + '"]');
  if (!el) return;
  scrollToClauseEl(el);
  el.classList.remove("row-flash");
  void el.offsetWidth; // 연속 클릭 시 애니메이션 재트리거용 리플로우
  el.classList.add("row-flash");
}

/* ---------- 체크 위치 재지정(11.7차) ----------
   자동 매칭이 엉뚱한 조항에 붙었을 때의 절차적 난점 해소(사용자 피드백 2026-08-05):
   "다른 조항에 반영된 것 같은데 엉뚱한 조항에 체크가 붙어 있으니 확인이 어렵다".
   → 검토자가 그 자리에서 올바른 조항으로 옮길 수 있게 한다. 옮긴 기록은 계약서별로
   저장되어 재분석해도 유지되고, 지식 개선 신호(loop)로도 회수 가능. */
var REASSIGN_CONTRACT = "__contract__";
var REASSIGN_CONFIRM = "__confirm__";
function reassignKey(hash) { return "cr-reassign-" + hash; }
function matchConfirmKey(hash) { return "cr-match-confirm-" + hash; }
function normalizeReassignMap(raw) {
  var out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(function (cpId) {
    var value = raw[cpId];
    if (value === REASSIGN_CONTRACT || (typeof value === "number" && Number.isInteger(value) && value >= 0))
      out[cpId] = value;
  });
  return out;
}
function loadReassign() {
  try { state.reassign = normalizeReassignMap(JSON.parse(localStorage.getItem(reassignKey(verdictHash)) || "{}")); }
  catch (e) { state.reassign = {}; }
}
function saveReassign() {
  try { localStorage.setItem(reassignKey(verdictHash), JSON.stringify(state.reassign || {})); } catch (e) {}
}
function normalizeMatchConfirmMap(raw) {
  var out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(function (cpId) { if (raw[cpId] === true) out[cpId] = true; });
  return out;
}
function loadMatchConfirm() {
  try { state.matchConfirm = normalizeMatchConfirmMap(JSON.parse(localStorage.getItem(matchConfirmKey(verdictHash)) || "{}")); }
  catch (e) { state.matchConfirm = {}; }
}
function saveMatchConfirm() {
  try { localStorage.setItem(matchConfirmKey(verdictHash), JSON.stringify(state.matchConfirm || {})); } catch (e) {}
}
// 분석기가 산출한 값을 화면 재배치와 분리한다. renderClauses가 여러 번 호출되어도 이 스냅샷은
// 바뀌지 않으므로 재지정 전 Top1을 정확도·태그 학습의 rule 값으로 계속 사용할 수 있다.
function snapshotRuleMatches() {
  ((state.result && state.result.results) || []).forEach(function (r) {
    r.ruleBest = r.best ? JSON.parse(JSON.stringify(r.best)) : null;
    r.ruleCoverage = r.coverage;
  });
}
// 재지정된 체크의 best를 그 조항으로 교체. coverage가 quiet이었어도 검토자가 지목했으므로
// verify(함께 살펴볼)로 올려 화면에 세운다 — 사람이 "여기 있다"고 한 것이 기계 점수보다 우선.
function applyReassign() {
  var map = state.reassign || {};
  (state.result ? state.result.results : []).forEach(function (r) {
    if (Object.prototype.hasOwnProperty.call(r, "ruleBest"))
      r.best = r.ruleBest ? JSON.parse(JSON.stringify(r.ruleBest)) : null;
    if (r.ruleCoverage) r.coverage = r.ruleCoverage;
    var ci = map[r.cpId];
    r.opinionScope = null;
    r.reassigned = false;
    if (ci === undefined || ci === null) return;
    if (ci === REASSIGN_CONTRACT) {
      r.opinionScope = "contract";
      r.reassigned = false;
      return;
    }
    if (!state.clauses[ci]) return;
    r.best = { clauseIndex: ci, score: (r.best && r.best.score) || 0,
      reasons: ["검토자가 이 조항으로 지정함"], gate: (r.best && r.best.gate) || null };
    if (r.coverage === "quiet" || r.coverage === "consider") r.coverage = "verify";
    r.reassigned = true;
  });
}
// 재지정 UI — 체크 카드에 붙는 "다른 조항으로" 선택. 후보(자동 상위 3개)를 앞에 노출하고
// 전체 조항 목록도 제공. 원위치 복귀도 가능.
function reassignControlHtml(r) {
  var cp = _cpById(r.cpId);
  if (!cp) return "";
  var cur = (state.reassign || {})[r.cpId];
  var confirmed = !!(state.matchConfirm || {})[r.cpId];
  var ranked = (r.ranked || []).map(function (rk) { return rk.clauseIndex; });
  var opts = ['<option value=""' + (cur === undefined && !confirmed ? " selected" : "") + '>대상 확인 필요</option>'];
  if (r.ruleBest) opts.push('<option value="' + REASSIGN_CONFIRM + '"' + (confirmed ? " selected" : "") +
    '>이 조항이 맞음 (자동매칭 확인)</option>');
  opts.push(
    '<option value="' + REASSIGN_CONTRACT + '"' + (cur === REASSIGN_CONTRACT ? " selected" : "") +
      '>전체 계약서 (특정 조항 아님)</option>');
  // 자동 후보 먼저(왜 이 조항들이 후보인지 점수와 함께)
  (r.ranked || []).forEach(function (rk) {
    // 원래 Top1은 위의 '이 조항이 맞음'으로 확인한다. 같은 조항을 '재지정'으로 기록하는
    // 모순 표본이 생기지 않도록 숫자 후보에서는 제외한다.
    if (r.ruleBest && rk.clauseIndex === r.ruleBest.clauseIndex) return;
    var c = state.clauses[rk.clauseIndex];
    if (!c) return;
    opts.push('<option value="' + rk.clauseIndex + '"' + (cur === rk.clauseIndex ? " selected" : "") + ">" +
      "후보 · " + esc(String(c.heading || "").slice(0, 24)) + " (" + rk.score.toFixed(0) + ")</option>");
  });
  // 전체 조항(후보 제외)
  state.clauses.forEach(function (c, i) {
    if (ranked.indexOf(i) !== -1) return;
    opts.push('<option value="' + i + '"' + (cur === i ? " selected" : "") + ">" +
      esc(String(c.heading || ("조항#" + i)).slice(0, 28)) + "</option>");
  });
  return '<label class="reassign-ctl" title="이 검토항목·의견이 귀속될 대상을 지정합니다">' +
    '<span class="reassign-lbl">의견 대상</span>' +
    '<select class="reassign-sel" data-rcp="' + esc(r.cpId) + '" name="reassign-' + esc(r.cpId) + '">' +
    opts.join("") + "</select>" +
    (r.opinionScope === "contract" ? ' <span class="reassign-mark contract-scope-mark">계약 전반 의견</span>' :
      (r.reassigned ? ' <span class="reassign-mark">검토자 지정</span>' :
        (confirmed ? ' <span class="reassign-mark match-confirm-mark">자동매칭 확인</span>' : ""))) + "</label>";
}
function bindReassign(root) {
  root.querySelectorAll(".reassign-sel").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var cp = sel.getAttribute("data-rcp");
      delete state.matchConfirm[cp];
      if (sel.value === "") delete state.reassign[cp];
      else if (sel.value === REASSIGN_CONFIRM) {
        delete state.reassign[cp];
        state.matchConfirm[cp] = true;
      } else state.reassign[cp] = sel.value === REASSIGN_CONTRACT ? REASSIGN_CONTRACT : Number(sel.value);
      saveReassign();
      saveMatchConfirm();
      var y = window.scrollY;
      runAnalysis();
      window.scrollTo(0, y);
    });
  });
}

function renderClauses() {
  applyReassign(); // 수동 재지정 반영(11.7차) — 자동 매칭 위에 검토자 지정을 덮어씀
  // results를 best.clauseIndex로 역인덱싱 — coverage별 그룹
  var byClause = {};
  var considerList = [];
  var contractWide = [];
  var actionQueue = [];
  state.result.results.forEach(function (r) {
    if (r.opinionScope === "contract") { contractWide.push(r); return; }
    var action = actionForResult(r);
    if (action.action === "verify_elsewhere" && (!r.best || r.coverage === "quiet" || r.coverage === "consider")) {
      actionQueue.push(r); return;
    }
    if (r.coverage === "consider") { considerList.push(r); return; }
    if (!r.best || r.coverage === "quiet") return;
    var ci = r.best.clauseIndex;
    var g = byClause[ci] || (byClause[ci] = { addressed: [], verify: [] });
    if (r.coverage === "addressed") g.addressed.push(r);
    else if (r.coverage === "verify") g.verify.push(r);
  });
  // ② 카드 순서: 필수·권장 먼저, 참고 뒤 — 전부 펼침(접기는 클릭 부담이 커서 폐기, 2026-07-29 사용자 피드백).
  Object.keys(byClause).forEach(function (k) {
    byClause[k].addressed.sort(function (a, b) { return _reviewRouteRank(a) - _reviewRouteRank(b); });
    byClause[k].verify.sort(function (a, b) {
      var rr = _reviewRouteRank(a) - _reviewRouteRank(b);
      if (rr) return rr;
      var ca = _cpById(a.cpId), cb = _cpById(b.cpId);
      return (ca && ca.severity === "참고" ? 1 : 0) - (cb && cb.severity === "참고" ? 1 : 0);
    });
  });
  // 부재 알람 심각도순(필수 먼저)
  considerList.sort(function (a, b) {
    var rr = _reviewRouteRank(a) - _reviewRouteRank(b);
    if (rr) return rr;
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
      : "<span>① 계약서 원문</span><span>② 확인 완료(자동·수동)</span><span>③ 검토할 항목·의견</span>";
  }
  rowsEl.innerHTML = state.clauses.map(clauseRowHtml).join("");
  rowsEl.querySelectorAll(".clause-row").forEach(bindRowControls);
  renderActionQueueBlock(actionQueue);
  renderContractOpinionBlock(contractWide);
  renderDocumentReviewBlock();
  renderConsiderBlock();
  renderCompareHeader();
  renderRemovedBlock();
  refreshClauseCounts();
}

function renderActionQueueBlock(items) {
  var block = document.getElementById("action-queue-block");
  if (!block) return;
  if (!items.length) { block.innerHTML = ""; return; }
  items.sort(function (a, b) {
    var ca = _cpById(a.cpId), cb = _cpById(b.cpId);
    var sa = SEV_RANK[ca && ca.severity]; if (sa === undefined) sa = 3;
    var sb = SEV_RANK[cb && cb.severity]; if (sb === undefined) sb = 3;
    return sa - sb;
  });
  block.innerHTML = '<section class="action-queue-panel"><h3><span class="badge contract-action action-verify_elsewhere">별도 자료에서 확인</span> ' +
    '부속서류·증빙·내부 운영자료 확인</h3>' +
    '<p class="consider-hint">법적으로 확인할 항목이지만 주계약 문구를 곧바로 수정할 사항은 아닙니다. 보안관리약정서, 동의서·고지자료, 승인·평가·점검자료에서 충족 여부를 확인하세요.</p>' +
    items.map(renderConsiderItem).join("") + "</section>";
  bindReassign(block);
  bindVerdictControls(block, function (cpId) {
    withVerdictAnchor("#action-queue-block", cpId, renderClauses);
    renderSuggestions(); renderReport();
  });
}

function renderContractOpinionBlock(items) {
  var block = document.getElementById("contract-opinion-block");
  if (!block) return;
  if (!items.length) { block.innerHTML = ""; return; }
  items.sort(function (a, b) {
    var ca = _cpById(a.cpId), cb = _cpById(b.cpId);
    return (SEV_RANK[ca && ca.severity] || 0) - (SEV_RANK[cb && cb.severity] || 0);
  });
  block.innerHTML = '<section class="contract-opinion-panel"><h3><span class="badge contract-scope-badge">계약 전반</span> ' +
    '특정 조항에 한정되지 않는 검토항목·의견</h3>' +
    '<p class="consider-hint">아래 의견은 개별 조항 수정이 아니라 계약 구조·거래 전체를 기준으로 종합 리포트에 반영됩니다.</p>' +
    items.map(function (r) { return renderCompareItem(r, false); }).join("") + "</section>";
  bindReassign(block);
  bindVerdictControls(block, function (cpId) {
    withVerdictAnchor("#contract-opinion-block", cpId, renderClauses);
    renderSuggestions();
    renderReport();
  });
}

function renderDocumentReviewBlock() {
  var block = document.getElementById("document-review-block");
  if (!block) return;
  var contractManual = _manualFindings().filter(function (f) { return f.scope === "contract"; });
  var decisions = (state.findingStore && state.findingStore.decisions) || {};
  var integrity = state.integrityFindings || [];
  function integrityCard(f) {
    var d = decisions[f.id] || {};
    var status = { opinion: "검토의견 반영", no_issue: "문제없음", dismissed: "오탐 제외" }[d.decision] || "확인 필요";
    return '<article class="integrity-card integrity-' + esc(d.decision || "pending") + '">' +
      '<div class="manual-finding-head"><span class="badge integrity-rule-badge">문서 완결성</span>' +
      '<span class="badge confidence-' + esc(f.confidence) + '">' + (f.confidence === "high" ? "높은 확신" : "확인 제안") + '</span>' +
      '<strong>' + esc(f.title) + '</strong><span class="integrity-status">' + esc(status) + '</span></div>' +
      '<p>' + esc(f.detail) + '</p>' +
      '<textarea class="integrity-comment" rows="2" placeholder="판단 메모 또는 종합의견에 반영할 문구">' + esc(d.comment || "") + '</textarea>' +
      '<div class="manual-finding-actions"><button class="ghost integrity-goto" data-ci="' + esc(f.clause_index) + '">원문 보기</button>' +
      '<button class="ghost integrity-decision" data-id="' + esc(f.id) + '" data-decision="opinion">검토의견 반영</button>' +
      '<button class="ghost integrity-decision" data-id="' + esc(f.id) + '" data-decision="no_issue">문제없음</button>' +
      '<button class="ghost integrity-decision" data-id="' + esc(f.id) + '" data-decision="dismissed">오탐</button></div></article>';
  }
  block.innerHTML = '<section class="document-review-panel"><div class="document-review-head"><div><h3>계약서 단위 검토</h3>' +
    '<p>체크리스트에 없는 의견을 직접 남기고, 조 번호·내부 인용·별첨의 완결성을 확인합니다.</p></div>' +
    '<button class="primary manual-finding-add" data-ci="">+ 계약 전반 의견</button></div>' +
    _findingEditorHtml(null) +
    (contractManual.length ? '<div class="document-review-group"><h4>직접 작성한 계약 전반 의견 (' + contractManual.length + ')</h4>' +
      contractManual.map(_manualFindingCardHtml).join("") + '</div>' : '') +
    (integrity.length ? '<details class="integrity-fold"' + (integrity.some(function (f) { return f.confidence === "high" && !decisions[f.id]; }) ? ' open' : '') +
      '><summary>문서 완결성 확인 ' + integrity.length + '건</summary><p class="consider-hint">자동 발견은 오류 확정이 아닙니다. 원문을 확인한 뒤 처리 상태를 선택하세요.</p>' +
      integrity.map(integrityCard).join("") + '</details>' : '<p class="document-integrity-ok">문서 내 조 번호·인용·별첨에서 확인할 구조 오류를 찾지 못했습니다.</p>') +
    '</section>';
  bindFindingControls(block);
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
  // 사유가 있으면 함께 노출(11.5차) — 같은 '이상없음'이라도 반영되어 있어서인지
  // 우리 케이스에 해당사항이 없어서인지가 리포트에서 구분되어야 함.
  return ' <span class="vd-badge ' + VERDICT_CLS[v.verdict] + '">' + esc(v.verdict) + "</span>" +
    (v.reason ? ' <span class="vd-reason-badge">' + esc(v.reason) + "</span>" : "");
}
// 리포트 = 2단 구성(#5 재구성): 좌=계약서 문안+검토의견 코멘트 / 우=종합 서술형 리포트.
function renderReport() {
  var r = state.result;

  // 분류
  var addressed = [], verify = [], consider = [], baseCovered = [];
  r.results.forEach(function (res) {
    var cp = _cpById(res.cpId);
    if (!cp) return;
    var it = { cp: cp, res: res, severity: cp.severity };
    if (res.coverage === "addressed") addressed.push(it);
    else if (res.coverage === "verify") verify.push(it);
    else if (res.coverage === "consider") consider.push(it);
    // 변경합의서 국면(11차): 원계약이 다루는 항목 — 알람 아님. 별도 접힘 구역으로만 표시.
    else if (res.coverage === "base_covered") baseCovered.push(it);
  });
  addressed.sort(_sevSort); verify.sort(_sevSort); consider.sort(_sevSort); baseCovered.sort(_sevSort);
  // 확인 권장(verify) 중 참고는 하단 별첨(ref-fold)으로 — 결론·본문 카운트는 필수·권장(verifyMain) 기준.
  var verifyMain = verify.filter(function (it) { return it.severity !== "참고"; });
  var verifyRef = verify.filter(function (it) { return it.severity === "참고"; });
  // 필수 consider를 부속서류 커버 여부로 분리(#3).
  // 판정 반영(팀 피드백 3차): 판정을 찍은 항목은 검토를 마친 것 — 알람(확인 안 된 항목)에서 이탈.
  // coverage(매칭 결과)는 불변, 표시·집계 레이어에서만 분리. 검토의견 판정분은 "검토의견 개진"
  // 구역이 담당하고, 이상없음 판정분은 "판정 완료" 소구역으로 이동.
  // (구 #① 해당없음 선제 제외(_isNA)는 폐기 — 지금은 모든 판정이 알람에서 이탈시키므로 중복이고,
  //  해당없음 판정분이 "판정 완료" 소구역·타일 M/N 집계에서 사라지는 불일치만 만들었음. 피드백 5차)
  function _verdictOf(cp) { var v = verdictStore[cp.id]; return (v && v.verdict) || ""; }
  var subCov = state.subDocCov || {};
  var refCov = state.refCov || {}; // 별첨 참조(#4) — 기계매칭(subCov) 우선
  var mustAll = consider.filter(function (it) { return it.severity === "필수"; });
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
  var recConsider = recAll.filter(function (it) { return _requiresDecision(it.res) && !_verdictOf(it.cp); });
  var alarmJudged = mustCoreAll.concat(mustCondAll, recAll).filter(function (it) { return _verdictOf(it.cp); });
  var alarmDone = alarmJudged.filter(function (it) { return _verdictOf(it.cp) !== "검토의견"; }); // 이상없음 → 판정 완료 소구역
  var alarmN = mustCoreAll.length + mustCondAll.length + recAll.length; // 전체 알람 모수(고정 분모)
  var alarmPending = mustCore.length + mustCond.length + recConsider.length; // 미확인(미판정)
  // 미검토 잔여(soft gate, 2026-08-03) — 알람 + 함께 살펴볼(필수·권장 verify). pendingReviewCount와 동일 규칙.
  var verifyPend = verifyMain.filter(function (it) { return _requiresDecision(it.res) && !_verdictOf(it.cp); });
  var verifyDone = verifyMain.filter(function (it) { var v = _verdictOf(it.cp); return v && v !== "검토의견"; }); // 이상없음 → 검토 완료 구역
  var projectedFindings = Findings.project(state.findingStore, state.integrityFindings);
  var manualOpinions = projectedFindings.filter(function (f) { return f.finding_source === "manual"; });
  var integrityOpinions = projectedFindings.filter(function (f) {
    return f.finding_source === "integrity_rule" && f.decision === "opinion";
  });
  var integrityPending = projectedFindings.filter(function (f) {
    return f.finding_source === "integrity_rule" && f.decision === "pending" && f.confidence === "high";
  });
  // 계약 관련성(coverage)과 실제 후속조치(action)를 분리한다. 같은 관련 문구라도
  // 계약서 수정, 별도 자료 확인, 회사 유불리 검토, 수정 불필요의 행선지가 서로 다르다.
  var actionAll = r.results.map(function (res) {
    var cp = _cpById(res.cpId);
    return cp ? { cp: cp, res: res, severity: cp.severity, action: actionForResult(res) } : null;
  }).filter(Boolean);
  var contractActionPending = actionAll.filter(function (it) {
    return ["add_or_modify", "remove"].indexOf(it.action.action) !== -1 && !_verdictOf(it.cp);
  });
  var actionHoldPending = actionAll.filter(function (it) {
    return it.action.action === "hold" && !_verdictOf(it.cp);
  });
  var externalPending = actionAll.filter(function (it) {
    return it.action.action === "verify_elsewhere" && !_verdictOf(it.cp);
  });
  var negotiationItems = actionAll.filter(function (it) {
    return it.action.action === "negotiate" && it.res.coverage !== "quiet";
  });
  var pendingN = contractActionPending.length + actionHoldPending.length + externalPending.length + integrityPending.length;

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
        scope: res.opinionScope === "contract" ? "contract" : "clause",
        loc: res.opinionScope === "contract" ? "" : (res.best ? _clauseHeading(res.best.clauseIndex) : ""),
        ci: res.opinionScope === "contract" ? null : (res.best && res.coverage !== "consider" ? res.best.clauseIndex : "consider") });
    }
  });
  var findingOpinionData = manualOpinions.map(function (f) {
    var a = (f.anchors || [])[0];
    return { label: f.title || "직접 검토의견", severity: f.severity, scope: f.scope === "contract" ? "contract" : "clause",
      loc: a ? (a.heading || _clauseHeading(a.clause_index)) : "", comment: f.comment || "" };
  }).concat(integrityOpinions.map(function (f) {
    return { label: f.title, severity: f.severity, scope: "clause", loc: f.heading || _clauseHeading(f.clause_index),
      comment: f.decision_comment || f.detail || "" };
  }));

  // 리포트 딥링크(§2.3-3) — 항목 클릭 시 조항별 검토 탭의 해당 조항 행으로 점프.
  function _gotoBtn(ci) {
    return ' <button class="rpt-goto" data-ci="' + esc(String(ci)) + '">조항 보기 →</button>';
  }

  var right = '<div class="report-summary"><h3>종합 리포트</h3>';

  // 검토 관점 명시(11.1차): 국면에 따라 "무엇을 보는 검토인지"가 달라지므로 리포트 첫머리에 고정.
  // 수익자 국면은 준수 점검이 아니라 "우리에게 불리하지 않은가"를 보는 검토임.
  if (state.stance === "beneficiary") {
    right += '<div class="report-stance-banner">' +
      "<strong>수익자·투자자 관점 검토</strong> — 당사는 이 계약의 의무주체가 아니라 " +
      "수익자로 참여함. 따라서 “당사가 규제를 준수하는가”가 아니라 " +
      "<em>“계약 내용이 수익자인 당사에게 불리하게 구성되어 있지 않은가”</em>를 봅니다. " +
      "운용사·판매회사가 준수 주체인 항목은 반영 여부 확인 수준으로만 표시됩니다." +
      (state.partyRoles && state.partyRoles.length
        ? ' <span class="stance-roles">계약상 당사 지위: ' + esc(state.partyRoles.join("·")) + "</span>" : "") +
      "</div>";
  }

  // 용역 성질결정 안내(12차): 부재알람이 성질 게이트로 접힌 경우 이유를 리포트에 명시 —
  // 조용한 억제는 "왜 이 항목이 안 보이지"라는 혼란을 낳으므로 판별 근거와 함께 노출.
  var svcNat = state.result && state.result.serviceNature;
  var svcGatedN = ((state.result && state.result.results) || [])
    .filter(function (r) { return r.serviceGated; }).length;
  if (svcNat && svcNat.nature && svcGatedN) {
    right += '<div class="report-stance-banner">' +
      "<strong>용역 성질: " + (svcNat.nature === "completion" ? "결과완성형(도급)" : "사무처리형(위임)") +
      "</strong> — 계약서 문언(근거어: " + esc(svcNat.hits.slice(0, 4).join("·")) + ")으로 판별. " +
      (svcNat.nature === "mandate"
        ? "위임형 용역에는 민법상 하자담보책임이 적용되지 않아(선관주의·채무불이행 체계) 도급 하자담보 부재알람 " + svcGatedN + "건을 표시하지 않습니다. 계약서에 하자보수 조항이 실제로 있으면 검토 대상으로 유지됩니다."
        : "도급형 용역이라 위임형 전용 항목의 부재알람 " + svcGatedN + "건을 표시하지 않습니다.") +
      "</div>";
  }

  // 개인정보 관계 태그(14차): 처리위탁 문서의 보호조항에 들어 있는 "제3자 제공 금지"를
  // 실제 제3자 제공으로 읽지 않았다는 사실과 제외 건수를 설명한다.
  var dataRel = state.result && state.result.dataRelationship;
  var relGatedN = ((state.result && state.result.results) || [])
    .filter(function (r) { return r.relationshipGated; }).length;
  if (dataRel && dataRel.kind !== "unknown" && relGatedN) {
    var relLabel = {
      processing_outsourcing: "개인정보 처리위탁",
      third_party_provision: "개인정보 제3자 제공",
      mixed: "처리위탁·제3자 제공 혼합"
    }[dataRel.kind] || dataRel.kind;
    var prohibitedN = ((dataRel.evidence || {}).third_party_provision_prohibited || []).length;
    right += '<div class="report-stance-banner data-relation-banner"><strong>개인정보 관계: ' +
      esc(relLabel) + '</strong> — 문장별 주제·행위·금지 태그를 함께 판독했습니다. ' +
      (prohibitedN ? '“제3자 제공 금지” 문구 ' + prohibitedN + '건은 실제 제공 신호에서 제외했고, ' : '') +
      '관계가 맞지 않는 체크 ' + relGatedN + '건은 표시하지 않았습니다.</div>';
  }

  // 추가 판단이 필요한 항목만 안내한다. 이미 반영된 항목·일반 권장은 클릭 완료를 요구하지 않는다.
  if (pendingN) {
    right += '<div class="report-pending-banner">추가 검토 필요 ' + pendingN +
      "건 — 계약 원문을 확인하고 이상없음 또는 검토의견으로 판정하면 결론에 반영됩니다. " +
      '<button class="rpt-goto-review primary">조항별 검토로 이동 →</button></div>';
  }

  // 종합 검토의견 — 기존 한 줄 결론 배너 대체. 자동 초안(판정 변경 시 즉시 재조립),
  // 사용자가 수정하면 수정본 우선 유지 + "자동 초안으로 재생성" 제공.
  var cmp = state.compare && state.compare.mapping ? state.compare : null;
  var savedOp = opinionStoreLoad();
  var opEdited = !!(savedOp && savedOp.edited);
  var opText = opEdited ? String(savedOp.text || "") : Verdict.composeOpinion({
    name: _contractName(),
    clauseCount: state.clauses.length,
    typeName: (typeDoc(state.typeId) || { meta: {} }).meta.type_name || null,
    contractActionLabels: contractActionPending.map(function (it) { return cpLabel(it.cp); }),
    holdLabels: actionHoldPending.map(function (it) { return cpLabel(it.cp); }),
    externalCheckLabels: externalPending.map(function (it) { return cpLabel(it.cp); }),
    negotiationLabels: negotiationItems.map(function (it) { return cpLabel(it.cp); }),
    opinions: flagged.map(function (o) {
      return { label: cpLabel(o.cp), severity: o.cp.severity, scope: o.scope, loc: o.loc, comment: o.comment };
    }).concat(findingOpinionData),
    formalWarnTitles: formalWarns.map(function (f) { return f.title; }),
    // 비교 모드(재검토): 전년 대비 요지 1문장 — 기존 호출 무영향(옵션 인자).
    compare: cmp ? { date: (cmp.meta || {}).date, changed: cmp.counts.changed,
      added: cmp.counts.added, removed: cmp.counts.removed } : undefined
  });
  _lastOpinionText = opText; // 내보내기(verdict JSON meta)용 캐시
  right += '<div class="report-opinion"><div class="ro-head"><span class="ro-label">종합 검토의견</span>' +
    '<span class="ro-mode">' + (opEdited ? "수정본" : (pendingN ? "자동 초안 — 추가 판단 " + pendingN + "건" : "자동 초안")) + "</span>" +
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

  // 리포트 타일은 사람의 업무 상태만 표시한다. 시스템의 원문 검색 결과는 조항별 검토에서만 안내.
  function _tile(anchor, cls, label, num, sub) {
    return '<button class="tile ' + cls + '" data-anchor="' + anchor + '">' +
      '<span class="tile-label">' + label + '</span><span class="tile-num">' + num + "</span>" +
      (sub ? '<span class="tile-sub">' + sub + "</span>" : "") + "</button>";
  }
  // 타일 문구 풀어쓰기(팀 피드백 2026-07): 압축어 라벨 폐기 — 설명형 라벨 + 한 줄 부연(작은 글씨).
  // 타일 재구성(2026-08-03 재설계): 결론 중심 — 진행률 첫자리 승격(미검토 시 클릭=조항별 검토로 유도),
  //   검토 결과 분포 신설(이상없음·검토의견). '함께 살펴볼' 타일은 폐지 — 검토 행위가
  //   조항별 검토 탭으로 일원화되며 잔여분은 진행률 부연으로 흡수.
  // N/M 분모 시맨틱(피드백 5~6차)은 유지: 진행형 분수는 진행률·확인 안 됨 타일만,
  //   반영·형식은 단독 수(전수 대비 오독 방지 — 모수는 부연에만).
  var formalN = (state.formal || []).length;
  right += '<div class="report-tiles">' +
    _tile("__review__", "tile-progress" + (pendingN ? " tile-pending" : ""), "검토 상태",
      (pendingN ? pendingN + "건 남음" : "완료"),
      (pendingN ? "확인이 필요한 항목이 남아 있음" : "필요한 검토를 모두 마침")) +
    _tile("rpt-sec-results", "tile-verdict", "검토 결과",
      (vsum.total + manualOpinions.length + integrityOpinions.length) + "건",
      "체크항목: 이상없음 " + vsum["이상없음"] + " · 검토의견 " + vsum["검토의견"] +
      (manualOpinions.length || integrityOpinions.length ? " · 직접/완결성 의견 " + (manualOpinions.length + integrityOpinions.length) : "") +
      (vsum.reasons["해당사항 없음"] ? " (해당사항 없음 " + vsum.reasons["해당사항 없음"] + ")" : "")) +
    _tile("rpt-sec-integrity", "tile-integrity", "문서 완결성",
      (integrityPending.length ? integrityPending.length + "건 확인" : "확인 완료"),
      "조 번호·내부 인용·별첨 점검") +
    _tile("rpt-sec-formal", "tile-formal", "형식 점검",
      (formalWarns.length ? formalWarns.length + "건 확인" : "이상 없음"),
      "상호·대표자·주소 등 " + formalN + "개 항목 점검") +
    "</div>";

  // 결론 화면(2026-08-03): 항목명+딥링크만 — 근거·표준문안 등 작업용 상세는 조항별 검토 탭이 담당.
  function _pendingItem(it) {
    var ci = it.action && it.action.action === "verify_elsewhere" && !it.res.best
      ? "action" : (it.res.best && it.res.coverage !== "consider" ? it.res.best.clauseIndex : "consider");
    return '<div class="report-item consider-item"><div class="ri-head"><span class="sev sev-' +
      esc(it.cp.severity) + '">' + esc(it.cp.severity) + '</span><span class="ri-q">' +
      labelQ(it.cp) + "</span>" + (it.action ? '<span class="badge contract-action action-' +
        esc(it.action.action) + '">' + esc(it.action.label) + '</span>' : '') + _gotoBtn(ci) + "</div></div>";
  }
  if (contractActionPending.length) {
    right += '<section id="rpt-sec-pending" class="report-sec-block sec-consider"><h4 class="h4-alert">계약서 수정 검토 (' + contractActionPending.length + ")</h4>";
    right += '<p class="sec-hint">계약 문구의 추가·수정 또는 삭제 필요성을 확인할 항목입니다.</p>';
    right += contractActionPending.map(_pendingItem).join("") + "</section>";
  }
  if (externalPending.length) {
    right += '<section id="rpt-sec-external" class="report-sec-block sec-external"><h4>별도 자료 확인 (' + externalPending.length + ")</h4>";
    right += '<p class="sec-hint">주계약을 고칠 항목으로 단정하지 않고 보안관리약정서, 동의서·고지자료, 승인·평가·점검자료에서 확인합니다.</p>';
    right += externalPending.map(_pendingItem).join("") + "</section>";
  }
  if (actionHoldPending.length || integrityPending.length) {
    right += '<section id="rpt-sec-hold" class="report-sec-block sec-consider"><h4 class="h4-alert">추가 확인 필요 (' + (actionHoldPending.length + integrityPending.length) + ")</h4>";
    right += '<p class="sec-hint">계약서 반영 여부, 현재 문구의 충분성 또는 문서 완결성을 확인해야 합니다.</p>';
    right += actionHoldPending.map(_pendingItem).join("") + integrityPending.map(function (f) {
      return '<div class="report-item consider-item"><div class="ri-head"><span class="badge integrity-rule-badge">문서 완결성</span>' +
        '<span class="ri-q">' + esc(f.title) + '</span>' + _gotoBtn(f.clause_index) + '</div><p class="ri-loc">' + esc(f.detail) + '</p></div>';
    }).join("") + "</section>";
  }
  if (negotiationItems.length) {
    right += '<details id="rpt-sec-negotiate" class="report-sec-block sec-negotiate"><summary>회사 유불리 검토 · 필수 반영 아님 (' + negotiationItems.length + ")</summary>" +
      '<p class="sec-hint">법령상 반드시 넣어야 하는 문구는 아닙니다. 회사에 유리한 조건으로 협의할 필요가 있는지만 살펴보며, 검토 완료를 막지 않습니다.</p>' +
      negotiationItems.map(_pendingItem).join("") + "</details>";
  }

  // 검토 완료 항목은 뒤의 "검토 결과" 안에서 접어서 제공한다. 완료 신호를 별도 초록색
  // 구역으로 반복하지 않고, 상단의 단일 "검토 상태"가 완료 여부를 전담한다.
  var doneItems = alarmDone.concat(verifyDone);

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

  // 형식 점검 — warn 항목만 표시
  if (formalWarns.length) {
    right += '<section id="rpt-sec-formal" class="report-sec-block sec-formal"><h4>형식 점검</h4>';
    // 점검 범위 한정 부연(7차 피드백) — 일반 오타는 룰로 검출 불가
    right += '<p class="sec-hint">당사 고유명사(상호·대표자·주소) 근방의 근사 오기만 점검함 — 일반 오타·빈칸은 점검 범위 밖.</p>';
    right += formalWarns.map(function (f) {
      return '<div class="report-item"><span class="ri-q">' + esc(f.title) + ' — ' + esc(f.detail) + "</span></div>";
    }).join("") + "</section>";
  }

  var integrityAll = projectedFindings.filter(function (f) { return f.finding_source === "integrity_rule"; });
  right += '<section id="rpt-sec-integrity" class="report-sec-block sec-integrity"><h4>문서 완결성</h4>' +
    '<p class="sec-hint">조 번호·내부 조항 인용·항/호 구조·별첨 참조를 기계 점검하고 검토자가 확정한 결과입니다.</p>';
  if (!integrityAll.length) right += '<p class="report-none">확인할 구조 오류를 찾지 못했습니다.</p>';
  else right += integrityAll.map(function (f) {
    var status = { pending: "확인 필요", opinion: "검토의견 반영", no_issue: "문제없음", dismissed: "오탐 제외" }[f.decision];
    return '<div class="report-item integrity-report-item"><div class="ri-head"><span class="badge integrity-rule-badge">' +
      esc(status) + '</span><span class="ri-q">' + esc(f.title) + '</span>' + _gotoBtn(f.clause_index) +
      '</div><p class="ri-loc">' + esc(f.decision_comment || f.detail) + '</p></div>';
  }).join("");
  right += '</section>';

  // 검토 결과 — 내부 용어인 "검토자 판정" 대신 사용자가 확인할 최종 결과를 보여준다.
  // 검토의견은 바로 펼치고, 이상없음으로 끝낸 상세 목록은 감사 추적용 접기로 제공한다.
  right += '<section id="rpt-sec-results" class="report-sec-block sec-opinions"><h4>검토 결과</h4>';
  if (vsum.total) {
    right += '<div class="report-verdict-summary">' +
      '<span class="vd-badge vd-ok">이상없음 ' + vsum["이상없음"] + "</span>" +
      '<span class="vd-badge vd-comment">검토의견 ' + vsum["검토의견"] + "</span>" +
      (vsum.reasons["해당사항 없음"]
        ? '<span class="vd-badge vd-na">해당사항 없음 ' + vsum.reasons["해당사항 없음"] + "</span>" : "") + "</div>";
  }
  function _flaggedHtml(o) {
    return '<div class="opinion-item' + (o.scope === "contract" ? " opinion-contract-wide" : "") +
      '"><div class="ri-head"><span class="sev sev-' + o.cp.severity + '">' + esc(o.cp.severity) +
      '</span><span class="ri-q">' + labelQ(o.cp) + "</span></div>" +
      (o.scope === "contract"
        ? '<p class="ri-loc"><span class="badge contract-scope-badge">계약 전반</span> 특정 조항에 한정되지 않는 의견</p>'
        : (o.loc ? '<p class="ri-loc">' + esc(o.loc) + _gotoBtn(o.ci) + "</p>" : '<p class="ri-loc">' + _gotoBtn(o.ci).trim() + "</p>")) +
      (o.comment ? '<p class="oi-comment">' + esc(o.comment) + "</p>" : "") + "</div>";
  }
  var contractFlagged = flagged.filter(function (o) { return o.scope === "contract"; });
  var clauseFlagged = flagged.filter(function (o) { return o.scope !== "contract"; });
  if (contractFlagged.length) {
    right += '<div class="report-contract-opinions"><h5>계약 전반 의견</h5>' +
      contractFlagged.map(_flaggedHtml).join("") + "</div>";
  }
  if (clauseFlagged.length) right += clauseFlagged.map(_flaggedHtml).join("");
  function _findingReportHtml(f) {
    var a = (f.anchors || [])[0];
    var ci = a && a.clause_index;
    var comment = f.finding_source === "manual" ? f.comment : (f.decision_comment || f.detail);
    return '<div class="opinion-item' + (f.scope === "contract" ? ' opinion-contract-wide' : '') + '">' +
      '<div class="ri-head"><span class="badge finding-source-badge">' +
      (f.finding_source === "manual" ? "직접 의견" : "문서 완결성") + '</span><span class="sev sev-' +
      esc(f.severity) + '">' + esc(f.severity) + '</span><span class="ri-q">' + esc(f.title || "검토의견") + '</span></div>' +
      (a ? '<p class="ri-loc">' + esc(a.heading || _clauseHeading(ci)) + _gotoBtn(ci) + '</p>' :
        '<p class="ri-loc"><span class="badge contract-scope-badge">계약 전반</span></p>') +
      (comment ? '<p class="oi-comment">' + esc(comment) + '</p>' : '') + '</div>';
  }
  if (manualOpinions.length) right += '<div class="report-contract-opinions"><h5>체크리스트 외 직접 의견</h5>' +
    manualOpinions.map(_findingReportHtml).join("") + '</div>';
  if (integrityOpinions.length) right += '<div class="report-contract-opinions"><h5>문서 완결성 검토의견</h5>' +
    integrityOpinions.map(_findingReportHtml).join("") + '</div>';
  if (!flagged.length && !manualOpinions.length && !integrityOpinions.length)
    right += '<p class="report-none">수정·보완이 필요한 검토의견 없음.</p>';
  if (doneItems.length) {
    right += '<details class="report-completed-fold"><summary>완료한 항목 ' + doneItems.length + '건 보기</summary>' +
      '<p class="sec-hint">검토 결과의 취소·변경은 조항별 검토 탭에서 할 수 있습니다.</p>';
    right += doneItems.map(function (it) {
      var v = verdictStore[it.cp.id] || {};
      return '<div class="report-item done-item"><div class="ri-head">' +
        '<span class="vd-badge ' + (VERDICT_CLS[v.verdict] || "") + '">' + esc(v.verdict || "") + "</span>" +
        (v.reason ? '<span class="vd-reason-badge">' + esc(v.reason) + "</span>" : "") +
        '<span class="sev sev-' + it.cp.severity + '">' + esc(it.cp.severity) + "</span>" +
        '<span class="ri-q">' + labelQ(it.cp) + "</span></div>" +
        (v.comment ? '<p class="oi-comment">' + esc(v.comment) + "</p>" : "") + "</div>";
    }).join("") + "</details>";
  }
  right += "</section>";

  // 일상 액션(팀 피드백 4차): [검토 마치기]=축적(지식 반영+아카이브 등록, 다운로드 없음),
  // 파일 생성·공유는 별도 [검토의견 파일로 내보내기](자동 명명) + 인쇄.
  // 개별 저장 버튼(내보내기·아카이브·지식 반영)과 관리 액션(골드셋 저장·판정파일 반영·
  // 코퍼스 백업/복원·정규화 후보)은 "팀·지식 관리" 접힘으로 격리(전문가용, 동작 불변).
  // 인쇄 시 접힘은 자동 펼침 대상에서 제외(admin-fold).
  // 검토 마치기 게이트(soft gate의 마감선): 미검토 잔여 시 비활성 — 내보내기·인쇄는 항상 가능.
  right += '<div class="report-actions">' +
    '<button id="report-finish" class="primary"' + (pendingN ? " disabled" : "") + '>검토 마치기</button>' +
    '<button id="report-export-file" class="ghost">검토의견 파일로 내보내기 (공유·회신용)</button>' +
    '<button id="report-print" class="ghost">인쇄</button>' +
    '<span id="finish-msg" class="report-actions-note">' +
    (pendingN ? "추가 판단 " + pendingN + "건 — 해당 항목 판단 후 [검토 마치기]가 활성화됩니다"
      : "마치기 = 지식 반영 + 브라우저에 아카이브 등록 — 파일이 필요하면 내보내기 사용") + "</span></div>";
  right += '<details class="report-sec admin-fold"><summary>팀·지식 관리</summary>';
  right += '<div class="report-actions">' +
    '<button id="report-verdict-export" class="ghost">검토의견 내보내기</button>' +
    '<button id="report-archive-export" class="ghost">검토 아카이브 저장</button>' +
    '<span class="report-actions-note">아카이브 = 계약 전문 + 검토 결과 + 종합의견(파일로도 받기) — 다음 해 재검토 시 "이전 검토와 비교"로 불러옴</span></div>';
  right += '<div class="report-actions">' +
    '<label class="reviewer-label">검토자 <input id="reviewer-name" placeholder="이름(코멘트 귀속)" value="' + esc(getReviewer()) + '"></label>' +
    '<button id="report-loop-ingest" class="ghost">이 검토를 지식에 반영</button>' +
    '<button id="report-goldset-snapshot" class="ghost">골드셋 케이스로 저장</button>' +
    '<span class="report-actions-note">누적 검토(코퍼스 ' + loopCorpus.meta.contract_count + '건)에 이 계약서 검토의견을 추가 — 다음 검토에 분포·추천으로 활용</span></div>';
  right += '<div class="report-actions experiment-actions">' +
    '<button id="report-experiment-full-ai" class="ghost">실험 전체 AI 채점</button>' +
    '<button id="report-experiment-predictions" class="ghost">실험 예측 내보내기</button>' +
    '<button id="report-experiment-gold" class="ghost">블라인드 골드 템플릿</button>' +
    '<span id="experiment-actions-msg" class="report-actions-note">동일 document_id로 규칙·Hybrid 예측과 사람 정답을 분리 저장 — 누적 코퍼스에는 반영되지 않음</span></div>';
  // 팀 취합(P4): 판정파일이 교환 단위(멱등 병합) — 공유폴더의 팀원 판정파일을 일괄 반영.
  right += '<div class="report-actions team-actions">' +
    '<label class="ghost file-btn">검토의견 파일 일괄 반영<input id="corpus-verdict-files" type="file" accept=".json" multiple hidden></label>' +
    '<button id="corpus-backup" class="ghost">코퍼스 백업</button>' +
    '<label class="ghost file-btn">코퍼스 복원<input id="corpus-restore" type="file" accept=".json" hidden></label>' +
    '<span id="team-actions-msg" class="report-actions-note">팀원들의 검토의견 JSON을 코퍼스에 병합 — 같은 계약 재반영은 무시됨(멱등)</span></div>';
  right += legalOpinionShadowHtml();
  right += curationPanelHtml();
  right += "</details>";
  right += "</div>";

  var body = document.getElementById("report-body");
  body.innerHTML = right;
  // 수치 타일 앵커(P1): 클릭 시 해당 섹션으로 페이지 스크롤 — 접힘 섹션은 먼저 펼침.
  // 진행률 타일(__review__)은 미검토 잔여 시 조항별 검토 탭으로 이동(작업 유도), 완료 시 결과 구역으로.
  body.querySelectorAll(".tile[data-anchor]").forEach(function (t) {
    t.addEventListener("click", function () {
      var a = t.getAttribute("data-anchor");
      if (a === "__review__") {
        if (pendingN) { document.querySelector('.tab[data-tab="clauses"]').click(); window.scrollTo(0, 0); return; }
        a = "rpt-sec-results";
      }
      var sec = document.getElementById(a);
      if (!sec) return;
      if (sec.tagName === "DETAILS") sec.open = true;
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  // 리포트 딥링크(§2.3-3): "조항 보기 →" — 조항별 검토 탭의 해당 행(또는 부재 알람 블록)으로 점프.
  body.querySelectorAll(".rpt-goto").forEach(function (btn) {
    btn.addEventListener("click", function () { gotoClause(btn.getAttribute("data-ci")); });
  });
  // 조항별 검토 이동(soft gate 배너·함께 살펴볼 요약 공용) — 리포트엔 판정 컨트롤이 없음(검토 일원화).
  body.querySelectorAll(".rpt-goto-review").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelector('.tab[data-tab="clauses"]').click();
      window.scrollTo(0, 0);
    });
  });
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
  var rexpf = document.getElementById("report-export-file");
  if (rexpf) rexpf.addEventListener("click", exportVerdicts);
  var rvIn = document.getElementById("reviewer-name");
  if (rvIn) rvIn.addEventListener("change", function () { setReviewer(rvIn.value); });
  var rexp = document.getElementById("report-verdict-export");
  if (rexp) rexp.addEventListener("click", exportVerdicts);
  var aexp = document.getElementById("report-archive-export");
  if (aexp) aexp.addEventListener("click", exportArchive);
  var gsnap = document.getElementById("report-goldset-snapshot");
  if (gsnap) gsnap.addEventListener("click", exportGoldsetCase);
  var efull = document.getElementById("report-experiment-full-ai");
  if (efull) efull.addEventListener("click", runFullExperimentLlmReview);
  var epred = document.getElementById("report-experiment-predictions");
  if (epred) epred.addEventListener("click", exportExperimentPredictions);
  var egold = document.getElementById("report-experiment-gold");
  if (egold) egold.addEventListener("click", exportExperimentGoldTemplate);
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
  body.querySelectorAll(".tag-proposal-decision").forEach(function (btn) {
    btn.addEventListener("click", function () {
      loopCorpus = Loop.decideTagProposal(loopCorpus, btn.getAttribute("data-key"),
        btn.getAttribute("data-decision"), { reviewer: getReviewer(), date: verdictToday() });
      saveCorpus(); renderReport();
    });
  });
  var tpex = document.getElementById("tag-proposals-export");
  if (tpex) tpex.addEventListener("click", exportApprovedTagProposals);
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
renderInputScreening();
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

/* ---------- 법률검토의견 전건 태깅자료 ----------
   앱 코드와 분리된 IndexedDB에 저장한다. 앱 버전 업데이트는 이 저장소를 덮어쓰지 않으며,
   XLSX 재반입은 문서 ID+내용 지문으로 멱등 병합한다. 현재 단계에서는 shadow 지식 기반으로만
   사용하고 계약유형·체크노출·자동판정을 직접 바꾸지 않는다. */
var legalOpinionKnowledge = null;
var legalOpinionShadowCache = { key: "", value: null };
function knowledgeSetState(label, cls) {
  var el = document.getElementById("knowledge-store-state");
  if (!el) return;
  el.textContent = label;
  el.className = "knowledge-store-state" + (cls ? " " + cls : "");
}
function knowledgeMessage(message, isError) {
  var el = document.getElementById("knowledge-action-msg");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "var(--c-red-fg)" : "";
}
function knowledgeLabel(tagId) {
  var tag = legalOpinionKnowledge && legalOpinionKnowledge.tags && legalOpinionKnowledge.tags[tagId];
  return tag ? (tag.hashtag || tag.label || tagId) : tagId;
}
function knowledgeRankedHtml(title, rows, formatter) {
  var items = (rows || []).slice(0, 10);
  return '<div class="knowledge-insight-card"><h3>' + esc(title) + "</h3>" +
    (items.length ? '<ol class="knowledge-ranked">' + items.map(function (row) {
      return "<li>" + esc(formatter ? formatter(row.key) : row.key) +
        ' <span class="count">' + row.count + "건</span></li>";
    }).join("") + "</ol>" : '<p class="report-none">아직 집계자료가 없습니다.</p>') + "</div>";
}
function legalOpinionShadowHtml() {
  if (!legalOpinionKnowledge || !legalOpinionKnowledge.meta.document_count || !state.text) return "";
  var shadowKey = String(legalOpinionKnowledge.meta.updated_at || "") + "|" +
    (verdictHash || hashText(state.text || "")) + "|" + String(state.docTitle || "");
  if (legalOpinionShadowCache.key !== shadowKey) {
    legalOpinionShadowCache = { key: shadowKey, value: LegalOpinionKnowledge.matchText(legalOpinionKnowledge,
      (state.docTitle || "") + "\n" + state.text, { limit: 12 }) };
  }
  var related = legalOpinionShadowCache.value;
  if (!related.tags.length) return '<div class="legal-opinion-shadow"><h4>과거 법률검토 태그 참고</h4>' +
    '<p class="report-none">현재 계약 문언과 직접 일치하는 정규 태그를 찾지 못했습니다.</p></div>';
  var tags = related.tags.map(function (tag) {
    return '<span class="knowledge-tag" title="과거 검토 ' + tag.support + '건 · 일치어 ' + esc(tag.matched_term) + '">' +
      esc(tag.hashtag || tag.label) + ' <small>' + tag.support + "</small></span>";
  }).join("");
  var docs = related.documents.slice(0, 5).map(function (doc) {
    return '<li><strong>' + esc(doc.title || doc.source_id) + '</strong>' +
      (doc.date ? " · " + esc(doc.date) : "") + (doc.department ? " · " + esc(doc.department) : "") +
      ' <span class="count">태그 ' + doc.hit_count + "개 일치 · ID " + esc(doc.source_id) + "</span></li>";
  }).join("");
  return '<div class="legal-opinion-shadow"><h4>과거 법률검토 태그 참고 <span class="badge">shadow</span></h4>' +
    '<p class="sec-hint">전 건 태깅자료에서 같은 용어가 확인된 후보입니다. 과거 검토의 법적 결론이나 계약서 수정 필요성을 뜻하지 않으며 현재 판정 점수에는 반영되지 않습니다.</p>' +
    '<div class="knowledge-tag-list">' + tags + "</div>" +
    (docs ? '<details><summary>관련 과거 검토 후보 ' + related.documents.length + '건 중 상위 5건</summary><ol class="knowledge-ranked">' + docs + "</ol></details>" : "") + "</div>";
}
function renderKnowledge() {
  if (!legalOpinionKnowledge) return;
  var s = LegalOpinionKnowledge.summary(legalOpinionKnowledge), m = s.meta;
  document.getElementById("knowledge-status").innerHTML = [
    [m.document_count, "현재 문서"], [m.revision_count, "보존 리비전"], [m.tag_count, "정규 태그"],
    [m.evidence_count, "근거 문장"], [m.snapshot_count, "적재 이력"]
  ].map(function (item) { return '<div class="knowledge-stat"><strong>' + item[0] + "</strong><span>" + item[1] + "</span></div>"; }).join("");
  var backup = document.getElementById("knowledge-backup");
  if (backup) backup.disabled = !m.document_count;
  var pairFormatter = function (key) {
    var parts = String(key).split("|");
    return parts.map(knowledgeLabel).join(" + ");
  };
  var conclusionFormatter = function (key) {
    var parts = String(key).split("|");
    return parts.map(function (part) { return part.charAt(0) === "#" ? part : knowledgeLabel(part); }).join(" → ");
  };
  var snapshot = s.snapshots[0];
  document.getElementById("knowledge-insights").innerHTML =
    knowledgeRankedHtml("빈도가 높은 태그", s.top_tags, knowledgeLabel) +
    knowledgeRankedHtml("함께 검토된 태그", s.top_pairs, pairFormatter) +
    knowledgeRankedHtml("검토결론 연결", s.conclusion_links, conclusionFormatter) +
    knowledgeRankedHtml("기존 DB 유형", s.db_types) +
    (snapshot ? '<p class="knowledge-snapshot">최근 적재: ' + esc(snapshot.file_name || "지식팩") +
      " · " + snapshot.document_count + "건 · 태거 " + esc(snapshot.tagger_version || "버전 미기록") +
      " · " + esc(String(snapshot.imported_at || "").slice(0, 10)) + "</p>" : "");
  knowledgeSetState(m.document_count ? "지식자료 사용 가능" : "자료 미적재", m.document_count ? "ready" : "");
}
function knowledgeProgress(info) {
  var box = document.getElementById("knowledge-progress");
  if (!box) return;
  box.hidden = false;
  var pct = info.total ? Math.round(info.completed / info.total * 100) : 0;
  box.querySelector("span").style.width = pct + "%";
  box.querySelector("p").textContent = "XLSX 읽는 중: " + (info.sheet || "") + " (" + info.completed + "/" + info.total + ")";
}
function finishKnowledgeProgress() {
  var box = document.getElementById("knowledge-progress");
  if (box) box.hidden = true;
}
function downloadKnowledgePack() {
  if (!legalOpinionKnowledge) return;
  var blob = new Blob([LegalOpinionKnowledge.packJson(legalOpinionKnowledge)], { type: "application/json" });
  var url = URL.createObjectURL(blob), a = document.createElement("a"), date = verdictToday();
  a.href = url;
  a.download = "legal-opinion-knowledge_" + date + "_" + legalOpinionKnowledge.meta.document_count + "건.crknowledge";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  knowledgeMessage("지식팩 백업 생성됨 — 폐쇄망 내부에 보관하세요.");
}
function importKnowledgeXlsx(file) {
  if (!file) return;
  knowledgeMessage("태깅자료 구조를 확인하고 있습니다.");
  knowledgeSetState("적재 중", "");
  LegalOpinionKnowledge.workbookTables(file, knowledgeProgress).then(function (parsed) {
    var dataset = LegalOpinionKnowledge.datasetFromTables(parsed.tables, parsed.source);
    var merged = LegalOpinionKnowledge.mergeDataset(legalOpinionKnowledge, dataset);
    return LegalOpinionKnowledge.save(merged.knowledge).then(function (saved) {
      legalOpinionKnowledge = saved;
      return LegalOpinionKnowledge.requestPersistence().then(function (persistent) {
        return { result: merged.result, persistent: persistent };
      });
    });
  }).then(function (out) {
    finishKnowledgeProgress(); renderKnowledge();
    if (state.result) renderReport();
    knowledgeMessage("적재 완료: 신규 " + out.result.added + "건, 갱신 " + out.result.updated +
      "건, 중복 제외 " + out.result.skipped + "건" + (out.persistent ? " · 브라우저 영구저장 허용됨" : "") +
      " — 지식팩 백업을 1회 보관하세요.");
  }).catch(function (error) {
    finishKnowledgeProgress(); knowledgeSetState("적재 실패", "error");
    knowledgeMessage("적재 실패: " + (error && error.message || "알 수 없는 오류"), true);
  });
}
function restoreKnowledgePack(file) {
  if (!file) return;
  file.text().then(function (raw) {
    var incoming = LegalOpinionKnowledge.fromPack(raw);
    return LegalOpinionKnowledge.save(LegalOpinionKnowledge.mergeKnowledge(legalOpinionKnowledge, incoming));
  }).then(function (saved) {
    legalOpinionKnowledge = saved; renderKnowledge();
    if (state.result) renderReport();
    knowledgeMessage("지식팩 복구·병합 완료 — 현재 문서 " + saved.meta.document_count + "건");
  }).catch(function (error) {
    knowledgeMessage("복구 실패: " + (error && error.message || "지식팩 형식 오류"), true);
  });
}
function initLegalOpinionKnowledge() {
  LegalOpinionKnowledge.load().then(function (loaded) {
    legalOpinionKnowledge = loaded; renderKnowledge();
    if (state.result) renderReport();
  }).catch(function (error) {
    legalOpinionKnowledge = LegalOpinionKnowledge.emptyKnowledge(); renderKnowledge();
    knowledgeSetState("저장소 사용 불가", "error");
    knowledgeMessage("브라우저 지식 저장소를 열 수 없습니다: " + (error && error.message || ""), true);
  });
  var xlsx = document.getElementById("knowledge-xlsx");
  if (xlsx) xlsx.addEventListener("change", function () {
    if (xlsx.files.length) importKnowledgeXlsx(xlsx.files[0]);
    xlsx.value = "";
  });
  var backup = document.getElementById("knowledge-backup");
  if (backup) backup.addEventListener("click", downloadKnowledgePack);
  var restore = document.getElementById("knowledge-restore");
  if (restore) restore.addEventListener("change", function () {
    if (restore.files.length) restoreKnowledgePack(restore.files[0]);
    restore.value = "";
  });
}

/* ---------- 폐쇄망 계약검토 이력 DB ----------
   실제 XLSX는 이 브라우저 안에서만 읽는다. 앱 코드·태깅 지식과 별도 IndexedDB에 보존하고,
   과거 기재값은 검색·사전채움 후보로만 사용한다. */
var reviewHistory = null;
function historySetState(label, cls) {
  var el = document.getElementById("history-store-state");
  if (!el) return;
  el.textContent = label;
  el.className = "knowledge-store-state" + (cls ? " " + cls : "");
}
function historyMessage(message, isError) {
  var el = document.getElementById("history-action-msg");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "var(--c-red-fg)" : "";
}
function historyProgress(info) {
  var box = document.getElementById("history-progress");
  if (!box) return;
  box.hidden = false;
  var pct = info.total ? Math.round(info.completed / info.total * 100) : 0;
  box.querySelector("span").style.width = pct + "%";
  box.querySelector("p").textContent = "계약검토 XLSX 확인 중: " + (info.step || "") + " (" + info.completed + "/" + info.total + ")";
}
function finishHistoryProgress() {
  var box = document.getElementById("history-progress");
  if (box) box.hidden = true;
}
function historyTypeValues(summary) {
  var seen = {}, values = [];
  (summary.result_types || []).concat(summary.request_types || []).forEach(function (item) {
    if (!item.key || item.key === "미기재" || seen[item.key]) return;
    seen[item.key] = true; values.push({ key: item.key, count: item.count });
  });
  return values.sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key, "ko"); });
}
function historyTypeOptions(selected) {
  return '<option value="">연결하지 않음</option>' + CR.types.map(function (type) {
    var id = type.meta.type_id;
    return '<option value="' + esc(id) + '"' + (id === selected ? " selected" : "") + ">" +
      esc(type.meta.type_name) + "</option>";
  }).join("");
}
function renderHistoryTypeMap(summary) {
  var box = document.getElementById("history-type-map"), filter = document.getElementById("history-filter-type");
  if (!box || !filter || !reviewHistory) return;
  var values = historyTypeValues(summary), mappings = reviewHistory.config.type_mappings || {};
  filter.innerHTML = '<option value="">전체 DB 유형</option>' + values.map(function (item) {
    return '<option value="' + esc(item.key) + '">' + esc(item.key) + " (" + item.count + "건)</option>";
  }).join("");
  box.innerHTML = values.length ? values.map(function (item) {
    return '<label for="history-map-' + ReviewHistory.hashString(item.key) + '">' + esc(item.key) +
      " <small>" + item.count + "건</small></label>" +
      '<select id="history-map-' + ReviewHistory.hashString(item.key) + '" class="history-map-select" data-db-type="' + esc(item.key) + '">' +
      historyTypeOptions(mappings[item.key] || "") + "</select>";
  }).join("") : '<p class="report-none">이력자료를 넣으면 실제 DB 유형이 표시됩니다.</p>';
  box.querySelectorAll(".history-map-select").forEach(function (select) {
    select.addEventListener("change", function () {
      reviewHistory = ReviewHistory.setTypeMapping(reviewHistory, select.getAttribute("data-db-type"), select.value);
      ReviewHistory.save(reviewHistory).then(function (saved) {
        reviewHistory = saved;
        historyMessage("DB 유형 연결 설정이 폐쇄망 저장소에 저장되었습니다.");
        renderHistorySearch();
      }).catch(function (error) { historyMessage("설정 저장 실패: " + (error.message || error), true); });
    });
  });
}
function historyRecordName(record) {
  return (record.result && record.result.contract_name) || (record.request && record.request.contract_name) || "계약명 미기재";
}
function historyRecordDbType(record) {
  return (record.result && record.result.type) || (record.request && record.request.type) || "";
}
function renderHistoryPrefill() {
  var box = document.getElementById("history-prefill");
  if (!box) return;
  if (!state.historyRef) { box.hidden = true; box.innerHTML = ""; return; }
  var bits = ["과거 계약검토 참고: <strong>" + esc(state.historyRef.contract_name || "계약명 미기재") + "</strong>"];
  if (state.historyRef.counterparty) bits.push("상대방 " + esc(state.historyRef.counterparty));
  if (state.historyRef.db_type) bits.push("DB 유형 " + esc(state.historyRef.db_type));
  if (state.historyRef.change_kind) bits.push(esc(state.historyRef.change_kind));
  if (state.historyRef.contract_period) bits.push("기간 " + esc(state.historyRef.contract_period));
  bits.push("ID " + esc(state.historyRef.review_id));
  box.innerHTML = bits.join(" · ") + '<button id="history-prefill-clear" class="ghost" type="button">참고 해제</button>' +
    '<div class="sec-hint">과거 기재값은 참고정보이며 현재 계약서의 유형·적용범위·수정 필요를 확정하지 않습니다.</div>';
  box.hidden = false;
  document.getElementById("history-prefill-clear").addEventListener("click", function () {
    state.historyRef = null; renderHistoryPrefill();
  });
}
function applyHistoryReference(reviewId) {
  var record = ReviewHistory.latestRecord(reviewHistory, reviewId);
  if (!record) return;
  var dbType = historyRecordDbType(record), mapped = reviewHistory.config.type_mappings[dbType] || "";
  state.historyRef = {
    review_id: reviewId, id_quality: record.id_quality || "", selected_at: new Date().toISOString(),
    contract_name: historyRecordName(record), counterparty: record.request.counterparty || "",
    db_type: dbType, mapped_type_id: mapped,
    change_kind: record.result.change_kind || record.request.change_kind || "",
    contract_period: record.result.contract_period || record.request.contract_period || ""
  };
  if (mapped && typeDoc(mapped)) onTypeChanged(mapped);
  renderHistoryPrefill();
  activatePane("input");
  window.scrollTo(0, 0);
}
function historyResultHtml(item) {
  var record = item.record, request = record.request || {}, result = record.result || {};
  var meta = [result.created_at || request.created_at, result.department || request.department,
    historyRecordDbType(record), result.change_kind || request.change_kind,
    request.counterparty, record.id_quality === "source" ? "원천 ID" : "임시 ID"].filter(Boolean);
  var context = textForHistory(request.context || result.review_text || "");
  return '<div class="history-result"><div><strong>' + esc(historyRecordName(record)) + '</strong>' +
    '<div class="history-result-meta">' + esc(meta.join(" · ")) + " · " + esc(record.review_id) + "</div>" +
    (context ? '<p class="history-result-context">' + esc(context) + "</p>" : "") +
    ((record.conflicts || []).length ? '<span class="history-diag-chip warn">신청·결과 불일치 ' + record.conflicts.length + "개</span>" : "") +
    '</div><button class="ghost history-apply" data-review-id="' + esc(record.review_id) + '">입력 설정에 참고</button></div>';
}
function textForHistory(value) {
  var valueText = String(value || "").replace(/\s+/g, " ").trim();
  return valueText.length > 260 ? valueText.slice(0, 260) + "…" : valueText;
}
function renderHistorySearch() {
  var box = document.getElementById("history-search-results"), input = document.getElementById("history-search");
  var filter = document.getElementById("history-filter-type");
  if (!box || !input || !filter || !reviewHistory) return;
  if (!reviewHistory.meta.review_count) { box.innerHTML = '<p class="report-none">적재된 계약검토 이력이 없습니다.</p>'; return; }
  var found = ReviewHistory.search(reviewHistory, input.value, { type: filter.value, limit: 30 });
  box.innerHTML = found.length ? found.map(historyResultHtml).join("") : '<p class="report-none">조건에 맞는 과거 검토가 없습니다.</p>';
  box.querySelectorAll(".history-apply").forEach(function (button) {
    button.addEventListener("click", function () { applyHistoryReference(button.getAttribute("data-review-id")); });
  });
}
function renderHistoryDiagnostics(summary) {
  var box = document.getElementById("history-diagnostics");
  if (!box) return;
  var snapshot = summary.snapshots[0];
  if (!snapshot) { box.innerHTML = ""; return; }
  var diagnostics = snapshot.diagnostics || {}, errors = diagnostics.error_counts || {};
  var chips = Object.keys(errors).sort().map(function (code) {
    return '<span class="history-diag-chip warn">' + esc(code) + " " + errors[code] + "건</span>";
  });
  if (!chips.length) chips.push('<span class="history-diag-chip">구조 오류 없음</span>');
  box.innerHTML = '<div class="history-diagnostic-card"><h3>최근 현장 진단</h3>' +
    '<p class="sec-hint">' + esc(snapshot.file_name || "계약검토 XLSX") + " · 실제 행 " + Number(snapshot.row_count || 0) +
    "건 · 머리글 일치 " + Number(diagnostics.header_score || 0) + "/33 · " +
    (diagnostics.stable_id_available ? "원천 검토번호 열 확인됨" : "원천 검토번호 없음 — 임시 로컬 ID 사용") + "</p>" +
    '<div class="history-diag-list">' + chips.join("") + "</div></div>";
  var benchmark = ReviewHistory.benchmarkSummary(reviewHistory), latest = benchmark.versions[0];
  box.innerHTML += '<div class="history-diagnostic-card"><h3>폐쇄망 내부 유형평가</h3>' +
    (latest ? '<p class="sec-hint">앱 v' + esc(latest.app_version) + " · 평가가능 " + latest.evaluable +
      "건 · 자동유형과 검토자 최종유형 일치 " + (latest.auto_agreement_rate === null ? "측정 전" : latest.auto_agreement_rate + "%") +
      " · 검토자 변경 " + latest.reviewer_changed + "건</p>" :
      '<p class="sec-hint">과거 이력을 선택해 계약을 검토한 뒤 검토 완료를 누르면 앱 버전별 유형 일치도가 여기에 누적됩니다.</p>') +
    '<div class="history-diag-list"><span class="history-diag-chip">사람확정 라벨 ' + benchmark.label_count +
    '건</span><span class="history-diag-chip">평가 실행 ' + benchmark.run_count + "건</span></div></div>";
}
function captureHistoryBenchmark() {
  if (!reviewHistory || !state.historyRef || !state.historyRef.review_id) return;
  var decision = currentTypeDecision();
  try {
    reviewHistory = ReviewHistory.addBenchmarkRun(reviewHistory, {
      review_id: state.historyRef.review_id,
      app_version: CR.app_version || "",
      contract_hash: verdictHash || "",
      initial_auto_type_id: decision.initial_auto_type_id || "",
      final_type_id: decision.final_type_id || "",
      outcome: decision.outcome || "",
      captured_at: new Date().toISOString()
    });
    ReviewHistory.save(reviewHistory).then(function (saved) {
      reviewHistory = saved;
      historyMessage("선택한 과거 이력과 이번 최종유형을 폐쇄망 내부 평가에 반영했습니다.");
      renderReviewHistory();
    }).catch(function (error) {
      historyMessage("내부 평가 저장 실패: " + (error && error.message || error), true);
    });
  } catch (error) {
    historyMessage("내부 평가 반영 실패: " + (error && error.message || error), true);
  }
}
function renderReviewHistory() {
  if (!reviewHistory) return;
  var summary = ReviewHistory.summary(reviewHistory), meta = summary.meta, stats = summary.stats;
  var status = document.getElementById("history-status");
  if (status) status.innerHTML = [
    [meta.review_count, "현재 이력"], [meta.revision_count, "보존 리비전"], [meta.snapshot_count, "적재 이력"],
    [stats.stable_ids, "원천 ID"], [stats.conflict_records, "신청·결과 불일치"]
  ].map(function (item) { return '<div class="knowledge-stat"><strong>' + item[0] + "</strong><span>" + item[1] + "</span></div>"; }).join("");
  var backup = document.getElementById("history-backup");
  if (backup) backup.disabled = !meta.review_count;
  historySetState(meta.review_count ? "이력자료 사용 가능" : "자료 미적재", meta.review_count ? "ready" : "");
  renderHistoryDiagnostics(summary);
  renderHistoryTypeMap(summary);
  renderHistorySearch();
  renderHistoryPrefill();
}
function importHistoryXlsx(file) {
  if (!file) return;
  historyMessage("폐쇄망에서 XLSX 구조를 확인하고 있습니다.");
  historySetState("적재 중", "");
  ReviewHistory.workbookRows(file, historyProgress).then(function (parsed) {
    var dataset = ReviewHistory.datasetFromRows(parsed.rows, parsed.source);
    var merged = ReviewHistory.mergeDataset(reviewHistory, dataset);
    return ReviewHistory.save(merged.history).then(function (saved) {
      reviewHistory = saved;
      return ReviewHistory.requestPersistence().then(function (persistent) {
        return { result: merged.result, diagnostics: dataset.diagnostics, persistent: persistent };
      });
    });
  }).then(function (out) {
    finishHistoryProgress(); renderReviewHistory();
    historyMessage("적재 완료: 신규 " + out.result.added + "건, 갱신 " + out.result.updated +
      "건, 중복 제외 " + out.result.skipped + "건" +
      (out.diagnostics.stable_id_available ? " · 원천 검토번호 사용" : " · 원천 검토번호 없음: 임시 ID 사용") +
      (out.persistent ? " · 브라우저 영구저장 허용됨" : "") + " — 이력팩 백업은 폐쇄망 내부에만 보관하세요.");
  }).catch(function (error) {
    finishHistoryProgress(); historySetState("적재 실패", "error");
    historyMessage("적재 실패: " + (error && error.message || "알 수 없는 오류"), true);
  });
}
function downloadHistoryPack() {
  if (!reviewHistory) return;
  var blob = new Blob([ReviewHistory.packJson(reviewHistory)], { type: "application/json" });
  var url = URL.createObjectURL(blob), a = document.createElement("a"), date = verdictToday();
  a.href = url; a.download = "contract-review-history_" + date + "_" + reviewHistory.meta.review_count + "건.crhistory";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  historyMessage("이력팩 내부 백업 생성됨 — 실제 검토정보가 포함되므로 폐쇄망 밖으로 반출하지 마세요.");
}
function restoreHistoryPack(file) {
  if (!file) return;
  file.text().then(function (raw) {
    var incoming = ReviewHistory.fromPack(raw);
    return ReviewHistory.save(ReviewHistory.mergeHistory(reviewHistory, incoming));
  }).then(function (saved) {
    reviewHistory = saved; renderReviewHistory();
    historyMessage("이력팩 복구·병합 완료 — 현재 이력 " + saved.meta.review_count + "건");
  }).catch(function (error) { historyMessage("복구 실패: " + (error && error.message || "이력팩 형식 오류"), true); });
}
function initReviewHistory() {
  ReviewHistory.load().then(function (loaded) {
    reviewHistory = loaded; renderReviewHistory();
  }).catch(function (error) {
    reviewHistory = ReviewHistory.emptyHistory(); renderReviewHistory();
    historySetState("저장소 사용 불가", "error");
    historyMessage("브라우저 계약검토 이력 저장소를 열 수 없습니다: " + (error && error.message || ""), true);
  });
  var xlsx = document.getElementById("history-xlsx");
  if (xlsx) xlsx.addEventListener("change", function () {
    if (xlsx.files.length) importHistoryXlsx(xlsx.files[0]);
    xlsx.value = "";
  });
  var backup = document.getElementById("history-backup");
  if (backup) backup.addEventListener("click", downloadHistoryPack);
  var restore = document.getElementById("history-restore");
  if (restore) restore.addEventListener("change", function () {
    if (restore.files.length) restoreHistoryPack(restore.files[0]);
    restore.value = "";
  });
  var search = document.getElementById("history-search"), filter = document.getElementById("history-filter-type");
  if (search) search.addEventListener("input", function () {
    clearTimeout(renderHistorySearch._timer); renderHistorySearch._timer = setTimeout(renderHistorySearch, 120);
  });
  if (filter) filter.addEventListener("change", renderHistorySearch);
}

initVerify();
initLocalLlm();
initMotionPreference();
initLegalOpinionKnowledge();
initReviewHistory();
