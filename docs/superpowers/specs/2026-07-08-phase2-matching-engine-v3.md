# Phase 2 (Part 1): 매칭 엔진 v3 — 다신호 + tier 게이트

- 작성일: 2026-07-08 · 상태: 승인됨
- 배경: Phase 1.5 사용자 피드백 — 매칭이 과다(샘플 실측 23매칭 중 74%가 단일 키워드). "재위탁" 한 단어가 체크 8개를 점등. 단일 키워드 매칭은 정밀도가 없음.
- 근거 리서치: comp_matching_auto가 동형 문제(확정 정밀도 0.807 낙관 편향)를 겪고, "더 좋은 유사도 점수(임베딩)가 아니라 어휘 점수 위에 얹은 비어휘 게이트"로 0.894까지 회복. 임베딩(sroberta)은 실측상 조문 단위 정밀도를 오히려 낮춰 그들이 폐기 → 우리도 안 씀. 엔진은 이미 순수 JS(webapp/engine.js)로 포팅돼 있어 이식 토대가 검증됨.

## 이번 범위 (한정)

매칭 로직 ①②③만. 가이드라인 배선(⑥)·유형 확대(④)·표준계약서(⑤)는 별도 Part.

## 현재 매칭의 문제

`src/matcher.js`의 checkpointHits: `triggers.keywords/patterns`가 조항 텍스트에 부분문자열로 1개라도 걸리면 매칭. 신호가 하나뿐 → 정밀도 없음. absence_check도 이 이진 매칭에 의존.

## v3 점수 모델

조항(clause) × 체크(check) 쌍마다 0~100 점수. 순수 JS, 브라우저 런타임.

### 텍스트 표현
- **check 대표 텍스트** = `check질문 + quote(조문 원문) + 큐레이션 키워드` 를 전처리한 것. 근거 조문 표제를 prepend해 신호화.
- **clause 질의** = `표제 + 본문` 전처리. 표제 용어는 가중 반복으로 강화(아래 B).

### 점수 (comp engine.js 차용)
```
sparse = tw·tfidf_cos_pct + jw·jaccard_pct        // 일반 tw=0.8, jw=0.2; 짧은 조항(<120자) tw=0.65, jw=0.35
score  = clip(sparse + norm_bonus + title_bonus, 0, 100)
```
- **tfidf_cos**: char_wb n-gram(2~5) TF-IDF(sublinear·smooth-idf·l2) 코사인. IDF는 전체 check 코퍼스로 빌드타임에 fit → 상수 임베드. 조사·어미 변형에 강건.
- **jaccard**: 2글자+ 한글 키워드 집합 교집합/합집합
- **norm_bonus** +3: 조항과 check의 규범유형(의무/금지/권한/선언, regex 판정)이 같으면
- **전처리**: engine.js의 STOPWORDS·PHRASE_ENDINGS·동의어·전각숫자 정규화 그대로 차용

### B. 조 표제 가중 (피드백 ②)
- clause 표제(`제N조(…)`의 괄호 내용)를 파싱. 표제 용어를 질의 텍스트에 **k회 반복**해 TF를 높임(표제만 보는 게 아니라 본문 위에 가중).
- check의 근거 조문 표제도 대표 텍스트에 반영.
- title_bonus: clause 표제 용어와 check 핵심어가 직접 겹치면 소폭 가산(+상한 있게).

## C. tier 게이트 (74% 과다 제거의 핵심)

조항별로 각 check 점수를 매기고, check마다 최고점 조항을 후보로 삼아 **신뢰도 tier** 판정:

- **confirmed(자동확정)**: 아래 중 하나
  - 명시 인용 일치: 조항 본문에 check 근거의 "법령명+제N조"가 조문번호까지 일치
  - 점수 ≥ ABS_SCORE AND 규범유형 일치
  - 1·2위 조항 점수차 ≥ MARGIN_HIGH
- **review(검토필요)**: confirmed 미달이나 점수 ≥ REVIEW_FLOOR. 아래는 confirmed여도 review로 강등:
  - 단일 후보(그 check에 걸린 조항이 1개뿐)
  - 단일 신호(tfidf·jaccard 중 한쪽만 유효, 사실상 한 단어)
  - clause가 정의/목적/전문(前文) 역할인데 명시 인용 없음 (조항역할 게이트)
- **none**: 최고점 < REVIEW_FLOOR

### 조항역할 게이트 (comp clause_role 차용)
clause 표제·본문 regex로 역할 판정: 목적/정의/전문/계약기간/완전합의 등 "외부 규범 근거가 약한" 조항. 이 역할 조항은 명시 인용이 없으면 confirmed 불가(→review). comp에서 확정 오탐 17건 전부가 이 유형이었고 어휘 점수로는 분리 불가했음.

## D. 누락 탐지 재정의

absence_check인 check가 **confirmed도 review도 없으면(= 모든 조항이 REVIEW_FLOOR 미달)** 누락 의심. 기존 "키워드 0개"보다 오탐 적음.

## E. 임계값 (초기 상수)

comp 캘리브레이션 값을 출발점으로: ABS_SCORE=35, MARGIN_HIGH=5, MARGIN_LOW=2, REVIEW_FLOOR=15 (build/matcher_config.js 상수, 튜닝 여지). 계약서 골드셋 라벨링 재보정은 후속.

## F. 기존 자산 재활용

- `triggers.keywords`는 폐기하지 않고 check 대표 텍스트의 **큐레이션 고가치 신호**로 투입(Jaccard·표제가중에 반영). patterns도 인용/규범 판정 보조로 유지 가능.
- 기존 `analyze()` 인터페이스(clauses, docs, activeModules) 유지하되 반환에 tier·score 추가. UI가 이걸 소비.

## UI 반영 (src/app.js, 최소)

- 매칭 열: `✓ 확정` / `△ 검토` / (빈칸) 3단계 배지. 조항별 상세는 점수순 정렬.
- 행 확장: 매칭 조항 발췌 + 점수 + tier 근거(왜 확정/검토인지 1줄) + 기존 "추정" 문구 유지.
- 누락 섹션: D 정의 기반.

## 빌드 (build/build_html.py)

- 빌드타임에 check 코퍼스로 IDF·어휘 사전을 계산해 JSON 임베드(런타임 재계산 없음).
- engine.js를 src/로 이식(vendored·adapt)하거나 우리 matcher.js에 흡수. 외부 의존 0 유지.

## 검증

- 단위 테스트(node --test): 점수 함수·tier 판정·조항역할 게이트·표제 가중 각각. 골든 케이스: "재위탁" 단독 조항이 confirmed 1개(재위탁 특정 check)만 만들고 나머지는 review/none으로 내려가는지.
- 회귀: 샘플 계약서 재측정 — 자동확정 비율이 실무적으로 납득 가능한 수준(단일 키워드 confirmed 대폭 감소)인지 수치 보고.
- 브라우저 E2E: tier 배지·정렬·누락 재정의.

## 비범위

- 임베딩(폐기), 표준계약서 수집(⑤), 가이드라인 배선(⑥), 신규 유형(④), LLM 재순위(오프라인 제약).
