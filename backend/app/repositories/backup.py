"""SQLite snapshot backup and non-destructive restore for the current DB schema.

The current schema stores all persistent application data in SQLite. This format
must be extended before file attachments are introduced; it is not a file backup.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

from app.repositories.database import audit

FORMAT = 'contract-review-sqlite-backup-v1'


def _digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)


def _check(connection):
    if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise ValueError('SQLite integrity check failed')
    if connection.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('SQLite foreign key check failed')
    migrations = dict(connection.execute('SELECT name, sha256 FROM schema_migrations'))
    expected = {p.name: _digest(p) for p in (Path(__file__).parent / 'migrations').glob('*.sql')}
    if migrations != expected:
        raise ValueError('Backup schema must match this application version')
    return migrations


def create_backup(database_path, output):
    database_path, output = Path(database_path), Path(output)
    if not database_path.is_file():
        raise ValueError('Database does not exist')
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    target = output / 'database.sqlite'
    # backup() includes committed pages still in the live database WAL.
    source = _readonly(database_path)
    destination = sqlite3.connect(str(target))
    target.chmod(0o600)
    deadline = time.monotonic() + 120
    def progress(status, remaining, total):
        if time.monotonic() > deadline:
            raise TimeoutError('Database backup exceeded the time limit')
    try:
        source.backup(destination, pages=256, progress=progress, sleep=.05)
        destination.execute('PRAGMA journal_mode=DELETE')
        migrations = _check(destination)
    finally:
        destination.close()
        source.close()
    with target.open('rb') as handle:
        os.fsync(handle.fileno())
    manifest = {'format': FORMAT, 'scope': 'sqlite_only', 'created_at': time.time(),
                'schema_migrations': migrations, 'sha256': _digest(target), 'size': target.stat().st_size}
    path = output / 'manifest.json'
    with path.open('x', encoding='utf-8') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    path.chmod(0o600)
    return manifest


def restore_backup(bundle, destination):
    bundle, destination = Path(bundle), Path(destination)
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    snapshot = bundle / 'database.sqlite'
    if (manifest.get('format') != FORMAT or manifest.get('scope') != 'sqlite_only'
            or snapshot.is_symlink() or not snapshot.is_file() or snapshot.stat().st_size != manifest.get('size')
            or _digest(snapshot) != manifest.get('sha256')):
        raise ValueError('Backup integrity check failed')
    source = _readonly(snapshot)
    try:
        if _check(source) != manifest.get('schema_migrations'):
            raise ValueError('Backup migration manifest mismatch')
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if any(Path(str(destination) + suffix).exists() for suffix in ('', '-wal', '-shm')):
            raise FileExistsError('Restore requires a new database path')
        descriptor = os.open(str(destination), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        restored = sqlite3.connect(str(destination))
        try:
            source.backup(restored)
            restored.execute('PRAGMA journal_mode=DELETE')
            # Old cookies must not become valid again after restoring a snapshot.
            restored.execute('DELETE FROM sessions')
            restored.execute('DELETE FROM login_attempts')
            audit(restored, None, 'backup.restored')
            restored.commit()
            _check(restored)
        finally:
            restored.close()
        with destination.open('rb') as handle:
            os.fsync(handle.fileno())
    finally:
        source.close()
    return destination
