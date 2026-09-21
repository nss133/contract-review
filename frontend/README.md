# 분리 프론트 개발 기반

현재 화면의 HTML·CSS와 컨트롤 ID를 유지한 정적 프론트이다. 파일 열기·본문 추출·계약 분석·현재 원문 자동판정과 근거 표시·항목별 의견 저장·최종 완료 리포트·저장 기록 재조회·JSON 내보내기를 FastAPI에 연결했다. 원문과 조건이 변경되면 재분석을 요구하고, 기존 의견을 보존한 채 재확인을 요청한다. 미이전 기능은 비활성 상태이며 기존 JavaScript 분석 엔진을 우회 실행하지 않는다. 전체 전환 완료판이 아니다.

프로젝트 루트에서 개발용으로 실행한다.

    backend/.venv/bin/python frontend/build.py --api-base http://127.0.0.1:8766/api/v1
    backend/.venv/bin/python -m http.server 8765 --bind 127.0.0.1 --directory frontend/dist

운영 빌드는 --api-base를 생략하면 /api/v1을 사용한다. 정적 웹서버가 frontend/dist를 제공하고 /api/v1은 별도 FastAPI 프로세스로 전달한다. 위 http.server는 개발용이며 공용 서버의 HTTPS 웹서버를 대체하지 않는다.

    node --test frontend/tests/*.test.mjs

Node는 개발 시험에만 사용하며 제품 실행에 필요하지 않다. 정적 파일에는 사용자 저장자료·계약 분석 엔진·지식 원문 JSON을 포함하지 않는다. API 설정에는 자격정보를 넣지 않는다.
