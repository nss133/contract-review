"use strict";
/* 매칭 엔진 v3 — 다신호 점수(tfidf·jaccard) + 규범/표제/인용 보너스 + tier 게이트.
   단일 키워드 이진 매칭(v2)을 대체. 전부 순수 함수.
   의존: Sim(sim.js)·ClauseRole(clause_role.js)·MatcherConfig(matcher_config.js).
   node에서는 require, 브라우저(빌드 연결)에서는 앞서 로드된 전역을 사용.
   tier 계단은 comp_matching_auto/matcher/review_rules.py evaluate_review 이식·적응. */

// ── 의존 로드 (node: require / 브라우저: 전역) ─────────────────────
// 브라우저 연결 시 var 재선언은 이미 정의된 전역값을 덮지 않음(no-op) — if 블록 미실행.
if (typeof require !== "undefined") {
  var Sim = require("./sim.js");
  var ClauseRole = require("./clause_role.js");
  var MatcherConfig = require("./matcher_config.js");
}

// ── 유형 감지·모듈 제안 (v2 유지) ────────────────────────────────
// 성격 배타 게이트(A3): 유형 meta의 nature_signals(성격 강신호)가 복수 검출되면
// 그 유형의 suppresses[]에 든 유형 점수를 0으로. 예: 화해계약 강신호(화해·상호양보·부제소 등)가
// ≥NATURE_MIN이면 shareholders(상법 조직행위) 점수를 눌러 오탐 차단.
// 단일 부수언급(화해 1회)으로 진성 주주간계약을 죽이지 않도록 임계는 복수(2).
var NATURE_MIN = 2;
function detectType(text, types) {
  var t = String(text || "");
  var scored = types.map(function (ty) {
    var score = (ty.meta.detect_keywords || []).reduce(function (s, kw) {
      return s + (t.split(kw).length - 1);
    }, 0);
    return { typeId: ty.meta.type_id, score: score };
  });
  // 성격 게이트: 강신호 복수 검출 유형의 suppresses 대상 점수를 0으로.
  var byId = {};
  scored.forEach(function (r) { byId[r.typeId] = r; });
  types.forEach(function (ty) {
    var sig = ty.meta.nature_signals, sup = ty.meta.suppresses;
    if (!sig || !sig.length || !sup || !sup.length) return;
    var hits = sig.reduce(function (n, kw) { return n + (t.indexOf(kw) !== -1 ? 1 : 0); }, 0);
    if (hits >= NATURE_MIN) {
      sup.forEach(function (id) { if (byId[id]) byId[id].score = 0; });
    }
  });
  return scored.sort(function (a, b) { return b.score - a.score; });
}

// 본문 키워드로 모듈 활성 제안. activation:"strong" 모듈은 특수 규제(전금감규 §60 등)라
// 키워드 1개로는 부족 — 서로 다른 키워드 2개+ 겹칠 때만 활성(일반 계약 오탐 억제).
function suggestModules(text, modules) {
  var t = String(text || "");
  return modules
    .filter(function (m) { return !m.always_on; })
    .filter(function (m) {
      var kws = m.suggest_keywords || [];
      var hits = 0;
      for (var i = 0; i < kws.length; i++) if (t.indexOf(kws[i]) !== -1) hits++;
      var need = m.activation === "strong" ? 2 : 1;
      return hits >= need;
    })
    .map(function (m) { return m.id; });
}

function activeCheckpoints(doc, activeModules) {
  return doc.checkpoints.filter(function (cp) {
    return !cp.module || activeModules.indexOf(cp.module) !== -1;
  });
}

// ── 규범유형 매핑 (check.norm_type ↔ 조항 규범유형) ───────────────
// check.norm_type: 강행|임의|추정|간주|실무 (조문 성격)
// ClauseRole.normType(body): 금지|의무|권한|선언|null (문장 어미)
var NORM_MAP = {
  "강행": { "의무": 1, "금지": 1 }, // 하여야 한다/아니 된다
  "임의": { "권한": 1 },            // 할 수 있다
  "추정": { "선언": 1 },            // 본다/추정
  "간주": { "선언": 1 }             // 간주/본다
  // "실무": 규범 근거 없음 → 매핑 없음(보너스 대상 아님)
};
function normMatches(clauseNorm, checkNorm) {
  if (!clauseNorm) return false;
  var m = NORM_MAP[checkNorm];
  return !!(m && m[clauseNorm]);
}

