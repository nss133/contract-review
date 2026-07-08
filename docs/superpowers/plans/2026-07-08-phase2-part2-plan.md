# Phase 2 Part 2 구현 계획: 검토 가이드 재정의

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 스펙: `docs/superpowers/specs/2026-07-08-phase2-part2-advisor-reframe.md` (기준). 기존 코드가 참조 구현. 각 태스크는 관련 파일 Read 후 수정.

**Goal:** "채점기" 화법을 "검토 보조" 화법으로 전환 — 상태 3분류(짚음/확인권장/검토제안), 규범효력 기반 심각도+근거, 단일후보 강등 제거, 가이드라인 배선, 조항별 좌우대비, 리포트 긍정-먼저 재설계.

**전제(실측):** Python 38 + JS 61 통과. checks: {id, check, severity, norm_type, basis, module, triggers, absence_check, sources:[{law,article,clause,quote,verified,status,text}], note}. 심각도 필수48/권장32/참고8. matcher v3 analyze→{checkpoints, results:[{cpId,tier,best,ranked}], matches, missing}. tier=confirmed/review/none. src 인라인 순서 sim→clause_role→matcher_config→segmenter→matcher→docx→app.

**용어 매핑(전 태스크 공통):** 내부 tier 값(confirmed/review/none)은 유지하되 **표시 라벨·의미만** 재정의 — confirmed→"짚음", review→"확인 권장", none+alarm게이트 통과→"검토 제안", none+비alarm→"기타"(조용). 또는 tier 값 자체를 addressed/verify/consider/quiet로 리네이밍(구현자 판단, 단 일관되게).

---

### Task A: 심각도 규범효력 기반 재도출 (지식+검증)

**Files:** Modify `build/validate.py`, `knowledge/common.yaml`, `knowledge/types/outsourcing.yaml`, `knowledge/schema.md`, `tests/`

- 규칙: severity = f(norm_type) — 강행→필수 / 임의→권장 / 추정·간주·선언→참고 / basis=practice→참고. (norm_type이 의무·금지 계열이면 강행으로 간주)
- **접근**: `severity`를 지식에 유지하되 규칙과 일치하도록 재계산해 갱신. 추가 필드 `severity_basis`(문자열, 예 "강행규정(의무) 근거") 를 각 check에 부여 — 지식에 명시하거나 build 도출. 규칙 예외(사람이 의도적으로 다르게)는 `severity_override: true` + 사유 note. 이번엔 규칙대로 전량 재계산 우선.
- validate.py: severity가 norm_type 도출 규칙과 불일치하고 override 없으면 경고(에러 아님) — 지식 작성 가드. severity_basis 필수화(있으면).
- 지식 재계산: 각 항목 severity를 규칙으로 재산정. 특히 계약기간·완전합의 등 저위험이 참고로 내려가는지 확인. norm_type이 강행인데 참고였던 것 등 이동 내역 기록.
- 검증: load_knowledge OK, enrich quote_ok 유지(변경 없음), pytest 회귀. severity 분포 before/after 보고.
- 커밋: "feat: 심각도 규범효력 기반 재도출 + severity_basis"

### Task B: matcher — 단일후보 강등 제거 + reason 정보형 + coverage 상태 (TDD)

**Files:** Modify `src/matcher.js`, `src/matcher_config.js`, `tests/matcher.test.js`

- **단일후보/단일신호 강등 제거**: decideTier에서 `ranked.length===1 → review` 및 `signals<2 → review` 강등 삭제. 짚음(confirmed)은 (인용일치) 또는 (score≥ABS && normMatch) 또는 (충분한 절대점수)로 도달. 단일 매칭도 근거 강하면 짚음.
- **weak-role 게이트는 유지**(목적·정의 조항 인용없음 → 확인권장). 이건 정당(도메인 유효).
- **coverage 상태 필드**: results[].tier를 confirmed/review/none 유지하되, `coverage: "addressed"|"verify"|"consider"|"quiet"` 파생 추가. consider = absence_check && none && **alarm게이트 통과**(severity 필수/권장 && 확실부재). quiet = none && 게이트 미통과. (스펙 B)
- **reason 정보형 재작성**: "제N조 본문과 문구 일치" / "핵심어 겹침(키워드…)" / "명시 인용 일치" / "관련 조항 있음 — 문구 확인 권장". "단일 후보/신호 — 검토필요" 삭제. `reasons` 배열.
- matches/missing 하위호환 유지. missing → coverage==="consider"로 재정의.
- 테스트 재작성: 단일후보가 강등 안 됨 / 강근거 단일매칭 addressed / weak-role 유지 / consider 게이트(저위험 부재는 quiet) / reason 문구 정보형 / 회귀. ~16개.
- 통합 스모크: 샘플로 coverage 분포 + "재위탁" 조항 짚음 수 + 계약기간 관련이 consider 아닌 quiet인지 보고.
- 커밋: "feat!: matcher — 단일후보 강등 제거·정보형 reason·coverage 상태"

