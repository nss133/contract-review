"use strict";
/* 정답·관찰의 분리 파일. 서버 호출·자동 업로드·외부 전송 없음. */
var SafetyEvalUI = (function () {
  var snapshot = null, snapshotContext = "", prediction = null, gold = null;
  function el(id) { return document.getElementById("safety-" + id); }
  function message(s) { el("message").textContent = s; }
  function input() {
    var seen = Object.create(null), checks = [];
    [CR.common].concat(CR.types).forEach(function (doc) {
      (doc.checks || []).forEach(function (cp) { if (!seen[cp.id]) { seen[cp.id] = true; checks.push(cp); } });
    });
    var subdocIds = {};
    ((CR.common.meta || {}).standard_subdocs || []).forEach(function (d) {
      if (subdocInUse(d)) (d.covers || []).forEach(function (id) {
        if (((state.result && state.result.results) || []).some(function (r) { return r.cpId === id; })) subdocIds[id] = true;
      });
    });
    return { contractHash: hashText(state.text || ""), appVersion: CR.app_version,
      liveText: document.getElementById("contract-text").value,
      caseDate:el("case-date").value, runtimeContext:SafetyRuntime.bundle().context, environment:SafetyRuntime.engineFingerprint(),
      familyId: el("family").value.trim(), text: state.text, documents: safetyDocuments(),
      clauses: state.clauses, checkpoints: checks, results: state.result && state.result.results || [], subdocIds: subdocIds,
      context: { type: state.typeId, modules: state.activeModules, title: state.docTitle,
        roles: state.partyRoles, party: state.partyContext, stance: state.stance,
        scopes: state.scopeAnswers, reassign: state.reassign, baseText: state.baseText,
        // 태그·이력의 관측 결과는 results에 고정. 실행환경도 내부 기록으로만 보존.
        tag_mode: MatcherConfig.TAG_MATCH_MODE } };
  }
  function save(obj, kind) {
    var url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    var a = document.createElement("a"); a.href = url; a.download = "safety-" + kind + "-" + obj.run_id + ".json";
    a.click(); URL.revokeObjectURL(url);
  }
  function download(kind) {
    if (!snapshot || snapshotContext !== JSON.stringify(input())) {
      el("gold").disabled = true; el("observation").disabled = true;
      message("입력이 변경되었습니다. 재분석 후 스냅샷을 다시 고정하세요."); return;
    }
    save(kind === "gold" ? SafetyEval.goldTemplate(snapshot) : snapshot, kind);
    message("폐쇄망 내부용 파일 저장 요청. 정답 검수자에게 관찰 기록을 제공하지 마세요.");
  }
  function rate(n, d) { return d ? (100 * n / d).toFixed(1) + "% (" + n + "/" + d + ")" : "평가 대상 없음"; }
  function render(m) {
    var h = '<p>확정 검수 ' + m.reviewed + '/' + m.total + '개 체크 · 안전성 입증 아님</p>';
    h += '<table><thead><tr><th>지표</th><th>현재 정책</th><th>이전 정책 가상 후보</th></tr></thead><tbody>';
    [["자동/후보 수", "candidates"], ["문제 있음인데 이상없음/후보", "false_clear"],
      ["판단불가인데 이상없음/후보", "unknown"], ["아직 검수하지 않은 후보", "unreviewed"]].forEach(function (row) {
      h += '<tr><th>' + row[0] + '</th><td>' + m.actual[row[1]] + '</td><td>' + m.shadow[row[1]] + '</td></tr>';
    });
    h += '<tr><th>확인된 오류 / 전체 후보 (미검수 포함)</th><td>' + rate(m.actual.false_clear, m.actual.candidates) +
      '</td><td>' + rate(m.shadow.false_clear, m.shadow.candidates) + '</td></tr></tbody></table>';
    h += '<p>문제 있음 정답 중 비노출: ' + rate(m.unsurfaced_issues, m.issue_count) +
      ' · 직접 근거가 지정된 체크의 Top1: ' + rate(m.mapping.top1_correct, m.mapping.denominator) +
      ' · Top3 근거 포함: ' + rate(m.mapping.top3_found, m.mapping.denominator) + '</p>';
    h += '<p>현재 정책의 자동판정 0건은 정확도 100%가 아닙니다. 가상 후보는 실제 확정 판정이 아닙니다. 미검수·판단불가를 안전 정답으로 세지 않으며, 한 계약의 복수 체크는 독립 계약 표본이 아닙니다. 승인에는 계열 분리 평가·반례·추가 검수가 필요합니다.</p>';
    el("metrics").innerHTML = h;
  }
  function load(id, kind) {
    var seq = 0;
    el(id).addEventListener("change", function () {
      var current = ++seq, file = el(id).files[0];
      if (kind === "prediction") prediction = null; else gold = null;
      el("score").disabled = true; el("metrics").textContent = "";
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (current !== seq) return;
        try {
          var obj = JSON.parse(reader.result);
          if (obj.format !== (kind === "prediction" ? "cr-safety-observation-v1" : "cr-safety-gold-v1")) throw Error("파일 형식 확인 필요");
          if (kind === "prediction") prediction = obj; else gold = obj;
          message("내부 평가 파일 로드 완료. 정답은 검수자·원본 대조·독립 검수 확인이 필요합니다.");
        } catch (e) { message(e.message); }
        el("score").disabled = !(prediction && gold);
      };
      reader.onerror = function () { if (current === seq) message("파일 읽기 실패"); };
      reader.readAsText(file);
    });
  }
  function init() {
    if (!el("snapshot")) return;
    el("case-date").value=verdictToday();
    el("confirm-inputs").addEventListener("click",function(){try{SafetyRuntime.confirmInputs();applyAutoVerdicts();renderClauses();renderReport();message("현재 문서 묶음의 원본 완전성·유형·당사 역할·적용범위 확인 기록. 입력 변경 시 확인은 무효화됩니다.");}catch(e){message(e.message);}});
    el("snapshot").addEventListener("click", async function () {
      if (!state.result || !state.text) { message("먼저 계약서를 분석하세요."); return; }
      if (document.getElementById("contract-text").value !== state.text ||
          JSON.stringify(segmentContract(state.text)) !== JSON.stringify(state.clauses)) {
        message("계약 본문이 변경되었습니다. 입력 화면에서 다시 분석한 뒤 고정하세요."); return;
      }
      if (!el("family").value.trim()) { message("동일 원계약·갱신·서식에 공통으로 사용할 계약 계열 ID를 입력하세요."); return; }
      // 분석·수동 재지정이 반영된 현재 결과를 고정한다. 시스템 판정이나 사람 판정은 정답에 넣지 않는다.
      el("snapshot").disabled=true;el("gold").disabled=true;el("observation").disabled=true;
      snapshot=null;snapshotContext="";
      message("현재 분석을 마친 뒤 평가 기록을 고정합니다.");
      try {
      var analysis=await runAnalysis();
      if(!analysis||analysis.status!=="completed"){
        message("평가 기록을 고정하지 않았습니다. "+(analysis?.error||"분석을 완료한 뒤 다시 시도하세요."));return;
      }
      var data = input(); snapshotContext = JSON.stringify(data);
      data.runId = hashText(snapshotContext) + "-" + Date.now();
      snapshot = SafetyEval.build(data);
      snapshot.context=Object.assign(snapshot.context,SafetyRuntime.bundle().context,{department:document.getElementById("input-department").value});
      snapshot.engine_fingerprint=SafetyRuntime.engineFingerprint();snapshot.checks_fingerprint=SafetyRuntime.checksFingerprint();
      snapshot.case_date=el("case-date").value;
      try { snapshot=SafetyRuntime.replay(snapshot,[snapshot.family_id]); }
      catch(e){message(e.message);snapshot=null;return;}
      el("gold").disabled = false; el("observation").disabled = false;
      message("전체 " + snapshot.items.length + "개 체크 고정. 블라인드 정답 양식의 빈 라벨을 원본으로 독립 검수하세요.");
      } catch(e) {snapshot=null;snapshotContext="";message("평가 기록 고정 실패: "+e.message);}
      finally {el("snapshot").disabled=false;}
    });
    el("gold").addEventListener("click", function () { download("gold"); });
    el("observation").addEventListener("click", function () { download("observation"); });
    load("pred-file", "prediction"); load("gold-file", "gold");
    el("score").addEventListener("click", function () {
      el("metrics").textContent = "";
      try { render(SafetyEval.score(prediction, gold)); message("내부 진단 완료. 자동판정 허용 범위는 변경되지 않습니다."); }
      catch (e) { message("채점 보류: " + e.message); }
    });
  }
  init();
  return { init: init };
})();
