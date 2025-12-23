import os
import sys
from pathlib import Path

import pytest

# Make `app` importable when running tests from repo root
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Use a temp-friendly default DB path for imports
os.environ.setdefault("PLAYLISTPOLISHER_DB_PATH", str(Path("/tmp/playlistpolisher_test.db")))

from app.db import database
from app.db import operations


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Use a temporary SQLite file so tests do not touch the real /data DB."""
    new_db = tmp_path / "test.db"
    monkeypatch.setenv("PLAYLISTPOLISHER_DB_PATH", str(new_db))
    # Reload modules so they pick up the new DB path
    import importlib
    import app.db.database as db_module
    import app.db.operations as op_module

    importlib.reload(db_module)
    globals()["database"] = db_module
    globals()["operations"] = importlib.reload(op_module)
    db_module.init_db()
    yield new_db


def test_record_and_get_latest(temp_db):
    op_id = operations.record_operation(
        playlist_id="pl1",
        user_id="user1",
        op_type="duplicates_remove",
        snapshot_before="snap-a",
        snapshot_after="snap-b",
        payload={"removed_items": [{"uri": "spotify:track:1", "position": 0}]},
    )

    latest = operations.get_latest_operation("pl1", "user1")
    assert latest is not None
    assert latest["id"] == op_id
    assert latest["op_type"] == "duplicates_remove"
    assert latest["snapshot_before"] == "snap-a"
    assert latest["snapshot_after"] == "snap-b"
    assert latest["payload"]["removed_items"][0]["uri"] == "spotify:track:1"


def test_history_and_cleanup(temp_db):
    # One expired, one active
    operations.record_operation(
        playlist_id="pl2",
        user_id="user2",
        op_type="duplicates_remove",
        snapshot_before="snap-a",
        snapshot_after="snap-b",
        payload={"removed_items": []},
        expires_days=-1,  # already expired
    )
    op_id = operations.record_operation(
        playlist_id="pl2",
        user_id="user2",
        op_type="duplicates_remove",
        snapshot_before="snap-c",
        snapshot_after="snap-d",
        payload={"removed_items": [{"uri": "spotify:track:2", "position": 5}]},
    )

    # Cleanup should remove the expired one
    deleted = operations.cleanup_expired()
    assert deleted >= 1

    history = operations.get_history("pl2", "user2")
    assert len(history) == 1
    assert history[0]["id"] == op_id
    assert history[0]["payload"]["removed_items"][0]["uri"] == "spotify:track:2"


def test_sort_history_metadata(temp_db):
    op_id = operations.record_operation(
        playlist_id="pl4",
        user_id="user4",
        op_type="sort_reorder",
        snapshot_before="snap-x",
        snapshot_after="snap-y",
        payload={
          "original_order": ["spotify:track:a", "spotify:track:b"],
          "sort_by": "date_added",
          "direction": "desc",
          "method": "preserve",
        },
    )
    history = operations.get_history("pl4", "user4")
    assert len(history) == 1
    entry = history[0]
    assert entry["id"] == op_id
    assert entry["payload"]["sort_by"] == "date_added"
    assert len(entry["payload"]["original_order"]) == 2


def test_mark_undone(temp_db):
    op_id = operations.record_operation(
        playlist_id="pl3",
        user_id="user3",
        op_type="duplicates_remove",
        snapshot_before="snap-a",
        snapshot_after="snap-b",
        payload={"removed_items": [{"uri": "spotify:track:3", "position": 1}]},
    )
    operations.mark_undone(op_id)
    latest = operations.get_latest_operation("pl3", "user3")
    # Should not return undone records
    assert latest is None
