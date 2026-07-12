# 부재 알람 관련성 게이트 — 3층 (조건부 부재체크 + 티어링 + 코퍼스 강등)

> 실사용 피드백 ③: '질권을 설정할 수 있다'만 있거나 질권 언급이 아예 없는데 민법 질권 설정 조항들이 필수로 뜸. 관련성 낮은 부재알람. 딜레마: 빼면 '누락 검출'(핵심 가치) 죽고, 두면 무관 알람 범람. 해법 = 부재알람에 관련성 조건 부여.

## 결정 (사용자)
- ① 조건부 부재체크(전제신호 게이트) + ② 2단계 부재 분리(core/conditional) + ③ 코퍼스 자동 강등 — 3개 모두 채택.
- ① 전제신호 판정: **1개로 충분(약한 게이트)**. 누락검출 우선 — 관련성 살짝만 있어도 체크 유지, 언급 자체가 없을 때만 조용.

## ① 조건부 부재체크 (즉효 룰)
check에 선택 필드 `absence_precondition: [어휘...]` 추가.
- matcher.js `coverageOf`(tier=none 분기): absence_check && alarmGate 통과해도, precondition이 있으면 **본문에 전제어휘 ≥1 있을 때만** consider. 없으면 quiet.
- precondition 없는 기존 check는 무조건 발동(하위호환).
- 순수함수 유지 위해 coverageOf에 text(또는 전제충족 bool) 전달 필요 → analyze에서 계산해 넘김.
- 예: 질권 관련 check에 `absence_precondition: [질권, 담보, 근질권, 입질, 담보권]`.
  - "질권을 설정할 수 있다" → 질권 있음 → 세부(대항요건·실행방법 등) 부재알람 유지(타당).
  - 질권 언급 전무 → 전제 불충족 → quiet. ← 오탐 제거.

## ② 2단계 부재 분리 (구조적 티어링)
기존 `tier: core|conditional` 필드 재사용(§60에 이미 적용, 리포트 접힘 분기 구현됨).
- 담보계약에서만 필수인 항목(질권 세부 등)에 tier: conditional 부여.
- core 부재 = "보완 필요"(강조), conditional 부재 = "특수 규제 확인(적용 시)"(접힘). renderReport 이미 분기.

## ③ 코퍼스 자동 강등 (장기 정규화)
loop.js `curationSignals`는 이미 conditional 후보(표본≥5 & 해당없음≥80%) 계산. 다만 미표시.
- 큐레이션 패널 UI에 노출: "이 항목 표본 N건 중 X% 해당없음 → 조건부 강등 후보".
- 자동 반영 금지 — 큐레이터 승인(법무 지식 무단변경 금지). 승인 시 yaml에 tier: conditional 반영.

## 구현 순서
1. matcher.js: coverageOf에 전제신호 충족 여부 반영(순수함수, analyze에서 계산 전달). TDD.
2. validate.py·schema.md: absence_precondition 필드 허용·문서화.
3. 질권 관련 check에 absence_precondition + (해당 시) tier: conditional 부여. 어느 유형에 질권 check 있는지 grep으로 확인 후.
4. loop.js curationSignals를 app.js 큐레이션 패널에 노출.
5. before/after: 질권 무관 계약(부재알람 0 기대) vs 담보계약(부재알람 유지). 회귀·빌드.

## 검증 목표 (전부 달성)
- [x] 질권 언급 없는 계약(저당만) → 질권 세부 부재알람 0. (E2E: consider=[])
- [x] '질권 설정할 수 있다'만 있는 계약 → FIN-SEC-02 유지(누락검출 살림). (E2E: consider=[FIN-SEC-02])
- [x] 기존 테스트 회귀 없음(JS 전체+py56), 빌드 스모크 260개.

## 구현 결과
- ① matcher.js: preconditionMet(check,text) + coverageOf(tier,check,text) 전제신호 게이트(1개 충족 약한 게이트, text 미전달 시 하위호환 비활성). analyze가 fullText 계산·전달. 테스트 4개.
- finance.yaml: FIN-SEC-02(질권)·03(저당)·05(양도담보)에 각 담보유형 어휘 absence_precondition 부여. 서로의 부재알람 교차 오탐 차단.
- ② tier(core/conditional): 이미 있음 — 이번엔 미적용(질권은 전제게이트로 충분). 필요 유형에 후속.
- ③ loop.js curationSignals → app.js curationPanelHtml 노출(리포트 하단 details). 조건부 강등 후보(반복 해당없음)·안정 항목(반복 이상없음) 서페이싱. 자동반영 금지·큐레이터 제시. style.css .curation-panel.
- validate.py: absence_precondition은 미지 필드 허용(관대) — 통과. schema.md 문서화는 백로그.
