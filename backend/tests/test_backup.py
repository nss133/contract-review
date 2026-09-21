import json
import sqlite3

import pytest

from app.auth.service import create_user
from app.repositories.backup import create_backup, restore_backup
from app.repositories.database import Database


def test_wal_snapshot_preserves_data_and_acl_but_revokes_sessions(tmp_path):
    path = tmp_path / 'live.sqlite'
    db = Database(path)
    db.initialize()
    user = create_user(db, 'alice', 'synthetic-only-password', 'reviewer')
    other = create_user(db, 'bob', 'synthetic-only-password', 'reviewer')
    connection = db.connect()
    # Keep the WAL open so a plain file copy would miss the latest transaction.
    connection.execute('PRAGMA wal_autocheckpoint=0')
    connection.execute("INSERT INTO reviews VALUES ('r', ?, '합성 계약', '원문 😀', 'h', 2, 1)", (user,))
    connection.execute("INSERT INTO review_memberships VALUES ('r', ?, 'read')", (other,))
    connection.execute("INSERT INTO opinion_drafts VALUES ('r', ?, '수기 의견', 4, 1)", (user,))
    connection.execute("INSERT INTO sessions VALUES ('token', ?, 'csrf', 99999999999)", (user,))
    assert (tmp_path / 'live.sqlite-wal').stat().st_size > 0
    backup = tmp_path / 'backup'
    create_backup(path, backup)
    connection.execute("UPDATE reviews SET text='백업 이후 변경' WHERE id='r'")
    restored = restore_backup(backup, tmp_path / 'restored.sqlite')
    connection.close()
    with sqlite3.connect(str(restored)) as check:
        assert check.execute('SELECT text,revision FROM reviews').fetchone() == ('원문 😀', 2)
        assert check.execute('SELECT text,revision FROM opinion_drafts').fetchone() == ('수기 의견', 4)
        assert check.execute('SELECT user_id,permission FROM review_memberships').fetchone() == (other, 'read')
        assert check.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0
        assert check.execute("SELECT count(*) FROM audit_events WHERE action='backup.restored'").fetchone()[0] == 1
    with pytest.raises(FileExistsError):
        restore_backup(backup, restored)
    assert Database(restored).healthy()


def test_tampered_backup_never_creates_destination(tmp_path):
    db = Database(tmp_path / 'live.sqlite')
    db.initialize()
    backup = tmp_path / 'backup'
    create_backup(db.path, backup)
    with (backup / 'database.sqlite').open('ab') as handle:
        handle.write(b'changed')
    target = tmp_path / 'restore.sqlite'
    with pytest.raises(ValueError, match='integrity'):
        restore_backup(backup, target)
    assert not target.exists()


def test_incompatible_schema_is_rejected_before_restore(tmp_path):
    db = Database(tmp_path / 'live.sqlite')
    db.initialize()
    backup = tmp_path / 'backup'
    create_backup(db.path, backup)
    path = backup / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['schema_migrations'] = {}
    path.write_text(json.dumps(manifest), encoding='utf-8')
    target = tmp_path / 'restore.sqlite'
    with pytest.raises(ValueError, match='migration'):
        restore_backup(backup, target)
    assert not target.exists()
