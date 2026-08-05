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

// ── 유형 감지 v2 (제목 가중·길이 정규화·미확정) ──────────────────
// 점수 = Σ키워드( 표제부(앞 DETECT_HEAD_LEN자) 출현 ×DETECT_TITLE_W + min(본문 출현, DETECT_BODY_CAP) ).
// 계약서 표제("업무위탁계약서" 등)가 최강 신호라 표제부 가중, 긴 문서의 부수 반복은 캡으로 억제.
// 성격 배타 게이트(A3): 유형 meta의 nature_signals(성격 강신호)가 복수 검출되면
// 그 유형의 suppresses[]에 든 유형 점수를 0으로. 예: 화해계약 강신호(화해·상호양보·부제소 등)가
// ≥NATURE_MIN이면 shareholders(상법 조직행위) 점수를 눌러 오탐 차단.
// 단일 부수언급(화해 1회)으로 진성 주주간계약을 죽이지 않도록 임계는 복수(2).
var NATURE_MIN = 2;
function _countOcc(hay, needle) {
  return needle ? hay.split(needle).length - 1 : 0;
}
// docTitle(선택, 11.1차): 문서 제목 줄. 표제부(앞 300자)보다 더 강한 최상위 신호로 가산 —
// "이 문서가 무슨 계약인가"는 제목이 가장 정확하게 말해주고, 본문의 부수 언급과 층위가 다름.
function detectType(text, types, docTitle) {
  var t = String(text || "");
  var head = t.slice(0, MatcherConfig.DETECT_HEAD_LEN);
  var title = String(docTitle || "");
  var scored = types.map(function (ty) {
    var score = 0, hits = [], titleHit = false;
    (ty.meta.detect_keywords || []).forEach(function (kw) {
      var titleN = _countOcc(title, kw);
      // 제목 적중분은 head 카운트에서 빼서 이중계산 방지(제목은 보통 head 안에 있음).
      var headN = Math.max(_countOcc(head, kw) - titleN, 0);
      var bodyN = Math.min(_countOcc(t, kw) - headN - titleN, MatcherConfig.DETECT_BODY_CAP);
      var s = titleN * MatcherConfig.DETECT_DOCTITLE_W +
        headN * MatcherConfig.DETECT_TITLE_W + Math.max(bodyN, 0);
      if (s > 0) { score += s; hits.push(kw); }
      if (titleN > 0) titleHit = true;
    });
    return { typeId: ty.meta.type_id, score: score, hits: hits, titleHit: titleHit };
  });
  // 성격 게이트: 강신호 복수 검출 유형의 suppresses 대상 점수를 0으로.
  var byId = {};
  scored.forEach(function (r) { byId[r.typeId] = r; });
  types.forEach(function (ty) {
    var sig = ty.meta.nature_signals, sup = ty.meta.suppresses;
    if (!sig || !sig.length || !sup || !sup.length) return;
    var hits = sig.reduce(function (n, kw) { return n + (t.indexOf(kw) !== -1 ? 1 : 0); }, 0);
    if (hits >= NATURE_MIN) {
      sup.forEach(function (id) {
        // 제목 적중 유형은 억제 대상에서 제외(11.1차) — 제목이 성격 신호보다 강한 증거.
        // "업무위탁계약서"라는 제목이 있는데 본문 어휘로 outsourcing을 죽이면 안 됨.
        if (byId[id] && !byId[id].titleHit) { byId[id].score = 0; byId[id].suppressed = true; }
      });
    }
  });
  return scored.sort(function (a, b) { return b.score - a.score; });
}
// 유형 선택 단일화 — 앱(btn-analyze)과 골드셋 러너가 공유. 임계 미달이면 null(미확정: 공통 검토만).
function pickType(ranked) {
  return ranked[0] && ranked[0].score >= MatcherConfig.DETECT_MIN_SCORE ? ranked[0].typeId : null;
}

