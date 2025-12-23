import sys
from pathlib import Path

import pytest

# Adjust path for imports
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os_env_db = "PLAYLISTPOLISHER_DB_PATH"

import os

from app.db import database
from app.db import schedules


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    new_db = tmp_path / "sched.db"
    monkeypatch.setenv(os_env_db, str(new_db))
    # Reload modules to pick up new DB path
    import importlib
    import app.db.database as db_module
    import app.db.schedules as sched_module

    importlib.reload(db_module)
    globals()["schedules"] = importlib.reload(sched_module)
    db_module.init_db()
    yield new_db


def test_create_and_due(temp_db):
    sched_id = schedules.create_schedule(
        playlist_id="pl1",
        user_id="u1",
        session_id="sess",
        action_type="sort",
        params={"sort_by": "date_added"},
        frequency_minutes=60,
    )
    all_scheds = schedules.list_schedules("pl1", "u1")
    assert len(all_scheds) == 1
    sched = schedules.get_schedule(sched_id, "u1")
    assert sched["playlist_id"] == "pl1"
    assert sched["params"]["sort_by"] == "date_added"
    due = schedules.due_schedules(now_iso="9999-01-01T00:00:00Z")
    assert any(d["id"] == sched_id for d in due)


def test_disable_and_delete(temp_db):
    sched_id = schedules.create_schedule(
        playlist_id="pl2",
        user_id="u2",
        session_id=None,
        action_type="sort",
        params={"sort_by": "title"},
        frequency_minutes=120,
    )
    schedules.update_schedule(sched_id, "u2", enabled=0)
    sched = schedules.get_schedule(sched_id, "u2")
    assert sched["enabled"] == 0
    deleted = schedules.delete_schedule(sched_id, "u2")
    assert deleted


def test_mark_run(temp_db):
    sched_id = schedules.create_schedule(
        playlist_id="pl3",
        user_id="u3",
        session_id=None,
        action_type="sort",
        params={"sort_by": "album"},
        frequency_minutes=30,
    )
    schedules.mark_run(sched_id, "u3", 30, success=True, error=None)
    sched = schedules.get_schedule(sched_id, "u3")
    assert sched["last_run_at"] is not None
    assert sched["next_run_at"] is not None
    assert sched["status"] == "ok"
