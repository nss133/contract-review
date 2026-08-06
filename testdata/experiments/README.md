# 매칭 실험 작업 폴더

실험할 때 아래 구조를 별도 작업 디렉터리에 만든다. 계약 본문을 포함하는 골드 파일은
공개 표준계약서 실험 또는 승인된 내부 환경에서만 보관한다.

```text
experiment/
  gold/          사람이 블라인드 작성한 *-matching-gold.json
  predictions/   앱에서 반출한 *-matching-predictions.json
  output/        experiment_report.py 산출물
```

골드와 예측은 `meta.document_id`가 같아야 한다. 누적 코퍼스 백업은 실험 입력으로 사용하지 않는다.

공개 표준계약서 일괄 파일럿 생성:

```bash
python3 build/run_matching_experiment.py --out experiment
```

명령은 앱과 같은 분석 엔진을 사용하고 localhost companion을 통해 `qwen3:4b`를 호출한다.
`experiment/gold`는 예측을 포함하지 않는 라벨링 원본이다.
