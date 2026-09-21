"""Install a verified offline bundle into a NEW directory; never start services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

from preflight import check


def verify(bundle):
    bundle = Path(bundle).resolve()
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format') != 'contract-review-linux-v1' or not isinstance(manifest.get('files'), dict):
        raise ValueError('Unsupported bundle manifest')
    for name, digest in manifest['files'].items():
        path = bundle / name
        if (Path(name).is_absolute() or '..' in Path(name).parts or path.is_symlink()
                or bundle not in path.resolve().parents or not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != digest):
            raise ValueError('Bundle integrity check failed: ' + name)
    actual = {p.relative_to(bundle).as_posix() for p in bundle.rglob('*') if p.is_file() and p != bundle / 'manifest.json'}
    if actual != set(manifest['files']):
        raise ValueError('Bundle contains unexpected or missing files')
    if manifest.get('architecture') not in ('x86_64', 'aarch64'):
        raise ValueError('Unsupported bundle architecture')
    if not {'requirements.lock', 'app-requirements.lock', 'frontend/index.html', 'frontend/config.json'} <= actual:
        raise ValueError('Incomplete application bundle')
    config = json.loads((bundle / 'frontend/config.json').read_text(encoding='utf-8'))
    if config != {'apiBase': '/api/v1', 'apiVersion': '1'}:
        raise ValueError('Frontend must use the same-origin API')
    return manifest


def install(bundle, destination, allow_development=False):
    bundle = Path(bundle).resolve()
    manifest = verify(bundle)
    if manifest.get('release_status') != 'production' and not allow_development:
        raise ValueError('This is a development bundle. For an isolated acceptance environment only, use --development')
    report = check(manifest['architecture'])
    if not report['ready_for_install']:
        raise ValueError(json.dumps(report, ensure_ascii=False))
    destination = Path(destination).absolute()
    destination.mkdir(parents=True, exist_ok=False)
    # Keep venv at its final absolute path; do not rename it after installation.
    venv.create(str(destination / 'venv'), with_pip=True)
    python = destination / 'venv/bin/python'
    env = {'PATH': os.environ.get('PATH', ''), 'PIP_CONFIG_FILE': os.devnull, 'PIP_NO_INDEX': '1',
           'PIP_DISABLE_PIP_VERSION_CHECK': '1', 'PYTHONNOUSERSITE': '1'}
    for requirements in ('requirements.lock', 'app-requirements.lock'):
        subprocess.run([str(python), '-m', 'pip', 'install', '--no-index', '--only-binary=:all:',
                        '--require-hashes', '--find-links', str(bundle / 'wheelhouse'), '-r', str(bundle / requirements)],
                       env=env, check=True)
    subprocess.run([str(python), '-m', 'pip', 'check'], env=env, check=True)
    subprocess.run([str(python), '-c', 'import fastapi, argon2, sqlite3; from app.main import create_app; create_app()'],
                   env=env, check=True)
    shutil.copytree(bundle / 'frontend', destination / 'frontend')
    shutil.copyfile(bundle / 'manifest.json', destination / 'manifest.json')
    print('Runtime installed. No service was started:', destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--development', action='store_true')
    args = parser.parse_args()
    install(args.bundle, args.destination, args.development)