// ── 텍스트 표현 ──────────────────────────────────────────────────
// check 대표 텍스트 = 질문 + 근거조문 quote + 큐레이션 키워드 + 근거조문 표제/항.
function checkText(check) {
  var parts = [String(check.check || "")];
  var sources = check.sources || [];
  sources.forEach(function (s) {
    if (s.quote) parts.push(String(s.quote));
    var title = ClauseRole.parseTitle(s.article || "");
    if (title) parts.push(title);
    else if (s.clause) parts.push(String(s.clause));
  });
  var kws = (check.triggers && check.triggers.keywords) || [];
  if (kws.length) parts.push(kws.join(" "));
  return Sim.preprocess(parts.join(" "));
}

// clause 질의 = 표제(TITLE_K회 반복) + 표제 + 본문. 표제 용어 TF 가중(스펙 B).
function clauseQuery(clause) {
  var title = ClauseRole.parseTitle(clause.heading || "");
  var rep = "";
  for (var i = 0; i < MatcherConfig.TITLE_K; i++) rep += title + " ";
  return Sim.preprocess(rep + String(clause.heading || "") + " " + String(clause.body || ""));
}

// 활성 check 코퍼스로 IDF 빌드 → {idf, checks:[{cp, text, doc}]}
function buildModel(docs, activeModules) {
  var checks = [];
  docs.forEach(function (d) {
    activeCheckpoints(d, activeModules).forEach(function (cp) {
      checks.push({ cp: cp, text: checkText(cp), doc: d });
    });
  });
  var idf = Sim.buildIdf(checks.map(function (c) { return c.text; }));
  return { idf: idf, checks: checks };
}

// ── 명시 인용 감지 (comp citation_extract 차용, 축약) ─────────────
// clauseText 에 check 근거의 "법령명(핵심 2~4글자+) + 제N조(번호 일치)"가 함께 나오면 true.
// 과탐 방지: 제N조 숫자 일치 필수 + 법령명 핵심 문자열 존재 필수.
function _lawCore(law) {
  var b = String(law || "").replace(/\s+/g, "");
  b = b.replace(/(등에관한규정|에관한규정|등에관한법률|에관한법률|시행세칙|시행규칙|시행령|감독규정|규정|법률|법)$/, "");
  return b;
}
// 매칭된 근거 source(law/article)를 반환. 없으면 null. (reason 라벨용)
function citationMatch(clauseText, check) {
  var q = String(clauseText || "").replace(/\s+/g, "");
  var sources = check.sources || [];
  for (var i = 0; i < sources.length; i++) {
    var m = String(sources[i].article || "").match(/제\s*(\d+)\s*조(?:의\s*(\d+))?/);
    if (!m) continue;
    var pat = "제" + m[1] + "조" + (m[2] ? "의" + m[2] : "");
    if (q.indexOf(pat) === -1) continue; // 조문번호 일치 필수
    var core = _lawCore(sources[i].law);
    if (core.length < 2) continue;
    var probe = core.length > 4 ? core.slice(0, 4) : core; // 핵심 2~4글자
    if (q.indexOf(core) !== -1 || q.indexOf(probe) !== -1) return sources[i];
  }
  return null;
}
function citationHit(clauseText, check) {
  return citationMatch(clauseText, check) !== null;
}

// ── 표제 보너스 ──────────────────────────────────────────────────
// clause 표제 용어와 check 핵심어(대표 텍스트 키워드) 겹침 → 소폭 가산(상한 TITLE_BONUS_MAX).
function titleBonus(clause, checkTextStr) {
  var title = ClauseRole.parseTitle(clause.heading || "");
  if (!title) return 0;
  var tkw = Sim.keywords(title);
  var ckw = Sim.keywords(checkTextStr);
  var overlap = 0;
  for (var k in tkw) if (ckw[k]) overlap++;
  if (!overlap) return 0;
  return Math.min(overlap * 2, MatcherConfig.TITLE_BONUS_MAX);
}

