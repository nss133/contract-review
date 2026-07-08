# Phase 2 Part 1: 매칭 엔진 v3 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 스펙: `docs/superpowers/specs/2026-07-08-phase2-matching-engine-v3.md` (기준). 이식 원본: `~/Library/Mobile Documents/com~apple~CloudDocs/cursor/comp_matching_auto/webapp/engine.js` (전처리·charWb·TF-IDF·Jaccard) 및 `matcher/review_rules.py`·`matcher/clause_role.py` (tier·게이트, Python→JS 이식).

**Goal:** 단일 키워드 매칭을 다신호 점수 + tier 게이트로 교체해 자동확정 정밀도를 높이고 "단일 키워드 과다 매칭"을 제거.

**전제(실측):** 현 테스트 Python 38 + JS 8 통과. `node --test`는 무인자. 샘플 계약서 현 매칭 23건 중 74% 단일. checks 구조: {id, check, severity, norm_type, basis, module, triggers:{keywords,patterns}, absence_check, sources:[{law,article,clause,quote,verified,status,text}], note}. matcher.js analyze는 app.js에서 {checkpoints: doc.checks} 브릿지로 호출됨.

**핵심 원칙:** matcher.js는 순수 함수 유지(테스트 가능). engine.js 코드는 라이선스/출처 주석과 함께 이식. 외부 의존 0. TDD.

---

### Task 1: sim.js — 전처리·charWb·TF-IDF·Jaccard 이식 (TDD)

**Files:** Create `src/sim.js`, `tests/sim.test.js`

- comp engine.js에서 다음을 `src/sim.js`로 이식(ES5·module 가드·출처 주석): preprocess(STOPWORDS/PHRASE_ENDINGS/normSynonyms/normNumbers), charWb(text,minN,maxN), TF-IDF 벡터화(sublinear_tf·smooth_idf·l2), 코사인, jaccard(2글자+ 키워드).
- IDF는 코퍼스 fit 함수 `buildIdf(docs)` → {vocab, idf} 반환. `tfidfVec(text, model)` → sparse map. `cosine(vecA, vecB)`.
- 테스트: preprocess가 불용어/어미 정규화 / charWb ngram 개수 / 동일문장 코사인≈1 / 무관문장 코사인 낮음 / jaccard 교집합 계산 / 짧은문장 안정성. ~10개.
- 커밋: "feat: 유사도 원시함수 이식 (sim.js — charWb TF-IDF·Jaccard)"

### Task 2: clause_role.js — 조항역할·규범유형·표제 파싱 (TDD)

**Files:** Create `src/clause_role.js`, `tests/clause_role.test.js`

- `parseTitle(heading)` → 표제 괄호 내용 추출 (제N조(재위탁 금지) → "재위탁 금지")
- `clauseRole(heading, body)` → {role: "purpose"|"definition"|"preamble"|"term"|"entire"|"general", weak: bool}. weak=true는 목적·정의·전문·완전합의·계약기간 등 외부규범 근거 약한 역할 (comp clause_role.py 차용, regex). 표제와 본문 앞부분으로 판정.
- `normType(text)` → "의무"|"금지"|"권한"|"선언"|null (regex: 하여야 한다/아니 된다/할 수 있다/본다). comp preprocess 규범유형 로직 차용.
- 테스트: "제1조(목적)"→purpose/weak, "제5조(재위탁 금지)"→general/의무·금지, "제3조(정의)"→definition/weak, 표제 없는 조항, normType 각 분기. ~9개.
- 커밋: "feat: 조항역할·규범유형·표제 파싱 (clause_role.js)"

### Task 3: matcher.js v3 — 점수·tier·게이트 (TDD, 기존 교체)

**Files:** Modify `src/matcher.js`, `tests/matcher.test.js`

