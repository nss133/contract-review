# 지식 YAML 스키마 (v2)

## 파일 구성
- `common.yaml` — 모든 계약 공통 체크리스트
- `types/<type_id>.yaml` — 유형별 체크리스트

## 최상위 구조 (두 키 모두 필수)

meta:
  type_id: outsourcing        # 파일명과 일치. common.yaml은 "common"
  type_name: 업무위탁          # UI 표시명
  detect_keywords: [위탁, 수탁]  # 유형 자동 감지용 (common은 빈 리스트)
  nature_signals: [화해, 부제소]  # 선택. 성격 배타 게이트 — 이 강신호가 본문에 NATURE_MIN(2)개+ 검출되면
  suppresses: [shareholders]     #   suppresses의 유형 점수를 0으로(오탐 억제). settlement가 사용 중
  modules:                    # 규제 레짐 모듈. 없으면 빈 리스트. common.yaml의 모듈(X-*)은 횡단 풀 —
                              #   유형과 무관하게 전 계약에서 스크리닝됨(유형 미확정 포함)
    - id: M-PRIV              # 파일 내 유일. 횡단 모듈은 X- 접두어 관례
      name: 개인(신용)정보 처리위탁
      always_on: false        # true면 스크리닝 없이 항상 활성
      screening_question: 위탁 업무에 개인(신용)정보 처리가 포함되는가?
      suggest_keywords: [개인정보, 신용정보]   # 본문 검출 시 활성화 제안
      activation: confirm     # 선택. 모듈 활성 등급 — 아래 "모듈 활성 등급" 참조. 생략 시 기본(1개 검출로 활성)
      requires_stance: [party]  # 선택. 이 모듈이 유효한 검토 국면. 생략 시 전 국면. 아래 "검토 국면" 참조
checks:
  - id: OUT-09-1               # 전역 유일. 유형약어-번호(-원자순번), 조문 항·호 = 1 항목
    check: 위탁 문서에 "위탁업무 수행 목적 외 개인정보의 처리 금지" 사항이 포함되어 있는가   # 질문 1문장. 서술형 코멘트 금지
    label: "목적외 처리 금지"    # 선택. UI 짧은 라벨(8자 내외). 생략 시 check 전문 표시
    module: M-PRIV             # 생략 시 유형 기본 (항상 포함)
    stance_scope: [beneficiary]  # 선택. 이 체크가 노출되는 검토 국면. 생략 시 전 국면. 아래 "검토 국면" 참조
    tier: conditional          # 선택. core(생략 기본)=유형 본질 | conditional=특수규제(법령상 별도 적용요건 —
                               #   문언 밖 사실(당사자 자격·규모)로 적용이 결정). 리포트에서 "적용 시 확인"으로 접힘
    severity: 필수              # 필수 | 권장 | 참고 — norm_type·basis에서 도출 (아래 "심각도 도출 규칙")
    severity_basis: 근거 조문이 강행규정(의무)임 — 개인정보 보호법 제26조   # 심각도 근거 1문장. UI "왜 필수?" 답변용
    severity_override: false   # 선택. true면 도출 규칙과 달라도 경고 억제(의도적 예외). 생략 시 false
    norm_type: 강행             # 강행 | 임의 | 추정 | 간주 | 선언 | 실무 — 조문 어미로 판정
    basis: statute             # statute(법령 요건) | practice(법령 근거 없는 실무 항목)
    triggers:
      keywords: [재위탁, 재수탁]   # 조항 본문 포함 검사 (OR)
      patterns: []                # JS 정규식 문자열 (선택)
    absence_check: true       # true: 매칭 조항 없으면 "누락 의심" 보고
    absence_precondition: [질권, 근질권]   # 선택. 조건부 부재체크 — 본문에 이 어휘가 1개+ 있을 때만
                               #   부재알람 발동(약한 게이트). 없으면 quiet. 생략 시 무조건 발동.
                               #   "문언에 제도 채택이 드러나는" 항목에만 사용(문언 밖 사실로 적용이
                               #   결정되면 tier: conditional이 맞음). 모듈 suggest_keywords와 동일
                               #   어휘면 중복(no-op)이므로 금지
    sources:                  # basis=statute면 1개 이상 필수. 첫 항목에 quote 필수
      - law: 개인정보 보호법      # DB law_name과 일치해야 원문 첨부됨
        article: 제26조         # "제N조" / "제N조의M" 형태
        clause: 제1항 제1호      # 표시용 (선택)
        quote: 위탁업무 수행 목적 외 개인정보의 처리 금지에 관한 사항   # 조문 원문에서 그대로 발췌 (basis=statute 첫 항목 필수)
        verified: false        # 사람이 원문 대조 후에만 true로 승격
        source_type: law       # law | self_regulation (선택, 생략 시 "law"). UI 근거 배지 구분용
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
- `norm_type` ∈ {강행, 임의, 추정, 간주, 선언, 실무}
- `basis` ∈ {statute, practice}
- `severity_basis`가 있으면 비어 있지 않은 문자열이어야 함
- `severity_override`가 있으면 불리언이어야 함
- `severity`가 아래 도출 규칙과 불일치하고 `severity_override`가 없거나 false면 **경고 출력**(stderr, ValidationError 아님 — 지식 작성 가드). 의도적 예외는 `severity_override: true` + `note`에 사유 기재
- `module`이 있으면 해당 파일 `meta.modules`에 선언된 id여야 함
- `sources` 각 항목 필수 키: `law`, `article`, `verified` / 선택 키: `clause`, `quote`, `source_type`
- `source_type` ∈ {`law`, `self_regulation`} (선택 필드 — validate가 필수화하지 않음). 생략 시 `law`로 간주. `self_regulation`은 협회 자율규제·모범규준(klia_regulations.sqlite 수록)에만 명시. UI가 법령 근거와 자율규제 근거의 배지를 구분하는 데 사용
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
| `norm_type: 선언` | 참고 | 선언규정임(권리 보전 등) — {law} {article} |

