import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.db.database import get_db_connection

logger = logging.getLogger(__name__)

DEFAULT_EXPIRY_DAYS = 7


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expiry_iso(days: int = DEFAULT_EXPIRY_DAYS) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def record_operation(
    *,
    playlist_id: str,
    user_id: str,
    op_type: str,
    snapshot_before: Optional[str],
    snapshot_after: Optional[str],
    payload: Dict[str, Any],
    expires_days: int = DEFAULT_EXPIRY_DAYS,
    changes_made: bool = True,
) -> int:
    """Persist an operation so it can be undone later."""
    created_at = _utc_now_iso()
    expires_at = _expiry_iso(expires_days)
    payload_json = json.dumps(payload)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO playlist_operations
            (playlist_id, user_id, op_type, snapshot_before, snapshot_after, payload, created_at, expires_at, changes_made)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (playlist_id, user_id, op_type, snapshot_before, snapshot_after, payload_json, created_at, expires_at, 1 if changes_made else 0),
        )
        conn.commit()
        op_id = cur.lastrowid
    logger.debug("Recorded operation %s for playlist %s user %s (changes_made=%s)", op_id, playlist_id, user_id, changes_made)
    return op_id


def get_latest_operation(playlist_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Return the most recent non-expired, not-undone operation for this playlist/user where changes were actually made."""
    now = _utc_now_iso()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM playlist_operations
            WHERE playlist_id = ? AND user_id = ? AND undone = 0 AND expires_at > ? AND changes_made = 1
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (playlist_id, user_id, now),
        )
        row = cur.fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["payload"] = json.loads(data.get("payload") or "{}")
    except json.JSONDecodeError:
        data["payload"] = {}
    return data


def get_history(playlist_id: str, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Return recent non-expired operations."""
    now = _utc_now_iso()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM playlist_operations
            WHERE playlist_id = ? AND user_id = ? AND expires_at > ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (playlist_id, user_id, now, limit),
        )
        rows = cur.fetchall()
    history = []
    for row in rows:
        data = dict(row)
        try:
            data["payload"] = json.loads(data.get("payload") or "{}")
        except json.JSONDecodeError:
            data["payload"] = {}
        history.append(data)
    return history


def mark_undone(op_id: int) -> None:
    with get_db_connection() as conn:
        conn.execute("UPDATE playlist_operations SET undone = 1 WHERE id = ?", (op_id,))
        conn.commit()


def cleanup_expired() -> int:
    now = _utc_now_iso()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM playlist_operations WHERE expires_at <= ?", (now,))
        deleted = cur.rowcount
        conn.commit()
    if deleted:
        logger.debug("Cleaned up %s expired operations", deleted)
    return deleted


def get_operation_by_id(op_id: int, user_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM playlist_operations WHERE id = ? AND user_id = ?", (op_id, user_id))
        row = cur.fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["payload"] = json.loads(data.get("payload") or "{}")
    except json.JSONDecodeError:
        data["payload"] = {}
    return data


def get_all_history(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Return recent non-expired operations across ALL playlists for this user."""
    now = _utc_now_iso()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM playlist_operations
            WHERE user_id = ? AND expires_at > ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, now, limit),
        )
        rows = cur.fetchall()
    history = []
    for row in rows:
        data = dict(row)
        try:
            data["payload"] = json.loads(data.get("payload") or "{}")
        except json.JSONDecodeError:
            data["payload"] = {}
        history.append(data)
    return history
