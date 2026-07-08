# 검수 보조 화면 설계

- 작성일: 2026-07-09 · 상태: 승인됨
- 목표: 지식 218개 항목의 statute source(177개, 전부 verified:false)를 법무팀 검토자가 quote↔DB원문 대조로 검수해 verified:true로 승격하는 것을 돕는 화면 + 빌드타임 적용 스크립트.

## 배경
- 각 source에 이미 quote(발췌)와 text(DB 원문 전문)가 빌드에 임베드됨 → 검수 시점에 DB 없이 브라우저에서 대조 가능.
- 앱은 오프라인 단일 HTML → 파일을 못 씀. 검수 결과(verified)를 지식 YAML(git 소스오브트루스)에 되돌리는 경로가 필요.
- verified:true + quote_ok → 빌드 시 "원문확인"(녹) 배지. 현재 전부 "원문 미대조"(황).

## 확정 결정 (사용자 승인)
- 방식: 브라우저 검수 화면 + 내보내기(JSON) + 빌드타임 apply 스크립트.
- 검수 범위: 법리 적정성 전체 — quote 원문 일치 + 조문이 체크 근거로 타당 + 심각도·규범유형까지 판단.

## 아키텍처 · 데이터 흐름

```
[브라우저 "검수" 탭] 항목별 판정(확인/보류/수정필요) → localStorage 누적
      │ "내보내기"
      ▼
verification.json (다운로드)
      │ python3 build/apply_verification.py verification.json
      ▼
[knowledge/*.yaml] verified:true + verified_date 적용 → 재빌드 → 원문확인(녹) 배지
```
localStorage = 작업 상태(며칠 이어서). git YAML = 진짜 저장소.

## 검수 화면 (src/app.js·template.html·style.css)

- 새 "검수" 탭(가이드/분석/리포트와 병렬). 계약서 입력과 무관 — 지식 전체 대상.
- statute source 177개를 **check(항목) 단위 그룹**으로 순회. 카드 구성:
  - 좌: check 질문 + 심각도 배지 + severity_basis + note
  - 우/하: source별 **quote(강조) ↔ text(DB 원문 전문)** 나란히. 발췌가 원문 어디인지 하이라이트(quote를 text에서 찾아 mark).
  - 판정 3택: 확인 / 보류 / 수정 필요(+메모).
  - 진행률("177개 중 N개 확인"), 필터(유형별 · 미검수만 · 수정필요만 · 확인됨).
- practice 56개(근거 조문 없음)는 "실무 항목(법령 근거 없음)"으로 표기, verified 카운트 제외.
- 판정 상태 localStorage 저장(키=아래). "내보내기" 버튼 → verification.json 다운로드.

## 데이터 규격

- source 키: `<check_id>#<source_index>` (source에 id 없으므로 index 사용).
- verification.json:
```json
{"CMN-12#0": {"decision":"확인","date":"2026-07-09"},
 "OUT-09#1": {"decision":"수정필요","note":"항 번호 재확인","date":"2026-07-09"}}
```
- decision ∈ {확인, 보류, 수정필요}. 보류는 미결(무동작).

## apply_verification.py (신규, build/)

- 입력: verification.json 경로. knowledge/ 로드.
- "확인" → 해당 check의 sources[index].verified = true, verified_date 기록.
- "수정필요" → YAML 미변경, 콘솔에 큐레이터 수정 목록 출력(check_id·note).
- 이미 verified:true인 것은 무동작(멱등).
- 존재하지 않는 check_id/index → 경고 후 스킵(지식이 변경된 경우).
- YAML 재작성 시 기존 포맷·주석 보존 노력(순서·필드 유지). 검증: load_knowledge 통과, enrich에서 해당 source status가 verified로.
- 적용 후 안내: `python3 build/build_html.py` 재빌드 → 배지 반영.

## 화면 로직 분리 (테스트 가능)

- 순수 함수로 분리(src/verify.js 또는 app.js 내): 진행률 계산, 필터, export JSON 생성, quote를 text에서 찾아 하이라이트 구간 계산. node --test 대상.
- DOM 렌더는 app.js.

## 테스트

- apply_verification.py: pytest — 확인만 true / 수정필요 미반영 / 멱등 / 잘못된 키 스킵 / verified_date 기록.
- verify 로직: node --test — 진행률·필터·export JSON·하이라이트 구간.
- 브라우저 E2E: 검수 탭 렌더·3택 판정·export → apply(샘플 JSON) → 재빌드 → 해당 항목 배지 녹색 전환.

## 비범위
- 검수 코멘트의 앱 내 영구 저장(git 아닌) — localStorage로 충분.
- 다중 검수자 동시 협업 머지 — 현재 단일 검토자 전제. 필요 시 후속.
- practice 항목의 별도 승인 워크플로우 — verified는 statute source 전용.
