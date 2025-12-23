"""
API routes for playlist sorting operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, Literal
import logging

from app.services.job_service import SortJobService
from app.services.task_executor import start_sort_job, cancel_sort_job
from app.services.spotify_service import SpotifyService
from app.services.sort_service import (
    calculate_moves_needed,
    estimate_sort_time,
    get_sort_key_function
)
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME
from app.services.spotify_service import get_spotify_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/playlists/{playlist_id}/sort", tags=["sorting"])


# Request/Response models
class SortRequest(BaseModel):
    """Request to start a playlist sort."""
    sort_by: Literal['title', 'artist', 'album', 'release_date', 'date_added', 'duration'] = 'date_added'
    direction: Literal['asc', 'desc'] = 'desc'
    method: Literal['fast', 'preserve'] = 'preserve'


class SortAnalysisResponse(BaseModel):
    """Analysis of what a sort operation would do."""
    total_tracks: int
    tracks_to_move: int
    estimated_time_seconds: int
    method: str
    warning: Optional[str] = None


class SortJobResponse(BaseModel):
    """Response when starting a sort job."""
    job_id: str
    status: str
    message: str


class SortStatusResponse(BaseModel):
    """Status of a running sort job."""
    job_id: str
    playlist_id: str
    sort_by: str
    direction: str
    method: str
    status: str
    progress: int
    total: int
    message: Optional[str]
    error: Optional[str]
    started_at: str
    updated_at: str
    completed_at: Optional[str]
    tracks_to_move: Optional[int]
    estimated_time: Optional[int]


def get_session_manager(request: Request) -> SessionManager:
    """Extract session manager from cookie."""
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


@router.post("/analyze", response_model=SortAnalysisResponse)
async def analyze_sort(
    playlist_id: str,
    request: SortRequest,
    session_mgr: SessionManager = Depends(get_session_manager),
    spotify_service: SpotifyService = Depends(get_spotify_service)
):
    """
    Analyze what a sort operation would do without actually sorting.
    
    Returns how many tracks would need to be moved and estimated time.
    """
    try:
        if not session_mgr.is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated")
        
        user_id = session_mgr.get_user_id()
        
        # Get Spotify client
        sp = spotify_service.get_spotify_client(user_id)
        
        if not sp:
            raise HTTPException(status_code=401, detail="Spotify authentication expired")
        
        # Fetch playlist tracks
        tracks = []
        offset = 0
        limit = 100
        
        while True:
            result = sp.playlist_items(
                playlist_id,
                limit=limit,
                offset=offset,
                fields='items(track(id,name,uri,artists(name),album(name),duration_ms),added_at),total'
            )
            
            for item in result['items']:
                if item and item.get('track'):
                    track = item['track']
                    track['added_at'] = item.get('added_at')
                    tracks.append(track)
            
            if len(result['items']) < limit:
                break
            
            offset += limit
        
        # Calculate moves needed
        key_func, reverse = get_sort_key_function(request.sort_by, request.direction)
        sorted_tracks = sorted(tracks, key=key_func, reverse=reverse)
        tracks_to_move = calculate_moves_needed(tracks, sorted_tracks)
        
        # Estimate time
        estimated_time = estimate_sort_time(len(tracks), tracks_to_move, request.method)
        
        # Warning for fast method
        warning = None
        if request.method == 'fast':
            warning = "⚠️ Fast method will reset the 'Date Added' field for all tracks"
        
        return SortAnalysisResponse(
            total_tracks=len(tracks),
            tracks_to_move=tracks_to_move,
            estimated_time_seconds=int(estimated_time),
            method=request.method,
            warning=warning
        )
    
    except Exception as e:
        logger.error(f"Error analyzing sort for playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=SortJobResponse)
async def start_sort(
    playlist_id: str,
    request: SortRequest,
    session_mgr: SessionManager = Depends(get_session_manager),
    spotify_service: SpotifyService = Depends(get_spotify_service)
):
    """
    Start a playlist sort operation in the background.
    
    Returns a job_id that can be used to track progress.
    """
    try:
        if not session_mgr.is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated")
        
        user_id = session_mgr.get_user_id()
        
        # Check per-user job limits (Phase 1 improvement)
        MAX_CONCURRENT_JOBS = 2  # Per-user concurrency limit
        active_count = SortJobService.get_user_active_job_count(user_id)
        
        if active_count >= MAX_CONCURRENT_JOBS:
            raise HTTPException(
                status_code=429,
                detail=f"You have {active_count} jobs in progress. Please wait for them to complete before starting a new one."
            )
        
        # Check if there's already an active sort for this playlist
        active_job = SortJobService.get_active_job_for_playlist(playlist_id)
        if active_job:
            return SortJobResponse(
                job_id=active_job['job_id'],
                status=active_job['status'],
                message=f"Sort already in progress: {active_job['message']}"
            )
        
        # Get Spotify client to fetch tracks for analysis
        sp = spotify_service.get_spotify_client(user_id)
        
        if not sp:
            raise HTTPException(status_code=401, detail="Spotify authentication expired")
        
        # Quick fetch to get track count
        result = sp.playlist_items(playlist_id, limit=1, fields='total')
        total_tracks = result['total']
        
        # Create job with estimates (actual calculation happens in background)
        job_id = SortJobService.create_job(
            playlist_id=playlist_id,
            user_id=user_id,
            sort_by=request.sort_by,
            direction=request.direction,
            method=request.method,
            total_tracks=total_tracks,
            tracks_to_move=0,  # Will be calculated in background
            estimated_time=0   # Will be calculated in background
        )
        
        # Start background task
        start_sort_job(
            job_id=job_id,
            playlist_id=playlist_id,
            user_id=user_id,
            sort_by=request.sort_by,
            direction=request.direction,
            method=request.method,
            session_id=session_mgr.session_id
        )
        
        return SortJobResponse(
            job_id=job_id,
            status='pending',
            message='Sort job started'
        )
    
    except Exception as e:
        logger.error(f"Error starting sort for playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{job_id}", response_model=SortStatusResponse)
async def get_sort_status(
    playlist_id: str,
    job_id: str,
    session_mgr: SessionManager = Depends(get_session_manager)
):
    """
    Get the status of a sort job.
    """
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    job = SortJobService.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Verify user owns this job
    if job['user_id'] != session_mgr.get_user_id():
        raise HTTPException(status_code=403, detail="Not authorized to view this job")
    
    return SortStatusResponse(**job)


@router.get("/active")
async def get_active_sort(
    playlist_id: str,
    session_mgr: SessionManager = Depends(get_session_manager)
):
    """
    Check if there's an active sort job for this playlist.
    """
    job = SortJobService.get_active_job_for_playlist(playlist_id)
    
    if job and job['user_id'] == session_mgr.get_user_id():
        return SortStatusResponse(**job)
    
    return None


@router.delete("/{job_id}")
async def cancel_sort(
    playlist_id: str,
    job_id: str,
    session_mgr: SessionManager = Depends(get_session_manager)
):
    """
    Cancel a running sort job.
    """
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    job = SortJobService.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Verify user owns this job
    if job['user_id'] != session_mgr.get_user_id():
        raise HTTPException(status_code=403, detail="Not authorized to cancel this job")
    
    # Check if job is still running
    if job['status'] not in ['pending', 'in_progress']:
        return {"message": "Job is not running", "status": job['status']}
    
    # Request cancellation
    cancelled = cancel_sort_job(job_id)
    
    if cancelled:
        SortJobService.cancel_job(job_id)
        return {"message": "Cancellation requested", "status": "cancelled"}
    else:
        # Job not in running jobs dict, mark as cancelled anyway
        SortJobService.cancel_job(job_id)
        return {"message": "Job cancelled", "status": "cancelled"}
