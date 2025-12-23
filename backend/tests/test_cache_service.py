import sys
import os
import importlib
from pathlib import Path
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _reload_modules(db_path: str):
    """Reload database and cache modules with a temp DB path."""
    os.environ["PLAYLISTPOLISHER_DB_PATH"] = db_path
    os.environ.setdefault("SPOTIFY_CLIENT_ID", "test-client-id")
    os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "test-client-secret")
    os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-chars")
    import app.db.database as db_module

    importlib.reload(db_module)
    db_module.init_db()

    import app.services.cache_service as cache_module

    importlib.reload(cache_module)
    return db_module, cache_module.CacheService


def test_clear_expired_removes_only_old_entries(tmp_path, monkeypatch):
    db_file = tmp_path / "cache.db"
    db_module, CacheService = _reload_modules(str(db_file))

    recent = datetime.now(timezone.utc)
    expired = recent - timedelta(days=40)

    with db_module.get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO track_cache (track_id, name, artists_json, album, duration_ms, album_art_url, cached_at, last_accessed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("recent", "Recent", '["A"]', "Album", 1000, None, recent.isoformat(), recent.isoformat()),
        )
        cur.execute(
            """
            INSERT INTO track_cache (track_id, name, artists_json, album, duration_ms, album_art_url, cached_at, last_accessed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("old", "Old", '["A"]', "Album", 1000, None, expired.isoformat(), expired.isoformat()),
        )
        conn.commit()

    removed = CacheService.clear_expired()
    assert removed == 1

    with db_module.get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as c FROM track_cache")
        remaining = cur.fetchone()["c"]
    assert remaining == 1


def test_get_cache_stats_aggregates_user_sessions(tmp_path, monkeypatch):
    db_file = tmp_path / "cache.db"
    db_module, CacheService = _reload_modules(str(db_file))

    user_id = "user123"
    session_a = "sessA"
    session_b = "sessB"
    now = datetime.now(timezone.utc).isoformat()

    with db_module.get_db_connection() as conn:
        cur = conn.cursor()
        # Two sessions for same user
        cur.execute(
            """
            INSERT INTO user_sessions (session_id, user_id, access_token, refresh_token, expires_at, created_at, updated_at, last_used_at)
            VALUES (?, ?, 'a', 'b', ?, ?, ?, ?)
            """,
            (session_a, user_id, now, now, now, now),
        )
        cur.execute(
            """
            INSERT INTO user_sessions (session_id, user_id, access_token, refresh_token, expires_at, created_at, updated_at, last_used_at)
            VALUES (?, ?, 'a', 'b', ?, ?, ?, ?)
            """,
            (session_b, user_id, now, now, now, now),
        )
        # Cache entries
        tracks = [("t1", session_a), ("t2", session_a), ("t3", session_b)]
        for tid, sess in tracks:
            cur.execute(
                """
                INSERT INTO track_cache (track_id, name, artists_json, album, duration_ms, album_art_url, cached_at, last_accessed)
                VALUES (?, ?, '["A"]', 'Album', 1000, NULL, ?, ?)
                """,
                (tid, tid, now, now),
            )
            cur.execute(
                """
                INSERT INTO track_usage (track_id, session_id, last_used_at)
                VALUES (?, ?, ?)
                """,
                (tid, sess, now),
            )
        conn.commit()

    stats = CacheService.get_cache_stats(session_a)
    assert stats["total_cached"] == 3
    # Distinct tracks across both sessions of same user
    assert stats["user_tracks"] == 3
