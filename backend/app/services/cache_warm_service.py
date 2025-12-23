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
from app.utils.session_manager import SessionManager
from app.db import playlist_cache as playlist_cache_store

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="cache-worker")
_jobs_lock = threading.Lock()
_jobs_by_user: Dict[str, Dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def start_cache_warm_job(user_id: str, session_id: str, playlist_ids: Iterable[str]) -> Dict:
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

    _executor.submit(_run_cache_warm, user_id, session_id, playlist_list, job_id)
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


def _run_cache_warm(user_id: str, session_id: str, playlist_ids: List[str], job_id: str) -> None:
    spotify_service = SpotifyService(session_manager=SessionManager(session_id=session_id))

    for playlist_id in playlist_ids:
        try:
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
            logger.info("Warmed cache for playlist %s (user=%s)", playlist_id, user_id)
        except Exception as exc:
            playlist_cache_store.mark_dirty(playlist_id)
            logger.warning("Failed to warm cache for playlist %s (user=%s): %s", playlist_id, user_id, exc)
        finally:
            with _jobs_lock:
                current_completed = _jobs_by_user.get(user_id, {}).get("completed", 0)
            _update_job(user_id, completed=current_completed + 1)

    _update_job(user_id, status="completed")
