"use strict";
/* comp_matching_auto/webapp/engine.js 이식 (char_wb TF-IDF·Jaccard)
 * 원본: ~/Library/Mobile Documents/com~apple~CloudDocs/cursor/comp_matching_auto/webapp/engine.js
 * 전처리(preprocess)·char_wb n-gram·TF-IDF(sublinear_tf·smooth-idf·l2)·Jaccard 유사도 원시함수만 이식.
 * IDF 코퍼스 fit(buildIdf)·벡터화(tfidfVec)·코사인(cosine) 인터페이스는 이 파일에서 신규 정의
 * (원본 engine.js의 build()/search()는 역색인 기반 검색 전용이라 그대로 재사용하지 않음).
 * 폐쇄망 HTML 앱용 — 외부 의존성 0. LLM·임베딩 없음.
 */
(function (root) {
  "use strict";

  // ── 전처리 (engine.js preprocess 이식) ──
  var STOPWORDS = [
    "대통령령으로 정하는 바에 따라", "금융위원회가 정하는 바에 따라", "정하는 바에 따른다",
    "정하는 바에 의한다", "의 규정에 의한", "의 규정에 따른", "대통령령으로 정하는",
    "금융위원회가 정하는", "총리령으로 정하는", "다음 각 호의", "다음 각호의",
    "다음 각 호에", "다음 각호에", "다음과 같다", "관계법령에 따라", "관련 법령에 따라",
    "제1항에 따른", "제2항에 따른", "제3항에 따른", "전항에 따른", "이 법에 따른",
    "이 규정에 따른", "에 관한 사항", "해당하는 경우", "해당하는 자", "필요한 사항은",
    "필요한 조치를", "에 해당하는", "이 법에서", "이 규정에서", "에도 불구하고",
    "에 불구하고", "그 밖에", "그밖에", "이 경우", "같은 법", "에 관하여", "에 대하여",
    "에 의하여", "으로 한다", "에 따라", "다만,", "다만 ,", "로 한다"
  ].sort(function (a, b) { return b.length - a.length; });

  var PHRASE_ENDINGS = [
    ["신고하여야 한다", "신고해야 한다"], ["신고하여야한다", "신고해야 한다"],
    ["보고하여야 한다", "보고해야 한다"], ["보고하여야한다", "보고해야 한다"],
    ["승인을 받아야 한다", "승인받아야 한다"], ["허가를 받아야 한다", "허가받아야 한다"],
    ["준수할 것이다", "준수해야 한다"], ["이행할 것이다", "이행해야 한다"]
  ].sort(function (a, b) { return b[0].length - a[0].length; });

  // 동의어 정규화 (legal_synonyms.json 등). setSynonyms 로 주입, 미주입 시 무시. 긴 형태→짧은 형태로 통일.
  /* 계약 실무 이형어 정규화(11.7차) — 같은 뜻을 다른 낱말로 쓰는 경우를 통일한다.
     실사고(2026-08-05): "제8조(기밀유지) … 기밀정보를 누설하여서는" 조항에 '비밀정보' 체크가
     붙지 않음. 토큰 겹침이 0이라 TF-IDF·표제적합도가 모두 0이 되기 때문
     (triggers.keywords에 '기밀'이 있어도 그건 활성 신호일 뿐 점수 산식에는 안 들어감).

     ⚠️ 넣어도 되는 것은 **법적으로 같은 뜻인 표기 변형**뿐이다. 코퍼스에서 혼용이 관찰돼도
     해제↔해지(소급효 유무), 배상↔보상(위법성 유무), 협의↔합의(구속력), 보수↔대금(대가 성격)은
     **법적 효과가 다르므로 통합 금지**. 이들을 합치면 매칭은 늘지만 검토 품질이 무너진다. */
  var SYN_DEFAULT = [
    ["기밀", "비밀"],       // 기밀유지=비밀유지, 기밀정보=비밀정보 (실무 이형 표기)
    ["비밀보장", "비밀유지"],
    ["비밀준수", "비밀유지"],
    ["기밀성", "비밀"],
    ["시크릿", "비밀"],
    ["컨피덴셜", "비밀"]
  ];
  var SYN = [];
  function setSynonyms(pairs) {
    SYN = (pairs || []).map(function (p) {
      var a = String(p[0] || ""), b = String(p[1] || "");
      return a.length >= b.length ? [a, b] : [b, a];
    }).filter(function (p) { return p[0] && p[1]; })
      .sort(function (x, y) { return y[0].length - x[0].length; });
  }
  function normSynonyms(t) {
    for (var i = 0; i < SYN.length; i++) t = t.split(SYN[i][0]).join(SYN[i][1]);
    return t;
  }
  setSynonyms(SYN_DEFAULT); // 기본 이형어 테이블 적용(setSynonyms로 교체 가능)

  var FW = "０１２３４５６７８９", HW = "0123456789";
  function normNumbers(t) {
    var s = "";
    for (var i = 0; i < t.length; i++) { var j = FW.indexOf(t[i]); s += j >= 0 ? HW[j] : t[i]; }
    s = s.replace(/(\d+)\s+일\b/g, "$1일").replace(/(\d+)\s+개월\b/g, "$1개월");
    s = s.replace(/(\d+)\s+년\b/g, "$1년").replace(/(\d+)\s+시간\b/g, "$1시간");
    return s;
  }
  function preprocess(text) {
    var t = normNumbers(String(text || ""));
    for (var i = 0; i < PHRASE_ENDINGS.length; i++) t = t.split(PHRASE_ENDINGS[i][0]).join(PHRASE_ENDINGS[i][1]);
    t = normSynonyms(t);
    t = t.replace(/제\s*\d+\s*호/g, " ");
    for (var k = 0; k < STOPWORDS.length; k++) t = t.split(STOPWORDS[k]).join(" ");
    return t.replace(/\s+/g, " ").trim();
  }

  // ── char_wb n-gram (sklearn 동등, engine.js 이식) ──
  function charWb(text, minN, maxN) {
    var out = [], toks = String(text || "").split(/\s+/);
    for (var w = 0; w < toks.length; w++) {
      if (!toks[w]) continue;
      var s = " " + toks[w] + " ", L = s.length;
      for (var n = minN; n <= maxN; n++) {
        var off = 0;
        out.push(s.slice(off, off + n));
        while (off + n < L) { off += 1; out.push(s.slice(off, off + n)); }
        // 단어가 n보다 짧으면 (off==0 유지) 더 큰 n에서 중복 카운트 방지
        if (off === 0) break;
      }
    }
    return out;
  }

  // ── TF-IDF (engine.js build()/search() 의 idf·가중치 산식을 fit/transform 형태로 분리) ──
  // buildIdf(docs): docs = 이미 preprocess()된 문자열 배열. smooth-idf: ln((1+N)/(1+df))+1
  function buildIdf(docs, minN, maxN) {
    minN = minN || 2; maxN = maxN || 5;
    var N = docs.length;
    var vocab = Object.create(null);
    for (var i = 0; i < N; i++) {
      var toks = charWb(docs[i], minN, maxN);
      var uniq = Object.create(null);
      for (var j = 0; j < toks.length; j++) uniq[toks[j]] = 1;
      for (var g in uniq) vocab[g] = (vocab[g] || 0) + 1;
    }
    var idf = Object.create(null);
    for (var g2 in vocab) idf[g2] = Math.log((1 + N) / (1 + vocab[g2])) + 1;
    return { vocab: vocab, idf: idf, N: N, minN: minN, maxN: maxN };
  }

  // tfidfVec(text, model): 이미 preprocess()된 text → sparse map {ngram: weight} (sublinear_tf, l2 정규화)
  // 모델(코퍼스)에 없는 ngram은 무시(engine.js search()와 동일한 OOV 처리).
  function tfidfVec(text, model) {
    var minN = model.minN || 2, maxN = model.maxN || 5;
    var toks = charWb(text, minN, maxN);
    var counts = Object.create(null);
    for (var i = 0; i < toks.length; i++) counts[toks[i]] = (counts[toks[i]] || 0) + 1;
    var vec = Object.create(null), norm2 = 0;
    for (var g in counts) {
      var idf = model.idf[g];
      if (idf === undefined) continue; // 코퍼스에 없는 ngram 무시
      var tf = 1 + Math.log(counts[g]); // sublinear_tf
      var w = tf * idf;
      vec[g] = w;
      norm2 += w * w;
    }
    var nrm = Math.sqrt(norm2) || 1;
    for (var g2 in vec) vec[g2] = vec[g2] / nrm;
    return vec;
  }

  // cosine(vecA, vecB): sparse map 코사인 (둘 다 l2 정규화되어 있으면 내적이 곧 코사인)
  function cosine(vecA, vecB) {
    var small = vecA, large = vecB;
    if (Object.keys(vecA).length > Object.keys(vecB).length) { small = vecB; large = vecA; }
    var sum = 0;
    for (var g in small) if (large[g] !== undefined) sum += small[g] * large[g];
    return sum;
  }

  // ── Jaccard (engine.js keywords/jaccard 이식) ──
  function keywords(text) {
    var m = String(text || "").match(/[가-힣]{2,}/g) || [], s = Object.create(null);
    for (var i = 0; i < m.length; i++) s[m[i]] = 1;
    return s;
  }
  function jaccardSets(a, b) {
    var ka = Object.keys(a); if (!ka.length) return 0;
    var kb = Object.keys(b); if (!kb.length) return 0;
    var inter = 0; for (var i = 0; i < ka.length; i++) if (b[ka[i]]) inter++;
    return inter / (ka.length + kb.length - inter);
  }
  // jaccard(textA, textB): 원문(전처리 불문) → 2글자+ 한글 키워드 집합 자카드. 빈 문자열/무키워드 안전(0 반환).
  function jaccard(textA, textB) {
    return jaccardSets(keywords(textA), keywords(textB));
  }

  var API = {
    preprocess: preprocess,
    setSynonyms: setSynonyms,
    charWb: charWb,
    buildIdf: buildIdf,
    tfidfVec: tfidfVec,
    cosine: cosine,
    jaccard: jaccard,
    keywords: keywords
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Sim = API;
})(typeof window !== "undefined" ? window : this);
