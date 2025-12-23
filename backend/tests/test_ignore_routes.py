"""
Unit tests for ignore routes
"""

import sys
from pathlib import Path
import os
import tempfile

# Use a test database in temp directory
TEST_DB = Path(tempfile.gettempdir()) / "test_ignore.db"

# Set required environment variables BEFORE any imports
os.environ.setdefault("PLAYLISTPOLISHER_DB_PATH", str(TEST_DB))
os.environ.setdefault("SPOTIFY_CLIENT_ID", "test_client_id")
os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "test_client_secret")
os.environ.setdefault("SECRET_KEY", "test_secret_key_at_least_32_chars_long_for_testing")
os.environ.setdefault("SPOTIFY_REDIRECT_URI", "http://localhost:8001/auth/callback")

# Adjust path for imports
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi.testclient import TestClient
from app.main import app
import importlib
from app.utils.session_manager import SESSION_COOKIE_NAME
import sqlite3


@pytest.fixture(autouse=True)
def setup_test_db():
    """Setup test database before each test"""
    # Point to a fresh DB path for every test
    os.environ["PLAYLISTPOLISHER_DB_PATH"] = str(TEST_DB)

    # Remove existing test db
    if TEST_DB.exists():
        TEST_DB.unlink()

    # Reload database module so DB_PATH updates, then init
    import app.db.database as db_module
    importlib.reload(db_module)
    db_module.init_db()

    # Rebind get_db_connection used below
    global get_db_connection
    get_db_connection = db_module.get_db_connection

    yield
    
    # Cleanup
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.fixture
def client():
    """Create a test client"""
    return TestClient(app)


