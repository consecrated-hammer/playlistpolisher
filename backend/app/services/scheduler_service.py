import threading
import time
import logging
from datetime import datetime, timezone
from typing import Optional

from app.db import schedules as schedule_store
from app.services.spotify_service import SpotifyService
from app.services.task_executor import start_sort_job
from app.services.job_service import SortJobService
from app.utils.session_manager import SessionManager
from app.services.cache_service import CacheService
from app.services.cache_warm_service import start_cache_warm_job
from app.db import playlist_cache as playlist_cache_store

logger = logging.getLogger(__name__)


class SchedulerService:
    """Lightweight scheduler for recurring playlist actions."""

    def __init__(self, poll_seconds: int = 60):
        self.poll_seconds = poll_seconds
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="scheduler", daemon=True)
        self._thread.start()
        logger.info("Scheduler thread started")

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
            logger.info("Scheduler thread stopped")

    def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                self.run_due()
            except Exception as exc:
                logger.error("Scheduler loop error: %s", exc, exc_info=True)
            time.sleep(self.poll_seconds)

    def run_due(self):
        now = datetime.now(timezone.utc).isoformat()
        try:
            playlist_cache_store.reconcile_facts_if_due()
        except Exception as exc:
            logger.warning("Playlist cache facts reconcile failed: %s", exc)
        due = schedule_store.due_schedules(now_iso=now, limit=10)
        for sched in due:
            self._run_schedule(sched)

    def _run_schedule(self, sched: dict):
        action_type = sched.get("action_type")
        params = sched.get("params") or {}
        playlist_id = sched.get("playlist_id")
        user_id = sched.get("user_id")
        session_id = sched.get("session_id")
        frequency_minutes = sched.get("frequency_minutes") or 1440
        schedule_id = sched.get("id")

        try:
            if action_type == "sort":
                self._run_sort_schedule(playlist_id, user_id, session_id, params, schedule_id)
            elif action_type == "cache_clear":
                removed = CacheService.clear_expired()
                logger.info("Scheduled cache cleanup removed %s expired tracks", removed)
            elif action_type in {"cache_refresh", "cache_refresh_full"}:
                self._run_cache_refresh_schedule(action_type, user_id, session_id, schedule_id)
            else:
                logger.warning("Unsupported scheduled action %s", action_type)
                schedule_store.mark_run(schedule_id, user_id, frequency_minutes, success=False, error="Unsupported action")
                return

            schedule_store.mark_run(schedule_id, user_id, frequency_minutes, success=True, error=None)
        except Exception as exc:
            logger.error("Scheduled action failed (id=%s): %s", schedule_id, exc, exc_info=True)
            schedule_store.mark_run(schedule_id, user_id, frequency_minutes, success=False, error=str(exc))

    def _run_sort_schedule(self, playlist_id: str, user_id: str, session_id: Optional[str], params: dict, schedule_id: int):
        sort_by = params.get("sort_by", "date_added")
        direction = params.get("direction", "desc")
        method = params.get("method", "preserve")

        # Skip if sort already in progress
        active = SortJobService.get_active_job_for_playlist(playlist_id)
        if active and active.get("user_id") == user_id:
            logger.info("Skipping scheduled sort; job already active for playlist %s", playlist_id)
            return

        session_mgr = SessionManager(session_id=session_id)
        spotify_service = SpotifyService(session_manager=session_mgr)
        sp = spotify_service.get_spotify_client(user_id)
        if not sp:
            raise Exception("Spotify authentication expired for scheduled task")

        # Quick count to mirror start_sort
        result = sp.playlist_items(playlist_id, limit=1, fields="total")
        total_tracks = result.get("total", 0)

        job_id = SortJobService.create_job(
            playlist_id=playlist_id,
            user_id=user_id,
            sort_by=sort_by,
            direction=direction,
            method=method,
            total_tracks=total_tracks,
            tracks_to_move=0,
            estimated_time=0,
        )

        start_sort_job(
            job_id=job_id,
            playlist_id=playlist_id,
            user_id=user_id,
            sort_by=sort_by,
            direction=direction,
            method=method,
            session_id=session_id or session_mgr.session_id,
            meta={"source": "scheduled", "schedule_id": schedule_id},
        )

    def _get_playlists_to_refresh(self, playlists: list) -> list:
        playlist_ids = [p.id for p in playlists if getattr(p, "id", None)]
        if not playlist_ids:
            return []
        facts_map = playlist_cache_store.get_facts_for_playlists(playlist_ids)
        to_refresh = []
        for playlist in playlists:
            playlist_id = getattr(playlist, "id", None)
            if not playlist_id:
                continue
            fact = facts_map.get(playlist_id)
            if not fact or not fact.get("last_snapshot_id"):
                to_refresh.append(playlist_id)
                continue
            if not getattr(playlist, "snapshot_id", None):
                to_refresh.append(playlist_id)
                continue
            if fact.get("last_snapshot_id") != playlist.snapshot_id:
                to_refresh.append(playlist_id)
                continue
            if fact.get("is_dirty") == 1:
                to_refresh.append(playlist_id)
        return to_refresh

    def _run_cache_refresh_schedule(self, action_type: str, user_id: str, session_id: Optional[str], schedule_id: int):
        session_mgr = SessionManager(session_id=session_id)
        spotify_service = SpotifyService(session_manager=session_mgr)
        sp = spotify_service.get_spotify_client(user_id)
        if not sp:
            raise Exception("Spotify authentication expired for scheduled cache refresh")

        playlists = spotify_service.get_user_playlists()
        if not playlists:
            logger.info("No playlists found for scheduled cache refresh (user=%s)", user_id)
            return

        if action_type == "cache_refresh_full":
            if not session_id:
                raise Exception("Session required for full cache refresh")
            CacheService.clear_user_cache(session_id)
            playlist_ids = [p.id for p in playlists if getattr(p, "id", None)]
            mode = "refresh_full"
        else:
            playlist_ids = self._get_playlists_to_refresh(playlists)
            mode = "refresh_changed"

        if not playlist_ids:
            logger.info("Scheduled cache refresh found no playlists to update (user=%s)", user_id)
            return

        start_cache_warm_job(
            user_id=user_id,
            session_id=session_id or session_mgr.session_id,
            playlist_ids=playlist_ids,
            meta={"source": "scheduled", "schedule_id": schedule_id, "mode": mode},
        )


# Singleton scheduler used by app lifespan
scheduler = SchedulerService()
