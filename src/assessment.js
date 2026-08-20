"use strict";
/* 매칭 결과를 감사 가능한 시스템 평가 원장으로 변환한다.
   법적 최종 판정(verdict)과 분리하며, score는 보정된 확률이 아니라 매칭 점수다. */
var Assessment = (function () {
  var FORMAT = "cr-system-assessment-v1";

  function _checkMap(checkpoints) {
    var out = {};
    (checkpoints || []).forEach(function (cp) { out[cp.id] = cp; });
    return out;
  }

  function _clauseMap(clauses) {
    var out = {};
    (clauses || []).forEach(function (cl) { out[cl.index] = cl; });
    return out;
  }

  function _roundScore(n) {
    return typeof n === "number" ? Math.round(n * 100) / 100 : null;
  }

  function _coverageContext(result, ctx) {
    var cpId = result && result.cpId;
    var sub = cpId && ctx && ctx.subdoc_coverage && ctx.subdoc_coverage[cpId];
    if (sub) return { kind: "uploaded_subdoc", detail: sub };
    var ref = cpId && ctx && ctx.ref_coverage && ctx.ref_coverage[cpId];
    if (ref) return {
      kind: ref.signal === "수동 체크" ? "reviewer_declared" : "contract_reference",
      detail: ref
    };
    return null;
  }

  function _classification(result, coverageCtx) {
    if (result.roleGated) {
      return { applicability: "not_applicable", assessment: "not_applicable", route: "no_review" };
    }
    if (result.coverage === "addressed") {
      return { applicability: "applicable", assessment: "evidence_found", route: "human_confirm" };
    }
    if (result.coverage === "verify") {
      return { applicability: "applicable", assessment: "possible_evidence", route: "human_required" };
    }
    if (result.coverage === "consider") {
      if (coverageCtx && coverageCtx.kind === "uploaded_subdoc") {
        return { applicability: "applicable", assessment: "covered_by_subdoc", route: "human_confirm" };
      }
      if (coverageCtx) {
        return { applicability: "applicable", assessment: "referenced_subdoc", route: "human_confirm" };
      }
      return { applicability: "applicable", assessment: "evidence_not_found", route: "human_required" };
    }
    if (result.coverage === "base_covered") {
      return { applicability: "applicable", assessment: "evidence_in_base", route: "human_confirm" };
    }
    return { applicability: "undetermined", assessment: "not_surfaced", route: "not_surfaced" };
  }

  function build(results, checkpoints, clauses, context) {
    var checks = _checkMap(checkpoints);
    var clauseByIndex = _clauseMap(clauses);
    var ctx = context || {};
    var items = {};

    (results || []).forEach(function (r) {
      var coverageCtx = _coverageContext(r, ctx);
      var cls = _classification(r, coverageCtx);
      var cp = checks[r.cpId] || {};
      var ranked = (r.ranked || []).map(function (hit) {
        var cl = clauseByIndex[hit.clauseIndex] || {};
        return {
          clause_index: hit.clauseIndex,
          heading: String(cl.heading || ""),
          match_score: _roundScore(hit.score)
        };
      });
      var evidence = [];
      if (cls.assessment === "evidence_found" || cls.assessment === "possible_evidence") {
        evidence = ranked.length ? [ranked[0]] : [];
      } else if (cls.assessment === "evidence_in_base" && r.inBase) {
        evidence = [{ source: "base_contract", clause_index: r.inBase.clauseIndex,
          heading: "", match_score: _roundScore(r.inBase.score) }];
      } else if (cls.assessment === "covered_by_subdoc") {
        evidence = [{ source: "subdoc", document: String(coverageCtx.detail.docName || ""),
          match_score: _roundScore(coverageCtx.detail.score) }];
      } else if (cls.assessment === "referenced_subdoc") {
        evidence = [{ source: coverageCtx.kind, document: String(coverageCtx.detail.title || ""),
          signal: String(coverageCtx.detail.signal || ""), quote: String(coverageCtx.detail.quote || "") }];
      }
      var advisory = null;
      if (r.localLlm) {
        advisory = {
          kind: "local_llm",
          model: String(r.localLlm.model || ""),
          selected_clause_index: r.localLlm.selected_clause_index,
          relation: r.localLlm.relation,
          completeness: r.localLlm.completeness,
          reason: String(r.localLlm.reason || ""),
          present_elements: (r.localLlm.present_elements || []).slice(),
          missing_elements: (r.localLlm.missing_elements || []).slice(),
          draft_comment: String(r.localLlm.draft_comment || ""),
          draft_accepted: !!r.localLlm.draft_accepted,
          duration_ms: Number(r.localLlm.duration_ms || 0)
        };
      }
      items[r.cpId] = {
        check_id: r.cpId,
        severity: cp.severity || "",
        applicability: cls.applicability,
        system_assessment: cls.assessment,
        review_route: cls.route,
        coverage_source: coverageCtx ? coverageCtx.kind : null,
        coverage: r.coverage || "",
        tier: r.tier || "",
        evidence: evidence,
        candidate_clauses: ranked,
        reasons: r.best && r.best.reasons ? r.best.reasons.slice() : [],
        perspective: r.perspective ? {
          rule: r.perspective.rule || "",
          obligation_bearer: r.perspective.bearer || "unknown",
          duration: r.perspective.duration || "unknown",
          favorable_to_company: !!r.perspective.favorable,
          auto_pass: !!r.perspective.auto_pass,
          reason: String(r.perspective.reason || "")
        } : null,
        decision_source: {
          kind: "rule",
          engine_version: String(ctx.engine_version || "")
        },
        advisory: advisory
      };
    });

    return {
      format: FORMAT,
      generated: String(ctx.generated || ""),
      contract_hash: String(ctx.contract_hash || ""),
      type_id: ctx.type_id || null,
      stance: ctx.stance || "party",
      party_roles: (ctx.party_roles || []).slice(),
      party_context: ctx.party_context || null,
      active_modules: (ctx.active_modules || []).slice(),
      items: items
    };
  }

  return { FORMAT: FORMAT, build: build };
})();

if (typeof module !== "undefined") module.exports = Assessment;