// 본문 키워드로 모듈 활성 제안 → { on: 자동활성, ask: 질문(약신호 — 사람 확인 필요) }.
// activation 등급:
//   (기본)      키워드 1개+ → on. 일반 모듈.
//   "strong"    서로 다른 키워드 2개+ → on, 아니면 off. 특수 규제(§60 등) — 오탐 억제 우선.
//   "confirm"   강신호(서로 다른 2개+ 또는 총 출현 3회+) → on / 약신호(1~2회) → ask / 무신호 → off.
//               개인정보 등 "문언만으론 실제 취급 여부 판단 불가" 모듈 — 약신호면 추측하지 않고 사람에게 물음.
//               (상투 준수조항의 1회 언급 ≈ 약신호, 실제 취급 계약은 반복 언급 ≈ 강신호)
// 「법령명」 인용구는 카운트에서 제외 — "제N조(법규준수) …「개인정보 보호법」, 「신용정보의
// 이용 및 보호에 관한 법률」 등을 준수한다"류 법령명 열거 문장에서, 서로 다른 두 법령명에
// 우연히 포함된 키워드가 "서로 다른 신호 2개"로 오카운트되는 것을 방지(사내표준층 케이스20
// mal-ad-online 회귀 — 실제 개인정보 처리 문언 없이 법령명 나열만으로 X-PII 오발동).
function _stripStatuteCitations(text) {
  return text.replace(/「[^」]*」/g, "");
}
// ── 검토 국면(stance) 게이트 ─────────────────────────────────────
// 당사가 규범의 수범자인지에 따라 모듈·체크의 유효성이 갈림. 문언 검출은 정확해도
// 의무주체가 제3자면 그 규제는 당사 검토항목이 아님(2026-08-04 투자신탁 사고).
//   party       = 당사가 의무를 부담·이행하는 국면(기본)
//   beneficiary = 당사가 수익자·투자자로 참여, 의무주체는 운용사·수탁회사 등 제3자
var STANCES = ["party", "beneficiary"];
var DEFAULT_STANCE = "party";
function normalizeStance(stance) {
  return STANCES.indexOf(stance) !== -1 ? stance : DEFAULT_STANCE;
}
// scope(배열)가 없으면 전 국면 허용. 있으면 현재 국면 포함 여부.
function _stanceAllows(scope, stance) {
  if (!scope || !scope.length) return true;
  return scope.indexOf(normalizeStance(stance)) !== -1;
}
// 국면 게이트. stance_exempt_if(선택)에 해당하는 사유가 성립하면 게이트를 뚫고 허용 —
// 국면상 원칙적으로 빠지는 모듈이라도 개별 사정이 있으면 살려야 하기 때문(11.1차).
// 현재 사유: "affiliate_party" = 계약 상대방이 미래에셋 계열사.
//   수익자 국면에서 X-RELATED를 막았으나, 상대방이 미래에셋자산운용인 펀드 투자는
//   계열사 거래 이슈가 실제 발생함(사용자 지적, 2026-08-05).
function moduleAllowedInStance(m, stance, ctx) {
  if (_stanceAllows(m && m.requires_stance, stance)) return true;
  var ex = m && m.stance_exempt_if;
  if (ex && ctx) {
    for (var i = 0; i < ex.length; i++) if (ctx[ex[i]]) return true;
  }
  return false;
}
function checkAllowedInStance(cp, stance) {
  return _stanceAllows(cp && cp.stance_scope, stance);
}

// 국면 자동 추정 — 계약서 문언에서 당사의 지위를 읽음. 입력 단계 프리필용이며
// 최종 결정은 검토자가 함(추정은 근거와 함께 노출).
// 수익자 신호: 투자신탁·집합투자 구조에서 당사가 수익자/투자자로만 등장하는 형태.
var BENEFICIARY_SIGNALS = [
  "수익자", "수익증권", "수익권", "집합투자업자", "신탁업자", "판매회사",
  "집합투자규약", "투자신탁", "일반사모집합투자기구", "신탁원본", "수익자총회"
];
// 당사자 신호: 당사가 직접 의무를 지는 전형 문언(위탁자로서의 발주·수탁 등).
var PARTY_SIGNALS = ["위탁업무", "수탁자는 위탁자에게", "용역대금", "납품", "하도급"];
var STANCE_MIN = 3;
function detectStance(text) {
  var t = _stripStatuteCitations(String(text || ""));
  var bHits = [], pHits = [];
  BENEFICIARY_SIGNALS.forEach(function (kw) { if (t.indexOf(kw) !== -1) bHits.push(kw); });
  PARTY_SIGNALS.forEach(function (kw) { if (t.indexOf(kw) !== -1) pHits.push(kw); });
  // 수익자 구조 신호가 복수이고 당사자 신호보다 우세할 때만 beneficiary 제안.
  // 확신 없으면 기본(party) — 게이트를 함부로 걸지 않는다는 공통 원칙.
  if (bHits.length >= STANCE_MIN && bHits.length > pHits.length)
    return { stance: "beneficiary", hits: bHits, confident: true };
  return { stance: DEFAULT_STANCE, hits: pHits, confident: bHits.length === 0 };
}

