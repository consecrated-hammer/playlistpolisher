from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from app.db.database import get_db_connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def replace_playlist_items(
    playlist_id: str,
    items: List[Dict],
    cached_at: str,
    snapshot_id: Optional[str] = None,
) -> None:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM playlist_cache_items WHERE playlist_id = ?", (playlist_id,))
        if items:
            cur.executemany(
                """
                INSERT INTO playlist_cache_items
                (playlist_id, position, track_id, added_at, cached_at, snapshot_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        playlist_id,
                        item["position"],
                        item["track_id"],
                        item.get("added_at"),
                        cached_at,
                        snapshot_id,
                    )
                    for item in items
                ],
            )
        conn.commit()


def upsert_cache_facts(
    *,
    playlist_id: str,
    last_track_added_at_utc: Optional[str],
    track_count_cached: int,
    last_cached_at_utc: str,
    updated_at_utc: str,
    is_dirty: int = 0,
    last_snapshot_id: Optional[str] = None,
    facts_version: int = 1,
) -> None:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO playlist_cache_facts
            (playlist_id, last_track_added_at_utc, track_count_cached, last_cached_at_utc,
             is_dirty, updated_at_utc, last_snapshot_id, facts_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(playlist_id) DO UPDATE SET
              last_track_added_at_utc = excluded.last_track_added_at_utc,
              track_count_cached = excluded.track_count_cached,
              last_cached_at_utc = excluded.last_cached_at_utc,
              is_dirty = excluded.is_dirty,
              updated_at_utc = excluded.updated_at_utc,
              last_snapshot_id = excluded.last_snapshot_id,
              facts_version = excluded.facts_version
            """,
            (
                playlist_id,
                last_track_added_at_utc,
                track_count_cached,
                last_cached_at_utc,
                is_dirty,
                updated_at_utc,
                last_snapshot_id,
                facts_version,
            ),
        )
        conn.commit()


def refresh_cached_playlist(
    *,
    playlist_id: str,
    items: List[Dict],
    snapshot_id: Optional[str] = None,
) -> Dict:
    now = _now_iso()
    replace_playlist_items(playlist_id, items, now, snapshot_id=snapshot_id)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT MAX(added_at) AS last_added,
                   COUNT(*) AS track_count,
                   MAX(cached_at) AS last_cached
            FROM playlist_cache_items
            WHERE playlist_id = ?
            """,
            (playlist_id,),
        )
        row = cur.fetchone()

    last_added = row["last_added"] if row else None
    track_count = row["track_count"] if row else 0
    last_cached = row["last_cached"] if row else now

    upsert_cache_facts(
        playlist_id=playlist_id,
        last_track_added_at_utc=last_added,
        track_count_cached=track_count or 0,
        last_cached_at_utc=last_cached or now,
        updated_at_utc=now,
        is_dirty=0,
        last_snapshot_id=snapshot_id,
    )

    return {
        "playlist_id": playlist_id,
        "last_track_added_at_utc": last_added,
        "track_count_cached": track_count or 0,
        "last_cached_at_utc": last_cached or now,
        "is_dirty": 0,
        "updated_at_utc": now,
        "last_snapshot_id": snapshot_id,
    }


def mark_dirty(playlist_id: str) -> None:
    now = _now_iso()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE playlist_cache_facts
            SET is_dirty = 1, updated_at_utc = ?
            WHERE playlist_id = ?
            """,
            (now, playlist_id),
        )
        conn.commit()


def get_facts_for_playlists(playlist_ids: Iterable[str]) -> Dict[str, Dict]:
    ids = [pid for pid in playlist_ids if pid]
    if not ids:
        return {}

    placeholders = ",".join(["?"] * len(ids))
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT playlist_id, last_track_added_at_utc, track_count_cached,
                   last_cached_at_utc, is_dirty, updated_at_utc, last_snapshot_id, facts_version
            FROM playlist_cache_facts
            WHERE playlist_id IN ({placeholders})
            """,
            tuple(ids),
        )
        rows = cur.fetchall()

    result = {}
    for row in rows:
        result[row["playlist_id"]] = dict(row)
    return result


def get_facts_summary(playlist_ids: Iterable[str]) -> Dict:
    ids = [pid for pid in playlist_ids if pid]
    total = len(ids)
    if total == 0:
        return {
            "total_playlists": 0,
            "facts_count": 0,
            "dirty_count": 0,
            "coverage_ratio": 0,
        }

    placeholders = ",".join(["?"] * len(ids))
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
              COUNT(*) AS facts_count,
              SUM(CASE WHEN is_dirty = 1 THEN 1 ELSE 0 END) AS dirty_count
            FROM playlist_cache_facts
            WHERE playlist_id IN ({placeholders})
            """,
            tuple(ids),
        )
        row = cur.fetchone()

    facts_count = row["facts_count"] if row else 0
    dirty_count = row["dirty_count"] if row else 0
    coverage_ratio = facts_count / total if total else 0
    return {
        "total_playlists": total,
        "facts_count": facts_count,
        "dirty_count": dirty_count,
        "coverage_ratio": coverage_ratio,
    }


