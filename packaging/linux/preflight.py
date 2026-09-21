"""Read-only Linux deployment check; needs only the Python standard library."""
import argparse
import importlib.util
import json
import platform
import shutil
import sqlite3
import sys
from pathlib import Path


def check(expected_arch=None):
    libc, libc_version = platform.libc_ver()
    try:
        libc_tuple = tuple(int(x) for x in libc_version.split('.')[:2])
    except ValueError:
        libc_tuple = ()
    machine = platform.machine()
    checks = {
        'linux': platform.system() == 'Linux',
        'cpython39': platform.python_implementation() == 'CPython' and sys.version_info[:2] == (3, 9),
        'architecture': machine in ('x86_64', 'aarch64') and (not expected_arch or machine == expected_arch),
        'glibc_2_28': libc == 'glibc' and libc_tuple >= (2, 28),
        'venv': importlib.util.find_spec('venv') is not None,
        'ensurepip': importlib.util.find_spec('ensurepip') is not None,
        'ssl': importlib.util.find_spec('_ssl') is not None,
        'systemd': bool(shutil.which('systemctl')) and Path('/run/systemd/system').is_dir(),
        'nginx': bool(shutil.which('nginx')),
    }
    os_release = {}
    path = Path('/etc/os-release')
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            key, _, value = line.partition('=')
            if key in ('ID', 'VERSION_ID', 'PRETTY_NAME'):
                os_release[key] = value.strip('"')
    return {'ready_for_install': all(checks.values()), 'checks': checks, 'os_release': os_release,
            'architecture': machine, 'python': platform.python_version(), 'libc': [libc, libc_version],
            'sqlite': sqlite3.sqlite_version,
            'scope': 'installation prerequisites only; application acceptance is separate'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=['x86_64', 'aarch64'])
    result = check(parser.parse_args().arch)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result['ready_for_install'] else 1)
