# contract-review — 계약서 리뷰 가이드

보험사 법무팀이 계약서를 검토할 때 확인해야 할 사항을 짚어주는 **오프라인 단일 HTML 앱**.
계약서를 붙여넣으면 조항별로 "이 항목은 반영됨 / 확인 권장 / 검토 제안"을 근거 조문과 함께 표시한다.

- 완전 오프라인: 브라우저만으로 실행, 네트워크 요청 0건 (계약서 텍스트가 기기 밖으로 나가지 않음)
- 규칙 기반 매칭: 다신호 점수 + 신뢰도 tier로 "왜 이 항목이 떴는지" 항상 설명 가능
- 증적 중심: 모든 체크 항목에 근거 조문 원문(quote)이 붙고 빌드 시 DB와 대조 검증

## 바로 써보기

빌드 없이 완성본을 열려면 `dist/contract-review.html`을 브라우저로 열면 된다. (커밋된 최신 빌드)

## 아키텍처 — "빌드 타임에 무겁게, 런타임에 가볍게"

지능이 필요한 일(지식 큐레이션, 조문 원문 대조)은 빌드 단계(Python)에서 하고,
브라우저 안에서는 예측 가능한 규칙 기반 매칭만 돈다.

```
knowledge/*.yaml (체크리스트 지식, 사람 검수 대상)
        │
build/build_html.py
   ├── validate.py         스키마·정규식·심각도 규칙 검증
   ├── enrich.py           data/law_snapshot.sqlite에서 조문 원문(quote) 대조·첨부
   └── src/*.js + *.css     인라인 조립
        ▼
dist/contract-review.html  (단일 파일, 외부 의존 0)
```

런타임 JS 모듈(브라우저 인라인, 외부 의존 0):
`sim.js`(유사도 char_wb TF-IDF·Jaccard) → `clause_role.js`(조항역할·규범유형) →
`matcher_config.js`(임계값) → `segmenter.js`(조항 분할) → `matcher.js`(점수·tier) →
`docx.js`(.docx 파싱) → `app.js`(UI). 이 순서로 인라인된다.

## 개발 환경

- Python 3 (표준 라이브러리 + `pyyaml`, `pytest`)
- Node.js (테스트 러너 `node --test`만 사용, 추가 패키지 없음)

## 빌드

```bash
python3 build/build_html.py
# → dist/contract-review.html 생성
```

빌드는 `data/law_snapshot.sqlite`(리포에 커밋된 조문 스냅샷)에서 조문 원문을 읽는다.
**원본 DB 없이 클론만으로 빌드된다.** (스냅샷 구조는 아래 "데이터" 참조)

## 테스트

```bash
python3 -m pytest tests/          # 빌드 파이프라인 (validate·enrich·build)
node --test tests/*.test.js       # 런타임 로직 (sim·clause_role·matcher·segmenter)
```

> Node 24에서 `node --test tests/`(디렉토리 인자)는 실패한다. `node --test tests/*.test.js` 또는 무인자 `node --test`를 쓸 것.

## 데이터 — 스냅샷과 원본 2계층

체크리스트 지식(`knowledge/`)은 조문 원문을 근거로 인용하는데, 그 원문은 대용량 SQLite DB에 있다.
DB 전체(수백 MB)를 리포에 넣지 않고, **지식이 실제 인용하는 조문만 추출한 스냅샷**을 커밋한다.

- `data/law_snapshot.sqlite` — 앱이 쓰는 조문만 담긴 소용량 스냅샷. **커밋 대상.** 팀원은 이것만으로 빌드 가능.
- 원본 DB — 새 조문을 인용해 지식을 확장할 때만 필요. 로컬 전용(리포 밖). 경로는 `build/config.py`의 `EXTERNAL_LAW_DBS` 참조.

**지식에 새 조문을 인용한 경우** 스냅샷을 갱신해야 원문이 붙는다 (원본 DB가 있는 환경에서):

```bash
python3 build/extract_snapshot.py   # 지식이 인용하는 조문을 원본 DB에서 스냅샷으로 재추출
# → data/law_snapshot.sqlite 갱신 후 커밋
```

## 리포 구조

```
knowledge/          체크리스트 지식 (YAML) — 이 앱의 핵심 콘텐츠
  schema.md         지식 스키마 규격
  common.yaml       공통 체크리스트
  types/            계약 유형별 (현재 outsourcing 업무위탁)
build/              빌드 파이프라인 (Python)
src/                런타임 모듈 (브라우저 JS·CSS·HTML 템플릿)
data/               조문 스냅샷 (커밋됨)
tests/              pytest + node --test
dist/               산출물 HTML (커밋됨)
samples/            테스트용 샘플 계약서
docs/               설계·구현 문서 (specs / plans)
```

## 기여

브랜치·커밋 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md) 참조.

## 고지

본 도구는 규칙 기반 스크리닝 참고자료이며 법적 판단을 대체하지 않는다.
