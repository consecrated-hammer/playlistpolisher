"""
Cache management routes for Playlist Polisher.

Provides endpoints for viewing cache statistics and managing cached track data.
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List

from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME
from app.services.cache_service import CacheService
from app.services.spotify_service import SpotifyService, get_spotify_service
from app.services.cache_warm_service import start_cache_warm_job, get_cache_warm_status
from app.db import playlist_cache as playlist_cache_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cache", tags=["cache"])


def get_session_manager(request: Request) -> SessionManager:
    """Extract session manager from the incoming request cookie."""
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


def require_auth(session_mgr: SessionManager = Depends(get_session_manager)) -> SessionManager:
    """Authentication dependency - validates user is authenticated."""
    if not session_mgr.is_authenticated():
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please login with Spotify."
        )
    return session_mgr


class CacheStatsResponse(BaseModel):
    """Response model for cache statistics."""
    total_cached: int
    expired: int
    total_in_db: int
    user_tracks: Optional[int]
    ttl_days: int
    cutoff_date: str


class CacheWarmRequest(BaseModel):
    """Request model for warming playlist cache."""
    playlist_ids: List[str]
    source: Optional[str] = None
    mode: Optional[str] = None
    schedule_id: Optional[int] = None


class CacheWarmStatusResponse(BaseModel):
    """Response model for cache warm status."""
    status: str
    total: int
    completed: int
    updated_at: str


class PlaylistFactsRequest(BaseModel):
    """Request model for playlist cache facts."""
    playlist_ids: List[str]


class PlaylistFactsResponse(BaseModel):
    """Response for playlist cache facts lookup."""
    facts: List[dict]
    summary: dict


class PlaylistCacheStatusResponse(BaseModel):
    """Response for playlist cache freshness check."""
    playlist_id: str
    cached: bool
    needs_refresh: bool
    is_dirty: bool
    last_snapshot_id: Optional[str]
    current_snapshot_id: Optional[str]
    cached_track_count: int
    current_track_count: int
    checked_at: str


class TrackPlaylistsResponse(BaseModel):
    playlists: List[dict]


@router.get("/stats", response_model=CacheStatsResponse)
async def get_cache_stats(
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Get Cache Statistics
    
    Returns statistics about the track metadata cache, including:
    - Total number of cached tracks (not expired)
    - Number of expired tracks
    - Number of tracks used by the current user
    - TTL configuration
    
    Returns:
        CacheStatsResponse: Cache statistics
        
    Raises:
        HTTPException: 401 if not authenticated
        
    Example Response:
        {
            "total_cached": 2543,
            "expired": 87,
            "total_in_db": 2630,
            "user_tracks": 342,
            "ttl_days": 30,
            "cutoff_date": "2024-11-17T10:30:00"
        }
    """
    try:
        session_id = session_mgr.session_id
        stats = CacheService.get_cache_stats(session_id)
        logger.info(f"Retrieved cache stats for user: {stats}")
        return stats
    except Exception as e:
        logger.error(f"Failed to get cache stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve cache statistics")


class PlaylistCacheStatsRequest(BaseModel):
    """Request model for playlist cache statistics."""
    track_ids: List[str]


class PlaylistCacheStatsResponse(BaseModel):
    """Response model for playlist-specific cache statistics."""
    user_cached_tracks: int
    user_expired_tracks: int
    total_cached_tracks: int


