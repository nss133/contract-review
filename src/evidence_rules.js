"use strict";
/* 선언형 문언 요건 검사. 임의 JS/정규식 실행 없음. 법적 의미의 일반 추론기가 아니다. */
var EvidenceRules = (function () {
  var VERSION = "evidence-rules-v5";
  function assert(ok, msg) { if (!ok) throw new Error(msg); }
  function nonempty(s) { return typeof s === "string" && s.trim().length > 0; }
  function list(a) { return Array.isArray(a) && a.length > 0 && a.length <= 50 && a.every(nonempty); }
  function validate(rule) {
    assert(rule && nonempty(rule.id) && nonempty(rule.check_id) && nonempty(rule.revision), "규칙 ID·체크 ID·버전 필요");
    assert(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(rule.id)&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(rule.check_id),"ID는 영문·숫자·점·하이픈·밑줄로 입력하세요");
    assert(list(rule.type_ids) && list(rule.party_roles) && nonempty(rule.rationale), "적용 유형·당사 역할·판단 기준 필요");
    assert(Array.isArray(rule.obligations) && rule.obligations.length > 0 && rule.obligations.length <= 20, "필수 요건 목록 필요");
    var ids = Object.create(null);
    rule.obligations.forEach(function (o) {
      assert(nonempty(o.id) && !ids[o.id], "요건 ID 중복/누락"); ids[o.id] = true;
      assert(list(o.actors) && list(o.actions) && list(o.objects), "요건별 주체·행위·대상 필요");
      assert(["obligation", "prohibition"].indexOf(o.polarity) !== -1, "의무/금지 방향 명시 필요");
      assert(Array.isArray(o.conditions) && o.conditions.every(nonempty), "조건 목록 필요 (해당 없으면 빈 배열)");
      if (o.quantity) assert(["일", "개월", "년", "%", "원"].indexOf(o.quantity.unit) !== -1 &&
        typeof o.quantity.min === "number" && isFinite(o.quantity.min) && o.quantity.min >= 0 &&
        typeof o.quantity.max === "number" && isFinite(o.quantity.max) && o.quantity.max >= o.quantity.min, "수치 단위·최소·최대 확인 필요");
    });
    return rule;
  }
  function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function actorHit(s, actors) {
    return actors.some(function (a) {
      return new RegExp("(?:^|[\\s\"'“”‘’(])" + reEscape(a) + "[\"'“”‘’)]*\\s*(?:은|는|이|가)(?:\\s|$)").test(s);
    });
  }
  function any(s, arr) { return arr.some(function (v) { return s.indexOf(v) !== -1; }); }
  function direction(s) {
    if (/할\s*수\s*없|하여서는\s*아니|해서는\s*안|하지\s*못|금지|하지\s*아니/.test(s)) return "prohibition";
    if (/하지\s*않|아니한다|면제|생략|의무(?:가|는)?\s*없|필요(?:가|는)?\s*없/.test(s)) return "negative";
    if (/하여야|해야|해야만|의무를\s*부담|하기로\s*한다/.test(s)) return "obligation";
    if (/할\s*수\s*있/.test(s)) return "permission";
    return "unknown";
  }
  function heading(text){
    var m=String(text||'').match(/^\s*(?:제\s*\d+\s*조(?:의\s*\d+)?|\d+[.)])\s*[（(]([^）)]+)[）)]/);
    if(m)return {title:m[1],prefix:m[0]};
    // 괄호 없는 독립 표제. 완결된 본문 문장은 표제로 잘라내지 않는다.
    m=String(text||'').match(/^\s*제\s*\d+\s*조(?:의\s*\d+)?\s+([^\n.。:：]{1,48})\s*$/);
    if(m&&!/(?:한다|된다|있다|없다|하여야|해야|에 따라|에 의하)/.test(m[1]))return {title:m[1].trim(),prefix:m[0]};
    m=String(text||'').match(/^\s*(?:(?:제\s*\d+\s*조(?:의\s*\d+)?|\d+[.)])\s+)?(계약기간|계약 기간|대금 지급|대금|정산|부가세|부가가치세|해지|해제|해지 및 해제|손해배상|비밀정보|비밀유지|관할|분쟁해결|목적|운송)\s*$/);
    return m?{title:m[1],prefix:m[0]}:null;
  }
  function sentences(documents) {
    var out = [];
    (documents || []).forEach(function (doc, di) {
      var section = '', sectionIndex = 0;
      // '다.' 목 번호를 문장 종결로 잘라 하위 항목의 경계를 잃지 않는다.
      String(doc.text || "").normalize("NFC").split(/\n|(?<=\S다\.)\s+/).forEach(function (text, si) {
        var h = heading(text);
        if (h) { section = h.title; sectionIndex++; }
        if (text.trim()) out.push({ document: doc.name || "문서 " + (di + 1), document_index: di, sentence_index: si,
          section: section, section_index: sectionIndex,
          text: text.trim(), direction: direction(text),
          exception: /다만|단,|단서|불구하고|예외|우선\s*(적용|한다)|별도로\s*정/.test(text),
          unusable: /_{2,}|\[\s*\]|�|(?:이란|라\s*함은|란).*(?:말한다|의미|뜻)|라고|라는|예시|가령|가정|노력|가급적|가능한\s*한|원칙적으로/.test(text) });
      });
    });
    return out;
  }
  // 명시된 별도 조항 구역에서만 무관성을 확정한다. 경계 미상·참조·전역 효력은 보류.
  function relevantSentences(terms, documents) {
    var sents = sentences(documents), marked = {};
    var global = /불구하고|우선|(?:본|이)\s*계약.{0,20}(?:전체|전부|모든|일체|배제)|모든|일체|전항|전조|각\s*조|제\s*\d+\s*조|준용|따른다|정한\s*바|별첨|부속|약정서/;
    sents.forEach(function(s){
      var h=heading(s.text),body=h?s.text.slice(h.prefix.length):s.text;
      if(any(s.text,terms)||global.test(body))marked[s.document_index+':'+s.section_index]=true;
    });
    return sents.filter(function(s){return !s.section||marked[s.document_index+':'+s.section_index];});
  }
  // 1차 축소: 사용되지 않는 독립 정의문만 전역 보류에서 제외한다.
  // 예외·참조·정의된 용어가 실제로 쓰인 경우는 범위 해석 전까지 계속 보류한다.
  function blockingQualifiers(rule, documents) {
    var sents = sentences(documents), terms = [];
    (rule.obligations || []).forEach(function (o) {
      terms = terms.concat(o.actors || [], o.actions || [], o.objects || [], o.conditions || []);
    });
    var scopeTerms=[];(rule.obligations||[]).forEach(function(o){scopeTerms=scopeTerms.concat(o.actions||[],o.objects||[]);});
    var relevant = relevantSentences(scopeTerms, documents);
    // 명시 참조의 목적지가 불명확하면 구역 제외를 하지 않는다.
    if(relevant.some(function(s){var h=heading(s.text);return /전항|전조|제\s*\d+\s*조|준용/.test(h?s.text.slice(h.prefix.length):s.text);}))relevant=sents;
    return sents.filter(function (s) {
      if (!s.exception && !s.unusable) return false;
      if (/_{2,}|\[\s*\]|�/.test(s.text)) return true;
      if (!relevant.some(function(r){return r.document_index===s.document_index&&r.sentence_index===s.sentence_index;})&&
          !(/(?:이란|이라 함은|란).*(?:말한다|의미|뜻)/.test(s.text)&&any(s.text,terms))) return false;
      if (s.exception) return true;
      var definition = s.text.match(/^["“]([^"”]{1,30})["”](?:이란|란|이라 함은)\s+.+(?:말한다|의미한다)\.$/);
      if (!definition || any(s.text, terms) || /_{2,}|\[\s*\]|�|전항|전조|이 계약|본 계약|모든|일체|우선|의무|권리/.test(s.text)) return true;
      return sents.some(function (other) { return other !== s && other.text.indexOf(definition[1]) !== -1; });
    });
  }
  function evaluate(rule, documents, context) {
    var out = { engine_version: VERSION, rule_id: rule && rule.id, status: "unknown", evidence: [], missing: [], conflicts: [] };
    try { validate(rule); } catch (e) { out.error = e.message; return out; }
    var ctx = context || {}, sents = sentences(documents);
    if (!sents.length || !nonempty(ctx.type_id) || !Array.isArray(ctx.party_roles) || !ctx.party_roles.length) return out;
    if (rule.type_ids.indexOf(ctx.type_id) === -1 || !rule.party_roles.some(function (r) { return ctx.party_roles.indexOf(r) !== -1; })) {
      out.status = "out_of_scope"; return out;
    }
    rule.obligations.forEach(function (o) {
      var supported = [];
      var units=sents.slice();
      // 바로 이어지는 명시적 지시어 문장만 결합한다. 다른 조항·문서의 단어를 합치지 않는다.
      sents.forEach(function(s,i){
        var next=sents[i+1];
        if(!next||next.document_index!==s.document_index||next.sentence_index!==s.sentence_index+1||
          !actorHit(s.text,o.actors)||!any(s.text,o.actions)||!any(s.text,o.objects))return;
        var linked=o.actions.some(function(action){return new RegExp('^(?:이|해당)\\s*'+reEscape(action)+'(?:은|는|을|를)\\s').test(next.text);});
        if(!linked)return;
        var joined=s.text+' '+next.text;
        units=units.filter(function(unit){return unit!==s;});
        units.push(Object.assign({},s,{text:joined,direction:direction(joined),exception:s.exception||next.exception,
          unusable:s.unusable||next.unusable||next.direction==='permission'||next.direction==='unknown'||/경우|때|하면|한하여|한해|조건|가능|요청/.test(next.text),
          linked_sentences:[s.sentence_index,next.sentence_index]}));
      });
      units.forEach(function (s) {
        var topic = any(s.text, o.actions) && any(s.text, o.objects);
        if (!topic) return;
        var actor = actorHit(s.text, o.actors);
        // 예외의 효력 범위를 확신할 수 없으면 관련 주체 누락도 보류한다.
        if (s.exception || (s.direction !== "unknown" && s.direction !== o.polarity)) {
          out.conflicts.push(Object.assign({ obligation: o.id, reason: s.exception ? "exception" : "direction" }, s)); return;
        }
        var subjects=["갑","을","위탁자","수탁자","임대인","임차인","매도인","매수인"].concat(o.actors)
          .filter(function(a,i,all){return all.indexOf(a)===i&&actorHit(s.text,[a]);});
        if(s.unusable||subjects.length>1){out.conflicts.push(Object.assign({obligation:o.id,reason:"qualification_or_subject_ambiguity"},s));return;}
        if (!actor || s.unusable || s.direction !== o.polarity || !o.conditions.every(function (c) { return s.text.indexOf(c) !== -1; })) return;
        if (o.quantity) {
          var re = new RegExp("([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*" + reEscape(o.quantity.unit), "g"), match, nums = [];
          while ((match = re.exec(s.text))) nums.push(Number(match[1].replace(/,/g, "")));
          // 같은 문장에 같은 단위의 여러 값이 있으면 귀속이 불명확하므로 자동 충족하지 않는다.
          if (nums.length !== 1 || nums[0] < o.quantity.min || nums[0] > o.quantity.max) {
            out.conflicts.push(Object.assign({ obligation: o.id, reason: "quantity_or_ambiguity" }, s)); return;
          }
        }
        supported.push(Object.assign({ obligation: o.id }, s));
      });
      if (!supported.length) out.missing.push({ obligation: o.id, actors: o.actors, actions: o.actions,
        objects: o.objects, conditions: o.conditions, quantity: o.quantity || null, polarity: o.polarity });
      out.evidence = out.evidence.concat(supported);
    });
    out.status = out.conflicts.length ? "conflict" : out.missing.length ? "incomplete" : "supported";
    return out;
  }
  return { VERSION: VERSION, validate: validate, evaluate: evaluate, sentences: sentences, direction: direction,
    blockingQualifiers: blockingQualifiers, relevantSentences: relevantSentences, heading: heading };
})();
if (typeof module !== "undefined") module.exports = EvidenceRules;
