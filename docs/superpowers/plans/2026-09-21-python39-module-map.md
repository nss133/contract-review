# Python 전환 소스 대응표

작성일: 2026-09-21. 기준 커밋: 4a2e5f195ae9cd23f46bd24cf3ff034453391d80.

현재 src/ 파일 92개(JS 88개, HTML 2개, CSS 2개)의 이전 방향이다. 대응표는 설계 분류이며 개별 함수 분리·동작 이식 완료를 의미하지 않는다. app.js와 UI 이름의 파일에도 계산·저장 코드가 섞여 있으므로 S0에서 함수별 경계를 확정한다. 최종 UI는 유지하고 권한 있는 판정·저장은 Python 3.9/FastAPI로 이전한다.

[실행계획](2026-09-21-python39-fastapi-migration.md) · [설계](../specs/2026-09-21-python39-fastapi-design.md)

| 현재 파일 | 이전 영역 | 단계 | 대상 경로 | 처리 기준 |
|---|---|---|---|---|
| [action_router.js](../../../src/action_router.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [agreement_evidence.js](../../../src/agreement_evidence.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [agreement_judgment.js](../../../src/agreement_judgment.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [analysis_runtime.js](../../../src/analysis_runtime.js) | 혼합 책임 분리 | S2/S5/S6 | frontend/src/ + backend/app/services/ | 화면·진행·편집 상태만 프론트, 분석·판정·완료·저장·AI 중계는 서버 |
| [analysis_worker.js](../../../src/analysis_worker.js) | 분석 작업 | S7 | backend/app/jobs/ | 메시지·취소·진행을 API 작업으로 이전, 운영 JS Worker 엔진 제거 |
| [app.js](../../../src/app.js) | 혼합 책임 분리 | S2/S5/S6 | frontend/src/ + backend/app/services/ | 화면·진행·편집 상태만 프론트, 분석·판정·완료·저장·AI 중계는 서버 |
| [assessment.js](../../../src/assessment.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [auto_pilot.js](../../../src/auto_pilot.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [auto_pilot_ui.js](../../../src/auto_pilot_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/auto_pilot_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [auto_safety.js](../../../src/auto_safety.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [cfb.js](../../../src/cfb.js) | 문서 추출 | S4 | backend/app/domain/extraction/ | 형식별 Python 3.9 파서 검증, 원문·표·경계·위치 보존 |
| [check_groups.js](../../../src/check_groups.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [checklist_presentation.js](../../../src/checklist_presentation.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/checklist_presentation.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [clause_equivalence.js](../../../src/clause_equivalence.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [clause_role.js](../../../src/clause_role.js) | 분류·태그·매칭 | S4 | backend/app/domain/matching/ | 규칙·순서·점수·범위 비교, 태그 브리지 Python 구현 포함 |
| [clause_semantics.js](../../../src/clause_semantics.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [compare.js](../../../src/compare.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [contract_tags.js](../../../src/contract_tags.js) | 분류·태그·매칭 | S4 | backend/app/domain/matching/ | 규칙·순서·점수·범위 비교, 태그 브리지 Python 구현 포함 |
| [decision_evaluation.js](../../../src/decision_evaluation.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [decision_evidence.js](../../../src/decision_evidence.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [decision_references.js](../../../src/decision_references.js) | 참고 검색 | S6 | backend/app/domain/references/ | 검색 순위·출처·자기계약 제외·권한별 색인 유지 |
| [document_structure.js](../../../src/document_structure.js) | 문서 구조 | S4 | backend/app/domain/structure/ | 구조·분할·형식 결과 이전, integrity의 제외된 자동경고는 재활성화하지 않음 |
| [eval_batch.js](../../../src/eval_batch.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [eval_batch_ui.js](../../../src/eval_batch_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/eval_batch_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [eval_operational.js](../../../src/eval_operational.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [eval_operational_ui.js](../../../src/eval_operational_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/eval_operational_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [eval_prepare.js](../../../src/eval_prepare.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [eval_prepare_ui.js](../../../src/eval_prepare_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/eval_prepare_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [eval_resolve_ui.js](../../../src/eval_resolve_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/eval_resolve_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [eval_trial.js](../../../src/eval_trial.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [eval_trial_ui.js](../../../src/eval_trial_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/eval_trial_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [evidence.js](../../../src/evidence.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [evidence_rules.js](../../../src/evidence_rules.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [experiment.js](../../../src/experiment.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [extract-doc.js](../../../src/extract-doc.js) | 문서 추출 | S4 | backend/app/domain/extraction/ | 형식별 Python 3.9 파서 검증, 원문·표·경계·위치 보존 |
| [extract-hwp.js](../../../src/extract-hwp.js) | 문서 추출 | S4 | backend/app/domain/extraction/ | 형식별 Python 3.9 파서 검증, 원문·표·경계·위치 보존 |
| [extract-pdf.js](../../../src/extract-pdf.js) | 문서 추출 | S4 | backend/app/domain/extraction/ | 형식별 Python 3.9 파서 검증, 원문·표·경계·위치 보존 |
| [extract-zip.js](../../../src/extract-zip.js) | 문서 추출 | S4 | backend/app/domain/extraction/ | 형식별 Python 3.9 파서 검증, 원문·표·경계·위치 보존 |
| [extract.js](../../../src/extract.js) | 문서 추출 | S4 | backend/app/domain/extraction/ | 형식별 Python 3.9 파서 검증, 원문·표·경계·위치 보존 |
| [findings.js](../../../src/findings.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [formal.js](../../../src/formal.js) | 문서 구조 | S4 | backend/app/domain/structure/ | 구조·분할·형식 결과 이전, integrity의 제외된 자동경고는 재활성화하지 않음 |
| [goldset.js](../../../src/goldset.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [history_assist.js](../../../src/history_assist.js) | 참고 검색 | S6 | backend/app/domain/references/ | 검색 순위·출처·자기계약 제외·권한별 색인 유지 |
| [history_eval.js](../../../src/history_eval.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [history_eval_ui.js](../../../src/history_eval_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/history_eval_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [human_precedent.js](../../../src/human_precedent.js) | 참고 검색 | S6 | backend/app/domain/references/ | 검색 순위·출처·자기계약 제외·권한별 색인 유지 |
| [integrity.js](../../../src/integrity.js) | 문서 구조 | S4 | backend/app/domain/structure/ | 구조·분할·형식 결과 이전, integrity의 제외된 자동경고는 재활성화하지 않음 |
| [judgment_hints.js](../../../src/judgment_hints.js) | 참고 검색 | S6 | backend/app/domain/references/ | 검색 순위·출처·자기계약 제외·권한별 색인 유지 |
| [judgment_policy.js](../../../src/judgment_policy.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [judgment_sources.js](../../../src/judgment_sources.js) | 참고 검색 | S6 | backend/app/domain/references/ | 검색 순위·출처·자기계약 제외·권한별 색인 유지 |
| [launcher.html](../../../src/launcher.html) | 배포 교체 | S8 | packaging/ | 기존 실행기는 구형 이관·복구용 보존, 새 제품은 사내 웹 주소 접속 |
| [legal_constraints.js](../../../src/legal_constraints.js) | 분류·태그·매칭 | S4 | backend/app/domain/matching/ | 규칙·순서·점수·범위 비교, 태그 브리지 Python 구현 포함 |
| [legal_opinion_knowledge.js](../../../src/legal_opinion_knowledge.js) | 영구저장·자료 모델 | S3/S6 | backend/app/repositories/ + backend/app/services/ | 구형 교환 포맷 보존, SQLite·사용자/팀 귀속·서버 파일 관리 |
| [local_llm.js](../../../src/local_llm.js) | 혼합 책임 분리 | S2/S5/S6 | frontend/src/ + backend/app/services/ | 화면·진행·편집 상태만 프론트, 분석·판정·완료·저장·AI 중계는 서버 |
| [loop.js](../../../src/loop.js) | 영구저장·자료 모델 | S3/S6 | backend/app/repositories/ + backend/app/services/ | 구형 교환 포맷 보존, SQLite·사용자/팀 귀속·서버 파일 관리 |
| [matcher.js](../../../src/matcher.js) | 분류·태그·매칭 | S4 | backend/app/domain/matching/ | 규칙·순서·점수·범위 비교, 태그 브리지 Python 구현 포함 |
| [matcher_config.js](../../../src/matcher_config.js) | 분류·태그·매칭 | S4 | backend/app/domain/matching/ | 규칙·순서·점수·범위 비교, 태그 브리지 Python 구현 포함 |
| [motion.js](../../../src/motion.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/motion.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [pf.js](../../../src/pf.js) | 문서 추출 | S4 | backend/app/domain/extraction/ | 형식별 Python 3.9 파서 검증, 원문·표·경계·위치 보존 |
| [presence_profiles.js](../../../src/presence_profiles.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [registered_presence.js](../../../src/registered_presence.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [report_layout.js](../../../src/report_layout.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/report_layout.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [requirement_rules.js](../../../src/requirement_rules.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [review_core.js](../../../src/review_core.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [review_groups.js](../../../src/review_groups.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [review_history.js](../../../src/review_history.js) | 영구저장·자료 모델 | S3/S6 | backend/app/repositories/ + backend/app/services/ | 구형 교환 포맷 보존, SQLite·사용자/팀 귀속·서버 파일 관리 |
| [review_replay.js](../../../src/review_replay.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [safety_digest.js](../../../src/safety_digest.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [safety_eval.js](../../../src/safety_eval.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [safety_eval_ui.js](../../../src/safety_eval_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/safety_eval_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [safety_runtime.js](../../../src/safety_runtime.js) | 혼합 책임 분리 | S2/S5/S6 | frontend/src/ + backend/app/services/ | 화면·진행·편집 상태만 프론트, 분석·판정·완료·저장·AI 중계는 서버 |
| [safety_workbench.js](../../../src/safety_workbench.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [safety_workbench_ui.js](../../../src/safety_workbench_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/safety_workbench_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [scope_assessment.js](../../../src/scope_assessment.js) | 분류·태그·매칭 | S4 | backend/app/domain/matching/ | 규칙·순서·점수·범위 비교, 태그 브리지 Python 구현 포함 |
| [segmenter.js](../../../src/segmenter.js) | 문서 구조 | S4 | backend/app/domain/structure/ | 구조·분할·형식 결과 이전, integrity의 제외된 자동경고는 재활성화하지 않음 |
| [sentence.js](../../../src/sentence.js) | 문서 구조 | S4 | backend/app/domain/structure/ | 구조·분할·형식 결과 이전, integrity의 제외된 자동경고는 재활성화하지 않음 |
| [sim.js](../../../src/sim.js) | 분류·태그·매칭 | S4 | backend/app/domain/matching/ | 규칙·순서·점수·범위 비교, 태그 브리지 Python 구현 포함 |
| [standard_auto.js](../../../src/standard_auto.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [standard_auto_archive.js](../../../src/standard_auto_archive.js) | 영구저장·자료 모델 | S3/S6 | backend/app/repositories/ + backend/app/services/ | 구형 교환 포맷 보존, SQLite·사용자/팀 귀속·서버 파일 관리 |
| [standard_auto_ui.js](../../../src/standard_auto_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/standard_auto_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [structure_review.js](../../../src/structure_review.js) | 혼합 책임 분리 | S2/S5/S6 | frontend/src/ + backend/app/services/ | 화면·진행·편집 상태만 프론트, 분석·판정·완료·저장·AI 중계는 서버 |
| [style.css](../../../src/style.css) | 프론트 표시 | S2 | frontend/assets/style.css | CSS 구성·색상·인쇄 유지 |
| [tags.js](../../../src/tags.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |
| [template.html](../../../src/template.html) | 프론트 표시 | S2 | frontend/src/index.html | DOM·문구 보존, 데이터/엔진 인라인 주입 제거 |
| [template_assist.js](../../../src/template_assist.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [template_fields.js](../../../src/template_fields.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [template_library.js](../../../src/template_library.js) | 영구저장·자료 모델 | S3/S6 | backend/app/repositories/ + backend/app/services/ | 구형 교환 포맷 보존, SQLite·사용자/팀 귀속·서버 파일 관리 |
| [template_library_ui.js](../../../src/template_library_ui.js) | 프론트 표시/어댑터 | S2/S6 | frontend/src/template_library_ui.js | 렌더링·이벤트 보존, 판정·저장·평가 계산은 API 호출 |
| [template_register.js](../../../src/template_register.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [ui_layout.css](../../../src/ui_layout.css) | 프론트 표시 | S2 | frontend/assets/ui_layout.css | CSS 구성·색상·인쇄 유지 |
| [verdict.js](../../../src/verdict.js) | 판정·표준·검토 | S5 | backend/app/domain/judgment/ | 순수 규칙 Python 이전, 저장/화면 부수효과는 서비스/프론트 분리 |
| [verify.js](../../../src/verify.js) | 평가·검수·관리 | S6 | backend/app/domain/evaluation/ | 평가 규칙·판정 관측·교환 형식 이전, 표시 부분은 프론트 분리 |

## src 외 필수 이전 대상

| 현재 자산 | 처리 |
|---|---|
| vendor/contract-tag-engine.js, .cjs, taxonomy, manifest | S4에서 규칙·프로필을 Python으로 구현하고 JS 결과와 비교. 운영 Node 의존 금지 |
| knowledge/*.yaml, knowledge/types/, 정책·개정 JSON | 원천·체크 ID·정책 의미 보존. 백엔드가 버전 있는 지식팩으로 읽고 프론트에는 표시 데이터 제공 |
| data/law_snapshot.sqlite 및 공개 법령 스냅샷 | 운영 사용자 DB와 별개인 읽기 전용 근거 자산으로 보존. SQLite 전환을 이유로 법령 인용을 변경하지 않음 |
| build/build_html.py, enrich.py, validate.py | 구형 빌드는 기준선용 보존. 지식 생성·검증을 Python 3.9 호환 도구로 분리하고 프론트/API를 별도 패키징 |
| build/serve_local.py | 선택형 Ollama 검증·중계 로직을 FastAPI 서비스로 이전. 팀원 PC 대신 서버/허용 사내 모델 주소 연결 |
| tests/*.test.js, tests/goldset/, build/test_*.mjs | 기존 JS는 비교 기준. Python 단위·API·동등성, 프론트 UI·통합 시험을 추가. 기존 테스트 수를 새 엔진 검증으로 대체 주장하지 않음 |
| schemas/cr-review-history-pack-v1.schema.json | 기존 교환 형식 유지. 새 API·DB 스키마와 명시적인 매핑 작성 |
| dist/의 HTML·.crupdate·ZIP | 구형 복구·비교 기준으로 보존. 새 서버 릴리스는 별도 프론트/API/DB manifest로 배포 |
| 브라우저 localStorage·IndexedDB | 기존 origin 내보내기 → bundle 검증 → 사용자/팀별 귀속 → 서버 DB 이관. 다른 사용자와 자동 공개/병합 금지 |
| prototypes/ | 참고 시안으로 보존. 새 기능이나 화면의 기준으로 채택하지 않음 |

## 새로 필요한 공용 서버 구성

backend/app/auth/의 세션·역할·계약 ACL, SQLite 마이그레이션·감사 이벤트, 작업 lease·heartbeat, 정적 웹서버/역방향 프록시·HTTPS, 서버 서비스 관리와 백업/복원은 기존 파일의 단순 이동으로 생기지 않는다. S1·S3·S7·S8에서 각각 구현·검증한다.
