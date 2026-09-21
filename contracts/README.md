# 전환 비교 기준과 API 계약

- openapi.json: 현재 구현된 FastAPI API 계약. backend의 export-openapi 명령으로 재생성한다.
- fixtures/baseline-manifest.json: v1.90.8 기준 커밋·HTML/엔진·소스 해시.
- fixtures/ui-inventory.json: 기존 정적 컨트롤과 탭 목록.
- fixtures/storage-inventory.json: 저장소 참조와 교환 형식의 정적 조사. 동적 키 전체를 검증한 완성 이관 명세는 아니다.
- fixtures/feature-boundaries.json: app.js의 분석·자동판정·수기 의견·완료·저장 함수와 Python 이전 책임.
- fixtures/legacy-compat.json: 원문 해시와 UTF-16 길이의 JavaScript 기준 결과.
- fixtures/legacy-presence.json: 기존 합성 수용 사례 61개의 입력·구조·판정·근거·자동 티켓·수기 정규화 결과.
- fixtures/legacy-worker.json: 선택 체크 8개·합성 문서 3종의 실제 기존 Worker 입력·출력. 전체 체크·UI 생명주기 검증을 대체하지 않는다.
- ui-baseline/: 합성 계약을 사용한 기존 화면의 폭별·인쇄 기준 이미지.

현재 자료는 공개 내장 지식과 합성 사례만 포함한다. 실제 사용자 브라우저 저장소나 비공개 계약을 읽지 않는다. 캡처 도구는 승인된 v1.90.8 HTML 해시와 다르면 중단한다. 비교 기준을 새 구현 결과로 자동 갱신하지 않는다.

    backend/.venv/bin/python tools/migration/export_baseline.py
    node tools/migration/capture_legacy.cjs
    backend/.venv/bin/python tools/migration/verify_foundation.py --chrome-path /설치된/Chrome/실행파일

브라우저 검사는 별도 합성 SQLite와 두 서버 프로세스를 만들어 실행한 뒤 서버를 종료한다. 기존 화면 캡처는 ui-baseline에, 개발판 화면과 검사 결과는 Git에서 제외한 .runtime/browser에 기록한다.

자동판정 결과는 JS 기준 엔진을 두 번 실행하여 결정성을 확인했다. Python 판정 엔진의 동등성을 통과했다는 뜻은 아니다. S4·S5에서 Python 출력과 대조한다. 실행 시점·임의 ID를 제외하기로 한 필드는 향후 비교 명세에 별도로 기록한다.
