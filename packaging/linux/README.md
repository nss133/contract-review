# Linux 설치 준비 및 검증 절차

2026-09-21. Linux 공용 서버, Python 3.9·FastAPI, 별도 정적 프론트, 서버 로컬 SQLite, 동시 사용자 10명 이하를 기준으로 한다. 사용자는 세부 배포판·CPU를 알지 못한다고 답했으므로 직접 확인을 반복 요청하지 않고 preflight.py 결과로 선택한다.

현재 생성하는 묶음은 개발 검증용이다. 전체 분석·문서 추출·자동판정·검토 완료 기능이 API/화면에 연결되지 않았다. 설치 준비와 전체 앱의 실사용 완료를 구별한다. 설치 도구는 기본적으로 개발 묶음 설치를 거부하며, 분리한 시험 서버에서만 --development를 사용한다. Linux 실기 서비스 실행은 아직 검증하지 않았다.

## 1. 서버 담당자가 확인할 내용

서버에서 다음 명령은 설정을 변경하거나 외부 인터넷에 접속하지 않는다. Python 3.9가 없다면 먼저 서버 담당자가 해당 배포판에 맞는 Python 3.9와 venv/ensurepip를 설치해야 한다. Nginx와 systemd도 서버의 사내 패키지 경로로 준비한다. 이 앱 묶음은 Linux OS·Python 실행파일·Nginx·인증서를 포함하지 않는다.

    python3.9 linux/preflight.py > server-check.json

종료 코드 0과 ready_for_install=true를 모두 확인한다. 결과에는 배포판·CPU·Python·glibc·SQLite·서비스 도구의 준비 여부가 있으며 사용자명·호스트명·계약·비밀번호는 수집하지 않는다.

현재 의존성 잠금은 x86_64와 aarch64용 wheel을 준비한다. glibc 2.28 이상인 Linux를 설치 기준으로 제한하며, Alpine/musl과 오래된 glibc 서버는 이 묶음 대상이 아니다. argon2-cffi-bindings 25.1.0의 잠금 바이너리는 manylinux 2.26/2.28이고 나머지 네이티브 의존성도 해당 CPU로 분리한다. 최소 조건 통과만으로 특정 배포판의 실제 실행을 보증하지 않는다.

## 2. 인터넷 가능한 개발 장비에서 묶음 생성

backend/requirements.lock에 고정한 의존성을 --require-hashes와 --only-binary=:all:로 내려받는다. CPU를 x86_64 또는 aarch64로 선택하고 플랫폼 인수도 같은 CPU로 맞춘다. 아래는 x86_64 예시이다.

    python3 -m pip download --disable-pip-version-check --require-hashes --only-binary=:all: --python-version 3.9 --implementation cp --abi cp39 --abi abi3 --abi none --platform manylinux_2_28_x86_64 --platform manylinux_2_26_x86_64 --platform manylinux2014_x86_64 --platform manylinux_2_17_x86_64 -r backend/requirements.lock --dest .runtime/linux-x86_64/wheelhouse
    uv build backend --wheel --out-dir .runtime/wheels
    python3 tools/migration/build_linux_bundle.py --arch x86_64 --wheelhouse .runtime/linux-x86_64/wheelhouse --app-wheel .runtime/wheels/contract_review_api-0.1.0-py3-none-any.whl --output .runtime/linux-x86_64/bundle

생성기는 앱 wheel과 현재 소스의 일치, Linux CPU, 의존성 해시를 확인하고 프론트를 /api/v1 상대 경로로 새로 빌드한다. 파일별 manifest.json과 별도의 앱 wheel 잠금 파일을 생성한다. 기존 출력 경로를 덮어쓰지 않는다. 묶음을 ZIP으로 전달할 때는 ZIP의 SHA-256도 별도로 기록·대조한다. 내부 manifest는 전송 오류·변조 검사용이며 발신자 인증 서명을 대신하지 않는다.

## 3. 폐쇄망 시험 서버에 실행 환경 설치

선택한 묶음을 Linux 서버에 옮긴 후, 새 릴리스 경로에 설치한다. pip는 로컬 wheelhouse만 사용하고 해시가 고정된 wheel만 설치한다. 설치 경로를 나중에 이동하면 venv의 절대 경로가 달라지므로 처음부터 최종 경로를 사용한다. 실패한 경로는 자동 실행되지 않으며 다음 시도에는 새 경로를 쓴다.

    sudo python3.9 linux/install_runtime.py --bundle . --destination /opt/contract-review/releases/test-20260921 --development

설치 성공 시에도 서비스를 등록하거나 시작하지 않는다. 개발 검증이 끝나기 전에는 팀 실사용을 시작하지 않는다.

## 4. 서비스 계정·주소·인증서 설정

서버 담당자가 로그인 불가 서비스 계정 contract-review와 동일 이름의 그룹을 만든다. 데이터 경로 /var/lib/contract-review는 서비스 계정 소유 0700으로 만든다. 릴리스 코드·venv·프론트는 관리자 소유로 두고 서비스 계정에 수정권한을 주지 않는다. Nginx는 프론트 파일만 읽을 수 있어야 한다. DB 파일은 NFS/SMB 공유폴더에 두지 않는다.

시험할 사내 HTTPS 주소로 설정 파일을 생성한다. 아래 주소는 예시이며 실제 사내 DNS와 인증서에 맞춘다. 출력 디렉터리도 새 경로여야 한다.

    python3.9 linux/configure.py --origin https://contracts.example.internal --output ./rendered