// ── 핵심어 겹침 게이트 (노출 자격) ───────────────────────────────
// char n-gram TF-IDF는 어절 하나만 겹쳐도 REVIEW_FLOOR를 넘길 수 있어 약한 후보를
// 대량 노출한다. 노출(verify/addressed)에는 "고유 핵심어(2글자+ 한글) 복수 겹침"을 요구.
// 예외: (a) 명시 인용, (b) 조항 표제와 강일치 — 표제어 겹침은 본문어보다 신뢰도가 높음.
//   uniq         = (조항 표제어 ∪ 본문어) ∩ check 대표텍스트 핵심어 개수(중복 제거).
//   titleStrong  = 조항 표제 핵심어 중 check와 겹친 비율 ≥ TITLE_STRONG_RATIO && 겹침 ≥ 1.
function overlapFeatures(clause, check) {
  var ck = Sim.keywords(checkText(check));
  var body = Sim.keywords(String(clause.body || ""));
  var titleKw = Sim.keywords(ClauseRole.parseTitle(clause.heading || ""));
  var all = {};
  var k;
  for (k in body) all[k] = 1;
  for (k in titleKw) all[k] = 1;
  var uniq = 0;
  for (k in all) if (ck[k]) uniq++;
  var tTot = 0, tHit = 0;
  for (k in titleKw) { tTot++; if (ck[k]) tHit++; }
  var titleStrong = tTot > 0 && tHit >= 1 && (tHit / tTot) >= MatcherConfig.TITLE_STRONG_RATIO;
  return { uniq: uniq, titleStrong: titleStrong };
}

// 노출 게이트: 명시 인용 · 복수 핵심어 겹침 · 표제 강일치 중 하나면 통과.
function passesOverlapGate(clause, check, citation) {
  if (citation) return true;
  var f = overlapFeatures(clause, check);
  return f.uniq >= MatcherConfig.OVERLAP_MIN || f.titleStrong;
}

// ── 조항×체크 점수 ───────────────────────────────────────────────
function scoreClauseCheck(clause, checkEntry, model) {
  var cq = clauseQuery(clause);
  var tfidf = Sim.cosine(Sim.tfidfVec(cq, model.idf), Sim.tfidfVec(checkEntry.text, model.idf)) * 100;
  var jaccard = Sim.jaccard(cq, checkEntry.text) * 100;
  var isShort = String(clause.body || "").length < MatcherConfig.SHORT_LEN;
  var tw = isShort ? MatcherConfig.TW_SHORT : MatcherConfig.TW;
  var jw = isShort ? MatcherConfig.JW_SHORT : MatcherConfig.JW;
  var clauseNorm = ClauseRole.normType(clause.body);
  var nMatch = normMatches(clauseNorm, checkEntry.cp.norm_type);
  var nBonus = nMatch ? MatcherConfig.NORM_BONUS : 0;
  var tBonus = titleBonus(clause, checkEntry.text);
  var citation = citationHit(String(clause.heading || "") + " " + String(clause.body || ""), checkEntry.cp);
  var raw = tw * tfidf + jw * jaccard + nBonus + tBonus;
  var score = Math.max(0, Math.min(100, raw));
  var signals = (tfidf > 0 ? 1 : 0) + (jaccard > 0 ? 1 : 0);
  return {
    score: score, tfidf: tfidf, jaccard: jaccard,
    normMatch: nMatch, titleBonus: tBonus, citation: citation, signals: signals
  };
}

// ── tier 판정 (검토 보조 화법: 단일후보/단일신호 강등 없음) ──────────
// rankedForCheck: 그 check에 대해 REVIEW_FLOOR 이상인 후보 조항 {clause, s} 내림차순.
// 계약서 도메인에선 "체크가 조항 하나에 매칭"이 정상 — 단일 매칭도 근거가 강하면 짚음(confirmed).
//   짚음 도달: (명시 인용) · (충분한 절대점수 단독) · (뚜렷한 최상위=margin).
//   weak 역할(목적·정의·전문·계약기간·완전합의) + 인용 없음 → 자동확정 불가(최대 review) — 도메인 유효.
function decideTier(ranked, check) {
  if (!ranked.length) return "none";
  var best = ranked[0];
  if (best.s.score < MatcherConfig.REVIEW_FLOOR) return "none";
  var role = ClauseRole.clauseRole(best.clause.heading, best.clause.body);
  var citation = best.s.citation === true;
  if (role.weak === true && !citation) return "review"; // weak-role 게이트 유지
  if (citation) return "confirmed";                      // 명시 인용 일치
  if (best.s.score >= MatcherConfig.ABS_SCORE) return "confirmed"; // 충분한 절대점수 — 단일 매칭도 짚음
  if (ranked.length >= 2 &&
    (best.s.score - ranked[1].s.score) >= MatcherConfig.MARGIN_HIGH &&
    best.s.score >= MatcherConfig.REVIEW_FLOOR) return "confirmed"; // 뚜렷한 최상위
  return "review"; // 관련 조항은 있으나(≥REVIEW_FLOOR) 확정 근거 부족 → 확인 권장
}