def get_playlist_ids_for_track(track_id: str) -> List[str]:
    if not track_id:
        return []
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT playlist_id
            FROM playlist_cache_items
            WHERE track_id = ?
            """,
            (track_id,),
        )
        return [row["playlist_id"] for row in cur.fetchall()]


def get_cached_track_ids(playlist_id: str) -> List[str]:
    if not playlist_id:
        return []
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT track_id
            FROM playlist_cache_items
            WHERE playlist_id = ?
              AND track_id IS NOT NULL
            """,
            (playlist_id,),
        )
        return [row["track_id"] for row in cur.fetchall()]


def get_cached_playlist_tracks(playlist_id: str, cutoff_iso: Optional[str] = None) -> List[Dict]:
    if not playlist_id:
        return []
    params: List[Optional[str]] = [playlist_id]
    cutoff_clause = ""
    if cutoff_iso:
        cutoff_clause = "AND tc.cached_at > ?"
        params.append(cutoff_iso)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT DISTINCT
                pci.track_id,
                tc.name,
                tc.artists_json,
                tc.duration_ms
            FROM playlist_cache_items pci
            JOIN track_cache tc ON tc.track_id = pci.track_id
            WHERE pci.playlist_id = ?
              {cutoff_clause}
            """,
            tuple(params),
        )
        return [dict(row) for row in cur.fetchall()]


def _get_last_reconcile_run() -> Optional[str]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT last_run_at_utc FROM cache_facts_runs WHERE id = 1")
        row = cur.fetchone()
    return row["last_run_at_utc"] if row else None


def _set_last_reconcile_run(now_iso: str) -> None:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO cache_facts_runs (id, last_run_at_utc)
            VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET last_run_at_utc = excluded.last_run_at_utc
            """,
            (now_iso,),
        )
        conn.commit()


def reconcile_facts_if_due(stale_days: int = 7) -> int:
    now = datetime.now(timezone.utc)
    last_run = _get_last_reconcile_run()
    if last_run:
        try:
            last_dt = datetime.fromisoformat(last_run)
            if now - last_dt < timedelta(hours=23):
                return 0
        except ValueError:
            pass

    updated = reconcile_facts(stale_days=stale_days)
    _set_last_reconcile_run(now.isoformat())
    return updated


def reconcile_facts(stale_days: int = 7) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=stale_days)).isoformat()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT playlist_id
            FROM playlist_cache_facts
            WHERE is_dirty = 1
               OR last_cached_at_utc < ?
               OR (last_track_added_at_utc IS NULL AND EXISTS (
                    SELECT 1 FROM playlist_cache_items pci
                    WHERE pci.playlist_id = playlist_cache_facts.playlist_id
               ))
            """,
            (cutoff,),
        )
        playlist_ids = [row["playlist_id"] for row in cur.fetchall()]

        cur.execute(
            """
            SELECT DISTINCT playlist_id
            FROM playlist_cache_items
            WHERE playlist_id NOT IN (SELECT playlist_id FROM playlist_cache_facts)
            """
        )
        playlist_ids.extend([row["playlist_id"] for row in cur.fetchall()])

    updated_count = 0
    for playlist_id in set(playlist_ids):
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT MAX(added_at) AS last_added,
                       COUNT(*) AS track_count,
                       MAX(cached_at) AS last_cached
                FROM playlist_cache_items
                WHERE playlist_id = ?
                """,
                (playlist_id,),
            )
            row = cur.fetchone()
            cur.execute(
                "SELECT last_snapshot_id FROM playlist_cache_facts WHERE playlist_id = ?",
                (playlist_id,),
            )
            snapshot_row = cur.fetchone()
        if not row or row["track_count"] == 0:
            continue
        now_iso = _now_iso()
        upsert_cache_facts(
            playlist_id=playlist_id,
            last_track_added_at_utc=row["last_added"],
            track_count_cached=row["track_count"],
            last_cached_at_utc=row["last_cached"] or now_iso,
            updated_at_utc=now_iso,
            is_dirty=0,
            last_snapshot_id=snapshot_row["last_snapshot_id"] if snapshot_row else None,
        )
        updated_count += 1

    return updated_count
