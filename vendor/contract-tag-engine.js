"use strict";
var ContractTagEngine = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/contract-tag-profile.mjs
  var contract_tag_profile_exports = {};
  __export(contract_tag_profile_exports, {
    CONTRACT_TAG_PROFILE_VERSION: () => CONTRACT_TAG_PROFILE_VERSION,
    CONTRACT_TAG_TAXONOMY: () => CONTRACT_TAG_TAXONOMY,
    compareContractTagFrames: () => compareContractTagFrames,
    compareContractTagSignatures: () => compareContractTagSignatures,
    contractTagValues: () => contractTagValues,
    extractContractTagAnalysis: () => extractContractTagAnalysis
  });
  var CONTRACT_TAG_PROFILE_VERSION = "1.1.0";
  var SOURCE_WEIGHTS = { document_title: 10, clause_heading: 8, clause_body: 5 };
  var RULES = {
    topics: [
      ["personal_information", "\uAC1C\uC778\uC815\uBCF4", /개인(?:신용)?정보|신용정보/g],
      ["subcontracting", "\uC7AC\uC704\uD0C1", /재위탁|재수탁|하도급/g],
      ["confidentiality", "\uBE44\uBC00\uC720\uC9C0", /비밀유지|비밀정보|기밀정보|기밀유지/g],
      ["damages", "\uC190\uD574\uBC30\uC0C1", /손해배상|배상책임/g],
      ["termination", "\uD574\uC9C0\xB7\uD574\uC81C", /계약해지|계약 해지|해제|해지/g],
      ["intellectual_property", "\uC9C0\uC2DD\uC7AC\uC0B0\uAD8C", /지식재산권|지적재산권|저작권|특허권/g],
      ["contract_term", "\uACC4\uC57D\uAE30\uAC04", /계약기간|유효기간|존속기간/g],
      ["assignment", "\uC591\uB3C4", /계약상 지위|권리의무|채권양도|양도/g],
      ["notice", "\uD1B5\uC9C0\xB7\uBCF4\uACE0", /통지|보고/g]
    ],
    actors: [
      ["trustee", "\uC218\uD0C1\uC790", /수탁자|수탁회사|수임인/g],
      ["trustor", "\uC704\uD0C1\uC790", /위탁자|위탁회사|위임인/g],
      ["company", "\uD68C\uC0AC", /미래에셋생명(?:보험)?|당사|회사/g],
      ["counterparty", "\uC0C1\uB300\uBC29", /상대방/g],
      ["disclosing_party", "\uC815\uBCF4\uC81C\uACF5\uC790", /정보제공자|공개당사자|제공 당사자/g],
      ["receiving_party", "\uC815\uBCF4\uC218\uB839\uC790", /정보수령자|수령당사자|수령 당사자/g],
      ["party_a", "\uAC11", /[“"']?갑[”"']?(?=은|는|이|가|에게|의|으로)/g],
      ["party_b", "\uC744", /[“"']?을[”"']?(?=은|는|이|가|에게|의|으로)/g]
    ],
    actions: [
      ["subcontract", "\uC7AC\uC704\uD0C1", /재위탁|재수탁|하도급/g],
      ["process", "\uCC98\uB9AC", /처리/g],
      ["provide", "\uC81C\uACF5", /제3자.{0,8}제공|정보.{0,8}제공/g],
      ["destroy", "\uD30C\uAE30", /파기|삭제|폐기/g],
      ["disclose", "\uACF5\uAC1C\xB7\uB204\uC124", /공개|누설|유출/g],
      ["notify", "\uD1B5\uC9C0", /통지/g],
      ["report", "\uBCF4\uACE0", /보고/g],
      ["obtain_consent", "\uB3D9\uC758\uCDE8\uB4DD", /동의.{0,8}(?:받|얻)|동의를 받아|동의를 얻어/g],
      ["obtain_approval", "\uC2B9\uC778\uCDE8\uB4DD", /승인.{0,8}(?:받|얻)|승인을 받아|승인을 얻어/g],
      ["terminate", "\uD574\uC9C0\xB7\uD574\uC81C", /해지|해제/g],
      ["compensate", "\uBC30\uC0C1", /배상|보상/g],
      ["assign", "\uC591\uB3C4", /양도/g],
      ["use", "\uC0AC\uC6A9", /사용|이용/g]
    ],
    objects: [
      ["personal_information", "\uAC1C\uC778\uC815\uBCF4", /개인(?:신용)?정보|신용정보/g],
      ["confidential_information", "\uBE44\uBC00\uC815\uBCF4", /비밀정보|기밀정보/g],
      ["intellectual_property", "\uC9C0\uC2DD\uC7AC\uC0B0\uAD8C", /지식재산권|지적재산권|저작권|특허권/g],
      ["contractual_position", "\uACC4\uC57D\uC0C1 \uC9C0\uC704", /계약상 지위|권리의무/g],
      ["deliverable", "\uC0B0\uCD9C\uBB3C", /산출물|성과물|결과물/g]
    ],
    modalities: [
      ["prior_written_consent", "\uC0AC\uC804 \uC11C\uBA74\uB3D9\uC758", /사전.{0,12}서면.{0,12}동의|서면.{0,12}사전.{0,12}동의/g],
      ["prior_consent", "\uC0AC\uC804\uB3D9\uC758", /사전.{0,12}동의/g],
      ["prior_approval", "\uC0AC\uC804\uC2B9\uC778", /사전.{0,12}승인/g],
      ["written", "\uC11C\uBA74", /서면|문서로/g],
      ["prohibition", "\uAE08\uC9C0", /금지|하여서는\s*아니|해서는\s*안|하지\s*못|할\s*수\s*없|허용되지\s*않/g],
      ["obligation", "\uC758\uBB34", /하여야\s*한다|해야\s*한다|할\s*의무|의무를\s*부담/g],
      ["permission", "\uD5C8\uC6A9", /할\s*수\s*있다|허용(?:한다|된다|할 수 있다)?/g],
      ["unconditional_permission", "\uBB34\uC870\uAC74 \uD5C8\uC6A9", /별도.{0,8}(?:동의|승인).{0,8}없이.{0,12}할\s*수\s*있|자유로이.{0,12}할\s*수\s*있/g],
      ["notice_required", "\uD1B5\uC9C0 \uD544\uC694", /통지하여야|통지해야|통지할\s*의무/g],
      ["post_notice", "\uC0AC\uD6C4 \uD1B5\uC9C0", /사후.{0,10}통지|후.{0,8}통지/g]
    ],
    conditions: [
      ["prior", "\uC0AC\uC804", /사전|미리/g],
      ["written", "\uC11C\uBA74", /서면|문서로/g],
      ["within_period", "\uAE30\uD55C", /\d+\s*(?:일|영업일|개월|년)\s*(?:이내|내에)|지체\s*없이|즉시/g],
      ["exception", "\uC608\uC678\xB7\uB2E8\uC11C", /다만|예외로|제외한다|그러하지\s*아니/g]
    ]
  };
  var CONTRACT_TAG_TAXONOMY = Object.freeze({
    profileVersion: CONTRACT_TAG_PROFILE_VERSION,
    facets: {
      ...Object.fromEntries(Object.entries(RULES).map(([facet, rules]) => [
        facet,
        Object.fromEntries(rules.map(([id, label]) => [id, { label }]))
      ])),
      provisions: {}
    }
  });
  var CONFLICTS = {
    prohibition: /* @__PURE__ */ new Set(["permission", "unconditional_permission"]),
    permission: /* @__PURE__ */ new Set(["prohibition"]),
    unconditional_permission: /* @__PURE__ */ new Set(["prohibition", "prior_consent", "prior_written_consent", "prior_approval"]),
    prior_consent: /* @__PURE__ */ new Set(["unconditional_permission", "post_notice"]),
    prior_written_consent: /* @__PURE__ */ new Set(["unconditional_permission", "post_notice"]),
    prior_approval: /* @__PURE__ */ new Set(["unconditional_permission", "post_notice"]),
    post_notice: /* @__PURE__ */ new Set(["prior_consent", "prior_written_consent", "prior_approval"])
  };
  function evidenceExcerpt(text, index, length) {
    return text.slice(Math.max(0, index - 30), Math.min(text.length, index + length + 45)).replace(/\s+/g, " ").trim();
  }
  function normalizeSources(input = {}) {
    return [
      ["document_title", String(input.documentTitle || input.title || "")],
      ["clause_heading", String(input.clauseHeading || input.heading || "")],
      ["clause_body", String(input.clauseBody || input.body || input.text || "")]
    ].filter(([, text]) => text.trim());
  }
  function scanRule(text, pattern) {
    const hits = [];
    pattern.lastIndex = 0;
    let match;
    while (match = pattern.exec(text)) {
      hits.push({ index: match.index, text: match[0] });
      if (!match[0].length) pattern.lastIndex += 1;
    }
    return hits;
  }
  function addFacet(store, facet, rule, source, text, hit) {
    const [id, label] = rule;
    const key = `${facet}:${id}`;
    const current = store.get(key) || {
      id,
      label,
      facet,
      score: 0,
      sources: /* @__PURE__ */ new Set(),
      evidence: [],
      occurrences: 0,
      status: "direct"
    };
    current.score = Math.min(100, Math.max(current.score, 62 + SOURCE_WEIGHTS[source]) + Math.min(8, current.occurrences * 2));
    current.sources.add(source);
    current.occurrences += 1;
    if (current.evidence.length < 8) {
      current.evidence.push({ source, text: evidenceExcerpt(text, hit.index, hit.text.length), at: hit.index, match: hit.text });
    }
    store.set(key, current);
  }
  function tagsFromStore(store) {
    return Array.from(store.values()).map((tag) => ({
      ...tag,
      score: Math.min(100, tag.score + (tag.sources.size > 1 ? 6 : 0)),
      sources: Array.from(tag.sources)
    })).sort((a, b) => b.score - a.score || a.facet.localeCompare(b.facet, "ko") || a.id.localeCompare(b.id, "ko"));
  }
  function facetsFromTags(tags) {
    const facets = {};
    for (const facet of Object.keys(RULES)) facets[facet] = tags.filter((tag) => tag.facet === facet);
    return facets;
  }
  function scanSources(sources) {
    const store = /* @__PURE__ */ new Map();
    for (const [source, sourceText] of sources) {
      for (const [facet, rules] of Object.entries(RULES)) {
        for (const rule of rules) {
          for (const hit of scanRule(sourceText, rule[2])) addFacet(store, facet, rule, source, sourceText, hit);
        }
      }
    }
    const tags = tagsFromStore(store);
    return { facets: facetsFromTags(tags), tags };
  }
  function clauseHeadingParts(value) {
    const heading = String(value || "").trim();
    const match = /^\s*제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\(([^)\n]+)\))?\s*/u.exec(heading);
    if (match) return { context: String(match[1] || "").trim(), remainder: heading.slice(match[0].length).trim() };
    if (heading.length <= 80 && !/[.!?。\n]|(?:한다|된다|아니한다|있다|없다)\s*$/u.test(heading)) {
      return { context: heading, remainder: "" };
    }
    return { context: "", remainder: heading };
  }
  function splitPropositionUnits(value) {
    return String(value || "").replace(/\r\n?/g, "\n").split(/\n+|(?<=[.!?。])\s+|(?=[①-⑳])/u).map((text) => text.trim()).filter(Boolean);
  }
  function propositionFrames(input = {}) {
    const heading = clauseHeadingParts(input.clauseHeading || input.heading || "");
    const raw = [
      ...splitPropositionUnits(heading.remainder).map((text) => ["clause_heading", text]),
      ...splitPropositionUnits(input.clauseBody || input.body || input.text || "").map((text) => ["clause_body", text])
    ];
    return raw.map(([source, text], index) => {
      const scanText = [heading.context, text].filter(Boolean).join(" ");
      const scanned = scanSources([[source, scanText]]);
      return {
        id: `frame-${index + 1}`,
        source,
        at: index,
        text,
        headingContext: heading.context,
        facets: scanned.facets,
        tags: scanned.tags
      };
    });
  }
  function extractContractTagAnalysis(input = {}) {
    const scanned = scanSources(normalizeSources(input));
    return {
      profileVersion: CONTRACT_TAG_PROFILE_VERSION,
      facets: scanned.facets,
      tags: scanned.tags,
      frames: propositionFrames(input)
    };
  }
  function ids(value) {
    return (Array.isArray(value) ? value : []).map((item) => typeof item === "string" ? item : item.id).filter(Boolean);
  }
  function compareContractTagSignatures(requirement = {}, observed = {}) {
    const requiredFacets = requirement.requiredFacets || requirement.required_facets || [];
    const matches = {};
    const missing = [];
    const conflicts = [];
    let score = 0;
    const weights = { topics: 4, actors: 6, actions: 4, objects: 4, modalities: 8, conditions: 6, provisions: 12 };
    for (const facet of Object.keys(weights)) {
      const wanted = ids(requirement[facet]);
      const seen = ids(observed[facet]);
      const common = wanted.filter((id) => seen.includes(id));
      matches[facet] = common;
      if (common.length) score += weights[facet] * Math.min(2, common.length);
      if (requiredFacets.includes(facet) && wanted.length && !common.length) missing.push(facet);
    }
    const wantedModalities = ids(requirement.modalities);
    const seenModalities = ids(observed.modalities);
    for (const wanted of wantedModalities) {
      for (const seen of seenModalities) {
        if (CONFLICTS[wanted]?.has(seen)) conflicts.push({ facet: "modalities", required: wanted, observed: seen });
      }
    }
    score -= conflicts.length * 12;
    return { score, matches, missing, conflicts, eligible: missing.length === 0 && conflicts.length === 0 };
  }
  function compactFrame(frame) {
    return frame ? {
      id: frame.id,
      source: frame.source,
      at: frame.at,
      text: frame.text,
      headingContext: frame.headingContext || ""
    } : null;
  }
  function compareContractTagFrames(requirement = {}, frames = []) {
    const candidates = (Array.isArray(frames) ? frames : []).map((frame) => {
      const comparison = compareContractTagSignatures(requirement, frame.facets || {});
      return { frame: compactFrame(frame), ...comparison };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.missing.length - b.missing.length || a.conflicts.length - b.conflicts.length);
    const best = candidates[0];
    if (!best) {
      const empty = compareContractTagSignatures(requirement, {});
      return { ...empty, eligible: false, bestFrame: null, candidates: [] };
    }
    return {
      score: best.score,
      matches: best.matches,
      missing: best.missing,
      conflicts: best.conflicts,
      eligible: best.eligible,
      bestFrame: best.frame,
      candidates: candidates.slice(0, 5)
    };
  }
  function contractTagValues(analysis = {}) {
    const out = {};
    for (const facet of Object.keys(RULES)) out[facet] = ids(analysis.facets?.[facet]);
    return out;
  }
  return __toCommonJS(contract_tag_profile_exports);
})();