- `basis: practice`가 `norm_type`보다 우선함(실무 항목은 항상 참고).
- `severity_basis`의 법령명·조문은 실제 `sources[0]`에서 가져옴(조문 표제 괄호는 생략, 예 "제3조(업무위탁 등)" → "제3조").
- 규칙과 다르게 두어야 할 의도적 예외만 `severity_override: true` + `note`에 사유. 그 외에는 규칙대로 전량 재계산.

## 모듈 활성 등급 (meta.modules[].activation — src/matcher.js suggestModules)

| 등급 | 활성 조건 | 용도 |
|---|---|---|
| (생략, 기본) | 서로 다른 suggest_keywords 1개+ 검출 | 일반 모듈. 어휘가 충분히 특이할 때 |
| `strong` | 서로 다른 키워드 **2개+** 검출, 아니면 꺼짐 | 특수 규제(전자금융 §60 등) — 오탐 억제 우선 |
| `confirm` | 강신호(서로 다른 2개+ **또는** 총 출현 3회+)=자동 ON / 약신호(1~2회)=OFF+**질문 노출** / 무신호=OFF | 문언만으론 실제 취급 여부 판단 불가한 모듈(개인정보 등). 상투 준수조항 1회 ≈ 약신호 → 추측하지 않고 사람에게 물음 |

## 오탐 억제 게이트 4층 (판정 기준 — P2에서 확립, 국면층은 11차 추가)

| 층 | 장치 | 언제 쓰나 |
|---|---|---|
| **국면** | `requires_stance` (모듈) / `stance_scope` (check) | **당사가 그 규범의 수범자가 아닐 때**. 문언은 맞지만 의무주체가 남일 때 |
| 유형 | `nature_signals` + `suppresses` | 계약의 법적 성격이 다른 유형과 배타적일 때(화해 vs 상법 조직행위) |
| 모듈 | `activation: strong/confirm` | 규제 모듈이 일반 계약에 오활성될 때 |
| check | `absence_precondition` / `tier: conditional` | **문언에 제도 채택이 드러나면** precondition, **문언 밖 사실(당사자 자격·규모)로 적용이 결정되면** conditional |

공통 원칙: 확신 없으면 게이트를 걸지 않음(누락검출 훼손이 오탐보다 나쁨). 게이트 추가·변경 시 `python3 build/goldset.py` before/after 필수.

## 검토 국면 (stance) — 당사가 누구인가

같은 문언이라도 **당사가 규범의 수범자인지**에 따라 검토 관점이 달라짐. 국면은 계약 유형과 직교하는
축이며, 입력 단계에서 검토자가 지정(자동 추정값 프리필).

| stance | 뜻 | 검토 관점 |
|---|---|---|
| `party` (기본) | 당사가 계약 당사자로서 **의무를 부담·이행**하는 국면 | 당사가 규제를 준수하는가 — 준수의무형 체크 전량 적용 |
| `beneficiary` | 당사가 **수익자·투자자**로서 참여하며, 계약의 의무주체는 제3자(운용사·수탁회사 등) | 당사에게 **불리한 조항이 없는지** — 준수의무형 체크 억제, 수익자 보호형 체크 표면화 |

실제 사고(2026-08-04): 일반사모부동산투자신탁의 신탁계약 변경합의서를 검토했는데, 신탁계약은
집합투자업자·신탁업자 사이의 펀드 단위 문서라 당사는 수익자일 뿐임에도 본문의 "대주주·계열회사",
"자산운용", "모집" 문구가 검출되어 X-ASSET(보험업 자산운용)·X-INSMOD(보험모집) 모듈이 켜지고
**당사가 준수주체인 양** 체크리스트가 붙음. 문언 검출은 정확했으나 **수범자가 당사가 아니었음**.

- 모듈: `requires_stance: [party]` — 그 국면에서만 활성 후보가 됨(다른 국면에서는 자동 제안·수동 ON 모두 차단).
- check: `stance_scope: [beneficiary]` — 특정 국면에서만 노출되는 체크(수익자 보호형 체크에 사용).
  생략 시 전 국면 노출. `requires_stance`가 걸린 모듈에 속한 check는 모듈 단계에서 이미 걸러짐.

원칙: 국면 게이트는 **수범자가 당사가 아님이 구조적으로 명백한 경우**에만 건다. 당사가 의무를
질 여지가 있으면 걸지 않음(누락검출 훼손 방지).

## 배지 의미 (enrich 이후, UI 표시용 — build/enrich.py가 부여)

- `quote_ok` + `verified: true` → **원문확인** (녹): quote가 DB 조문 원문에서 확인되었고 사람이 대조 완료
- `quote_ok` + `verified: false` → **원문 미대조** (황): quote는 원문에서 확인되었으나 사람 검수 전
- `quote_mismatch` → **문언 불일치** (적): 조문은 찾았으나 quote 문언이 원문과 불일치 (조작·오기 방지 경고)
- `missing` → **원문 미확인** (적): 조문 자체를 DB에서 찾지 못함
- `basis: practice` → **실무** (회): 법령 근거 없는 실무 항목, quote 대조 대상 아님
- `source_type: self_regulation` → **자율규제** 톤: 협회 모범규준·표준내부통제기준 등 자율규제 근거. quote 검증은 법령 source와 동일(klia DB 대조). 법령(강제)과 달리 자율규제임을 배지로 구분

## 검수 흐름

Claude 초안(verified: false, quote는 DB 원문에서 직접 발췌) → 법무팀 검토자 원문 대조 → verified: true 승격 → 재빌드