### Task C: 가이드라인·자율규제 근거 배선 (지식)

**Files:** Modify `knowledge/types/outsourcing.yaml` (+common 해당시), 필요시 `build/config.py`/`build/enrich.py`

- klia_regulations.sqlite를 enrich의 조회 대상에 포함(이미 config.LAW_DBS에 있는지 확인; 없으면 추가). fsc_guidelines는 quote 앵커링 부적합 → 제외 또는 참고링크.
- 관련 check에 자율규제 source 추가: 예 업무위탁 관리·감독 항목에 "손해사정 업무위탁 및 손해사정사 선임 등에 관한 모범규준" 해당 조, 내부통제 항목에 "보험권 표준내부통제기준" 해당 조. **quote는 DB 원문 발췌**(법무 하네스: SELECT 후 발췌, verified:false).
- source에 `source_type: "law"|"self_regulation"` 구분 필드(선택) — UI 배지용.
- 검증: enrich quote_ok에 자율규제 건 포함, mismatch 0. 몇 개 항목에 배선했는지 보고.
- 커밋: "feat: 가이드라인·자율규제(klia) 근거 배선"

### Task D: UI — 3분류 라벨 + 조항별 좌우대비 (수동검증)

**Files:** Modify `src/app.js`, `src/style.css`

- 매칭 열 라벨: coverage 소비 — addressed "✓ 반영"(녹) / verify "◑ 확인 권장"(청) / consider "! 검토 제안"(주의) / quiet 접힘·연회색. 붉은 "✗ 미검출" 폐기.
- 정렬: consider → verify → addressed → quiet. addressed도 쉽게 보이게.
- 각 행 severity + severity_basis 한 줄 노출(툴팁/보조텍스트).
- **조항별 보기 좌우대비**: 조항 펼침 시 2열 — 좌 "반영된 검토항목"(그 조항이 addressed인 check들), 우 "추가 확인 제안"(verify/관련 check). CSS 그리드. 칸 축소+펼치기.
- reason 정보형 표시. 자율규제 source 배지 구분.
- 검증: node --check, DOM id 대조, 픽스처/실 analyze 시뮬레이션으로 라벨·좌우대비 렌더 확인.
- 커밋: "feat: UI — 검토 가이드 3분류 라벨·조항별 좌우대비"

### Task E: 리포트 긍정-먼저 워크시트 재설계 (수동검증)

**Files:** Modify `src/app.js`, `src/style.css`

- 상단 요약 타일: "짚어진 항목 N / 확인 권장 M / 검토 제안 K" (긍정 먼저). 실패목록 화법 제거.
- 검토 제안 목록: 각 항목에 severity_basis("왜 봐야 하는지") 병기. 대량 나열 대신 접힘·심각도순.
- 체크박스 → "검토자 확인(sign-off)"으로 라벨 명확화 + localStorage 유지, 또는 제거하고 sign-off만.
- 조항별 요약(반영/확인제안) 리포트에도 반영.
- 검증: node --check, DOM id, 시뮬레이션. 육안 확인은 Task F.
- 커밋: "feat: 리포트 — 긍정-먼저 검토 워크시트 재설계"

### Task F: 풀빌드 + 브라우저 E2E + 병합

- `python3 build/build_html.py` 풀빌드. pytest+node 회귀.
- Chrome E2E: 3분류 라벨·정렬, 계약기간이 검토제안 알람에서 빠졌는지, 조항 펼침 좌우대비, 심각도 근거 노출, 가이드라인 근거 표시, 리포트 긍정-먼저·거부감 감소, 외부요청 0.
- dist 커밋 "feat: Phase 2 Part2 완성 — 검토 가이드 재정의 (브라우저 검증)", main 병합, push.

---

## 실행 메모
- 순서 A→B(A의 severity 소비)→C→D(B·C 소비)→E→F. A·C는 지식, 병렬 가능하나 같은 파일(outsourcing.yaml) 만지면 충돌 — 순차 권장.
- 각 코드 태스크 후 2단계 리뷰. 특히 B(coverage 게이트)·D/E(화법)는 리뷰에서 "채점기 화법 잔재" 스캔.
- 지식 태스크(A·C)는 법무 하네스: severity_basis·자율규제 quote 모두 DB 원문 대조.
- 브랜치 phase2-advisor. dist는 F에서만.
