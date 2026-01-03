import json
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.db.database import get_db_connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_backup_from_cache(
    playlist_id: str,
    user_id: str,
    name: str,
    *,
    description: Optional[str] = None,
    source: Optional[str] = None,
    schedule_id: Optional[int] = None,
    playlist_name: Optional[str] = None,
) -> Optional[Dict]:
    if not playlist_id or not user_id:
        return None

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT position, track_id, added_at
            FROM playlist_cache_items
            WHERE playlist_id = ?
              AND track_id IS NOT NULL
            ORDER BY position ASC
            """,
            (playlist_id,),
        )
        items = cur.fetchall()
        if not items:
            return None

        cur.execute(
            """
            SELECT last_snapshot_id
            FROM playlist_cache_facts
            WHERE playlist_id = ?
            """,
            (playlist_id,),
        )
        fact = cur.fetchone()
        snapshot_id = fact["last_snapshot_id"] if fact else None

        created_at = _now_iso()
        track_count = len(items)
        cur.execute(
            """
            INSERT INTO playlist_backups
            (playlist_id, user_id, name, description, track_count, snapshot_id, source, schedule_id, created_at, playlist_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                playlist_id,
                user_id,
                name,
                description,
                track_count,
                snapshot_id,
                source,
                schedule_id,
                created_at,
                playlist_name,
            ),
        )
        backup_id = cur.lastrowid
        cur.executemany(
            """
            INSERT INTO playlist_backup_items
            (backup_id, position, track_id, added_at)
            VALUES (?, ?, ?, ?)
            """,
            [
                (
                    backup_id,
                    row["position"],
                    row["track_id"],
                    row["added_at"],
                )
                for row in items
            ],
        )
        conn.commit()

    return {
        "id": backup_id,
        "playlist_id": playlist_id,
        "user_id": user_id,
        "name": name,
        "description": description,
        "track_count": track_count,
        "snapshot_id": snapshot_id,
        "source": source,
        "schedule_id": schedule_id,
        "created_at": created_at,
        "playlist_name": playlist_name,
    }


def list_backups(playlist_id: str, user_id: str, limit: Optional[int] = None) -> List[Dict]:
    if not playlist_id or not user_id:
        return []
    query = """
        SELECT id, playlist_id, user_id, name, description, track_count,
               snapshot_id, source, schedule_id, created_at, playlist_name
        FROM playlist_backups
        WHERE playlist_id = ? AND user_id = ?
        ORDER BY created_at DESC
    """
    params: List = [playlist_id, user_id]
    if limit is not None:
        query = f"{query} LIMIT ?"
        params.append(limit)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(query, tuple(params))
        return [dict(row) for row in cur.fetchall()]


def list_all_backups(user_id: str, limit: Optional[int] = None) -> List[Dict]:
    if not user_id:
        return []
    query = """
        SELECT id, playlist_id, user_id, name, description, track_count,
               snapshot_id, source, schedule_id, created_at, playlist_name
        FROM playlist_backups
        WHERE user_id = ?
        ORDER BY created_at DESC
    """
    params: List = [user_id]
    if limit is not None:
        query = f"{query} LIMIT ?"
        params.append(limit)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(query, tuple(params))
        return [dict(row) for row in cur.fetchall()]


def get_backup(backup_id: int, playlist_id: str, user_id: str) -> Optional[Dict]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, playlist_id, user_id, name, description, track_count,
                   snapshot_id, source, schedule_id, created_at, playlist_name
            FROM playlist_backups
            WHERE id = ? AND playlist_id = ? AND user_id = ?
            """,
            (backup_id, playlist_id, user_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_backup_track_ids(backup_id: int) -> List[str]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT track_id
            FROM playlist_backup_items
            WHERE backup_id = ?
              AND track_id IS NOT NULL
            ORDER BY position ASC
            """,
            (backup_id,),
        )
        return [row["track_id"] for row in cur.fetchall()]


def get_backup_preview(backup_id: int, limit: int = 50) -> List[Dict]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT pbi.track_id,
                   pbi.position,
                   pbi.added_at,
                   tc.name,
                   tc.album,
                   tc.artists_json
            FROM playlist_backup_items pbi
            LEFT JOIN track_cache tc ON tc.track_id = pbi.track_id
            WHERE pbi.backup_id = ?
            ORDER BY pbi.position ASC
            LIMIT ?
            """,
            (backup_id, limit),
        )
        rows = cur.fetchall()

    preview = []
    for row in rows:
        artists = []
        artists_json = row["artists_json"] if row["artists_json"] is not None else None
        if artists_json:
            try:
                artists = json.loads(artists_json)
            except json.JSONDecodeError:
                artists = []
        preview.append(
            {
                "track_id": row["track_id"],
                "title": row["name"] if row["name"] is not None else None,
                "album": row["album"] if row["album"] is not None else None,
                "artists": artists,
            }
        )
    return preview


def get_backup_tracks(backup_id: int) -> List[Dict]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT pbi.track_id,
                   pbi.position,
                   pbi.added_at,
                   tc.name,
                   tc.album,
                   tc.artists_json
            FROM playlist_backup_items pbi
            LEFT JOIN track_cache tc ON tc.track_id = pbi.track_id
            WHERE pbi.backup_id = ?
            ORDER BY pbi.position ASC
            """,
            (backup_id,),
        )
        rows = cur.fetchall()

    tracks = []
    for row in rows:
        artists = []
        artists_json = row["artists_json"] if row["artists_json"] is not None else None
        if artists_json:
            try:
                artists = json.loads(artists_json)
            except json.JSONDecodeError:
                artists = []
        tracks.append(
            {
                "track_id": row["track_id"],
                "position": row["position"],
                "added_at": row["added_at"],
                "title": row["name"] if row["name"] is not None else None,
                "album": row["album"] if row["album"] is not None else None,
                "artists": artists,
            }
        )
    return tracks


def delete_backups_older_than(user_id: str, cutoff_iso: str) -> Tuple[int, int]:
    if not user_id or not cutoff_iso:
        return 0, 0
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id
            FROM playlist_backups
            WHERE user_id = ?
              AND created_at < ?
            """,
            (user_id, cutoff_iso),
        )
        backup_ids = [row["id"] for row in cur.fetchall()]
        if not backup_ids:
            return 0, 0

        placeholders = ",".join("?" * len(backup_ids))
        cur.execute(
            f"DELETE FROM playlist_backup_items WHERE backup_id IN ({placeholders})",
            tuple(backup_ids),
        )
        items_deleted = cur.rowcount if cur.rowcount is not None else 0
        cur.execute(
            f"DELETE FROM playlist_backups WHERE id IN ({placeholders})",
            tuple(backup_ids),
        )
        backups_deleted = cur.rowcount if cur.rowcount is not None else 0
        conn.commit()
    return backups_deleted, items_deleted
