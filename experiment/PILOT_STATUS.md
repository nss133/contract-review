# qwen3:4b 매칭 파일럿 상태

- 실행일: 2026-08-06
- 입력: 공개 표준계약서·지침 5개
- 모델: Ollama `qwen3:4b`, temperature 0
- 비교: 규칙 Top-1 대 규칙 Top-3 + LLM 재정렬

## 예측 생성 결과

| 문서 | 재정렬 후보 | 유효 LLM 응답 | direct | reference_only | unrelated |
|---|---:|---:|---:|---:|---:|
| GOV-SVC-2024 | 0 | 0 | 0 | 0 | 0 |
| PERF-SHARE | 0 | 0 | 0 | 0 | 0 |
| POP-TRAINEE-2025 | 12 | 12 | 9 | 3 | 0 |
| WORK-ATHLETE-2024 | 23 | 23 | 21 | 2 | 0 |
| ESPORTS-GUIDE | 26 | 26 | 20 | 3 | 3 |
| **합계** | **61** | **61** | **50** | **8** | **3** |

최초 2건 배치 응답에서는 모델이 일부 항목을 생략했다. 누락 항목을 1건씩 재요청하는
fallback 후 유효 응답률은 100%가 됐다. 따라서 운영 구현에서도 응답 배열 길이를 신뢰하지 않고
`check_id`별 완결성을 검사해야 한다.

## 아직 결론낼 수 없는 것

블라인드 골드의 `applicable`과 직접·참조 조항 라벨이 비어 있으므로 현재 파일만으로 규칙 대비
정확도 향상은 주장할 수 없다. `experiment/gold/*.json`의 61개 후보 체크를 사람이 라벨링한 뒤
`build/experiment_report.py`를 실행해야 Exact Match, Recall@3, McNemar 검정과 bootstrap CI가 나온다.

두 문서의 후보 0건은 LLM 실패가 아니라 유형감지·규칙 검색 단계의 누락이다. 재정렬 성능과 분리해
retrieval miss로 분석해야 한다.