@pytest.fixture
def mock_session(monkeypatch, client):
    """Mock session management"""
    test_session_id = "test-session-123"
    test_user_id = "test-user-456"
    
    # Create a test session in the database
    with get_db_connection() as conn:
        cursor = conn.cursor()
        from datetime import datetime, timedelta
        cursor.execute("""
            INSERT INTO user_sessions (
                session_id, user_id, access_token, refresh_token, 
                expires_at, created_at, updated_at, last_used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            test_session_id,
            test_user_id,
            "test-access-token",
            "test-refresh-token",
            (datetime.now() + timedelta(hours=1)).isoformat(),
            datetime.now().isoformat(),
            datetime.now().isoformat(),
            datetime.now().isoformat()
        ))
        conn.commit()
    
    # Set session cookie so SessionManager can resolve the session
    client.cookies.set(SESSION_COOKIE_NAME, test_session_id)
    
    return {"session_id": test_session_id, "user_id": test_user_id}


def test_add_ignored_pair_playlist_scope(client, mock_session):
    """Test adding an ignored pair with playlist scope"""
    response = client.post("/ignore/pair", json={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "playlist789"
    })
    
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert "message" in data
    assert "playlist" in data["message"].lower()


def test_add_ignored_pair_global_scope(client, mock_session):
    """Test adding an ignored pair with global scope (no playlist_id)"""
    response = client.post("/ignore/pair", json={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": None
    })
    
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert "all playlists" in data["message"].lower()


def test_add_ignored_pair_sorts_track_ids(client, mock_session):
    """Test that track IDs are sorted to avoid duplicate pairs"""
    # Add pair in one order
    response1 = client.post("/ignore/pair", json={
        "track_id_1": "trackZZZ",
        "track_id_2": "trackAAA",
        "playlist_id": "playlist789"
    })
    assert response1.status_code == 200
    
    # Try to add same pair in reverse order - should fail with 409
    response2 = client.post("/ignore/pair", json={
        "track_id_1": "trackAAA",
        "track_id_2": "trackZZZ",
        "playlist_id": "playlist789"
    })
    assert response2.status_code == 409
    assert "already ignored" in response2.json()["detail"].lower()


def test_add_ignored_pair_duplicate_constraint(client, mock_session):
    """Test that duplicate pairs are rejected"""
    payload = {
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "playlist789"
    }
    
    # First insertion should succeed
    response1 = client.post("/ignore/pair", json=payload)
    assert response1.status_code == 200
    
    # Second insertion should fail
    response2 = client.post("/ignore/pair", json=payload)
    assert response2.status_code == 409
    assert "already ignored" in response2.json()["detail"].lower()


def test_list_ignored_pairs_empty(client, mock_session):
    """Test listing ignored pairs when none exist"""
    response = client.get("/ignore/list")
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 0


def test_list_ignored_pairs_multiple(client, mock_session):
    """Test listing multiple ignored pairs"""
    # Add three pairs
    client.post("/ignore/pair", json={
        "track_id_1": "track1",
        "track_id_2": "track2",
        "playlist_id": "playlistA"
    })
    client.post("/ignore/pair", json={
        "track_id_1": "track3",
        "track_id_2": "track4",
        "playlist_id": "playlistB"
    })
    client.post("/ignore/pair", json={
        "track_id_1": "track5",
        "track_id_2": "track6",
        "playlist_id": None  # Global
    })
    
    # List all pairs
    response = client.get("/ignore/list")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 3
    
    # Check structure
    for pair in data:
        assert "id" in pair
        assert "track_id_1" in pair
        assert "track_id_2" in pair
        assert "scope" in pair
        assert pair["scope"] in ["playlist", "global"]


def test_list_ignored_pairs_filtered_by_playlist(client, mock_session):
    """Test listing ignored pairs filtered by playlist"""
    # Add pairs for different playlists
    client.post("/ignore/pair", json={
        "track_id_1": "track1",
        "track_id_2": "track2",
        "playlist_id": "playlistA"
    })
    client.post("/ignore/pair", json={
        "track_id_1": "track3",
        "track_id_2": "track4",
        "playlist_id": "playlistB"
    })
    client.post("/ignore/pair", json={
        "track_id_1": "track5",
        "track_id_2": "track6",
        "playlist_id": None  # Global
    })
    
    # List pairs for playlistA (should include playlistA-specific and global)
    response = client.get("/ignore/list?playlist_id=playlistA")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2  # playlistA + global
    
    playlist_ids = [p.get("playlist_id") for p in data]
    assert "playlistA" in playlist_ids
    assert None in playlist_ids  # Global pair


def test_remove_ignored_pair(client, mock_session):
    """Test removing an ignored pair"""
    # Add a pair
    response = client.post("/ignore/pair", json={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "playlist789"
    })
    pair_id = response.json()["id"]
    
    # Remove it
    response = client.delete(f"/ignore/{pair_id}")
    assert response.status_code == 200
    assert "removed" in response.json()["message"].lower()
    
    # Verify it's gone
    response = client.get("/ignore/list")
    assert len(response.json()) == 0


def test_remove_nonexistent_pair(client, mock_session):
    """Test removing a pair that doesn't exist"""
    response = client.delete("/ignore/99999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_check_if_ignored_true(client, mock_session):
    """Test checking if a pair is ignored (positive case)"""
    # Add a pair
    client.post("/ignore/pair", json={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "playlist789"
    })
    
    # Check if it's ignored
    response = client.get("/ignore/check", params={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "playlist789"
    })
    
    assert response.status_code == 200
    assert response.json()["ignored"] is True


def test_check_if_ignored_false(client, mock_session):
    """Test checking if a pair is ignored (negative case)"""
    response = client.get("/ignore/check", params={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "playlist789"
    })
    
    assert response.status_code == 200
    assert response.json()["ignored"] is False


def test_check_if_ignored_global_match(client, mock_session):
    """Test that global ignores match any playlist check"""
    # Add a global ignore
    client.post("/ignore/pair", json={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": None
    })
    
    # Check against a specific playlist - should still match
    response = client.get("/ignore/check", params={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "any-playlist"
    })
    
    assert response.status_code == 200
    assert response.json()["ignored"] is True


def test_check_if_ignored_reversed_ids(client, mock_session):
    """Test that reversed track IDs are handled correctly"""
    # Add pair
    client.post("/ignore/pair", json={
        "track_id_1": "trackZZZ",
        "track_id_2": "trackAAA",
        "playlist_id": "playlist789"
    })
    
    # Check with reversed IDs - should still match due to sorting
    response = client.get("/ignore/check", params={
        "track_id_1": "trackAAA",
        "track_id_2": "trackZZZ",
        "playlist_id": "playlist789"
    })
    
    assert response.status_code == 200
    assert response.json()["ignored"] is True


def test_unauthenticated_requests(client):
    """Test that unauthenticated requests are rejected"""
    # Override mock session by not using the fixture
    test_client = TestClient(app)
    
    # Try to add pair without auth
    response = test_client.post("/ignore/pair", json={
        "track_id_1": "track123",
        "track_id_2": "track456"
    })
    assert response.status_code == 401
    
    # Try to list pairs without auth
    response = test_client.get("/ignore/list")
    assert response.status_code == 401
    
    # Try to delete pair without auth
    response = test_client.delete("/ignore/1")
    assert response.status_code == 401


def test_session_isolation(client, mock_session):
    """Test that ignored pairs are isolated by session"""
    # Add pair for first session
    client.post("/ignore/pair", json={
        "track_id_1": "track123",
        "track_id_2": "track456",
        "playlist_id": "playlist789"
    })
    
    # Switch to a different session by setting a new cookie and seeding the DB
    new_session_id = "different-session-999"

    with get_db_connection() as conn:
        cursor = conn.cursor()
        from datetime import datetime, timedelta
        cursor.execute("""
            INSERT INTO user_sessions (
                session_id, user_id, access_token, refresh_token,
                expires_at, created_at, updated_at, last_used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            new_session_id,
            "other-user",
            "test-access-token",
            "test-refresh-token",
            (datetime.now() + timedelta(hours=1)).isoformat(),
            datetime.now().isoformat(),
            datetime.now().isoformat(),
            datetime.now().isoformat()
        ))
        conn.commit()

    client.cookies.set(SESSION_COOKIE_NAME, new_session_id)
    
    # List pairs - should be empty for different session
    response = client.get("/ignore/list")
    assert response.status_code == 200
    assert len(response.json()) == 0

    # Restore original session cookie and ensure the pair remains visible
    client.cookies.set(SESSION_COOKIE_NAME, mock_session["session_id"])
    response2 = client.get("/ignore/list")
    assert response2.status_code == 200
    data = response2.json()
    assert len(data) == 1
    assert data[0]["track_id_1"] == "track123"
    assert data[0]["track_id_2"] == "track456"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
