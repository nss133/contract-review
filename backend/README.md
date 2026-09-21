# Python 3.9 FastAPI 개발 기반

현재는 전환 개발판이다. 로그인·계약별 접근권한·공개 체크리스트 조회·본문/개인 의견 초안 저장까지 구현했다. 기존 전체 분석 엔진·파일 추출·완료·자료 이관·평가 기능은 아직 이전하지 않았다. capabilities에 미구현 기능을 false로 응답하고 분석 호출은 501을 반환한다.

Python 3.9.25, FastAPI 0.128.8, 서버 로컬 SQLite, 동시 사용자 10명 이하를 기준으로 개발한다. 프론트 정적 파일은 frontend/에서 독립 빌드한다. API는 HTML·CSS·JS를 제공하지 않는다.

## 설치와 실행

프로젝트 루트에서 실행한다. uv.lock은 Python 3.9만 허용하며 requirements.lock과 requirements-test.lock에는 해시를 포함한 의존성이 고정되어 있다.

    uv sync --project backend --all-extras --frozen
    export CR_DATABASE_PATH=/절대경로/서버로컬디스크/contract-review.sqlite
    export CR_ENV=development
    export CR_FRONTEND_ORIGIN=http://127.0.0.1:8765
    backend/.venv/bin/python -m app.cli init-db
    backend/.venv/bin/python -m app.cli create-user reviewer-name
    backend/.venv/bin/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8766 --workers 1

create-user는 터미널에서 비밀번호를 숨겨 입력받으며 계정은 공개 회원가입으로 만들지 않는다. --role은 operator, knowledge_manager, reviewer, reader 중 지정한다. 기본은 reviewer이다. operator 역할은 계정 운영 역할이며 타인의 계약을 읽는 우회권한이 아니다. 현재 계정 생성은 서버 CLI에서 수행한다.

DB는 서버 로컬 디스크에 두고 서비스 계정만 디렉터리에 접근하게 한다. SQLite는 WAL과 짧은 쓰기 트랜잭션을 사용한다. NFS/SMB/공유폴더에 DB 파일을 두지 않는다. 팀원 PC에는 Python이나 SQLite를 설치할 필요가 없다.

운영 설정은 CR_ENV=production과 HTTPS인 CR_FRONTEND_ORIGIN을 요구한다. production은 배포를 완료했다는 표시가 아니며 현재 개발판을 팀 운영에 사용하지 않는다. 원문 파일·전체 백업·자료 이관·계정관리 화면·분석 엔진은 후속 단계이다.

## 확인

    backend/.venv/bin/python -m pytest backend/tests -q
    backend/.venv/bin/python -m app.cli export-openapi contracts/openapi.json

GET /api/v1/health는 프로세스 생존과 저장소 준비를 표시한다. scope=foundation은 기초 서비스 범위만 준비됨을 뜻한다. GET /api/v1/ready는 DB가 없으면 503이다. /me, /catalog, /capabilities와 검토 데이터는 인증이 필요하다. 쓰기 요청에는 세션 쿠키·Origin·X-CSRF-Token을 함께 사용한다.

현재 API 오류는 원문·비밀번호·DB 경로를 응답에 넣지 않는다. SQLite 잠금은 503과 retryable=true로, 오래된 편집 revision은 409로 반환한다. 본문 저장과 개인별 의견 초안은 실제 SQLite에 저장되며 전체 법무 검토 완료와는 구별한다.

배포 OS가 아직 미확정이므로 대상 서버용 오프라인 wheelhouse·서비스 등록·HTTPS·백업 복원은 배포 검증에서 별도로 확인해야 한다.
