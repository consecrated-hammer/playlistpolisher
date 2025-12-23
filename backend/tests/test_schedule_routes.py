import os
import sys
import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure backend modules are importable when running from repo root
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "routes.db"
    monkeypatch.setenv("PLAYLISTPOLISHER_DB_PATH", str(db_path))
    monkeypatch.setenv("SPOTIFY_CLIENT_ID", "test-client")
    monkeypatch.setenv("SPOTIFY_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")

    import app.db.database as db_module
    import app.db.schedules as schedules_module
    import app.routes.playlists as playlists_module
    import app.routes.schedule as schedule_module
    import app.main as main_module

    # Reload modules so they pick up the temporary database path
    importlib.reload(db_module)
    importlib.reload(playlists_module)
    importlib.reload(schedules_module)
    importlib.reload(schedule_module)
    app_module = importlib.reload(main_module)

    db_module.init_db()

    class DummySession:
        session_id = "sess"

        def is_authenticated(self):
            return True

        def get_user_id(self):
            return "user123"

    app_module.app.dependency_overrides[playlists_module.require_auth] = lambda: DummySession()

    client = TestClient(app_module.app)
    yield client, schedules_module, db_module, app_module.app, playlists_module.require_auth

    app_module.app.dependency_overrides.pop(playlists_module.require_auth, None)


def test_list_user_schedules_returns_valid_entries(client):
    client, schedules_module, _, _, _ = client

    sched_id = schedules_module.create_schedule(
        playlist_id="pl-valid",
        user_id="user123",
        session_id="sess",
        action_type="sort",
        params={"sort_by": "date_added"},
        frequency_minutes=60,
    )

    response = client.get("/schedules")
    assert response.status_code == 200
    payload = response.json()
    assert payload["schedules"][0]["id"] == sched_id
    assert payload["schedules"][0]["playlist_id"] == "pl-valid"


def test_invalid_schedule_records_are_filtered_out(client):
    client, schedules_module, db_module, _, _ = client

    valid_id = schedules_module.create_schedule(
        playlist_id="pl-valid",
        user_id="user123",
        session_id="sess",
        action_type="sort",
        params={"sort_by": "title"},
        frequency_minutes=90,
    )

    with db_module.get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO playlist_schedules
            (playlist_id, user_id, session_id, action_type, params, frequency_minutes, next_run_at, created_at, updated_at, enabled, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'scheduled')
            """,
            (
                "pl-bad",
                "user123",
                "sess",
                "sort",
                "{\"sort_by\": \"album\"}",
                "not-a-number",
                schedules_module._now_iso(),
                schedules_module._now_iso(),
                schedules_module._now_iso(),
            ),
        )
        conn.commit()

    response = client.get("/schedules")
    assert response.status_code == 200
    payload = response.json()
    ids = [s["id"] for s in payload["schedules"]]
    assert valid_id in ids
    assert len(ids) == 1  # invalid record should be skipped


def test_cache_schedule_create_and_update(client):
    client, schedules_module, _, _, _ = client

    resp = client.post("/schedules/cache", json={"action_type": "cache_clear"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["action_type"] == "cache_clear"
    assert data["playlist_id"] == "__cache_global__"
    cache_id = data["id"]

    # List should include the cache schedule
    list_resp = client.get("/schedules")
    assert list_resp.status_code == 200
    cache_entries = [s for s in list_resp.json().get("schedules", []) if s["action_type"] == "cache_clear"]
    assert len(cache_entries) == 1

    # Update schedule (disable and change hour)
    update_resp = client.patch(f"/schedules/cache/{cache_id}", json={"enabled": False, "hour_of_day": 5})
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["enabled"] is False
    assert updated["params"]["hour_of_day"] == 5
