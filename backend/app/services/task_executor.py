"""
Background task executor for long-running sort operations.

Uses threading to run sort jobs in the background while keeping
the API responsive.
"""

import threading
import logging
import asyncio
from typing import Dict
from concurrent.futures import ThreadPoolExecutor

from app.services.job_service import SortJobService
from app.services.spotify_service import SpotifyService
from app.utils.session_manager import SessionManager
from app.services.sort_service import (
    sort_playlist_fast,
    sort_playlist_preserve_dates,
    calculate_moves_needed,
    estimate_sort_time,
    get_sort_key_function
)
from app.db import operations as op_store
from app.db import playlist_cache as playlist_cache_store

logger = logging.getLogger(__name__)

# Global executor for background tasks
# Increased from 3 to 10 to handle more concurrent users (Phase 1 improvement)
_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="sort-worker")

# Track running jobs for cancellation
_running_jobs: Dict[str, threading.Event] = {}


def start_sort_job(
    job_id: str,
    playlist_id: str,
    user_id: str,
    sort_by: str,
    direction: str,
    method: str,
    session_id: str,
    meta: dict | None = None,
):
    """
    Start a sort job in the background.
    
    This is the entry point that submits work to the thread pool.
    """
    # Create cancellation event
    cancel_event = threading.Event()
    _running_jobs[job_id] = cancel_event
    
    # Submit to thread pool
    _executor.submit(
        _run_sort_job,
        job_id,
        playlist_id,
        user_id,
        sort_by,
        direction,
        method,
        session_id,
        cancel_event,
        meta or {},
    )
    
    logger.info(f"Sort job {job_id} submitted to background executor")


def cancel_sort_job(job_id: str) -> bool:
    """
    Request cancellation of a running sort job.
    
    Returns:
        True if job was found and cancellation requested
    """
    if job_id in _running_jobs:
        _running_jobs[job_id].set()
        logger.info(f"Cancellation requested for job {job_id}")
        return True
    return False


def _run_sort_job(
    job_id: str,
    playlist_id: str,
    user_id: str,
    sort_by: str,
    direction: str,
    method: str,
    session_id: str,
    cancel_event: threading.Event,
    meta: dict,
):
    """
    Execute the sort job in a background thread.
    
    This function handles the entire sort operation including:
    - Fetching playlist tracks
    - Calculating what needs to be moved
    - Executing the sort
    - Updating job status
    """
    try:
        logger.info(f"Starting sort job {job_id}: playlist={playlist_id}, method={method}, sort_by={sort_by}")
        
        # Update job status
        SortJobService.update_job(job_id, status='in_progress', message='Fetching playlist tracks...')
        
        # Get Spotify client for this user
        spotify_service = SpotifyService(session_manager=SessionManager(session_id=session_id))
        sp = spotify_service.get_spotify_client(user_id)
        
        if not sp:
            raise Exception("Failed to get Spotify client - authentication may have expired")
        
        snapshot_before = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
        
        # Fetch all playlist tracks
        tracks = []
        offset = 0
        limit = 100
        
        while True:
            if cancel_event.is_set():
                SortJobService.update_job(job_id, status='cancelled', message='Cancelled by user')
                return
            
            result = sp.playlist_items(
                playlist_id,
                limit=limit,
                offset=offset,
                fields='items(track(id,name,uri,artists(id,name),album(id,name,images,release_date,release_date_precision),duration_ms,explicit,popularity,preview_url),added_at),total'
            )
            
            # Extract tracks from items
            for item in result['items']:
                if item and item.get('track'):
                    track = item['track']
                    track['added_at'] = item.get('added_at')
                    tracks.append(track)
            
            if len(result['items']) < limit:
                break
            
            offset += limit
            SortJobService.update_job(
                job_id,
                message=f'Fetching tracks... ({len(tracks)} loaded)'
            )
        
        logger.info(f"Fetched {len(tracks)} tracks for job {job_id}")
        
        # Calculate how many tracks need to be moved
        key_func, reverse = get_sort_key_function(sort_by, direction)
        sorted_tracks = sorted(tracks, key=key_func, reverse=reverse)
        tracks_to_move = calculate_moves_needed(tracks, sorted_tracks)
        total_moves = tracks_to_move if method == 'preserve' else len(tracks)
        
        # Estimate time
        estimated_seconds = estimate_sort_time(len(tracks), tracks_to_move, method)
        
        # Update job with analysis
        SortJobService.update_job(
            job_id,
            total=total_moves,
            message=f'Analyzing: {tracks_to_move} tracks need repositioning (est. {estimated_seconds}s)'
        )
        
        logger.info(f"Job {job_id}: {tracks_to_move}/{len(tracks)} tracks need moving")
        original_order = [t.get("uri") for t in tracks if t.get("uri")]
        
        # Define progress callback
        def progress_callback(current: int, message: str):
            if not cancel_event.is_set():
                SortJobService.update_job(job_id, progress=current, message=message)
        
        # Define cancellation check
        def should_cancel():
            return cancel_event.is_set()
        
        # Execute sort
        if method == 'fast':
            asyncio.run(sort_playlist_fast(
                sp, playlist_id, tracks, sort_by, direction, progress_callback
            ))
        else:  # preserve
            asyncio.run(sort_playlist_preserve_dates(
                sp, playlist_id, tracks, sort_by, direction,
                progress_callback, should_cancel
            ))
        
        # Check if cancelled during sort
        if cancel_event.is_set():
            SortJobService.update_job(
                job_id,
                status='cancelled',
                message='Sort cancelled by user'
            )
            logger.info(f"Job {job_id} was cancelled")
        else:
            # Mark as completed
            SortJobService.update_job(
                job_id,
                status='completed',
                progress=total_moves,
                total=total_moves,
                message=(
                    "Playlist already sorted." if tracks_to_move == 0
                    else f'Sort completed successfully! {len(tracks)} tracks sorted.'
                )
            )
            logger.info(f"Job {job_id} completed successfully")

            try:
                snapshot_after = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
                op_store.cleanup_expired()
                # Track whether changes were actually made
                changes_made = tracks_to_move > 0
                op_store.record_operation(
                    playlist_id=playlist_id,
                    user_id=user_id,
                    op_type="sort_reorder",
                    snapshot_before=snapshot_before,
                    snapshot_after=snapshot_after,
                    payload={
                        "original_order": original_order,
                        "sort_by": sort_by,
                        "direction": direction,
                        "method": method,
                        "source": meta.get("source") if meta else None,
                        "schedule_id": meta.get("schedule_id") if meta else None,
                        "tracks_moved": tracks_to_move,
                    },
                    changes_made=changes_made,
                )
                if changes_made:
                    playlist_cache_store.mark_dirty(playlist_id)
            except Exception as log_err:
                logger.warning("Failed to persist sort undo record for job %s: %s", job_id, log_err)
        
    except Exception as e:
        logger.error(f"Error in sort job {job_id}: {e}", exc_info=True)
        SortJobService.update_job(
            job_id,
            status='failed',
            error=str(e),
            message=f'Sort failed: {str(e)}'
        )
    
    finally:
        # Clean up cancellation event
        if job_id in _running_jobs:
            del _running_jobs[job_id]