// ── coverage 상태 (검토 관점 표시값) ─────────────────────────────
//   addressed=짚음 / verify=확인 권장 / consider=검토 제안(알람) / quiet=조용한 기타.
// 알람 게이트: 확실 부재(absence_check && none)이고 severity가 필수·권장일 때만 consider.
//   저위험(참고) 부재는 조용(quiet) — 저위험 알람 억제(스펙 B).
function alarmGate(check) {
  return MatcherConfig.ALARM_SEVERITIES.indexOf(check && check.severity) !== -1;
}
// 조건부 부재체크(전제신호 게이트): absence_precondition이 있으면 본문에 전제어휘가
// 1개 이상 있을 때만 부재알람 발동. 없으면 관련성 미달로 조용(quiet).
// precondition이 없는 check는 항상 발동(하위호환). 약한 게이트(1개 충족) — 누락검출 우선.
function preconditionMet(check, text) {
  var pre = check && check.absence_precondition;
  if (!pre || !pre.length) return true; // 전제 없음 = 무조건 대상
  var t = String(text || "");
  for (var i = 0; i < pre.length; i++) if (t.indexOf(pre[i]) !== -1) return true;
  return false;
}
// text(계약서 전체 본문) 전달 시 전제신호 게이트 적용. 미전달이면 게이트 비활성(하위호환).
function coverageOf(tier, check, text) {
  if (tier === "confirmed") return "addressed";
  if (tier === "review") return "verify";
  // tier === "none"
  if (check && check.absence_check && alarmGate(check) &&
      (text === undefined || preconditionMet(check, text))) return "consider";
  return "quiet";
}

// ── tier 근거 문자열 (정보형 — 판정 어휘 금지) ───────────────────
function _articleShort(article) {
  var m = String(article || "").match(/제\s*\d+\s*조(?:의\s*\d+)?/);
  return m ? m[0].replace(/\s+/g, "") : "";
}
// clause 표제·본문과 check 대표텍스트가 공유하는 2글자+ 한글 핵심어 몇 개.
function _overlapKeywords(clause, check, limit) {
  var ck = Sim.keywords(checkText(check));
  var cl = Sim.keywords(String(clause.heading || "") + " " + String(clause.body || ""));
  var out = [];
  for (var k in cl) {
    if (ck[k]) { out.push(k); if (out.length >= (limit || 3)) break; }
  }
  return out;
}
function _reasons(tier, ranked, check) {
  if (!ranked.length || tier === "none") return [];
  var best = ranked[0], s = best.s;
  if (s.citation) {
    var src = citationMatch(String(best.clause.heading || "") + " " + String(best.clause.body || ""), check);
    var tag = src ? " (" + [src.law, _articleShort(src.article)].filter(Boolean).join(" ") + ")" : "";
    return ["명시 인용 일치" + tag];
  }
  var role = ClauseRole.clauseRole(best.clause.heading, best.clause.body);
  if (tier === "confirmed") {
    if (s.normMatch) return ["본문 문구·규범 일치"];
    var kws = _overlapKeywords(best.clause, check);
    return ["본문 문구 일치" + (kws.length ? " (핵심어: " + kws.join(", ") + ")" : "")];
  }
  // review
  if (role.weak) return ["관련 조항 있음 — 목적·정의 조항이라 문구 확인 권장"];
  return ["관련 조항 있음 — 충분한지 확인 권장"];
}

// ── 메인 ─────────────────────────────────────────────────────────
// 서브 서류 커버리지(#3): 주 계약서에서 consider(필수 부재)로 뜬 check가
// 부속 서류(보안관리약정서 등)에서 다뤄지는지 매칭엔진으로 확인.
// considerCps: consider 판정된 checkpoint 배열. subDocs: [{name, clauses}]. model: buildModel 결과(IDF 재사용).
// 반환: { cpId: {docName, score} } — 부속서류에서 커버된 항목만.
function subDocCoverage(considerCps, subDocs, model) {
  var out = {};
  if (!considerCps || !considerCps.length || !subDocs || !subDocs.length) return out;
  considerCps.forEach(function (cp) {
    var entry = { cp: cp, text: checkText(cp), doc: null };
    for (var d = 0; d < subDocs.length; d++) {
      var doc = subDocs[d];
      var clauses = doc.clauses || [];
      if (!clauses.length) continue;
      var scored = clauses.map(function (cl) {
        return { clause: cl, s: scoreClauseCheck(cl, entry, model) };
      }).sort(function (a, b) { return b.s.score - a.s.score; });
      var candidates = scored.filter(function (r) { return r.s.score >= MatcherConfig.REVIEW_FLOOR; });
      var tier = decideTier(candidates, cp);
      // 부속서류에서 addressed/verify로 닿고 노출 게이트 통과하면 커버로 인정.
      if ((tier === "confirmed" || tier === "review") && candidates.length) {
        var best = candidates[0];
        if (passesOverlapGate(best.clause, cp, best.s.citation === true)) {
          out[cp.id] = { docName: doc.name, score: best.s.score };
          break; // 첫 커버 서류에서 확정
        }
      }
    }
  });
  return out;
}

