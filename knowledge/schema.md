# 지식 YAML 스키마 (v2)

## 파일 구성
- `common.yaml` — 모든 계약 공통 체크리스트
- `types/<type_id>.yaml` — 유형별 체크리스트

## 최상위 구조 (두 키 모두 필수)

meta:
  type_id: outsourcing        # 파일명과 일치. common.yaml은 "common"
  type_name: 업무위탁          # UI 표시명
  detect_keywords: [위탁, 수탁]  # 유형 자동 감지용 (common은 빈 리스트)
  modules:                    # 규제 레짐 모듈. 없으면 빈 리스트
    - id: M-PRIV              # 파일 내 유일
      name: 개인(신용)정보 처리위탁
      always_on: false        # true면 스크리닝 없이 항상 활성
      screening_question: 위탁 업무에 개인(신용)정보 처리가 포함되는가?
      suggest_keywords: [개인정보, 신용정보]   # 본문 검출 시 활성화 제안
checks:
  - id: OUT-09-1               # 전역 유일. 유형약어-번호(-원자순번), 조문 항·호 = 1 항목
    check: 위탁 문서에 "위탁업무 수행 목적 외 개인정보의 처리 금지" 사항이 포함되어 있는가   # 질문 1문장. 서술형 코멘트 금지
    module: M-PRIV             # 생략 시 유형 기본 (항상 포함)
    severity: 필수              # 필수 | 권장 | 참고 — norm_type·basis에서 도출 (아래 "심각도 도출 규칙")
    severity_basis: 근거 조문이 강행규정(의무)임 — 개인정보 보호법 제26조   # 심각도 근거 1문장. UI "왜 필수?" 답변용
    severity_override: false   # 선택. true면 도출 규칙과 달라도 경고 억제(의도적 예외). 생략 시 false
    norm_type: 강행             # 강행 | 임의 | 추정 | 간주 | 실무 — 조문 어미로 판정
    basis: statute             # statute(법령 요건) | practice(법령 근거 없는 실무 항목)
    triggers:
      keywords: [재위탁, 재수탁]   # 조항 본문 포함 검사 (OR)
      patterns: []                # JS 정규식 문자열 (선택)
    absence_check: true       # true: 매칭 조항 없으면 "누락 의심" 보고
    sources:                  # basis=statute면 1개 이상 필수. 첫 항목에 quote 필수
      - law: 개인정보 보호법      # DB law_name과 일치해야 원문 첨부됨
        article: 제26조         # "제N조" / "제N조의M" 형태
        clause: 제1항 제1호      # 표시용 (선택)
        quote: 위탁업무 수행 목적 외 개인정보의 처리 금지에 관한 사항   # 조문 원문에서 그대로 발췌 (basis=statute 첫 항목 필수)
        verified: false        # 사람이 원문 대조 후에만 true로 승격
    note: ""                  # 선택, 1줄 이하 보충 메모. 서술형 지침 작성 금지(폐지된 guidance 대체 아님)
    jid_refs: []              # 사내 판단 선례 라벨 (예: J-2026-0496)
    news_refs: []             # briefing.sqlite3 items.id

## v1 → v2 변경 (breaking change)

| | v1 (폐기) | v2 (현행) |
|---|---|---|
| 최상위 키 | `checkpoints` | `checks` |
| 표제 필드 | `title` (묶음 제목) | `check` (원자 질문 1문장) |
| 서술형 지침 | `guidance` | 폐지 — `norm_type` + `sources[].quote`가 대체. 필요시 `note`에 1줄 보충만 |
| 근거 | `legal_basis` (조 단위, quote 없음) | `sources` (항·호 단위, quote 필수) |
| 항목 단위 | 쟁점 묶음 | 조문 항·호 = check 1개 |

`checkpoints` 키가 남아 있으면 `ValidationError("checkpoints는 v2에서 checks로 변경됨")`.
check 항목에 `guidance` 키가 남아 있으면 `ValidationError("guidance는 폐지됨 — note 사용")`.