@router.get("/stats/playlist/{playlist_id}", response_model=PlaylistCacheStatsResponse)
async def get_playlist_cache_stats_by_id(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Get Playlist-Specific Cache Statistics (Efficient)
    
    Returns cache statistics for a specific playlist using the playlist_cache_facts table.
    Much more efficient than the POST endpoint that requires all track IDs.
    
    Args:
        playlist_id: Spotify playlist ID
    
    Returns:
        PlaylistCacheStatsResponse: Playlist-specific cache statistics
        
    Raises:
        HTTPException: 401 if not authenticated
        
    Example Response:
        {
            "user_cached_tracks": 89,
            "user_expired_tracks": 5,
            "total_cached_tracks": 234
        }
    """
    try:
        session_id = session_mgr.session_id
        stats = CacheService.get_playlist_cache_stats_by_id(playlist_id, session_id)
        logger.info(f"Retrieved playlist cache stats for {playlist_id}: {stats}")
        return stats
    except Exception as e:
        logger.error(f"Failed to get playlist cache stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve playlist cache statistics")


@router.post("/stats/playlist", response_model=PlaylistCacheStatsResponse)
async def get_playlist_cache_stats(
    body: PlaylistCacheStatsRequest,
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Get Playlist-Specific Cache Statistics (Legacy - requires track IDs)
    
    Returns cache statistics for a specific playlist's tracks, including:
    - Number of tracks from this playlist cached for the current user
    - Number of expired tracks from this playlist for the current user
    - Total number of tracks from this playlist cached (all users)
    
    Note: This endpoint is less efficient than GET /stats/playlist/{playlist_id}
    as it requires sending all track IDs. Use the GET endpoint when possible.
    
    Args:
        body: Request with track_ids from the playlist
    
    Returns:
        PlaylistCacheStatsResponse: Playlist-specific cache statistics
        
    Raises:
        HTTPException: 401 if not authenticated
        
    Example Response:
        {
            "user_cached_tracks": 89,
            "user_expired_tracks": 5,
            "total_cached_tracks": 234
        }
    """
    try:
        session_id = session_mgr.session_id
        stats = CacheService.get_playlist_cache_stats(body.track_ids, session_id)
        logger.info(f"Retrieved playlist cache stats: {stats}")
        # Map old field names to new for backward compatibility
        return {
            'user_cached_tracks': stats.get('user_tracks', 0),
            'user_expired_tracks': stats.get('user_expired', 0),
            'total_cached_tracks': stats.get('total_tracks', 0)
        }
    except Exception as e:
        logger.error(f"Failed to get playlist cache stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve playlist cache statistics")


@router.post("/clear/expired")
async def clear_expired_cache(
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Clear Expired Cache Entries
    
    Removes all expired track metadata from the cache based on TTL setting.
    This is a maintenance operation that frees up database space.
    
    Returns:
        dict: Number of tracks removed
        
    Raises:
        HTTPException: 401 if not authenticated
        
    Example Response:
        {
            "removed": 87,
            "message": "Removed 87 expired tracks from cache"
        }
    """
    try:
        removed = CacheService.clear_expired()
        logger.info(f"Cleared {removed} expired cache entries")
        return {
            "removed": removed,
            "message": f"Removed {removed} expired tracks from cache"
        }
    except Exception as e:
        logger.error(f"Failed to clear expired cache: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear expired cache")


@router.post("/warm/playlists")
async def warm_playlist_cache(
    body: CacheWarmRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    """
    Warm Playlist Cache

    Starts a background job that fetches the selected playlists so their
    metadata is cached locally.
    """
    try:
        user_id = session_mgr.get_user_id()
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
        meta = {
            "source": body.source,
            "mode": body.mode,
            "schedule_id": body.schedule_id,
        }
        result = start_cache_warm_job(user_id, session_mgr.session_id, body.playlist_ids, meta=meta)
        queued = result.get("queued", 0)
        return {
            "queued": queued,
            "job_id": result.get("job_id"),
            "message": f"Queued caching for {queued} playlists" if queued else "No playlists selected for caching",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to warm playlist cache: {e}")
        raise HTTPException(status_code=500, detail="Failed to warm playlist cache")


@router.get("/warm/status", response_model=CacheWarmStatusResponse)
async def get_cache_warm_status_route(
    session_mgr: SessionManager = Depends(require_auth),
):
    """Return current cache warm status for the user."""
    try:
        user_id = session_mgr.get_user_id()
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
        status = get_cache_warm_status(user_id)
        if not status:
            return {
                "status": "idle",
                "total": 0,
                "completed": 0,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        return {
            "status": status.get("status", "idle"),
            "total": status.get("total", 0),
            "completed": status.get("completed", 0),
            "updated_at": status.get("updated_at") or datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get cache warm status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get cache warm status")


@router.post("/playlist-facts", response_model=PlaylistFactsResponse)
async def get_playlist_facts(
    body: PlaylistFactsRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    """Return cached playlist facts for the given playlist IDs."""
    try:
        _ = session_mgr.get_user_id()
        facts_map = playlist_cache_store.get_facts_for_playlists(body.playlist_ids)
        summary = playlist_cache_store.get_facts_summary(body.playlist_ids)
        return {
            "facts": list(facts_map.values()),
            "summary": summary,
        }
    except Exception as e:
        logger.error(f"Failed to get playlist cache facts: {e}")
        raise HTTPException(status_code=500, detail="Failed to get playlist cache facts")


@router.get("/playlist/{playlist_id}/status", response_model=PlaylistCacheStatusResponse)
async def get_playlist_cache_status(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    """Return cache freshness status for a playlist without loading full tracks."""
    try:
        _ = session_mgr.get_user_id()
        meta = spotify.get_playlist_context_meta(playlist_id)
        facts = playlist_cache_store.get_facts_for_playlists([playlist_id]).get(playlist_id)

        last_snapshot_id = facts.get("last_snapshot_id") if facts else None
        cached_track_count = facts.get("track_count_cached") if facts else 0
        is_dirty = bool(facts.get("is_dirty")) if facts else True
        current_snapshot_id = meta.snapshot_id
        current_track_count = meta.total_tracks or 0

        snapshot_mismatch = bool(last_snapshot_id) and bool(current_snapshot_id) and last_snapshot_id != current_snapshot_id
        count_mismatch = cached_track_count != current_track_count
        missing_cache = not facts or not last_snapshot_id
        needs_refresh = missing_cache or is_dirty or snapshot_mismatch or count_mismatch

        if (snapshot_mismatch or count_mismatch) and facts:
            playlist_cache_store.mark_dirty(playlist_id)

        return {
            "playlist_id": playlist_id,
            "cached": bool(facts),
            "needs_refresh": needs_refresh,
            "is_dirty": is_dirty,
            "last_snapshot_id": last_snapshot_id,
            "current_snapshot_id": current_snapshot_id,
            "cached_track_count": cached_track_count,
            "current_track_count": current_track_count,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get playlist cache status for {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get playlist cache status")


@router.get("/track/{track_id}/playlists", response_model=TrackPlaylistsResponse)
async def get_track_playlists(
    track_id: str,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    """Return cached playlists that contain a track, mapped to user playlists."""
    try:
        user_id = session_mgr.get_user_id()
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
        cached_ids = playlist_cache_store.get_playlist_ids_for_track(track_id)
        if not cached_ids:
            return {"playlists": []}
        cached_id_set = set(cached_ids)
        playlists = spotify.get_user_playlists()
        results = []
        for playlist in playlists:
            if playlist.id in cached_id_set:
                results.append({
                    "id": playlist.id,
                    "name": playlist.name,
                    "spotify_url": f"https://open.spotify.com/playlist/{playlist.id}",
                })
        return {"playlists": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get playlists for track {track_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get track playlist matches")


@router.post("/clear/user")
async def clear_user_cache(
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Clear User's Cache
    
    Removes all track usage entries for the current user and orphaned tracks.
    This allows the user to "refresh" their cache by clearing tracks they've used.
    
    Returns:
        dict: Number of tracks removed
        
    Raises:
        HTTPException: 401 if not authenticated
        
    Example Response:
        {
            "removed": 342,
            "message": "Cleared 342 tracks from your cache"
        }
    """
    try:
        session_id = session_mgr.session_id
        removed = CacheService.clear_user_cache(session_id)
        logger.info(f"Cleared {removed} cache entries for user {session_id}")
        return {
            "removed": removed,
            "message": f"Cleared {removed} tracks from your cache"
        }
    except Exception as e:
        logger.error(f"Failed to clear user cache: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear user cache")


@router.post("/clear/all")
async def clear_all_cache(
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Clear Entire Cache (All Users)
    
    Removes all track metadata from the cache for all users.
    This is a destructive operation that clears the entire cache database.
    
    Note: This will affect all users of the instance. Use with caution.
    
    Returns:
        dict: Number of tracks removed
        
    Raises:
        HTTPException: 401 if not authenticated
        
    Example Response:
        {
            "removed": 2630,
            "message": "Cleared entire cache (2630 tracks)"
        }
    """
    try:
        removed = CacheService.clear_all_cache()
        logger.warning(f"Cleared entire cache: {removed} tracks")
        return {
            "removed": removed,
            "message": f"Cleared entire cache ({removed} tracks)"
        }
    except Exception as e:
        logger.error(f"Failed to clear all cache: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear cache")


@router.get("/enrichment-ids")
async def get_enrichment_ids(
    session_mgr: SessionManager = Depends(require_auth),
):
    """
    Get all artist and track IDs from cache for enrichment.
    
    Returns:
        dict: Lists of unique artist IDs and track IDs
        
    Example Response:
        {
            "artist_ids": ["3TVXtAsR1Inumwj472S9r4", ...],
            "track_ids": ["11dFghVXANMlKmJXsNCbNl", ...],
            "artist_count": 1234,
            "track_count": 5678
        }
    """
    try:
        import json
        from app.db.database import get_db_connection
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get all track IDs
            cursor.execute("SELECT track_id FROM track_cache")
            track_ids = [row[0] for row in cursor.fetchall()]
            
            # Get all unique artist IDs from artists_json
            cursor.execute("SELECT DISTINCT artists_json FROM track_cache WHERE artists_json IS NOT NULL")
            artist_ids = set()
            for row in cursor.fetchall():
                try:
                    artists = json.loads(row[0])
                    for artist in artists:
                        if isinstance(artist, dict) and artist.get('id'):
                            artist_ids.add(artist['id'])
                except (json.JSONDecodeError, TypeError):
                    continue
            
            artist_ids = list(artist_ids)
            
        return {
            "artist_ids": artist_ids,
            "track_ids": track_ids,
            "artist_count": len(artist_ids),
            "track_count": len(track_ids)
        }
    except Exception as e:
        logger.error(f"Failed to get enrichment IDs: {e}")
        raise HTTPException(status_code=500, detail="Failed to get enrichment IDs")


class EnrichArtistsRequest(BaseModel):
    """Request model for enriching artist metadata."""
    artist_ids: List[str]


class EnrichArtistsResponse(BaseModel):
    """Response model for artist enrichment."""
    requested: int
    cached: int
    fetched: int
    message: str


@router.post("/enrich/artists", response_model=EnrichArtistsResponse)
async def enrich_artists(
    body: EnrichArtistsRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    """
    Enrich artist metadata (genres, popularity, followers).
    
    Checks cache first, fetches missing artists from Spotify API,
    and stores them in artist_cache.
    
    Args:
        body: Request with artist IDs to enrich
        session_mgr: Session manager from auth dependency
        spotify: Spotify service instance
    
    Returns:
        dict: Enrichment statistics
        
    Example Response:
        {
            "requested": 50,
            "cached": 30,
            "fetched": 20,
            "message": "Enriched 20 artists (30 from cache)"
        }
    """
    try:
        if not body.artist_ids:
            raise HTTPException(status_code=400, detail="No artist IDs provided")
        
        session_id = session_mgr.session_id
        
        # Check cache first
        cached_artists, missing_ids = CacheService.get_artists(
            body.artist_ids,
            session_id=session_id
        )
        
        # Fetch missing artists from Spotify
        fetched_count = 0
        if missing_ids:
            artists_data = spotify.get_artists(list(missing_ids))
            if artists_data:
                fetched_count = CacheService.set_artists(artists_data, session_id)
        
        return {
            "requested": len(body.artist_ids),
            "cached": len(cached_artists),
            "fetched": fetched_count,
            "message": f"Enriched {fetched_count} artists ({len(cached_artists)} from cache)"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to enrich artists: {e}")
        raise HTTPException(status_code=500, detail="Failed to enrich artist metadata")


class EnrichAudioFeaturesRequest(BaseModel):
    """Request model for enriching audio features."""
    track_ids: List[str]


class EnrichAudioFeaturesResponse(BaseModel):
    """Response model for audio features enrichment."""
    requested: int
    cached: int
    fetched: int
    message: str


@router.post("/enrich/audio-features", response_model=EnrichAudioFeaturesResponse)
async def enrich_audio_features(
    body: EnrichAudioFeaturesRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    """
    Enrich audio features (tempo, energy, danceability, etc.).
    
    Checks cache first, fetches missing features from Spotify API,
    and stores them in audio_features_cache.
    
    Args:
        body: Request with track IDs to enrich
        session_mgr: Session manager from auth dependency
        spotify: Spotify service instance
    
    Returns:
        dict: Enrichment statistics
        
    Example Response:
        {
            "requested": 100,
            "cached": 60,
            "fetched": 40,
            "message": "Enriched 40 tracks (60 from cache)"
        }
    """
    try:
        if not body.track_ids:
            raise HTTPException(status_code=400, detail="No track IDs provided")
        
        # Check cache first
        cached_features, missing_ids = CacheService.get_audio_features(
            body.track_ids
        )
        
        # Fetch missing features from Spotify
        fetched_count = 0
        if missing_ids:
            features_data = spotify.get_audio_features(list(missing_ids))
            if features_data:
                fetched_count = CacheService.set_audio_features(features_data)
        
        return {
            "requested": len(body.track_ids),
            "cached": len(cached_features),
            "fetched": fetched_count,
            "message": f"Enriched {fetched_count} tracks ({len(cached_features)} from cache)"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to enrich audio features: {e}")
        raise HTTPException(status_code=500, detail="Failed to enrich audio features")