- `buildCheckCorpus(docs)` → 각 check의 대표 텍스트(check + quote + keywords + 근거표제) 배열 + buildIdf 모델. (app.js가 빌드 결과 CR을 넘기지만, IDF는 런타임에 한 번 build해도 되고 빌드타임 임베드도 가능 — 이 태스크는 런타임 build로 단순화, 성능은 check 수백 규모라 무해)
- `scoreClauseCheck(clause, check, idfModel)` → {score, tfidf, jaccard, normMatch, titleBonus, citation:bool}. 스펙 C의 점수식. length-adaptive 가중. 표제 가중(B): clause 표제 용어를 질의에 k=2회 반복.
- `citationHit(clauseText, check)` → check.sources의 law+article이 조항 본문에 조문번호까지 일치하는지 (comp citation_extract 차용, regex)
- `decideTier(candidatesForCheck, check)` → "confirmed"|"review"|"none" (스펙 C 계단): 인용일치 confirmed / 점수≥ABS & 규범일치 confirmed / margin≥MARGIN_HIGH confirmed / 단일후보·단일신호·weak역할&인용없음 → review 강등 / <REVIEW_FLOOR → none
- `analyze(clauses, docs, activeModules)` 재작성: 활성 check마다 전 조항 점수 → 정렬 → decideTier. 반환 `{checkpoints, results:[{cpId, tier, best:{clauseIndex,score,reasons}, ranked:[...]}], missing:[absence_check & tier==none]}`. **하위호환**: 기존 app.js가 쓰는 matches/missing도 파생 제공(matches = tier!=none인 best). 
- 임계값은 `src/matcher_config.js`(신규, 상수 ABS_SCORE/MARGIN_HIGH/MARGIN_LOW/REVIEW_FLOOR/TITLE_K) 분리.
- 기존 detectType·suggestModules 유지.
- 테스트 재작성: 점수 단조성 / "재위탁" 단독 조항이 재위탁 check만 confirmed, 유사어 걸린 타 check는 review/none / weak역할 게이트(목적조항 confirmed 불가) / 단일후보 review 강등 / 인용일치 confirmed / absence 재정의 / detectType·suggestModules 회귀. ~16개.
- 커밋: "feat!: matcher v3 — 다신호 점수·tier 게이트·조항역할"

### Task 4: app.js — tier 배지·정렬·누락 반영 (수동검증)

**Files:** Modify `src/app.js`, `src/style.css`

- analyze 반환 변경 반영: 매칭 열 `✓ 확정`(녹)/`△ 검토`(황)/빈칸. results 소비.
- 조항 상세: 점수순 정렬, tier 근거 1줄(예 "명시 인용 일치" / "복수 신호 상위" / "단일 후보 — 검토필요"), 기존 quote·원문·추정문구 유지.
- 누락 섹션: results.missing.
- 체크리스트 표·리포트가 results 구조로 동작하도록 브릿지. matcher/segmenter/sim/clause_role 무변경.
- 검증: node --check, DOM id 대조, 픽스처 빌드 스모크.
- 커밋: "feat: UI — tier 배지·점수정렬·누락 재정의"

### Task 5: build_html.py — 빌드 반영 + 풀빌드 + 회귀 측정

**Files:** Modify `build/build_html.py` (JS_ORDER에 sim.js·clause_role.js·matcher_config.js 추가), 필요시 스모크

- JS 인라인 순서: sim.js → clause_role.js → matcher_config.js → segmenter.js → matcher.js → docx.js → app.js (의존 순)
- 풀빌드 후 회귀 측정 스크립트(scratchpad): 샘플 계약서로 v3 실행, confirmed/review/none 분포 + 단일신호 confirmed 수를 v2와 비교해 수치 보고.
- pytest 38 + node --test 전부 통과.
- 커밋: "feat: 빌드 v3 통합 + 회귀 측정"

### Task 6: 브라우저 E2E

- 풀빌드 HTML을 Chrome으로: 업무위탁 유형, 샘플 계약서 분석 → 매칭 열 3-tier 표시, "재위탁" 단독이 8개 점등하지 않고 소수 confirmed로 수렴하는지, 검토필요·누락 구분, 정렬, 외부요청 0.
- dist 커밋: "feat: Phase 2 Part1 완성 — 매칭 엔진 v3 (브라우저 검증)"

---

## 실행 메모

- Task 1·2는 독립 → 병렬 가능. 3은 1·2 의존. 4는 3 의존. 5는 3·4. 6은 5.
- 각 코드 태스크 후 스펙+품질 2단계 리뷰. 특히 Task 3는 정밀도 핵심이라 리뷰에서 "게이트가 과도하게 엄격(정상 매칭 탈락)/관대(단일 통과)" 균형을 재현 검증.
- comp 코드 이식 시 출처 주석 필수. 라이선스 상충 없음(동일 사용자 프로젝트).
- 브레이킹 체인지: dist는 Task 6에서만 재커밋. 브랜치 phase2-matching.
