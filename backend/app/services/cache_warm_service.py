"""
Background playlist cache warming.

Fetches playlist details to warm the local cache without blocking API requests.
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional
from uuid import uuid4

from app.services.spotify_service import SpotifyService
from app.services.cache_service import CacheService
from app.utils.session_manager import SessionManager
from app.db import playlist_cache as playlist_cache_store
from app.db import operations as op_store

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="cache-worker")
_jobs_lock = threading.Lock()
_jobs_by_user: Dict[str, Dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def start_cache_warm_job(
    user_id: str,
    session_id: str,
    playlist_ids: Iterable[str],
    meta: Optional[Dict] = None,
) -> Dict:
    playlist_list = [pid for pid in playlist_ids if pid]
    if not playlist_list:
        return {
            "queued": 0,
            "job_id": None,
        }

    job_id = str(uuid4())
    job = {
        "job_id": job_id,
        "user_id": user_id,
        "status": "running",
        "total": len(playlist_list),
        "completed": 0,
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    with _jobs_lock:
        _jobs_by_user[user_id] = job

    _executor.submit(_run_cache_warm, user_id, session_id, playlist_list, job_id, meta)
    logger.info("Queued cache warm for %s playlists (user=%s)", len(playlist_list), user_id)
    return {
        "queued": len(playlist_list),
        "job_id": job_id,
    }


def get_cache_warm_status(user_id: str) -> Optional[Dict]:
    with _jobs_lock:
        job = _jobs_by_user.get(user_id)
        if not job:
            return None
        if job["status"] == "completed":
            updated = datetime.fromisoformat(job["updated_at"])
            if datetime.now(timezone.utc) - updated > timedelta(minutes=10):
                _jobs_by_user.pop(user_id, None)
                return None
        return dict(job)


def _update_job(user_id: str, **updates: Dict) -> None:
    with _jobs_lock:
        job = _jobs_by_user.get(user_id)
        if not job:
            return
        job.update(updates)
        job["updated_at"] = _now_iso()


def _run_cache_warm(
    user_id: str,
    session_id: str,
    playlist_ids: List[str],
    job_id: str,
    meta: Optional[Dict] = None,
) -> None:
    spotify_service = SpotifyService(session_manager=SessionManager(session_id=session_id))
    record_modes = {"refresh_changed", "refresh_full"}

    for playlist_id in playlist_ids:
        try:
            facts = playlist_cache_store.get_facts_for_playlists([playlist_id]).get(playlist_id) or {}
            snapshot_before = facts.get("last_snapshot_id")
            cached_count_before = facts.get("track_count_cached") or 0
            playlist = spotify_service.get_playlist_details(playlist_id, should_warm_cache=True)
            snapshot_id = getattr(playlist, "snapshot_id", None)
            items = []
            for idx, track in enumerate(playlist.tracks or []):
                if not track or not getattr(track, "id", None):
                    continue
                added_at = track.added_at.isoformat() if getattr(track, "added_at", None) else None
                items.append(
                    {
                        "position": idx,
                        "track_id": track.id,
                        "added_at": added_at,
                    }
                )
            playlist_cache_store.refresh_cached_playlist(
                playlist_id=playlist_id,
                items=items,
                snapshot_id=snapshot_id,
            )
            if meta and meta.get("mode") in record_modes:
                op_store.cleanup_expired()
                op_store.record_operation(
                    playlist_id=playlist_id,
                    user_id=user_id,
                    op_type="cache_refresh_full" if meta.get("mode") == "refresh_full" else "cache_refresh",
                    snapshot_before=snapshot_before,
                    snapshot_after=snapshot_id,
                    payload={
                        "source": meta.get("source"),
                        "schedule_id": meta.get("schedule_id"),
                        "mode": meta.get("mode"),
                        "cached_track_count_before": cached_count_before,
                        "cached_track_count_after": len(items),
                    },
                    changes_made=False,
                )
            logger.info("Warmed cache for playlist %s (user=%s)", playlist_id, user_id)
        except Exception as exc:
            playlist_cache_store.mark_dirty(playlist_id)
            logger.warning("Failed to warm cache for playlist %s (user=%s): %s", playlist_id, user_id, exc)
        finally:
            with _jobs_lock:
                current_completed = _jobs_by_user.get(user_id, {}).get("completed", 0)
            _update_job(user_id, completed=current_completed + 1)

    # After caching all playlists, enrich metadata
    try:
        logger.info("Starting metadata enrichment for user %s", user_id)
        _update_job(user_id, status="enriching_artists")
        
        # Get all cached track IDs to extract artist IDs
        from app.db.database import get_db_connection
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT artists_json FROM track_cache")
            rows = cursor.fetchall()
            
        # Extract unique artist IDs
        artist_ids = set()
        import json
        for row in rows:
            try:
                artists = json.loads(row[0]) if row[0] else []
                for artist in artists:
                    if isinstance(artist, dict) and artist.get('id'):
                        artist_ids.add(artist['id'])
            except:
                continue
        
        # Enrich artists in batches
        if artist_ids:
            artist_id_list = list(artist_ids)
            batch_size = 50
            enriched_artists = 0
            for i in range(0, len(artist_id_list), batch_size):
                batch = artist_id_list[i:i + batch_size]
                cached_artists, missing_ids = CacheService.get_artists(batch, session_id)
                if missing_ids:
                    artists_data = spotify_service.get_artists(list(missing_ids))
                    if artists_data:
                        enriched_artists += CacheService.set_artists(artists_data, session_id)
            
            logger.info("Enriched %d artists for user %s", enriched_artists, user_id)
        
        # Enrich audio features
        _update_job(user_id, status="enriching_audio_features")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT track_id FROM track_cache")
            track_ids = [row[0] for row in cursor.fetchall()]
        
        if track_ids:
            batch_size = 100
            enriched_features = 0
            for i in range(0, len(track_ids), batch_size):
                batch = track_ids[i:i + batch_size]
                cached_features, missing_ids = CacheService.get_audio_features(batch)
                if missing_ids:
                    features_data = spotify_service.get_audio_features(list(missing_ids))
                    if features_data:
                        enriched_features += CacheService.set_audio_features(features_data)
            
            logger.info("Enriched audio features for %d tracks (user=%s)", enriched_features, user_id)
    except Exception as exc:
        logger.warning("Failed to enrich metadata for user %s: %s", user_id, exc)

    _update_job(user_id, status="completed")
