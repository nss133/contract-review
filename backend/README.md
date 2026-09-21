# Python 3.9 FastAPI 개발 기반

로그인·계약별 권한·원문 파일 추출·Python 원문 매칭·현재 약정 자동판정·항목별 수기 의견·최종 검토 완료 및 재조회까지 연결했다. TXT/PDF/DOCX/HWPX/DOC/HWP를 읽으며 원본 파일과 추출 결과를 SQLite에 함께 보관한다. 분석·추출·자동판정·완료 capability는 true다. 과거 판단·등록 표준 재사용, 구형 자료 이관, 평가·관리·로컬 AI 화면은 아직 전환 중이다. 상세 검증과 범위는 [핵심 검토 흐름 기록](../docs/2026-09-21-python39-automatic.md)을 확인한다.

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

운영 설정은 CR_ENV=production과 HTTPS인 CR_FRONTEND_ORIGIN을 요구한다. production은 배포를 완료했다는 표시가 아니며 현재 개발판을 팀 운영에 사용하지 않는다. 실제 Linux 서비스 실행과 과거 판단 재사용·자료 이관·계정관리 화면의 완료는 별도 검증 대상이다.

## 확인

    backend/.venv/bin/python -m pytest backend/tests -q
    backend/.venv/bin/python -m app.cli export-openapi contracts/openapi.json

GET /api/v1/health는 프로세스 생존과 저장소 준비를 표시한다. scope=review_workflow는 핵심 수기 검토 흐름이 연결됐음을 뜻하며 전체 기존 기능의 동등성을 뜻하지 않는다. GET /api/v1/ready는 DB가 없으면 503이다. /me, /catalog, /capabilities와 검토 데이터는 인증이 필요하다. 쓰기 요청에는 세션 쿠키·Origin·X-CSRF-Token을 함께 사용한다.

현재 API 오류는 원문·비밀번호·DB 경로를 응답에 넣지 않는다. SQLite 잠금은 503과 retryable=true로, 오래된 편집 revision은 409로 반환한다. 원문·분석·항목별 의견·종합 초안·완료 스냅샷은 SQLite에 저장된다. 완료 시 현재 분석, 모든 대상 항목의 저장 여부, 항목별 revision, 원본 대조 확인을 서버에서 검사한다.

배포 OS는 Linux로 확정됐다. 배포판·CPU는 사용자가 알지 못하므로 [Linux 설치 점검 도구](../packaging/linux/README.md)로 확인한다. x86_64/aarch64·glibc 2.28 이상 대상 의존성 묶음과 systemd/Nginx 설정을 준비하며 실제 Linux 서비스 실행은 별도 검증해야 한다.

현재 SQLite 데이터는 CLI의 backup-db 출력디렉터리, restore-db 백업디렉터리 새DB경로로 백업·복원할 수 있다. WAL 포함 스냅샷, 해시·무결성·스키마 검사, 기존 DB 덮어쓰기 방지, 복원 시 세션 폐기를 적용한다. 첨부 원본 BLOB·분석·완료 스냅샷도 같은 DB에 있어 함께 복원된다. 첨부 해제 후에도 이전 완료 기록이 참조한 원본을 보존한다.