function analyze(clauses, docs, activeModules) {
  var model = buildModel(docs, activeModules);
  var results = [];
  var matches = [];
  var missing = [];
  // 전제신호 게이트용 본문 전체(표제+본문). 조건부 부재체크가 여기서 전제어휘를 찾음.
  var fullText = (clauses || []).map(function (cl) {
    return String(cl.heading || "") + " " + String(cl.body || "");
  }).join("\n");

  model.checks.forEach(function (entry) {
    var cp = entry.cp;
    var scored = clauses.map(function (cl) {
      return { clause: cl, s: scoreClauseCheck(cl, entry, model) };
    }).sort(function (a, b) { return b.s.score - a.s.score; });

    var candidates = scored.filter(function (r) { return r.s.score >= MatcherConfig.REVIEW_FLOOR; });
    var tier = decideTier(candidates, cp);
    var coverage = coverageOf(tier, cp, fullText);
    var top = scored[0] || null;

    // 노출 게이트: 짚음/확인권장(조항 매칭 tier)에 핵심어 복수 겹침을 요구.
    // 미달 시 tier는 보존하되 coverage를 quiet로 강등(약한 후보를 조용히 접음).
    // consider(부재 알람)·none은 조항 매칭이 아니라 게이트 대상 아님.
    var gate = null;
    if ((coverage === "addressed" || coverage === "verify") && candidates.length) {
      var bestClause = candidates[0].clause;
      var f = overlapFeatures(bestClause, cp);
      // 게이트 통과 판정은 passesOverlapGate로 단일화(순수함수·테스트 대상과 동일 로직).
      var passed = passesOverlapGate(bestClause, cp, candidates[0].s.citation === true);
      gate = { uniq: f.uniq, titleStrong: f.titleStrong, passed: passed };
      if (!passed) coverage = "quiet";
    }

    var reasons = _reasons(tier, candidates.length ? candidates : scored, cp);
    var rankedTop = scored.slice(0, 3).map(function (r) {
      return { clauseIndex: r.clause.index, score: r.s.score };
    });

    results.push({
      cpId: cp.id,
      tier: tier,
      coverage: coverage,
      best: top ? { clauseIndex: top.clause.index, score: top.s.score, reasons: reasons, gate: gate } : null,
      ranked: rankedTop
    });

    // 노출 매칭: 게이트 통과(coverage가 quiet로 강등되지 않은 조항 매칭)만.
    if ((coverage === "addressed" || coverage === "verify") && top) {
      matches.push({
        cpId: cp.id,
        clauseIndex: top.clause.index,
        hits: {
          tier: tier, coverage: coverage, score: top.s.score, tfidf: top.s.tfidf, jaccard: top.s.jaccard,
          citation: top.s.citation, normMatch: top.s.normMatch, reasons: reasons
        }
      });
    }
    if (coverage === "consider") missing.push(cp);
  });

  return {
    checkpoints: model.checks.map(function (e) { return e.cp; }),
    results: results,
    matches: matches,   // 하위호환: tier!=="none" 인 best (app.js 소비)
    missing: missing    // 하위호환(재정의): coverage==="consider" — 알람 게이트 통과분만
  };
}

if (typeof module !== "undefined")
  module.exports = {
    detectType: detectType,
    suggestModules: suggestModules,
    activeCheckpoints: activeCheckpoints,
    normMatches: normMatches,
    checkText: checkText,
    clauseQuery: clauseQuery,
    buildModel: buildModel,
    citationHit: citationHit,
    citationMatch: citationMatch,
    titleBonus: titleBonus,
    overlapFeatures: overlapFeatures,
    passesOverlapGate: passesOverlapGate,
    scoreClauseCheck: scoreClauseCheck,
    decideTier: decideTier,
    alarmGate: alarmGate,
    preconditionMet: preconditionMet,
    coverageOf: coverageOf,
    subDocCoverage: subDocCoverage,
    analyze: analyze
  };