## 검증 규칙 (build/validate.py가 강제)

- check 필수 필드: `id`, `check`, `severity`, `basis`, `norm_type`
- `id` 전역 유일
- `severity` ∈ {필수, 권장, 참고}
- `norm_type` ∈ {강행, 임의, 추정, 간주, 실무}
- `basis` ∈ {statute, practice}
- `severity_basis`가 있으면 비어 있지 않은 문자열이어야 함
- `severity_override`가 있으면 불리언이어야 함
- `severity`가 아래 도출 규칙과 불일치하고 `severity_override`가 없거나 false면 **경고 출력**(stderr, ValidationError 아님 — 지식 작성 가드). 의도적 예외는 `severity_override: true` + `note`에 사유 기재
- `module`이 있으면 해당 파일 `meta.modules`에 선언된 id여야 함
- `sources` 각 항목 필수 키: `law`, `article`, `verified` / 선택 키: `clause`, `quote`
- `basis: statute` → `sources`가 1개 이상 필요, `sources[0].quote`가 비어있지 않은 문자열이어야 함 (없으면 빌드 실패)
- `basis: practice` → `sources`는 빈 리스트 허용 (법령 근거 없는 실무 항목)
- `note`가 있으면 문자열이어야 함
- `triggers.patterns`는 정규식으로 컴파일 가능해야 함 (Python `re` 기준 사전 검증. JS RegExp과 문법이 미세하게 다르나 현재 패턴 수준에선 동일함)
- 빈 `meta` / `checks` 부재 / 파일 부재 → `ValidationError`

## 심각도 도출 규칙 (severity = f(norm_type, basis))

심각도는 항목의 "업무적 중요도"가 아니라 **근거 조문의 규범 효력**을 반영함. `build/validate.py`의 `derive_severity(norm_type, basis)`가 규칙 함수이며, 지식의 `severity`는 이 규칙과 일치하도록 재계산해 유지함.

| 조건 | 도출 severity | severity_basis 예시 |
|---|---|---|
| `basis: practice` (법령 근거 없는 실무 항목) | 참고 | 실무 관행 항목(법령 강제 아님) |
| `norm_type: 강행` (의무·금지) | 필수 | 근거 조문이 강행규정(의무)임 — {law} {article} |
| `norm_type: 임의` (권한) | 권장 | 근거 조문이 임의규정임 — {law} {article} |
| `norm_type: 추정` | 참고 | 추정규정임 — {law} {article} |
| `norm_type: 간주` | 참고 | 간주규정임 — {law} {article} |

- `basis: practice`가 `norm_type`보다 우선함(실무 항목은 항상 참고).
- `severity_basis`의 법령명·조문은 실제 `sources[0]`에서 가져옴(조문 표제 괄호는 생략, 예 "제3조(업무위탁 등)" → "제3조").
- 규칙과 다르게 두어야 할 의도적 예외만 `severity_override: true` + `note`에 사유. 그 외에는 규칙대로 전량 재계산.

## 배지 의미 (enrich 이후, UI 표시용 — build/enrich.py가 부여)

- `quote_ok` + `verified: true` → **원문확인** (녹): quote가 DB 조문 원문에서 확인되었고 사람이 대조 완료
- `quote_ok` + `verified: false` → **원문 미대조** (황): quote는 원문에서 확인되었으나 사람 검수 전
- `quote_mismatch` → **문언 불일치** (적): 조문은 찾았으나 quote 문언이 원문과 불일치 (조작·오기 방지 경고)
- `missing` → **원문 미확인** (적): 조문 자체를 DB에서 찾지 못함
- `basis: practice` → **실무** (회): 법령 근거 없는 실무 항목, quote 대조 대상 아님

## 검수 흐름

Claude 초안(verified: false, quote는 DB 원문에서 직접 발췌) → 손남수 원문 대조 → verified: true 승격 → 재빌드
