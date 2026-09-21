"""Build a development-only offline bundle from locked, downloaded Linux wheels."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(architecture, wheelhouse, app_wheel, output):
    wheelhouse, app_wheel, output = map(Path, (wheelhouse, app_wheel, output))
    lock = (ROOT / 'backend/requirements.lock').read_text(encoding='utf-8')
    approved = set(re.findall(r'--hash=sha256:([a-f0-9]{64})', lock))
    wheels = sorted(wheelhouse.glob('*.whl'))
    if not wheels or any(sha(p) not in approved for p in wheels):
        raise ValueError('Wheelhouse includes a file outside the dependency lock')
    for path in wheels:
        if not (path.name.endswith('-none-any.whl') or ('manylinux' in path.name and path.name.endswith(architecture + '.whl'))):
            raise ValueError('Wrong target platform: ' + path.name)
    if not app_wheel.name.endswith('-py3-none-any.whl'):
        raise ValueError('Expected a pure Python application wheel')
    # The app wheel must match current source, including package data, not an earlier build.
    with zipfile.ZipFile(app_wheel) as archive:
        names = {n for n in archive.namelist() if n.startswith('app/') and not n.endswith('/')}
        sources = {p.relative_to(ROOT / 'backend').as_posix(): p for p in (ROOT / 'backend/app').rglob('*')
                   if p.is_file() and p.suffix in ('.py', '.json', '.sql') and '__pycache__' not in p.parts}
        if names != set(sources) or any(archive.read(n) != p.read_bytes() for n, p in sources.items()):
            raise ValueError('Application wheel does not match current backend sources')
    subprocess.run([sys.executable, str(ROOT / 'frontend/build.py')], check=True)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'wheelhouse').mkdir()
    for path in wheels + [app_wheel]:
        shutil.copyfile(path, output / 'wheelhouse' / path.name)
    shutil.copyfile(ROOT / 'backend/requirements.lock', output / 'requirements.lock')
    with zipfile.ZipFile(app_wheel) as archive:
        metadata = archive.read(next(n for n in archive.namelist() if n.endswith('.dist-info/METADATA'))).decode('utf-8')
    name = re.search(r'^Name: (.+)$', metadata, re.M)[1]
    version = re.search(r'^Version: (.+)$', metadata, re.M)[1]
    (output / 'app-requirements.lock').write_text('%s==%s --hash=sha256:%s\n' % (name, version, sha(app_wheel)), encoding='utf-8')
    shutil.copytree(ROOT / 'frontend/dist', output / 'frontend')
    shutil.copytree(ROOT / 'packaging/linux', output / 'linux', ignore=shutil.ignore_patterns('__pycache__'))
    manifest = {'format': 'contract-review-linux-v1', 'release_status': 'development', 'architecture': architecture,
                'python': '3.9', 'minimum_glibc': '2.28', 'linux_execution_verified': False,
                'limitations': ['Native current-text automatic verdicts and human completion are connected; legacy archive import and management/AI screens remain incomplete.'],
                'files': {p.relative_to(output).as_posix(): sha(p) for p in sorted(output.rglob('*')) if p.is_file()}}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Development bundle:', output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=['x86_64', 'aarch64'], required=True)
    parser.add_argument('--wheelhouse', required=True, type=Path)
    parser.add_argument('--app-wheel', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    build(args.arch, args.wheelhouse, args.app_wheel, args.output)