// 제목 신호 판정(11.1차) — 문서 제목에 그 모듈의 성격어가 있으면 "이 문서가 곧 그 계약".
// title_signals가 선언된 모듈은 제목이 1차 판정자가 된다:
//   제목 적중 → 본문 신호와 무관하게 on
//   제목 미적중 + title_required:true → 본문에 어휘가 있어도 off
//     (담보설정계약이 아닌 문서에 스쳐 나온 "질권" 한 단어로 담보 체크군이 붙는 것을 차단)
function titleHits(docTitle, signals) {
  var d = String(docTitle || "");
  if (!d || !signals || !signals.length) return [];
  return signals.filter(function (s) { return d.indexOf(s) !== -1; });
}
// opts: { stance, docTitle } — 하위호환으로 3번째 인자에 stance 문자열도 허용.
// ── 당사 지위(party role) 판별 — 11.1차 ──────────────────────────
// "우리가 계약에서 어느 자리에 있는가". 담보설정계약이라도 당사가 담보권자(질권자)면
// 대항요건·점유이전은 우리가 챙길 사항이고, 담보설정자면 부담 조항으로 보게 됨.
// 서명란·당사자 정의부의 당사 상호 주변 표기에서 역할어를 읽는다.
var OUR_NAMES = ["미래에셋생명보험", "미래에셋생명", "미래에셋 생명"];
// 지위어 — "어느 쪽인지"를 말해주는 것만. 갑·을·병은 계약마다 지시 대상이 달라
// 위치 정보를 담지 않으므로 제외(당사가 갑이어도 그것만으로는 질권자인지 설정자인지 모름).
var ROLE_TERMS = [
  "질권자", "질권설정자", "담보권자", "담보제공자", "설정자", "저당권자",
  "양도담보권자", "물상보증인", "양도인", "양수인", "위탁자", "수탁자", "수익자",
  "임대인", "임차인", "매도인", "매수인", "채권자", "채무자", "보증인",
  "위탁회사", "수탁회사", "판매회사", "집합투자업자", "신탁업자", "발행인", "인수인"
];
var ROLE_WINDOW = 60; // 당사 상호 앞뒤 탐색 폭(자) — 같은 줄에서 못 찾았을 때만 사용
// 텍스트에서 당사(미래에셋생명보험)가 어떤 역할어로 지칭되는지 수집.
// 탐색은 **같은 줄 우선** — 서명란은 "집합투자업자: A / 신탁업자: B / 수익자: 당사"처럼
// 줄마다 다른 당사자가 오므로, 줄을 넘어 훑으면 남의 지위까지 당사 것으로 오인함.
// 같은 줄에서 아무 지위어도 못 찾은 경우에만 앞뒤 창(정의부 문장 형태)으로 넓힌다.
function detectPartyRoles(text) {
  var t = String(text || "");
  var roles = [], seen = {};
  function collect(scope) {
    var found = [];
    ROLE_TERMS.forEach(function (r) { if (scope.indexOf(r) !== -1) found.push(r); });
    return found;
  }
  OUR_NAMES.forEach(function (name) {
    var from = 0, i;
    while ((i = t.indexOf(name, from)) !== -1) {
      from = i + name.length;
      // ① 같은 줄
      var ls = t.lastIndexOf("\n", i) + 1;
      var le = t.indexOf("\n", i); if (le === -1) le = t.length;
      var found = collect(t.slice(ls, le));
      // ② 같은 줄에 없으면 앞뒤 창(줄바꿈 없는 정의부 문장 대비)
      if (!found.length)
        found = collect(t.slice(Math.max(0, i - ROLE_WINDOW), i + name.length + ROLE_WINDOW));
      found.forEach(function (r) { if (!seen[r]) { seen[r] = 1; roles.push(r); } });
    }
  });
  return roles;
}
// 계약 상대방에 미래에셋 계열사가 있는가 — 수익자 국면이라도 상대방이 계열사면
// 계열사 거래 이슈가 실제 발생(사용자 지적, 2026-08-05).
// 판정은 "미래에셋 + 법인격/업권 표기"가 붙은 **법인명** 기준. 단순히 "미래에셋"이라는
// 브랜드가 들어간 펀드명("미래에셋맵스일반사모부동산투자신탁제3호")은 상대방이 아니라
// 상품명이므로 제외 — 이를 세지 않으면 비계열 운용사 펀드까지 계열 거래로 오판.
var AFFILIATE_ENTITY_RE = /미래에셋[가-힣A-Za-z]*(자산운용|증권|생명|화재|캐피탈|벤처투자|컨설팅|파트너스|자산관리|저축은행|금융서비스|글로벌|투자운용)/;
function hasAffiliateParty(text) {
  var t = String(text || "");
  OUR_NAMES.forEach(function (n) { t = t.split(n).join(""); }); // 당사 자신은 제외
  return AFFILIATE_ENTITY_RE.test(t);
}
// 체크가 요구하는 당사 지위를 충족하는가. party_roles 미선언이면 전 지위 적용(하위호환).
// 지위를 **못 읽은 경우(빈 배열)는 통과**시킨다 — 갑·을만 쓰고 당사 상호를 적지 않은 계약서가
// 흔하므로, 빈 배열은 "해당 지위가 아님"이 아니라 "모름"임. 모름을 근거로 체크를 접으면
// 누락검출을 잃는다(schema.md "확신 없으면 게이트를 걸지 않음").
// 지위가 읽혔는데 요구 지위와 하나도 겹치지 않을 때만 접는다.
function partyRoleAllows(check, roles) {
  var req = check && check.party_roles;
  if (!req || !req.length) return true;
  var have = roles || [];
  if (!have.length) return true; // 지위 미상 → 게이트 비활성
  for (var i = 0; i < req.length; i++) if (have.indexOf(req[i]) !== -1) return true;
  return false;
}

