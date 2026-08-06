# qwen3:4b 매칭 재정렬 실험 프로토콜

## 목적

규칙 Top-1과 동일한 규칙 Top-3를 입력받은 qwen3:4b Hybrid를 동일 사례에서 쌍대 비교한다.
공개·변형 표준계약서에서 직접 관련 조항 매칭 정확도와 참조 조항 오부착률의 변화를 측정한다.

## 사전 고정 가설

`규칙 Top-3 + qwen3:4b 재정렬`은 규칙 Top-1보다 사람 골드의 직접 관련 조항을 더 정확히 선택하고,
단순 참조 조항을 직접 근거로 오부착하는 비율을 높이지 않는다.

## 자료 계층

1. 원문: `testdata/standard_contracts/raw/`
2. 골드: 규칙·LLM 결과를 보지 않고 사람이 작성한 `cr-matching-gold-v1`
3. 예측: 앱이 반출한 `cr-matching-predictions-v1`
4. 보고서: `build/experiment_report.py`가 생성하는 CSV·JSON·Markdown

공개 표준계약서가 모델 학습자료에 포함됐을 가능성이 있으므로 원문과 수동 변형본 결과를 별도 보고한다.
내부 계약서 성능으로 일반화하지 않는다.

## 실험 단위

- 1차 파일럿: 평가 가능한 `문서 × 체크` 100쌍
- 본 실험: 15개 이상 독립 문서, 평가 가능한 쌍 300개 이상
- 같은 계약서의 문구 변형은 독립 문서 수로 중복 계산하지 않는다.
- LLM 응답이 없는 항목은 쌍대 정확도 계산에서 제외하고 별도로 누락 수를 확인한다.
- 본 쌍대 실험은 규칙 Top-3 후보가 있는 `addressed/verify` 항목의 **재정렬 성능**을 측정한다.
  후보 자체가 없는 체크는 별도의 검색 누락(retrieval miss) 분석 대상으로 보고 이 정확도에 섞지 않는다.

## 골드 라벨

`블라인드 골드 템플릿` 파일에서 다음 필드만 사람이 채운다.

- `applicable`: 체크의 적용 여부 (`true` / `false`)
- `direct_clause_indices`: 체크 내용을 직접 정하는 조항 인덱스. 복수 허용
- `reference_clause_indices`: 단순 참조·예시·전제 조항 인덱스. 복수 허용
- `completeness`: `complete` / `partial` / `unclear`
- `confidence`: `high` / `medium` / `low`
- `note`: 근거 메모

직접 관련 조항이 없으면 `direct_clause_indices`는 빈 배열로 둔다. 적용되지 않는 체크도
`applicable: false`와 빈 직접 조항 배열을 기록해 `NONE` 판별 정확도에 포함한다.

가능하면 두 검토자가 독립 라벨링한 뒤 불일치를 조정한다. 한 명이면 예측을 보지 않은 상태로
최초 라벨링하고 최소 1주 후 순서를 바꿔 재검토한다.

## 예측 정의

- Baseline: 규칙 엔진 `rule_clause_index`
- Hybrid: LLM이 `direct`로 분류하면 선택 조항, `reference_only` 또는 `unrelated`이면 `null`
- 복수 골드 중 하나를 고르면 정답
- 직접 골드가 비어 있으면 `null`이 정답

## 1차 지표와 성공 기준

- 1차 지표: Direct Exact Match@1 차이
- 안전 지표: 참조 조항 오부착 건수
- 보조 지표: 개선 건수, 훼손 건수, 순개선, McNemar exact p, 문서 단위 bootstrap 95% CI

채택 조건은 모두 충족해야 한다.

1. Hybrid 정확도 순증가 `+5%p` 이상
2. 문서 단위 bootstrap 95% CI 하한이 `0%p` 초과
3. 참조 조항 오부착률이 악화되지 않음
4. 응답 실패·미검토 비중이 2% 이하

전체 조건을 충족하지 않고 특정 체크군만 개선되면 그 체크군에만 제한 적용한다.
이 실험만으로 자동 법적 판정을 허용하지 않는다.

## 실행

1. localhost 앱에서 계약서를 분석한다.
2. AI 결과를 보기 전에 `블라인드 골드 템플릿`을 내려받아 라벨링한다.
3. `실험 전체 AI 채점`을 실행해 전체 후보 처리가 끝났는지 확인한다.
4. `실험 예측 내보내기`를 실행한다.
5. 문서별 파일을 서로 다른 폴더에 모은다.
6. 다음 명령으로 보고서를 생성한다.

```bash
python3 build/experiment_report.py \
  --predictions experiment/predictions/*.json \
  --gold experiment/gold/*.json \
  --out output/experiment
```

산출물은 `summary.json`, `paired_results.csv`, `report.md`다.
