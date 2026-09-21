# 분리 프론트 개발 기반

현재 화면의 HTML·CSS와 컨트롤 ID를 유지한 정적 프론트이다. 로그인·저장된 본문 초안 조회·본문 초안 저장만 연결되어 있다. 미이전 기능은 비활성 상태이며 기존 JavaScript 분석 엔진을 우회 실행하지 않는다. 전체 전환 완료판이 아니다.

프로젝트 루트에서 개발용으로 실행한다.

    backend/.venv/bin/python frontend/build.py --api-base http://127.0.0.1:8766/api/v1
    backend/.venv/bin/python -m http.server 8765 --bind 127.0.0.1 --directory frontend/dist

운영 빌드는 --api-base를 생략하면 /api/v1을 사용한다. 정적 웹서버가 frontend/dist를 제공하고 /api/v1은 별도 FastAPI 프로세스로 전달한다. 위 http.server는 개발용이며 공용 서버의 HTTPS 웹서버를 대체하지 않는다.

    node --test frontend/tests/*.test.mjs

Node는 개발 시험에만 사용하며 제품 실행에 필요하지 않다. 정적 파일에는 사용자 저장자료·계약 분석 엔진·지식 원문 JSON을 포함하지 않는다. API 설정에는 자격정보를 넣지 않는다.
