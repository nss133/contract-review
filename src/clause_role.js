"use strict";
/* 조항역할(role)·규범유형(norm type)·조 표제(title) 파싱.
   원본 이식 출처:
   - comp_matching_auto/matcher/clause_role.py — "역할 기반 자동확정 게이트" 아이디어 차용.
     단, 원본은 사규(내부규정) 도메인 역할(definition/internal_admin/committee_ops/substantive)이고
     본 파일은 계약서 도메인 역할(purpose/definition/preamble/term/entire/general)로 재정의함.
   - comp_matching_auto/matcher/preprocess.py의 classify_norm_type() regex를 JS로 이식(우선순위:
     금지 > 의무 > 권한 > 선언 동일 유지). */

var ClauseRole = (function () {

  // segmenter.js가 생성하는 특수 heading("(전문)"=조항 분리 실패 시 전체 텍스트 앞부분,
  // "(전체)"=조항이 1개 이하라 분리 자체를 포기한 경우)은 표제 파싱 대상이 아님.
  var SPECIAL_HEADINGS = { "(전문)": "preamble", "(전체)": "entire" };

  // 표제(괄호 안 텍스트) 기반 역할 판정 — 표제 우선.
  var TITLE_ROLE_RULES = [
    { re: /목적/, role: "purpose", weak: true },
    { re: /정의|용어/, role: "definition", weak: true },
    { re: /계약\s*기간|유효\s*기간/, role: "term", weak: true },
    { re: /완전\s*합의|완전한\s*합의/, role: "general", weak: true },
    // 통지·비용부담은 실체 규제의무(예: 개인정보 유출 통지)일 수 있어 weak 게이트 대상 아님.
    // 표제 무매치 → general/weak=false 로 판정되게 두어 tier 게이트에서 자동확정 가능하게 함.
  ];

  // 표제가 없을 때만 본문 앞부분으로 보조 판정(comp preprocess.py declaration 정규식 차용).
  var BODY_ROLE_RULES = [
    { re: /목적으로\s*한다|정함을\s*목적/, role: "purpose", weak: true },
    { re: /[을를]\s*말한다|이라\s*한다|이라\s*함은/, role: "definition", weak: true },
    { re: /계약\s*기간은|유효\s*기간은/, role: "term", weak: true },
  ];

  function parseTitle(heading) {
    var h = String(heading || "").trim();
    if (h === "(전문)" || h === "(전체)") return "";
    var m = h.match(/[\(（]([^\)）]*)[\)）]/);
    if (!m) return "";
    return m[1].trim();
  }

  function clauseRole(heading, body) {
    var h = String(heading || "").trim();
    if (Object.prototype.hasOwnProperty.call(SPECIAL_HEADINGS, h)) {
      return { role: SPECIAL_HEADINGS[h], weak: true };
    }
    var title = parseTitle(heading);
    var i;
    if (title) {
      for (i = 0; i < TITLE_ROLE_RULES.length; i++) {
        if (TITLE_ROLE_RULES[i].re.test(title)) {
          return { role: TITLE_ROLE_RULES[i].role, weak: TITLE_ROLE_RULES[i].weak };
        }
      }
      return { role: "general", weak: false };
    }
    var b = String(body || "");
    for (i = 0; i < BODY_ROLE_RULES.length; i++) {
      if (BODY_ROLE_RULES[i].re.test(b)) {
        return { role: BODY_ROLE_RULES[i].role, weak: BODY_ROLE_RULES[i].weak };
      }
    }
    return { role: "general", weak: false };
  }

  // 규범유형: 금지 > 의무 > 권한 > 선언 (comp preprocess.classify_norm_type 이식, 라벨만 국문 그대로)
  var PROHIBITION_RE = [
    /아니\s*된다/, /하여서는\s*아니/, /금지/,
    /할\s*수\s*없다/, /하지\s*못한다/, /해서는\s*안/
  ];
  var OBLIGATION_RE = [/하여야\s*한다/, /해야\s*한다/, /의무/];
  var RIGHT_RE = [/할\s*수\s*있다/, /권한/];
  var DECLARATION_RE = [/본다/, /간주/, /추정/, /정의한다/, /말한다/];

  function _any(text, list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].test(text)) return true;
    }
    return false;
  }

  function normType(text) {
    var t = String(text || "");
    if (!t.trim()) return null;
    if (_any(t, PROHIBITION_RE)) return "금지";
    if (_any(t, OBLIGATION_RE)) return "의무";
    if (_any(t, RIGHT_RE)) return "권한";
    if (_any(t, DECLARATION_RE)) return "선언";
    return null;
  }

  /* 조항 주어(의무·권리의 주체) 추출 — 11.6차.
     "집합투자업자는 …하여야 한다" / "수익자는 …할 수 있다"처럼 한국어 계약 조항은
     주체를 문두에 '지위어+은/는'으로 명시하는 것이 표준. 이 주체가 누구인지에 따라
     같은 문언이라도 우리 검토항목인지가 갈린다(사용자 지적: '당사자' 축).
     조항 본문 각 항(①②…)의 첫머리를 훑어 주어 후보를 수집. 최대 3개(항마다 주체가
     바뀌는 조항이 있음). 못 찾으면 빈 배열 — 이 경우 게이트는 걸지 않는다. */
  var SUBJ_RE = /(?:^|\n|[①-⑮]\s*|\d+\.\s*)\s*([가-힣]{2,12}?)(?:은|는)\s/g;
  // 주어가 될 수 없는 어휘(문장 부사·비인격 명사) — 오추출 차단.
  var SUBJ_STOP = ["다음", "이에", "그에", "본조", "본항", "전항", "해당", "각각", "이하",
    "위의", "상기", "다만", "또한", "기타", "이때", "그때", "본건", "이건"];
  function clauseSubjects(body, limit) {
    var t = String(body || "");
    var out = [], seen = {};
    var m, re = new RegExp(SUBJ_RE.source, "g");
    while ((m = re.exec(t)) !== null) {
      var s = m[1];
      if (SUBJ_STOP.indexOf(s) !== -1) continue;
      // 용언 어간 배제 — "…을 변경하는 경우에는"의 '변경하'처럼 동사가 잘려 들어오는 것 차단.
      // 한국어 지위어는 명사이므로 '하/되/시키/받' 등으로 끝나면 주어가 아님.
      if (/(하|되|시키|받|주|지|이|가)$/.test(s) && s.length <= 4) continue;
      // 조사가 붙은 형태에서 어간만: "집합투자업자" 그대로 사용(지위어는 명사형)
      if (!seen[s]) { seen[s] = 1; out.push(s); }
      if (out.length >= (limit || 3)) break;
    }
    return out;
  }

  return { parseTitle: parseTitle, clauseRole: clauseRole, normType: normType,
    clauseSubjects: clauseSubjects };
})();

if (typeof module !== "undefined") module.exports = ClauseRole;
