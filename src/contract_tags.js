"use strict";
/* legal-opinion-tagger의 계약 전용 엔진을 계약 매처에 연결하는 얇은 어댑터.
   브라우저는 vendor IIFE 전역, Node 골드셋은 같은 빌드의 CJS를 사용한다. */
if (typeof require !== "undefined") {
  var ContractTagEngineRef = require("../vendor/contract-tag-engine.cjs");
} else {
  var ContractTagEngineRef = ContractTagEngine;
}

var ContractTags = (function (Engine) {
  function analyzeClause(clause, docTitle) {
    return Engine.extractContractTagAnalysis({
      documentTitle: docTitle || "",
      clauseHeading: String(clause && clause.heading || ""),
      clauseBody: String(clause && clause.body || "")
    });
  }

  function values(analysis) {
    return Engine.contractTagValues(analysis || {});
  }

  function matchClause(check, clause, docTitle) {
    var signature = check && check.tag_signature;
    if (!signature || signature.status !== "curated") return null;
    var analysis = analyzeClause(clause, docTitle);
    var observed = values(analysis);
    var aggregateComparison = Engine.compareContractTagSignatures(signature, observed);
    var frameComparison = typeof Engine.compareContractTagFrames === "function"
      ? Engine.compareContractTagFrames(signature, analysis.frames || []) : null;
    // v1.1부터 assist 가점 자격은 같은 항·문장의 명제 프레임으로만 정한다.
    // 조항 전체 합계는 설명·회귀 진단용으로 보존한다.
    var comparison = frameComparison || aggregateComparison;
    var conflicts = (comparison.conflicts || []).slice();
    // 사람 교정에서 반복적으로 오부착 조항에만 나타난 태그는 avoid로 큐레이션할 수 있다.
    // 태그 자체가 노출 게이트는 아니며 assist에서 제한 감점만 만든다.
    Object.keys(signature.avoid || {}).forEach(function (facet) {
      var blocked = signature.avoid[facet] || [];
      var actual = observed[facet] || [];
      var hits = actual.filter(function (tag) { return blocked.indexOf(tag) !== -1; });
      if (hits.length) conflicts.push({ facet: facet, expected: "avoid", observed: hits });
    });
    var evidenceTags = analysis.tags || [];
    if (frameComparison && frameComparison.bestFrame) {
      var selectedFrame = (analysis.frames || []).find(function (frame) {
        return frame.id === frameComparison.bestFrame.id;
      });
      if (selectedFrame) evidenceTags = selectedFrame.tags || [];
    }
    return {
      profileVersion: analysis.profileVersion,
      score: comparison.score,
      eligible: comparison.eligible,
      comparisonBasis: frameComparison ? "proposition_frame" : "clause_aggregate",
      aggregateEligible: aggregateComparison.eligible,
      matches: comparison.matches,
      missing: comparison.missing,
      conflicts: conflicts,
      bestFrame: frameComparison ? frameComparison.bestFrame : null,
      frameCandidates: frameComparison ? frameComparison.candidates : [],
      observed: observed,
      evidence: evidenceTags.slice(0, 12).map(function (tag) {
        return { facet: tag.facet, id: tag.id, score: tag.score, evidence: tag.evidence.slice(0, 2) };
      })
    };
  }

  // 개인정보가 등장하는 계약을 단순 키워드 수가 아니라 "관계"로 분류한다.
  // 특히 "제3자에게 제공하여서는 아니 된다"는 처리위탁의 보호조항이지,
  // 제3자 제공을 실행하는 문구가 아니다. 기존 엔진의 action·modality 태그를
  // 문장 단위로 결합해 이 반대 의미를 보존한다.
  function detectDataRelationship(clauses, docTitle) {
    var outsourcing = [], thirdParty = [], prohibited = [];
    var title = String(docTitle || "");
    var units = [];
    (clauses || []).forEach(function (clause) {
      var heading = String(clause && clause.heading || "");
      // HWP/PDF 추출물은 "제3조(표제) 본문" 전체가 heading으로 들어오기도 한다.
      // 관계 판정은 body만 보지 않고 표제+본문을 함께 문장화한다.
      var raw = (/^\((?:전문|전체)\)$/.test(heading) ? "" : heading + "\n") +
        String(clause && clause.body || "");
      raw.split(/(?:\n+|(?<=[.!?다]))\s+/).forEach(function (sentence) {
        if (sentence.trim()) units.push({
          clauseIndex: clause.index,
          heading: heading,
          text: sentence.trim()
        });
      });
    });

    function add(bucket, unit, reason) {
      if (bucket.length >= 8) return;
      bucket.push({ clauseIndex: unit.clauseIndex, heading: unit.heading,
        reason: reason, quote: unit.text.slice(0, 180) });
    }

    units.forEach(function (unit) {
      var analysis = analyzeClause({ heading: unit.heading, body: unit.text }, title);
      var observed = values(analysis);
      var topics = observed.topics || [], actions = observed.actions || [];
      var objects = observed.objects || [], modalities = observed.modalities || [];
      var personal = topics.indexOf("personal_information") !== -1 ||
        objects.indexOf("personal_information") !== -1 ||
        /고객정보|개인(?:신용)?정보|신용정보/.test(unit.text);
      if (!personal) return;

      var hasOutsourcing = /처리\s*업무.{0,12}위탁|개인정보\s*처리위탁|업무위탁계약|위탁업무|위탁받은\s*업무|수탁자|재수탁자/.test(unit.text);
      if (hasOutsourcing) add(outsourcing, unit, "개인정보 처리위탁·수탁 관계 문언");

      var hasProvideAction = actions.indexOf("provide") !== -1 ||
        /제3자.{0,16}제공|제휴사.{0,16}제공|정보.{0,12}제공/.test(unit.text);
      var isProhibited = modalities.indexOf("prohibition") !== -1 ||
        /제3자.{0,24}(?:제공|누설).{0,18}(?:아니|안\s*된다|금지|할\s*수\s*없)/.test(unit.text);
      if (hasProvideAction && isProhibited) {
        add(prohibited, unit, "제3자 제공·누설 금지 문언");
        return;
      }

      // 제공받는 자·그 이용목적·동의 증빙은 독립 이용을 전제하는 강한 신호다.
      // 단순히 수탁자에게 업무자료를 "제공"한다는 표현만으로는 승격하지 않는다.
      var strongThirdParty = /제공받는\s*자|제공받는\s*자의\s*이용\s*목적|제3자\s*제공.{0,18}동의|제3자에게.{0,18}제공(?:한다|할\s*수\s*있다)|제휴사에게.{0,18}제공|자체\s*목적|독자적으로/.test(unit.text) ||
        (/수집.{0,10}이용.{0,10}제공/.test(unit.text) && /동의/.test(unit.text));
      if (hasProvideAction && strongThirdParty) add(thirdParty, unit, "독립적 제3자 제공·동의 문언");
    });

    if (/개인(?:신용)?정보\s*보안관리\s*약정서|정보보안관리\s*약정서/.test(title)) {
      outsourcing.unshift({ clauseIndex: null, heading: title,
        reason: "표준 보안관리약정서 문서명", quote: title });
    }
    var kind = thirdParty.length && outsourcing.length ? "mixed"
      : (thirdParty.length ? "third_party_provision"
        : (outsourcing.length ? "processing_outsourcing" : "unknown"));
    return {
      kind: kind,
      tags: {
        processing_outsourcing: outsourcing.length > 0,
        third_party_provision: thirdParty.length > 0,
        third_party_provision_prohibited: prohibited.length > 0
      },
      evidence: { processing_outsourcing: outsourcing,
        third_party_provision: thirdParty, third_party_provision_prohibited: prohibited }
    };
  }

  return {
    PROFILE_VERSION: Engine.CONTRACT_TAG_PROFILE_VERSION,
    TAXONOMY: Engine.CONTRACT_TAG_TAXONOMY || null,
    analyzeClause: analyzeClause,
    values: values,
    matchClause: matchClause,
    detectDataRelationship: detectDataRelationship
  };
})(ContractTagEngineRef);

if (typeof module !== "undefined") module.exports = ContractTags;