function suggestModules(text, modules, opts) {
  var o = (opts && typeof opts === "object") ? opts : { stance: opts };
  var stance = o.stance;
  var docTitle = o.docTitle || "";
  // 국면 예외 사유 컨텍스트 — 미지정 시 본문에서 계열사 상대방 여부를 직접 판정.
  var ctx = o.stanceCtx || { affiliate_party: hasAffiliateParty(text) };
  var t = _stripStatuteCitations(String(text || ""));
  var on = [], ask = [];
  modules
    .filter(function (m) { return !m.always_on && moduleAllowedInStance(m, stance, ctx); })
    .forEach(function (m) {
      var kws = m.suggest_keywords || [];
      var distinct = 0, occ = 0;
      for (var i = 0; i < kws.length; i++) {
        var n = t.split(kws[i]).length - 1;
        if (n > 0) { distinct++; occ += n; }
      }
      // 예외사유 직접 활성(11.1차): stance_exempt_if 사유가 성립해서 이 모듈이 후보로 살아난
      // 경우, 그 사유 자체가 활성 근거임 — 본문 어휘 카운트를 추가로 요구하지 않는다.
      // (상대방 상호가 "미래에셋자산운용"이면 본문에 "계열사"라는 단어가 없어도 계열 거래임)
      if (m.stance_exempt_if && !_stanceAllows(m.requires_stance, stance)) {
        for (var e = 0; e < m.stance_exempt_if.length; e++) {
          if (ctx && ctx[m.stance_exempt_if[e]]) { on.push(m.id); return; }
        }
      }
      // 제목 게이트 — 본문 카운트보다 우선.
      if (m.title_signals && m.title_signals.length) {
        if (titleHits(docTitle, m.title_signals).length) { on.push(m.id); return; }
        // 제목에 없음: title_required면 본문 신호를 신뢰하지 않고 끔(약신호는 질문으로).
        if (m.title_required) {
          if (occ >= 1 && m.screening_question) ask.push(m.id);
          return;
        }
      }
      if (m.activation === "strong") {
        if (distinct >= 2) on.push(m.id);
        return;
      }
      if (m.activation === "confirm") {
        if (distinct >= 2 || occ >= 3) on.push(m.id);
        else if (occ >= 1) ask.push(m.id);
        return;
      }
      if (distinct >= 1) on.push(m.id);
    });
  return { on: on, ask: ask };
}

