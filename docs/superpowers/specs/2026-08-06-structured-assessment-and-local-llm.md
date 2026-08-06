# 구조화 시스템 평가와 로컬 LLM 확장 설계

## 목적

매칭 결과, 시스템의 사실 평가, 사람의 최종 판정을 분리해 자동화의 안전성과 학습 데이터의 품질을 함께 높인다.

## 판단 계층

1. 적용성: applicable / not_applicable / undetermined
2. 증거: evidence_found / possible_evidence / evidence_not_found / evidence_in_base / not_surfaced
3. 검토 경로: human_confirm / human_required / no_review / not_surfaced
4. 사람 판정: 이상없음 / 검토의견

`addressed`는 법적 이상없음이 아니라 관련 근거를 강하게 찾았다는 뜻이다. 따라서 초기 버전에서는 자동으로 사람 판정을 생성하지 않는다.

## 데이터 계약

검토의견 JSON은 기존 `meta`, `verdicts`를 유지하고 선택 키 `system_assessments`를 추가한다. 사람 판정에는 `origin`을 기록한다.

- manual: 사람이 직접 남긴 판정
- bulk: 통과계약 일괄 처리
- subdoc: 표준 부속서류 사용에 따른 자동 기재
- prior_review: 전년 판정 수용
- legacy: 출처 필드 도입 전 데이터

코퍼스는 체크별로 `system_verdict_pairs`와 `origin_counts`를 누적한다. 시스템의 근거 발견과 사람의 최종 판정을 같은 의미로 간주하지 않고 조합 원자료를 보존한다.

## 자동판정 승격 조건

체크별 골드셋과 실제 뒤집기 데이터가 축적되기 전에는 자동 이상없음으로 승격하지 않는다. 향후 체크 단위 정책은 다음 조건을 모두 요구한다.

- 적용성이 명확함
- 승인 표준문구 또는 결정문구가 존재함
- 목적·정의 조항이 아님
- 예외·부정·상충 신호가 없음
- 근거 조항이 기록됨
- 별도 평가셋에서 잘못된 자동 이상없음 비율이 허용치 이하임

## 로컬 LLM 연결

단일 HTML은 규칙 엔진만으로 계속 동작한다. 선택적인 localhost companion service가 임베딩, reranking, 구조화 평가, 의견 초안을 제공한다.

1차 실험은 현재 규칙 엔진의 Top-K 후보를 입력으로 받아 reranking만 수행한다. 생성 모델이 새로운 법령이나 근거를 만들게 하지 않는다.

평가 지표는 Recall@K, Precision@1, 사람의 매칭 수정률, 잘못된 자동 이상없음 비율, 계약당 검토시간이다.

### v1.20 구현

- `build/serve_local.py`가 `127.0.0.1`에서 앱을 제공하고 Ollama를 같은 출처로 중계한다.
- 지원 모델은 `qwen3:4b`로 고정한다.
- 규칙 엔진이 표면화한 `verify`, `addressed` 항목 중 최대 12개를 우선순위에 따라 선택한다.
- 체크당 규칙 후보 Top-3의 표제와 본문 최대 1,800자를 보낸다.
- 모델은 `direct / reference_only / unrelated`, `complete / partial / unclear`를 JSON 스키마로 반환한다.
- 결과는 규칙 coverage를 변경하지 않는 advisory이며, 사람 판정과의 조합을 코퍼스에 누적한다.
- 클라이언트는 localhost HTTP에서만 AI API를 호출한다. 프록시는 모델, 요청 개수, 후보 개수, 본문 길이를 제한한다.

앱 내장 골드셋은 기존 `addressed`, `consider` 외에 `verify` 목록도 선택적으로 저장·비교한다. 구 v1 케이스에 `verify`가 없으면 해당 축은 채점하지 않아 하위호환을 유지한다.