- rendered/contract-review.env → /etc/contract-review/contract-review.env, 관리자 소유 0600.
- rendered/contract-review-api.service → /etc/systemd/system/contract-review-api.service.
- rendered/nginx.conf → 기존 Nginx의 http 문맥에 포함되는 개별 설정 파일. 서버의 다른 사이트 설정은 덮어쓰지 않는다.
- 회사가 발급한 인증서와 키 → /etc/contract-review/tls/server.crt, server.key. 키는 관리자만 읽게 한다. 팀 PC가 해당 사내 CA를 신뢰해야 한다.
- /opt/contract-review/current → 시험할 새 릴리스 경로의 심볼릭 링크. 이전 릴리스 경로는 보존한다.

API는 127.0.0.1:8766에서만 듣고 Nginx가 정적 프론트 및 /api/v1을 같은 HTTPS 주소로 제공한다. DB/API를 팀원 PC에 직접 공개하지 않는다. 사용자에게는 브라우저 주소만 제공한다. 사내 방화벽은 승인된 팀 접근 범위에 HTTPS를 허용한다. SELinux 환경은 정책에 따라 Nginx의 로컬 API 연결과 정적 파일 읽기를 허용하며, SELinux를 통째로 끄지 않는다.

초기 관리자 발급 계정은 서버 터미널에서 만든다. 아래의 사용자 이름은 실제 계정명으로 바꾼다. 비밀번호는 숨김 입력이며 명령행 인수나 문서에 기록하지 않는다.

    sudo -u contract-review env CR_ENV=production CR_DATABASE_PATH=/var/lib/contract-review/contract-review.sqlite CR_FRONTEND_ORIGIN=https://contracts.example.internal /opt/contract-review/current/venv/bin/python -m app.cli init-db
    sudo -u contract-review env CR_ENV=production CR_DATABASE_PATH=/var/lib/contract-review/contract-review.sqlite CR_FRONTEND_ORIGIN=https://contracts.example.internal /opt/contract-review/current/venv/bin/python -m app.cli create-user reviewer-name

서버 담당자가 설정 문법을 검사하고, 분리한 시험 환경의 서비스를 시작한다.

    sudo nginx -t
    sudo systemd-analyze verify /etc/systemd/system/contract-review-api.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now contract-review-api
    sudo systemctl reload nginx

## 5. DB 백업·복원

현재 DB 백업은 users·reviews·opinion_drafts·접근권한·감사 기록을 함께 포함한다. SQLite backup API로 WAL까지 일관된 스냅샷을 만든다. 현재 파일 첨부 저장은 미구현이므로 이 형식은 SQLite만 포함한다. 첨부 기능을 추가할 때 원문 파일 백업도 확장해야 한다.

백업 경로는 접근을 제한한 서버 로컬 디스크에 둔다. 날짜·시각별 새 디렉터리를 지정한다. 백업에는 계약 원문과 계정 해시가 들어 있으므로 개발 코드 ZIP이나 메일용 설치 묶음에 넣지 않는다. 외부 보관 주기·보존기간은 서버 운영자가 정한다.

    sudo -u contract-review env CR_DATABASE_PATH=/var/lib/contract-review/contract-review.sqlite /opt/contract-review/current/venv/bin/python -m app.cli backup-db /var/lib/contract-review/backups/20260921-1800

복원 명령은 기존 DB와 WAL·SHM이 있는 경로에 쓰지 않는다. 새 경로에 복원한 후 행 수·샘플 본문·의견·권한을 확인한다. 복원된 DB에서는 모든 기존 로그인 세션을 없앤다. 같은 앱 스키마 버전으로 복원해야 한다.

    sudo -u contract-review /opt/contract-review/current/venv/bin/python -m app.cli restore-db /var/lib/contract-review/backups/20260921-1800 /var/lib/contract-review/recovered.sqlite

실제 전환 시에는 서비스를 중지하고 환경 파일의 DB 경로를 검증한 새 파일로 변경한 뒤 서비스를 시작한다. 원래 DB와 백업은 보존한다. 코드만 이전 버전으로 돌려도 DB 스키마가 자동으로 내려가지 않으므로 코드·해당 스키마 백업을 함께 복구 대상으로 선택한다.

## 6. Linux 실기 인수검사

인터넷 연결 없이 새 경로 설치, pip check, API ready, 사내 HTTPS 로그인과 Secure 쿠키, 본문·의견 저장, 다른 사용자의 접근 차단, 동시 사용자 10명 저장, 서비스 재시작 후 복원, 백업 복원, 브라우저 외부 요청 0건을 기록한다. 전체 분석·파일 추출·판정·완료·자료 이관 검증도 별도로 통과해야 실사용 패키지라고 표시할 수 있다.

이 장비의 테스트 결과는 macOS ARM64·실제 Python 3.9 기반이다. Linux wheel의 다운로드·해시 검사와 macOS에서의 단위시험은 Linux 서비스 실행 성공을 대신하지 않는다.

설정 근거: [Nginx proxy_pass 공식 문서](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass), [pip 대상 플랫폼 다운로드](https://pip.pypa.io/en/stable/cli/pip_download/), [Python 3.9 SQLite backup](https://docs.python.org/3.9/library/sqlite3.html#sqlite3.Connection.backup).