function activeCheckpoints(doc, activeModules, stance) {
  return doc.checkpoints.filter(function (cp) {
    if (!checkAllowedInStance(cp, stance)) return false;
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
function buildModel(docs, activeModules, stance) {
  var checks = [];
  docs.forEach(function (d) {
    activeCheckpoints(d, activeModules, stance).forEach(function (cp) {
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

// ── 조항 귀속(clause ownership) — 11.3차 ─────────────────────────
// 조항 표제가 특정 체크를 정면으로 지시하면 그 조항은 그 체크의 것이다.
// 다른 체크가 같은 조항을 best로 집어가면 "엉뚱한 체크가 붙는" 오탐이 됨.
//
// 실사고(2026-08-05): "제35조(반대수익자의 수익증권매수청구권)" 조항에 매수청구권 체크(INV-BEN-02)
// 말고도 수익자총회 결의(INV-BEN-01)·변경 공시(INV-BEN-04)가 함께 붙음. 원인은 매수청구권 조항이
// 요건을 적으면서 "신탁계약의 변경에 대한 수익자총회의 결의에 반대하는 경우"라고 **다른 제도를
// 전제로 언급**하기 때문 — 그 언급은 참조이지 그 제도를 규정한 것이 아님.
//
// 표제 적합도 — 조항 표제가 이 체크를 얼마나 정면으로 지시하는가(0~1).
// ⚠️ Sim.keywords 토큰 비교는 쓸 수 없음: 한국어 법령 표제는 "수익증권매수청구권"처럼
// 복합어 한 덩어리로 나와, check 문장의 분리된 어절("수익증권", "매수를 청구")과 토큰이
// 절대 일치하지 않아 항상 0이 됨(11.3차 실측). 부분문자열 포함으로 판정한다.
// 표제를 2글자 이상 조각으로 나눠, check 대표텍스트에 포함되는 조각의 길이 비중을 본다.
function titleFitRatio(clause, check) {
  var title = ClauseRole.parseTitle(clause.heading || "");
  if (!title) return 0;
  var ck = checkText(check) + " " + String(check.check || "") + " " + String(check.label || "");
  ck = ck.replace(/\s+/g, "");
  // 표제를 어절 단위로 자르고, 각 어절에서 조사·접미를 떼어 핵심부만 비교.
  var parts = title.split(/[\s·ㆍ,()（）]+/).filter(function (p) { return p.length >= 2; });
  if (!parts.length) return 0;
  var totLen = 0, hitLen = 0;
  parts.forEach(function (p) {
    var core = p.replace(/(의|을|를|이|가|은|는|에|과|와|및|등)$/, "");
    if (core.length < 2) core = p;
    totLen += core.length;
    // 복합어는 그대로 또는 앞부분(4글자+)이 포함되면 적중으로 봄
    if (ck.indexOf(core) !== -1) hitLen += core.length;
    else if (core.length >= 6 && ck.indexOf(core.slice(0, 4)) !== -1) hitLen += core.length * 0.5;
  });
  return totLen > 0 ? hitLen / totLen : 0;
}
// clauseIndex → 소유 체크 id. 소유자가 없는 조항은 키 자체가 없음.
function computeClauseOwners(clauses, checks) {
  var owners = {};
  (clauses || []).forEach(function (cl) {
    var best = null, bestRatio = 0, tie = false;
    checks.forEach(function (cp) {
      var r = titleFitRatio(cl, cp);
      if (r < MatcherConfig.TITLE_STRONG_RATIO) return;
      if (r > bestRatio) { bestRatio = r; best = cp.id; tie = false; }
      else if (r === bestRatio && best !== null && cp.id !== best) tie = true;
    });
    if (best && !tie) owners[cl.index] = best;
  });
  return owners;
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
// 결정 문구 승격(2026-08-03 피드백): check에 decisive_patterns가 있고 best 조항에 그 결정적
// 문구(예: CMN-19 "전속관할")가 그대로 있으면, 점수·마진이 확정 문턱에 못 미쳐도 confirmed로
// 승격. 전역 임계값(ABS_SCORE 등)은 건드리지 않고 체크 단위로만 확신을 보강 — 명확히 규정된
// 조항이 "확인 권장"으로 떨어지는 과잉 표시 방지. weak-role 게이트(목적·정의 조항)는 승격보다
// 우선 — 정의 조항이 용어로 결정 문구를 담는 오탐 차단.
function decisiveHit(clause, check) {
  var pats = (check && check.decisive_patterns) || [];
  if (!pats.length || !clause) return null;
  var t = String(clause.heading || "") + " " + String(clause.body || "");
  for (var i = 0; i < pats.length; i++) if (pats[i] && t.indexOf(pats[i]) !== -1) return pats[i];
  return null;
}

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
  if (decisiveHit(best.clause, check)) return "confirmed"; // 결정 문구 승격
  return "review"; // 관련 조항은 있으나(≥REVIEW_FLOOR) 확정 근거 부족 → 해당 여부 확인
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
// 문서 성격 게이트(11.1차) — requires_doc_title이 선언된 체크는 "그 문서가 애초에 그런 계약일 때"만
// 적용됨. 담보권 설정계약의 대항요건·점유이전 체크가, 본문에 "질권" 한 단어가 스쳐 나온 신탁계약서에
// 붙던 오탐을 차단(2026-08-05 사용자 보고: 신탁계약은 질권 설정 시 전자등록 방식만 정하고 있고
// 신탁사가 질권자가 되는 구조가 아님).
function docTitleAllows(check, docTitle) {
  var req = check && check.requires_doc_title;
  if (!req || !req.length) return true;
  var d = String(docTitle || "");
  if (!d) return false; // 제목을 못 뽑았으면 그 성격의 계약이라는 근거가 없음 → 미적용
  for (var i = 0; i < req.length; i++) if (d.indexOf(req[i]) !== -1) return true;
  return false;
}
// text(계약서 전체 본문) 전달 시 전제신호 게이트 적용. 미전달이면 게이트 비활성(하위호환).
// docTitle 전달 시 문서 성격 게이트 적용 — 미적용 체크는 매칭 자체를 quiet로 접음.
function coverageOf(tier, check, text, docTitle) {
  if (docTitle !== undefined && !docTitleAllows(check, docTitle)) return "quiet";
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
    var dh = decisiveHit(best.clause, check);
    if (dh) return ["결정 문구 일치 (“" + dh + "”)"];
    if (s.normMatch) return ["본문 문구·규범 일치"];
    var kws = _overlapKeywords(best.clause, check);
    return ["본문 문구 일치" + (kws.length ? " (핵심어: " + kws.join(", ") + ")" : "")];
  }
  // review — 매칭 확신 부족 표시(2026-08-03 문구 교정): 조항 내용의 충분성 평가로 읽히지 않게,
  // "이 조항이 해당 항목이 맞는지"라는 매칭 확인 의미로 한정.
  if (role.weak) return ["관련 조항으로 보임 — 목적·정의 조항이라 해당 여부 확인 필요"];
  return ["관련 조항으로 보임 — 이 항목에 해당하는 조항인지 확인 필요"];
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

// 표준 부속서류 참조 감지(#4): 본문이 별첨 약정서 체결을 참조하면 그 서류가 커버하는
// check들을 "별첨 참조" 그룹으로 묶을 근거를 준다. addressed로 치지 않음 —
// N건 알람을 "약정서 체결·첨부 여부 확인" 1건으로 전환하는 용도. 증적: 참조 문구 quote.
function detectSubdocRefs(fullText, defs) {
  var out = [];
  var t = String(fullText || "");
  (defs || []).forEach(function (d) {
    var sigs = d.ref_signals || [];
    for (var i = 0; i < sigs.length; i++) {
      var idx = t.indexOf(sigs[i]);
      if (idx !== -1) {
        var s = Math.max(0, idx - 40), e = Math.min(t.length, idx + sigs[i].length + 40);
        out.push({ id: d.id, title: d.title, signal: sigs[i],
          quote: t.slice(s, e).replace(/\s+/g, " ").trim(), covers: (d.covers || []).slice() });
        break; // 서류당 첫 신호 1회
      }
    }
  });
  return out;
}

// analyze(clauses, docs, activeModules) — 하위호환(3번째 인자 배열)
// analyze(clauses, docs, { modules, stance, baseClauses, docTitle, partyRoles }) — 확장형
//   stance      : 검토 국면(party|beneficiary) — 수범자가 당사가 아닌 규제를 배제
//   baseClauses : 원계약 조항(변경합의서 검토 시). 부재 판정을 원계약+변경본 합본으로 수행해
//                 "원계약에 이미 있는 조항"이 누락으로 잡히는 오탐을 차단.
//   docTitle    : 문서 제목 — requires_doc_title 체크의 문서 성격 게이트(11.1차)
//   partyRoles  : 당사 지위 목록 — party_roles 체크의 지위 게이트(11.1차)
function analyze(clauses, docs, opts) {
  var o = (opts && !Array.isArray(opts)) ? opts : { modules: opts || [] };
  var activeModules = o.modules || [];
  var stance = normalizeStance(o.stance);
  var baseClauses = o.baseClauses || [];
  var docTitle = o.docTitle;
  var partyRoles = o.partyRoles;
  var model = buildModel(docs, activeModules, stance);
  var results = [];
  var matches = [];
  var missing = [];
  // 전제신호 게이트용 본문 전체(표제+본문). 조건부 부재체크가 여기서 전제어휘를 찾음.
  // 변경합의서 국면에서는 원계약 본문도 합산 — 전제어휘가 원계약에만 있어도 게이트가 열려야 함.
  var fullText = (clauses || []).concat(baseClauses).map(function (cl) {
    return String(cl.heading || "") + " " + String(cl.body || "");
  }).join("\n");
  // 조항 귀속(11.3차): 표제가 특정 체크를 정면으로 지시하는 조항을 미리 확정.
  var owners = computeClauseOwners(clauses, model.checks.map(function (e) { return e.cp; }));

  model.checks.forEach(function (entry) {
    var cp = entry.cp;
    var scored = clauses.map(function (cl) {
      return { clause: cl, s: scoreClauseCheck(cl, entry, model) };
    }).sort(function (a, b) { return b.s.score - a.s.score; });

    var candidates = scored.filter(function (r) { return r.s.score >= MatcherConfig.REVIEW_FLOOR; });
    var tier = decideTier(candidates, cp);
    var coverage = coverageOf(tier, cp, fullText, docTitle);
    var top = scored[0] || null;
    // 당사 지위 게이트(11.1차): 그 지위가 아니면 이 체크는 우리 검토항목이 아님.
    // 담보설정계약에서 당사가 질권자가 아니면 대항요건 확보는 우리 몫이 아니다.
    var roleGated = false;
    if (partyRoles !== undefined && !partyRoleAllows(cp, partyRoles)) {
      coverage = "quiet";
      roleGated = true;
    }

    // 노출 게이트: 짚음/확인권장(조항 매칭 tier)에 핵심어 복수 겹침을 요구.
    // 미달 시 tier는 보존하되 coverage를 quiet로 강등(약한 후보를 조용히 접음).
    // consider(부재 알람)·none은 조항 매칭이 아니라 게이트 대상 아님.
    var gate = null;
    if ((coverage === "addressed" || coverage === "verify") && candidates.length) {
      var bestClause = candidates[0].clause;
      var f = overlapFeatures(bestClause, cp);
      var cited = candidates[0].s.citation === true;
      // 게이트 통과 판정은 passesOverlapGate로 단일화(순수함수·테스트 대상과 동일 로직).
      var passed = passesOverlapGate(bestClause, cp, cited);
      gate = { uniq: f.uniq, titleStrong: f.titleStrong, passed: passed };
      if (!passed) coverage = "quiet";
      // 조항 귀속 게이트(11.3차): 이 조항의 표제가 **다른 체크**를 정면으로 지시하는데,
      // 이 체크는 그 조항에 자기 근거(표제 적합·명시 인용)가 없으면 붙이지 않는다.
      // 매수청구권 조항이 요건 서술에서 "수익자총회의 결의에 반대하는 경우"라고 다른 제도를
      // 참조한 것만으로 총회 체크가 함께 붙던 오탐 차단.
      //
      // ⚠️ 한 조항이 여러 체크를 정당하게 충족하는 경우가 많음 — "제6조(물리적·기술적·관리적
      // 보호조치)" 하나가 보호조치 체크와 접근제한 체크를 함께 충족하고, 담보권 실행 조항이
      // 실행 체크와 유질 체크를 동시에 담는 식. 표제어가 다르다고 그 조항의 것이 아닌 게 아님.
      // 따라서 접는 조건을 좁게 잡는다:
      //   표제가 남을 정면으로 가리키고(owner) + 내 표제 근거 0 + **본문 근거도 빈약**(겹침 최소치 미만).
      // 사용자 사례(제35조 매수청구권에 총회·공시 체크 부착)는 본문 겹침이 참조 언급 수준이라
      // 이 조건에 걸리고, PRIV-06처럼 본문에 실질 근거(겹침 5개)가 있으면 살아남는다.
      if (coverage !== "quiet" && !cited && !f.titleStrong) {
        var owner = owners[bestClause.index];
        if (owner && owner !== cp.id && titleFitRatio(bestClause, cp) === 0 &&
            f.uniq < MatcherConfig.OWNED_CLAUSE_MIN_OVERLAP) {
          coverage = "quiet";
          gate.ownedBy = owner;
        }
      }
      // weak-role 강등(실사용 피드백): 전문·목적·정의 등 weak 조항에는 구체 검토항목을 붙이지 않음 —
      // 모든 내용이 목적에 닿는 건 논리 필연이라 정보가치 0. 예외: 명시 인용, 또는 그 조항을
      // 직접 겨냥한 체크(표제 강일치 — 예: '계약의 목적' 체크). 강등돼도 tier는 보존(매칭 존재 자체는 기록).
      if (coverage !== "quiet") {
        var bestRole = ClauseRole.clauseRole(bestClause.heading, bestClause.body);
        if (bestRole.weak === true && !cited && !f.titleStrong) {
          coverage = "quiet";
          gate.weakRole = true;
        }
      }
    }

    // 원계약 커버(변경합의서 국면): 변경본에 없더라도 원계약에 해당 조항이 있으면
    // 부재 알람이 아님 — 원계약이 적법하게 존재한다는 전제이므로 "원계약에 반영됨"으로 분류.
    // 검토 포커스는 변경된 내용에 두고, 원계약 커버분은 별도 표시로 접는다.
    var inBase = null;
    if (coverage === "consider" && baseClauses.length) {
      var baseScored = baseClauses.map(function (cl) {
        return { clause: cl, s: scoreClauseCheck(cl, entry, model) };
      }).sort(function (a, b) { return b.s.score - a.s.score; });
      var baseCand = baseScored.filter(function (r) { return r.s.score >= MatcherConfig.REVIEW_FLOOR; });
      if (decideTier(baseCand, cp) !== "none") {
        coverage = "base_covered";
        inBase = { clauseIndex: baseScored[0].clause.index, score: baseScored[0].s.score };
      }
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
      ranked: rankedTop,
      inBase: inBase,      // 원계약에서 커버된 위치(변경합의서 국면) — 없으면 null
      roleGated: roleGated // 당사 지위 불일치로 접힘(11.1차) — 진단·설명용
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
    pickType: pickType,
    detectStance: detectStance,
    normalizeStance: normalizeStance,
    moduleAllowedInStance: moduleAllowedInStance,
    checkAllowedInStance: checkAllowedInStance,
    STANCES: STANCES,
    titleHits: titleHits,
    titleFitRatio: titleFitRatio,
    computeClauseOwners: computeClauseOwners,
    docTitleAllows: docTitleAllows,
    detectPartyRoles: detectPartyRoles,
    hasAffiliateParty: hasAffiliateParty,
    partyRoleAllows: partyRoleAllows,
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
    decisiveHit: decisiveHit,
    decideTier: decideTier,
    alarmGate: alarmGate,
    preconditionMet: preconditionMet,
    coverageOf: coverageOf,
    subDocCoverage: subDocCoverage,
    detectSubdocRefs: detectSubdocRefs,
    analyze: analyze
  };
