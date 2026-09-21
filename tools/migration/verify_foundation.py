"""Reproducible browser check using two task-owned servers and synthetic SQLite."""
import argparse
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time

from app.auth.service import create_user
from app.repositories.database import Database

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chrome-path', help='Existing Chrome/Chromium executable')
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 9):
        parser.error('Run using the backend Python 3.9 environment')
    (ROOT / '.runtime').mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix='foundation-', dir=ROOT / '.runtime'))
    db = Database(run / 'synthetic.sqlite')
    db.initialize()
    password = secrets.token_urlsafe(24)
    create_user(db, 'browser-reviewer', password)
    env = dict(os.environ, CR_ENV='test', CR_DATABASE_PATH=str(run / 'synthetic.sqlite'),
               CR_FRONTEND_ORIGIN='http://127.0.0.1:18765', CR_TEST_PASSWORD=password)
    if args.chrome_path:
        env['CR_CHROME_PATH'] = args.chrome_path
    # Fail if either port is occupied; never attach to somebody else's service.
    for port in (18765, 18766):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
    subprocess.run([sys.executable, str(ROOT / 'frontend/build.py'), '--api-base', 'http://127.0.0.1:18766/api/v1'], check=True, cwd=ROOT)
    commands = [
        [sys.executable, '-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1', '--port', '18766'],
        [sys.executable, '-m', 'http.server', '18765', '--bind', '127.0.0.1', '--directory', str(ROOT / 'frontend/dist')],
    ]
    processes, logs = [], []
    try:
        for index, command in enumerate(commands):
            log = (run / ('server-%d.log' % index)).open('w')
            logs.append(log)
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=log)
            processes.append(process)
            deadline = time.monotonic() + 15
            port = (18766, 18765)[index]
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Dedicated test server failed; see ' + str(run))
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=0.3):
                        break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Dedicated test server timed out')
                    time.sleep(0.1)
        subprocess.run([sys.executable, str(ROOT / 'tools/migration/test_browser.py')], env=env, cwd=ROOT, check=True)
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for log in logs:
            log.close()


if __name__ == '__main__':
    main()
