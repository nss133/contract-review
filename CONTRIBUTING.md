# 기여 가이드

## 작업 흐름

1. `main`에서 브랜치를 딴다 (`feat/…`, `fix/…`, `docs/…`).
2. 변경 후 **테스트를 돌린다** (아래 "완료 전 체크리스트").
3. 커밋하고 push, PR로 `main`에 병합한다. `main`에 직접 커밋하지 않는다.

## 브랜치 이름

- `feat/<주제>` — 기능·지식 추가 (예: `feat/nda-type`, `feat/klia-wiring`)
- `fix/<주제>` — 버그·수정
- `docs/<주제>` — 문서

## 커밋 메시지

- 한 줄 요약은 한국어, 접두사 사용: `feat:` / `fix:` / `docs:` / `test:` / `chore:`
- 예: `feat: NDA 유형 지식 추가`, `fix: 조항 분할 — 호 나열 오분할`

## 완료 전 체크리스트 (반드시 통과)

```bash
python3 -m pytest tests/           # 그린이어야 함
node --test tests/*.test.js        # 그린이어야 함
python3 build/build_html.py        # 스모크 통과 (dist 갱신)
```

- 빌드 산출물 `dist/contract-review.html`을 변경에 맞게 재빌드해 커밋에 포함한다.
- 브라우저에서 실제로 열어 동작을 확인한다 (외부 요청 0건 유지).

## 영역별 유의점

### 지식 (`knowledge/`) — 이 앱의 핵심

법령·조문을 인용하는 콘텐츠이므로 정확성이 최우선이다.

- **모든 근거 quote는 DB 원문에서 직접 발췌한다.** 기억·추정으로 쓰지 않는다. `build/enrich.py`가 빌드 시 quote를 원문과 대조해 불일치를 잡는다.
- 새 조문을 인용하면 `python3 build/extract_snapshot.py`로 스냅샷을 갱신하고 `data/law_snapshot.sqlite`를 커밋한다. (원본 DB가 있는 환경에서만 가능)
- 새 항목은 `verified: false`로 둔다. 원문 대조 검수 후에만 `verified: true`로 승격한다.
- `severity`(필수/권장/참고)는 근거 조문의 규범 효력에서 도출된다 (강행→필수 / 임의→권장 / 추정·간주·선언·실무→참고). 규칙과 다르게 두려면 `severity_override: true` + 사유를 `note`에 명시한다. `validate.py`가 불일치를 경고한다.
- 스키마 상세는 `knowledge/schema.md` 참조.

### 런타임 JS (`src/*.js`)

- 브라우저 인라인용이라 **ES5 스타일**(`var`/`function`)과 `if (typeof module !== "undefined") module.exports` 가드를 유지한다. 외부 npm 의존 금지.
- 전역 이름이 서로 충돌하지 않게 한다 (파일이 하나의 `<script>`로 concat됨).
- 로직 변경은 해당 `tests/*.test.js`에 테스트를 먼저 추가한다.

### 화법 — "검토 보조", 채점기 아님

이 앱은 합격/불합격 판정기가 아니라 검토를 돕는 가이드다. UI 문구에 판정형 어휘(“미검출”, “누락 의심”, “미흡”)를 쓰지 않는다. 상태는 **반영 / 확인 권장 / 검토 제안**으로 표현한다.

## 문서

설계·구현 결정은 `docs/superpowers/specs/`(스펙)와 `docs/superpowers/plans/`(구현 계획)에 날짜별로 남긴다. 큰 변경은 스펙을 먼저 쓴다.
