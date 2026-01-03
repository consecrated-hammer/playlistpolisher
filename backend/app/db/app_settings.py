from datetime import datetime, timezone
from typing import Optional, Tuple

from app.config import settings
from app.db.database import get_db_connection


TRACK_CACHE_TTL_KEY = "track_cache_ttl_days"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_setting(key: str) -> Optional[str]:
    if not key:
        return None
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
        row = cur.fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    if not key:
        return
    now = _now_iso()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            """,
            (key, value, now),
        )
        conn.commit()


def get_track_cache_ttl_days() -> Tuple[int, str]:
    value = get_setting(TRACK_CACHE_TTL_KEY)
    if value is None:
        return settings.track_cache_ttl_days, "env"
    try:
        return int(value), "stored"
    except (TypeError, ValueError):
        return settings.track_cache_ttl_days, "env"


def set_track_cache_ttl_days(days: int) -> None:
    set_setting(TRACK_CACHE_TTL_KEY, str(int(days)))
