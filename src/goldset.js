"use strict";
/* 앱 내장 골드셋(폐쇄망) 순수 로직 — 스냅샷 생성·재현 실행·차이 채점·반출 요약.
   설계: 실계약은 폐쇄망 밖으로 못 나가므로 채점기를 앱에 내장한다. 케이스(계약 본문 포함)는
   폐쇄망 공유폴더에만 축적하고, 밖으로는 요약(check id·유형명·통과/실패 — 본문 0자)만 내보낸다.
   브라우저 전역 Goldset + node require 겸용. */
var Goldset = (function () {

  // 스냅샷: 검토자가 확인·교정한 현재 분석 상태를 기대값으로 저장.
  // expect.detected는 검토자가 최종 선택한 유형(수동 교정 포함) — 자동감지가 이와 다르면
  // 그 케이스는 "감지 개선 대상"으로 계속 실패 표시되는 것이 의도임.
  function buildCase(input) {
    var results = input.results || [];
    function ids(cov) {
      return results.filter(function (r) { return r.coverage === cov; })
        .map(function (r) { return r.cpId; }).sort();
    }
    return {
      format: "cr-goldset-case-v1",
      id: input.id || ("case-" + (input.hash || "") + "-" + (input.date || "")),
      desc: input.desc || "",
      created: input.date || "",
      text: String(input.text || ""),
      expect: {
        detected: input.typeId || null,
        activeModules: (input.activeModules || []).slice().sort(),
        consider: ids("consider"),
        verify: ids("verify"),
        addressed: ids("addressed")
      },
      context: {
        auto_detected_at_save: input.autoDetected || null,
        subdoc_names: input.subDocNames || [],
        checks_count_at_save: input.checksCount || 0
      }
    };
  }

  // 재현 실행 — 앱·goldset_runner.js와 동일 파이프라인(전자동). env로 엔진 함수 주입(테스트 용이).
  function runCase(caseObj, env) {
    var CR = env.CR;
    var text = String(caseObj.text || "");
    var clauses = env.segmentContract(text);
    var ranked = env.detectType(text, CR.types);
    var detected = env.pickType(ranked);
    var doc = null;
    for (var i = 0; i < CR.types.length; i++)
      if (CR.types[i].meta.type_id === detected) { doc = CR.types[i]; break; }
    var modList = (CR.common.meta.modules || []).concat(doc ? doc.meta.modules || [] : []);
    var suggested = env.suggestModules(text, modList);
    var active = modList.filter(function (m) {
      return m.always_on || suggested.on.indexOf(m.id) !== -1;
    }).map(function (m) { return m.id; });
    var r = env.analyze(clauses, [{ checkpoints: CR.common.checks }, { checkpoints: doc ? doc.checks : [] }], active);
    function ids(cov) {
      return r.results.filter(function (x) { return x.coverage === cov; })
        .map(function (x) { return x.cpId; }).sort();
    }
    return { detected: detected, activeModules: active.slice().sort(), consider: ids("consider"),
      verify: ids("verify"), addressed: ids("addressed") };
  }

  function _diffSet(expected, observed) {
    var e = {}, o = {};
    (expected || []).forEach(function (x) { e[x] = 1; });
    (observed || []).forEach(function (x) { o[x] = 1; });
    return {
      added: (observed || []).filter(function (x) { return !e[x]; }),   // 새로 생김(신규 지식 or 오탐)
      removed: (expected || []).filter(function (x) { return !o[x]; })  // 사라짐(개선 or 누락 회귀)
    };
  }

  // 채점: 유형 감지 불일치 = 실패(경성). 나머지는 차이 보고(연성) — 지식이 의도적으로
  // 진화하면 consider가 변하는 게 정상이므로, 차이 유무만 알리고 판단은 사람이.
  function diffCase(caseObj, observed) {
    var ex = caseObj.expect || {};
    var detectOk = (observed.detected || null) === (ex.detected || null);
    var mods = _diffSet(ex.activeModules, observed.activeModules);
    var cons = _diffSet(ex.consider, observed.consider);
    // 구 v1 케이스에는 verify 기대값이 없으므로 그 경우는 채점하지 않는다.
    var veri = Object.prototype.hasOwnProperty.call(ex, "verify")
      ? _diffSet(ex.verify, observed.verify) : _diffSet([], []);
    var addr = _diffSet(ex.addressed, observed.addressed);
    var changed = mods.added.length || mods.removed.length || cons.added.length ||
      cons.removed.length || veri.added.length || veri.removed.length ||
      addr.added.length || addr.removed.length;
    return {
      id: caseObj.id, desc: caseObj.desc,
      detectOk: detectOk, expectedType: ex.detected || null, observedType: observed.detected || null,
      modules: mods, consider: cons, verify: veri, addressed: addr,
      status: !detectOk ? "실패" : (changed ? "변화" : "통과")
    };
  }

  // G2: "변화" 케이스의 새 기준 갱신 — 관측(observed) 결과를 새 expect로 삼아 케이스를 재생성.
  // text·id·desc·context(축적 당시 메타)는 원본 유지, expect만 현재 관측값으로 교체.
  function rebuildCase(caseObj, observed) {
    return {
      format: caseObj.format,
      id: caseObj.id,
      desc: caseObj.desc,
      created: caseObj.created,
      text: caseObj.text,
      expect: {
        detected: observed.detected || null,
        activeModules: (observed.activeModules || []).slice().sort(),
        consider: (observed.consider || []).slice().sort(),
        verify: (observed.verify || []).slice().sort(),
        addressed: (observed.addressed || []).slice().sort()
      },
      context: caseObj.context
    };
  }

  // 반출용 요약 텍스트 — 계약 본문·조항 문언 포함 금지(check id·유형명·카운트만).
  function summaryText(diffs, meta) {
    var L = [];
    L.push("# 골드셋 채점 요약 (본문 미포함 — 반출용)");
    if (meta) L.push("빌드 check 수: " + (meta.checksCount || "?") + " · 채점일: " + (meta.date || "?"));
    var pass = diffs.filter(function (d) { return d.status === "통과"; }).length;
    var chg = diffs.filter(function (d) { return d.status === "변화"; }).length;
    var fail = diffs.filter(function (d) { return d.status === "실패"; }).length;
    L.push("결과: 통과 " + pass + " · 변화 " + chg + " · 실패 " + fail + " / 총 " + diffs.length);
    diffs.forEach(function (d) {
      if (d.status === "통과") return;
      L.push("");
      L.push("[" + d.status + "] " + d.id + (d.desc ? " — " + d.desc : ""));
      if (!d.detectOk) L.push("  유형감지: 기대 " + (d.expectedType || "미확정") + " ≠ 실제 " + (d.observedType || "미확정"));
      if (d.modules.added.length) L.push("  모듈 신규활성: " + d.modules.added.join(", "));
      if (d.modules.removed.length) L.push("  모듈 비활성화: " + d.modules.removed.join(", "));
      if (d.consider.added.length) L.push("  부재알람 신규: " + d.consider.added.join(", "));
      if (d.consider.removed.length) L.push("  부재알람 사라짐: " + d.consider.removed.join(", "));
      if (d.verify.added.length) L.push("  확인권장 신규: " + d.verify.added.join(", "));
      if (d.verify.removed.length) L.push("  확인권장 사라짐: " + d.verify.removed.join(", "));
      if (d.addressed.added.length) L.push("  반영 신규: " + d.addressed.added.join(", "));
      if (d.addressed.removed.length) L.push("  반영 사라짐: " + d.addressed.removed.join(", "));
    });
    return L.join("\n");
  }

  return { buildCase: buildCase, runCase: runCase, diffCase: diffCase, rebuildCase: rebuildCase, summaryText: summaryText };
})();

if (typeof module !== "undefined") module.exports = Goldset;
