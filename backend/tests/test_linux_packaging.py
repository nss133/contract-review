"""Artifact validation runs locally; it does not substitute for Linux acceptance."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import pytest

LINUX = Path(__file__).resolve().parents[2] / 'packaging/linux'


def module(name):
    spec = importlib.util.spec_from_file_location(name, LINUX / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


preflight = module('preflight')
sys.modules['preflight'] = preflight
installer = module('install_runtime')
configure = module('configure')


def bundle(tmp_path):
    root = tmp_path / 'bundle'
    root.mkdir()
    (root / 'frontend').mkdir()
    (root / 'frontend/index.html').write_text('<html></html>', encoding='utf-8')
    (root / 'frontend/config.json').write_text(json.dumps({'apiBase': '/api/v1', 'apiVersion': '1'}), encoding='utf-8')
    for name in ('requirements.lock', 'app-requirements.lock'):
        (root / name).write_text('', encoding='utf-8')
    manifest = {'format': 'contract-review-linux-v1', 'architecture': 'x86_64', 'release_status': 'development',
                'files': {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in root.rglob('*') if p.is_file()}}
    (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    return root


def test_rejects_modified_and_extra_bundle_files(tmp_path):
    root = bundle(tmp_path)
    assert installer.verify(root)['architecture'] == 'x86_64'
    extra = root / 'extra.whl'
    extra.touch()
    with pytest.raises(ValueError, match='unexpected'):
        installer.verify(root)
    extra.unlink()
    (root / 'frontend/index.html').write_text('changed', encoding='utf-8')
    with pytest.raises(ValueError, match='integrity'):
        installer.verify(root)


def test_development_bundle_is_not_installed_as_production(tmp_path):
    root = bundle(tmp_path)
    with pytest.raises(ValueError, match='development bundle'):
        installer.install(root, tmp_path / 'installed')
    assert not (tmp_path / 'installed').exists()


@pytest.mark.parametrize('origin', ['http://a.internal', 'https://a.internal/', 'https://a.internal:443',
                                  'https://a.internal;return 200', 'https://a.internal\nroot /tmp;', 'https://user@a.internal'])
def test_rejects_origin_configuration_injection(tmp_path, origin):
    with pytest.raises(ValueError):
        configure.render(origin, tmp_path / 'config')


def test_renders_same_origin_and_private_api(tmp_path):
    out = configure.render('https://review.internal', tmp_path / 'config')
    proxy = (out / 'nginx.conf').read_text(encoding='utf-8')
    service = (out / 'contract-review-api.service').read_text(encoding='utf-8')
    assert 'proxy_pass http://127.0.0.1:8766;' in proxy
    assert 'server_name review.internal;' in proxy
    assert '--host 127.0.0.1' in service and '--workers 1' in service
    assert 'CR_FRONTEND_ORIGIN=https://review.internal' in (out / 'contract-review.env').read_text(encoding='utf-8')
    with pytest.raises(FileExistsError):
        configure.render('https://review.internal', out)


def test_wrong_python_or_os_is_not_reported_as_ready(monkeypatch):
    monkeypatch.setattr(preflight.platform, 'system', lambda: 'Darwin')
    monkeypatch.setattr(preflight.sys, 'version_info', (3, 14))
    result = preflight.check('x86_64')
    assert not result['ready_for_install']
    assert not result['checks']['linux'] and not result['checks']['cpython39']
