from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List
import logging
import sqlite3

from app.db.database import get_db_connection

logger = logging.getLogger(__name__)


def _chunk_list(items: List[str], chunk_size: int) -> Iterable[List[str]]:
    for i in range(0, len(items), chunk_size):
        yield items[i:i + chunk_size]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_cached_follow_statuses(
    session_id: str,
    artist_ids: Iterable[str],
    ttl_minutes: int,
) -> Dict[str, bool]:
    ids = [artist_id for artist_id in artist_ids if artist_id]
    if not session_id or not ids:
        return {}

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=ttl_minutes)
    cutoff_iso = cutoff.isoformat()
    results: Dict[str, bool] = {}
    chunk_size = 500

    try:
        with get_db_connection() as conn:
            cur = conn.cursor()
            for chunk in _chunk_list(ids, chunk_size):
                placeholders = ",".join(["?"] * len(chunk))
                cur.execute(
                    f"""
                    SELECT artist_id, is_following
                    FROM artist_follow_cache
                    WHERE session_id = ?
                      AND artist_id IN ({placeholders})
                      AND cached_at > ?
                    """,
                    (session_id, *chunk, cutoff_iso),
                )
                rows = cur.fetchall()
                for row in rows:
                    results[row["artist_id"]] = bool(row["is_following"])
    except sqlite3.Error as exc:
        logger.warning("Artist follow cache lookup failed: %s", exc)
        return {}

    return results


def set_cached_follow_statuses(
    session_id: str,
    statuses: Dict[str, bool],
) -> int:
    if not session_id or not statuses:
        return 0

    now = _now_iso()
    entries = [
        (session_id, artist_id, 1 if is_following else 0, now)
        for artist_id, is_following in statuses.items()
        if artist_id
    ]

    if not entries:
        return 0

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.executemany(
            """
            INSERT INTO artist_follow_cache (session_id, artist_id, is_following, cached_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(session_id, artist_id) DO UPDATE SET
              is_following = excluded.is_following,
              cached_at = excluded.cached_at
            """,
            entries,
        )
        conn.commit()

    return len(entries)
