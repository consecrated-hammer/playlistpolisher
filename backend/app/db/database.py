"""
Database management for sort jobs using SQLite.
"""

import os
import sqlite3
from pathlib import Path
from typing import Optional
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Database file location (env override for tests)
DB_PATH = Path(os.getenv("PLAYLISTPOLISHER_DB_PATH", "/data/playlist_polisher.db"))


def init_db():
    """Initialize the database with required tables."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    # Create sort_jobs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sort_jobs (
            job_id TEXT PRIMARY KEY,
            playlist_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            sort_by TEXT NOT NULL,
            direction TEXT NOT NULL,
            method TEXT NOT NULL,
            status TEXT NOT NULL,
            progress INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            message TEXT,
            error TEXT,
            tracks_to_move INTEGER,
            estimated_time INTEGER
        )
    """)
    
    # Create index for faster lookups
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_id ON sort_jobs(playlist_id)
    """)
    
    # Create oauth_states table for temporary state storage
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS oauth_states (
            state TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL
        )
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states(created_at)
    """)

    # Short-lived auth exchange codes (OAuth callback -> frontend -> API exchange)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS auth_exchange_codes (
            code TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_auth_exchange_codes_created_at ON auth_exchange_codes(created_at)
    """)
    
    # Create user_sessions table for persistent token storage
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            token_type TEXT DEFAULT 'Bearer',
            scope TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL
        )
    """)
    
    # Create index for session cleanup
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_session_expires ON user_sessions(expires_at)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_id ON user_sessions(user_id)
    """)

    # User preferences (persisted per Spotify user)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY,
            preferences_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_id ON sort_jobs(user_id)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_status ON sort_jobs(status)
    """)

    # History of bulk playlist operations (undo support)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlist_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            op_type TEXT NOT NULL,
            snapshot_before TEXT,
            snapshot_after TEXT,
            payload TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            undone INTEGER DEFAULT 0,
            changes_made INTEGER DEFAULT 1
        )
    """)
    
    # Add changes_made column if it doesn't exist (migration)
    try:
        cursor.execute("ALTER TABLE playlist_operations ADD COLUMN changes_made INTEGER DEFAULT 1")
        logger.info("Added changes_made column to playlist_operations")
    except sqlite3.OperationalError:
        pass  # Column already exists
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_ops_user ON playlist_operations(user_id, playlist_id, created_at DESC)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_ops_expiry ON playlist_operations(expires_at)
    """)

    # Scheduled actions (sort/dedupe) with simple interval scheduling
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlist_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT,
            action_type TEXT NOT NULL,
            params TEXT,
            frequency_minutes INTEGER NOT NULL,
            next_run_at TEXT,
            last_run_at TEXT,
            enabled INTEGER DEFAULT 1,
            status TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_schedules_next ON playlist_schedules(enabled, next_run_at)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_schedules_user ON playlist_schedules(user_id, playlist_id)
    """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_schedules_unique ON playlist_schedules(user_id, playlist_id)
    """)
    
    # Ignored duplicate track pairs
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ignored_pairs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            track_id_1 TEXT NOT NULL,
            track_id_2 TEXT NOT NULL,
            playlist_id TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(session_id, track_id_1, track_id_2, playlist_id)
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_ignored_pairs_session ON ignored_pairs(session_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_ignored_pairs_lookup ON ignored_pairs(session_id, track_id_1, track_id_2)
    """)
    
    # Track cache (global, shared across users)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS track_cache (
            track_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            artists_json TEXT NOT NULL,
            album TEXT,
            album_release_date TEXT,
            album_release_date_precision TEXT,
            duration_ms INTEGER,
            album_art_url TEXT,
            cached_at TEXT NOT NULL,
            last_accessed TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_track_cache_accessed ON track_cache(last_accessed)
    """)

    # Migrations: add album release date fields to existing DBs
    for col, ddl in (
        ("album_release_date", "ALTER TABLE track_cache ADD COLUMN album_release_date TEXT"),
        ("album_release_date_precision", "ALTER TABLE track_cache ADD COLUMN album_release_date_precision TEXT"),
    ):
        try:
            cursor.execute(ddl)
            logger.info("Added %s column to track_cache", col)
        except sqlite3.OperationalError:
            pass  # Column already exists (or table missing during initial creation)
    
    # Track usage by users (for user-specific cache management)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS track_usage (
            track_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            PRIMARY KEY (track_id, session_id),
            FOREIGN KEY (track_id) REFERENCES track_cache(track_id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES user_sessions(session_id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_track_usage_session ON track_usage(session_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_track_usage_track ON track_usage(track_id)
    """)

    # Cached playlist items (local playlist snapshot with added_at timestamps)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlist_cache_items (
            playlist_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            track_id TEXT NOT NULL,
            added_at TEXT,
            cached_at TEXT NOT NULL,
            snapshot_id TEXT,
            PRIMARY KEY (playlist_id, position)
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_cache_items_playlist ON playlist_cache_items(playlist_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_cache_items_added ON playlist_cache_items(playlist_id, added_at)
    """)

    # Derived facts for cached playlists (used for estimated sorting)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlist_cache_facts (
            playlist_id TEXT PRIMARY KEY,
            last_track_added_at_utc TEXT,
            track_count_cached INTEGER NOT NULL,
            last_cached_at_utc TEXT NOT NULL,
            is_dirty INTEGER DEFAULT 0,
            updated_at_utc TEXT NOT NULL,
            last_snapshot_id TEXT,
            facts_version INTEGER DEFAULT 1
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_cache_facts_last_track ON playlist_cache_facts(last_track_added_at_utc DESC)
    """)

    # Daily reconciliation run tracking
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cache_facts_runs (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_run_at_utc TEXT
        )
    """)
    
    conn.commit()
    conn.close()
    
    logger.info(f"Database initialized at {DB_PATH}")


@contextmanager
def get_db_connection():
    """Context manager for database connections."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row  # Enable column access by name
    try:
        yield conn
    finally:
        conn.close()


# Initialize database on module import
init_db()
