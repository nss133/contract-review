"use strict";
const fs = require("fs");
const crypto = require("crypto");
const { segmentContract, extractDocTitle } = require("../src/segmenter.js");
const { detectType, pickType, suggestModules, analyze, detectStance,
  moduleAllowedInStance, detectPartyRoles, hasAffiliateParty } = require("../src/matcher.js");
const Experiment = require("../src/experiment.js");
const LocalLLM = require("../src/local_llm.js");

const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const common = payload.common;
const types = payload.types;

function analyzeDocument(d) {
  const text = String(d.text || "");
  const clauses = segmentContract(text);
  const docTitle = extractDocTitle(text);
  const ranked = detectType(text, types, docTitle);
  const typeId = pickType(ranked);
  const doc = types.find(t => t.meta.type_id === typeId) || null;
  const stance = detectStance(text).stance;
  const partyRoles = detectPartyRoles(text);
  const stanceCtx = { affiliate_party: hasAffiliateParty(text) };
  const modules = (common.meta.modules || []).concat(doc ? doc.meta.modules || [] : [])
    .filter(m => moduleAllowedInStance(m, stance, stanceCtx));
  const suggested = suggestModules(text, modules, { stance, docTitle, stanceCtx });
  const active = modules.filter(m => m.always_on || suggested.on.includes(m.id)).map(m => m.id);
  const docs = [{ checkpoints: common.checks }, { checkpoints: doc ? doc.checks : [] }];
  const result = analyze(clauses, docs, { modules: active, stance, docTitle, partyRoles });
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const base = {
    documentId: d.id, contractHash: hash, typeId, generated: payload.generated,
    appVersion: payload.app_version, model: LocalLLM.MODEL,
    results: result.results, checkpoints: result.checkpoints, clauses
  };
  return {
    id: d.id,
    prediction: Experiment.buildPredictions(base),
    gold: Experiment.buildGoldTemplate(base),
    batches: LocalLLM.buildBatches(result.results, result.checkpoints, clauses, 2)
  };
}

process.stdout.write(JSON.stringify(payload.documents.map(analyzeDocument)));
