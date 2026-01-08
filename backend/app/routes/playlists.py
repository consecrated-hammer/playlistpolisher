"""
Playlist Routes

This module defines all playlist-related API endpoints including:
- Listing user playlists
- Fetching detailed playlist information with tracks

All routes are prefixed with /playlists and require authentication.
"""

from fastapi import APIRouter, HTTPException, Depends, Path, Request, Query, Body
from fastapi.responses import StreamingResponse
from typing import List, Optional, Dict, Any, Literal
import logging
from spotipy.exceptions import SpotifyException
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import json

from app.services.spotify_service import SpotifyService, get_spotify_service
from app.config import settings
from app.db import app_settings
from app.models.schemas import (
    AlbumSimple,
    ArtistSimple,
    CacheInfo,
    ErrorResponse,
    ImageObject,
    PaginatedTracks,
    PlaylistContextMeta,
    PlaylistDetail,
    PlaylistSimple,
    PlaylistTrack,
)
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME
from pydantic import BaseModel, Field
from app.db import operations as op_store
from app.db import preferences as preference_store
from app.db import playlist_cache as playlist_cache_store
from app.db import playlist_backups as playlist_backup_store
from app.db import artist_follow_cache as artist_follow_cache_store
from app.services.sort_service import get_sort_key_function
from app.services.cache_warm_service import start_cache_warm_job
from app.services.cache_service import CacheService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/playlists", tags=["playlists"])

CACHE_REFRESH_COOLDOWN_SECONDS = 30
_cache_refresh_lock = threading.Lock()
_cache_refresh_last_request: Dict[str, float] = {}


class PlaylistArtistEntry(BaseModel):
    id: Optional[str] = None
    name: str
    uri: Optional[str] = None
    external_url: Optional[str] = None
    track_count: int = 0


class PlaylistArtistsResponse(BaseModel):
    artists: List[PlaylistArtistEntry] = Field(default_factory=list)
    total: int = 0


class PlaylistArtistActionRequest(BaseModel):
    artist_ids: List[str] = Field(default_factory=list)


class PlaylistArtistFollowCheckResponse(BaseModel):
    statuses: List[bool] = Field(default_factory=list)


def get_session_manager(request: Request) -> SessionManager:
    """Extract session manager from the incoming request cookie."""
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


def require_auth(session_mgr: SessionManager = Depends(get_session_manager)) -> SessionManager:
    """
    Authentication Dependency
    
    Validates that the user is authenticated before accessing protected routes.
    
    Args:
        session_mgr: Session manager instance derived from cookie
        
    Raises:
        HTTPException: 401 if not authenticated
    """
    if not session_mgr.is_authenticated():
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please login with Spotify."
        )
    return session_mgr


def _queue_cache_refresh(session_mgr: SessionManager, playlist_id: str, source: str) -> None:
    session_id = session_mgr.get_session_id()
    user_id = session_mgr.get_user_id()
    if not session_id or not user_id:
        return
    now = time.monotonic()
    with _cache_refresh_lock:
        last_request = _cache_refresh_last_request.get(playlist_id)
        if last_request is not None and (now - last_request) < CACHE_REFRESH_COOLDOWN_SECONDS:
            logger.info("Skipping cache refresh for playlist %s (cooldown)", playlist_id)
            return
    try:
        start_cache_warm_job(user_id, session_id, [playlist_id], meta={"source": source})
        with _cache_refresh_lock:
            _cache_refresh_last_request[playlist_id] = now
    except Exception as exc:
        logger.warning("Failed to queue cache refresh for playlist %s: %s", playlist_id, exc)


def _spotify_external_url(entity_type: str, entity_id: Optional[str]) -> Optional[str]:
    if not entity_id:
        return None
    return f"https://open.spotify.com/{entity_type}/{entity_id}"


@router.get("/", response_model=List[PlaylistSimple])
async def get_playlists(
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """
    Get User's Playlists
    
    Retrieves all playlists for the authenticated user. Returns simplified
    playlist information suitable for list display.
    
    Returns:
        List[PlaylistSimple]: List of user's playlists
        
    Raises:
        HTTPException: 401 if not authenticated, 500 on API errors
        
    Example Response:
        [
            {
                "id": "37i9dQZF1DXcBWIGoYBM5M",
                "name": "Today's Top Hits",
                "description": "Ed Sheeran is on top...",
                "images": [...],
                "tracks_total": 50,
                "owner": "Spotify",
                "public": true,
                "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
            },
            ...
        ]
        
    Note:
        This endpoint automatically handles pagination and returns all
        playlists regardless of total count.
    """
    try:
        playlists = spotify.get_user_playlists()
        logger.info(f"Fetched {len(playlists)} playlists for user")
        return playlists
    except ValueError as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to fetch playlists: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch playlists: {str(e)}"
        )


@router.get("/{playlist_id}", response_model=PlaylistDetail)
async def get_playlist(
    playlist_id: str = Path(..., description="Spotify playlist ID"),
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """
    Get Detailed Playlist Information
    
    Retrieves complete playlist information including all tracks. Use this
    endpoint when displaying a specific playlist's contents.
    
    Args:
        playlist_id: Spotify playlist ID
        
    Returns:
        PlaylistDetail: Detailed playlist with all tracks
        
    Raises:
        HTTPException: 401 if not authenticated, 404 if playlist not found,
                      500 on other errors
        
    Example Response:
        {
            "id": "37i9dQZF1DXcBWIGoYBM5M",
            "name": "Today's Top Hits",
            "description": "Ed Sheeran is on top...",
            "images": [...],
            "owner": "Spotify",
            "public": true,
            "collaborative": false,
            "tracks": [
                {
                    "id": "7qiZfU4dY1lWllzX7mPBI",
                    "name": "Shape of You",
                    "artists": [...],
                    "album": {...},
                    "duration_ms": 233713,
                    "added_at": "2024-01-01T00:00:00Z",
                    ...
                },
                ...
            ],
            "followers": 1000000,
            "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
        }
        
    Note:
        For large playlists (1000+ tracks), this endpoint may take several
        seconds to complete as it needs to paginate through all tracks.
    """
    try:
        user_id = session_mgr.get_user_id()
        should_warm_cache = True
        if user_id:
            should_warm_cache = preference_store.should_warm_playlist_cache(user_id, playlist_id)
        playlist = spotify.get_playlist_details(playlist_id, should_warm_cache=should_warm_cache)
        logger.info(f"Fetched playlist '{playlist.name}' with {playlist.total_tracks} tracks")
        return playlist
    except ValueError as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        
        # Check if it's a "not found" error
        if "404" in error_msg or "not found" in error_msg.lower():
            logger.warning(f"Playlist not found: {playlist_id}")
            raise HTTPException(
                status_code=404,
                detail=f"Playlist not found: {playlist_id}"
            )
        
        logger.error(f"Failed to fetch playlist {playlist_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch playlist: {str(e)}"
        )


@router.get("/{playlist_id}/summary", response_model=PlaylistContextMeta)
async def get_playlist_summary(
    playlist_id: str = Path(..., description="Spotify playlist ID"),
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Get lightweight playlist metadata without loading tracks."""
    try:
        meta = _ensure_playlist_cache(spotify, session_mgr, playlist_id)
        return meta
    except ValueError as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        if "404" in error_msg or "not found" in error_msg.lower():
            logger.warning(f"Playlist not found: {playlist_id}")
            raise HTTPException(
                status_code=404,
                detail=f"Playlist not found: {playlist_id}"
            )
        logger.error(f"Failed to fetch playlist summary {playlist_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch playlist summary: {str(e)}"
        )


@router.get("/{playlist_id}/tracks", response_model=PaginatedTracks)
async def get_playlist_tracks_paginated(
    playlist_id: str = Path(..., description="Spotify playlist ID"),
    offset: int = 0,
    limit: int = 100,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """
    Get paginated playlist tracks for infinite scroll.
    
    Fetches a page of tracks from a playlist. Used for infinite scroll
    pagination in the frontend. Returns tracks along with pagination metadata.
    
    Args:
        playlist_id: Spotify playlist ID
        offset: Starting position (default: 0)
        limit: Page size (default: 100, max: 100)
        
    Returns:
        PaginatedTracks: Paginated response with tracks and metadata
        
    Example Response:
        {
            "tracks": [...],
            "offset": 0,
            "limit": 100,
            "total": 500,
            "has_more": true
        }
    """
    try:
        # Enforce max limit of 100 (Spotify API constraint)
        limit = min(limit, 100)
        
        user_id = session_mgr.get_user_id()
        should_warm_cache = True
        if user_id:
            should_warm_cache = preference_store.should_warm_playlist_cache(user_id, playlist_id)

        facts = playlist_cache_store.get_facts_for_playlists([playlist_id]).get(playlist_id)
        cached = _get_cached_playlist_tracks_page(
            spotify=spotify,
            playlist_id=playlist_id,
            offset=offset,
            limit=limit,
            session_id=session_mgr.get_session_id(),
            should_warm_cache=should_warm_cache,
            allow_dirty=True,
            facts=facts,
        )
        if cached:
            if facts and facts.get("is_dirty") == 1:
                _queue_cache_refresh(session_mgr, playlist_id, "tracks_paginated_dirty")
            return cached
        if should_warm_cache:
            _queue_cache_refresh(session_mgr, playlist_id, "tracks_paginated_miss")

        tracks, total, cache_hits, cache_misses, cache_warmed = spotify.get_playlist_tracks_paginated(
            playlist_id,
            offset=offset,
            limit=limit,
            should_warm_cache=should_warm_cache
        )
        
        has_more = (offset + len(tracks)) < total
        
        logger.info(
            f"Fetched playlist tracks page: playlist={playlist_id}, offset={offset}, "
            f"limit={limit}, returned={len(tracks)}, total={total}, has_more={has_more}"
        )
        
        return PaginatedTracks(
            tracks=tracks,
            offset=offset,
            limit=limit,
            total=total,
            has_more=has_more,
            cache_info=CacheInfo(
                hits=cache_hits,
                misses=cache_misses,
                warmed=cache_warmed,
                details={"track_count": len(tracks)}
            )
        )
    except ValueError as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        if "404" in error_msg or "not found" in error_msg.lower():
            logger.warning(f"Playlist not found: {playlist_id}")
            raise HTTPException(
                status_code=404,
                detail=f"Playlist not found: {playlist_id}"
            )
        logger.error(f"Failed to fetch playlist tracks {playlist_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch playlist tracks: {str(e)}"
        )


@router.post("/artists/following", response_model=PlaylistArtistFollowCheckResponse)
async def check_user_follows_artists(
    body: PlaylistArtistActionRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Check follow status for the current user across artist IDs."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    artist_ids = [artist_id for artist_id in body.artist_ids if artist_id]
    if not artist_ids:
        return PlaylistArtistFollowCheckResponse(statuses=[])
    try:
        session_id = session_mgr.get_session_id()
        cached_statuses = {}
        if session_id:
            try:
                cached_statuses = artist_follow_cache_store.get_cached_follow_statuses(
                    session_id,
                    artist_ids,
                    settings.artist_follow_cache_ttl_minutes,
                )
            except Exception as exc:
                logger.warning("Artist follow cache lookup failed: %s", exc)
        missing_ids = [artist_id for artist_id in artist_ids if artist_id not in cached_statuses]

        fetched_statuses: Dict[str, bool] = {}
        if missing_ids:
            for chunk in _chunk_list(missing_ids, 50):
                if hasattr(sp, "current_user_following_artists"):
                    result = sp.current_user_following_artists(chunk)
                else:
                    params = {"type": "artist", "ids": ",".join(chunk)}
                    result = sp._get("me/following/contains", params)
                if not isinstance(result, list):
                    raise ValueError("Unexpected response from follow status check")
                for artist_id, status in zip(chunk, result):
                    fetched_statuses[artist_id] = bool(status)
            if session_id and fetched_statuses:
                artist_follow_cache_store.set_cached_follow_statuses(session_id, fetched_statuses)

        statuses_map = {**cached_statuses, **fetched_statuses}
        statuses = [bool(statuses_map.get(artist_id, False)) for artist_id in artist_ids]
        return PlaylistArtistFollowCheckResponse(statuses=statuses)
    except SpotifyException as e:
        logger.error("Spotify error checking artist follow status: %s", e)
        detail = e.msg or str(e)
        if e.http_status == 403:
            detail = "Spotify permissions missing for artist follow status. Please re-authenticate."
        raise HTTPException(status_code=e.http_status or 502, detail=detail)
    except Exception as e:
        logger.error("Failed to check artist follow status: %s", e)
        raise HTTPException(status_code=500, detail="Failed to check follow status")


@router.get("/{playlist_id}/artists", response_model=PlaylistArtistsResponse)
async def get_playlist_artists(
    playlist_id: str = Path(..., description="Spotify playlist ID"),
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Get unique artists for a playlist with track counts."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    try:
        _ensure_playlist_cache(spotify, session_mgr, playlist_id)
        cached_items = _build_cached_playlist_items(
            spotify,
            playlist_id,
            session_mgr.get_session_id(),
        )
        if cached_items is not None:
            artists = _build_playlist_artists_from_items(cached_items)
        else:
            artists = _fetch_playlist_artists(sp, playlist_id)
        return PlaylistArtistsResponse(artists=artists, total=len(artists))
    except Exception as e:
        error_msg = str(e)
        if "404" in error_msg or "not found" in error_msg.lower():
            logger.warning("Playlist not found for artists list: %s", playlist_id)
            raise HTTPException(status_code=404, detail=f"Playlist not found: {playlist_id}")
        logger.error("Failed to fetch playlist artists %s: %s", playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to fetch playlist artists")


@router.post("/{playlist_id}/artists/follow")
async def follow_playlist_artists(
    playlist_id: str,
    body: PlaylistArtistActionRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Follow selected artists from a playlist."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    artist_ids = [artist_id for artist_id in body.artist_ids if artist_id]
    if not artist_ids:
        return {"message": "No artists selected", "followed": 0}
    try:
        for chunk in _chunk_list(artist_ids, 50):
            sp.user_follow_artists(chunk)
        session_id = session_mgr.get_session_id()
        if session_id:
            artist_follow_cache_store.set_cached_follow_statuses(
                session_id,
                {artist_id: True for artist_id in artist_ids},
            )
        return {"message": "Artists followed", "followed": len(artist_ids)}
    except Exception as e:
        logger.error("Failed to follow artists for playlist %s: %s", playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to follow artists")


@router.post("/{playlist_id}/artists/unfollow")
async def unfollow_playlist_artists(
    playlist_id: str,
    body: PlaylistArtistActionRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Unfollow selected artists from a playlist."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    artist_ids = [artist_id for artist_id in body.artist_ids if artist_id]
    if not artist_ids:
        return {"message": "No artists selected", "unfollowed": 0}
    try:
        for chunk in _chunk_list(artist_ids, 50):
            sp.user_unfollow_artists(chunk)
        session_id = session_mgr.get_session_id()
        if session_id:
            artist_follow_cache_store.set_cached_follow_statuses(
                session_id,
                {artist_id: False for artist_id in artist_ids},
            )
        return {"message": "Artists unfollowed", "unfollowed": len(artist_ids)}
    except Exception as e:
        logger.error("Failed to unfollow artists for playlist %s: %s", playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to unfollow artists")


class PlaylistUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, description="New playlist name")
    public: Optional[bool] = Field(None, description="Whether playlist is public")
    collaborative: Optional[bool] = Field(None, description="Whether playlist is collaborative")
    description: Optional[str] = Field(None, description="Playlist description")


@router.patch("/{playlist_id}")
async def update_playlist(
    playlist_id: str,
    body: PlaylistUpdateRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Update playlist metadata (name/public/collaborative/description)."""
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated")
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    try:
        change_kwargs = {}
        if body.name is not None:
            change_kwargs["name"] = body.name
        if body.public is not None:
            change_kwargs["public"] = body.public
        if body.collaborative is not None:
            change_kwargs["collaborative"] = body.collaborative
        if body.description is not None:
            change_kwargs["description"] = body.description

        logger.info(
            "Updating playlist %s (user=%s) with name=%s, public=%s, collaborative=%s, has_description=%s",
            playlist_id,
            session_mgr.get_user_id(),
            body.name,
            body.public,
            body.collaborative,
            bool(body.description),
        )
        sp.playlist_change_details(playlist_id, **change_kwargs)
        updated = sp.playlist(playlist_id, fields="id,name,public,collaborative,description,owner(id)")

        applied_public = updated.get("public")
        applied_collab = updated.get("collaborative")
        owner_id = updated.get("owner", {}).get("id")

        if body.public is not None and applied_public != body.public:
            logger.warning("Initial update mismatch public=%s -> %s for playlist %s (user=%s owner=%s), retrying with collaborative=False then public=%s", body.public, applied_public, playlist_id, session_mgr.get_user_id(), owner_id, body.public)
            try:
                # Retry with collaborative forced false, then public flag in a second step to mirror desktop behavior
                sp.playlist_change_details(playlist_id, collaborative=False)
                time.sleep(0.3)
                sp.playlist_change_details(playlist_id, public=body.public)
                time.sleep(0.3)
                updated = sp.playlist(playlist_id, fields="id,name,public,collaborative,description,owner(id)")
                applied_public = updated.get("public")
                applied_collab = updated.get("collaborative")
                owner_id = updated.get("owner", {}).get("id")
            except Exception as retry_err:
                logger.error("Retry to force visibility failed for playlist %s: %s", playlist_id, retry_err)
                raise HTTPException(status_code=502, detail="Spotify rejected the visibility change. Try setting collaborative off, then toggle public.") from retry_err

        if body.public is not None and applied_public != body.public:
            logger.warning(
                "Requested public=%s but Spotify returned public=%s for playlist %s (user=%s owner=%s) even after retry",
                body.public,
                applied_public,
                playlist_id,
                session_mgr.get_user_id(),
                owner_id,
            )
            raise HTTPException(
                status_code=502,
                detail="Spotify did not apply the requested public/private change via API. Ensure collaborative is off and consider toggling privacy in the official client.",
            )

        if body.collaborative is not None and applied_collab != body.collaborative:
            logger.warning(
                "Requested collaborative=%s but Spotify returned collaborative=%s for playlist %s (user=%s owner=%s)",
                body.collaborative,
                applied_collab,
                playlist_id,
                session_mgr.get_user_id(),
                owner_id,
            )
            raise HTTPException(
                status_code=502,
                detail="Spotify did not apply the requested collaborative change. Ensure you own the playlist and it is set to private when collaborative.",
            )

        logger.info(
            "Updated playlist %s result: public=%s collaborative=%s",
            playlist_id,
            applied_public,
            applied_collab,
        )
        return {"message": "Playlist updated", "public": applied_public, "collaborative": applied_collab}
    except SpotifyException as e:
        logger.error("Spotify error updating playlist %s: %s", playlist_id, e)
        raise HTTPException(status_code=e.http_status or 500, detail=e.msg or str(e))
    except Exception as e:
        logger.error(f"Failed to update playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class PlaylistCloneRequest(BaseModel):
    name: str
    public: Optional[bool] = None
    collaborative: Optional[bool] = None
    description: Optional[str] = None


class PlaylistTrackAddRequest(BaseModel):
    track_uris: List[str] = Field(..., description="Spotify track URIs to add")
    position: Optional[int] = Field(None, description="Optional insert position in playlist")


class PlaylistTrackSelection(BaseModel):
    uri: str
    position: Optional[int] = None


class PlaylistTrackRemoveRequest(BaseModel):
    items: List[PlaylistTrackSelection]
    snapshot_id: Optional[str] = None


class PlaylistCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    public: Optional[bool] = None
    collaborative: Optional[bool] = None
    track_uris: List[str] = Field(default_factory=list)


class PlaylistBackupStatusResponse(BaseModel):
    cached: bool
    track_count: int
    last_cached_at_utc: Optional[str] = None
    last_snapshot_id: Optional[str] = None
    is_dirty: bool = False


class PlaylistBackupCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    cache_first: bool = True


class PlaylistBackupRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class PlaylistBackupSummary(BaseModel):
    id: int
    playlist_id: str
    name: str
    track_count: int
    created_at: str
    playlist_name: Optional[str] = None
    snapshot_id: Optional[str] = None
    source: Optional[str] = None


class PlaylistBackupListResponse(BaseModel):
    backups: List[PlaylistBackupSummary]


class PlaylistBackupPreviewTrack(BaseModel):
    track_id: str
    title: Optional[str] = None
    album: Optional[str] = None
    artists: List[str] = Field(default_factory=list)


class PlaylistBackupTrack(PlaylistBackupPreviewTrack):
    position: Optional[int] = None
    added_at: Optional[str] = None


class PlaylistBackupPreviewResponse(BaseModel):
    backup_id: int
    playlist_id: str
    track_count: int
    limit: int
    tracks: List[PlaylistBackupPreviewTrack]


class PlaylistBackupDetailResponse(BaseModel):
    backup_id: int
    playlist_id: str
    track_count: int
    created_at: str
    name: str
    playlist_name: Optional[str] = None
    tracks: List[PlaylistBackupTrack]


class PlaylistRestoreRequest(BaseModel):
    mode: Literal["overwrite", "clone"] = "overwrite"
    name: Optional[str] = None
    description: Optional[str] = None
    public: Optional[bool] = None
    collaborative: Optional[bool] = None


class PlaylistCacheMatchTrack(BaseModel):
    client_key: Optional[str] = None
    track_id: Optional[str] = None
    name: Optional[str] = None
    artists: List[str] = Field(default_factory=list)
    duration_ms: Optional[int] = None


class PlaylistCacheMatchRequest(BaseModel):
    tracks: List[PlaylistCacheMatchTrack] = Field(default_factory=list)


class PlaylistCacheMatchEntry(BaseModel):
    client_key: str
    status: Optional[str] = None


class PlaylistCacheMatchResponse(BaseModel):
    cached: bool
    exact_count: int
    similar_count: int
    total: int
    matches: List[PlaylistCacheMatchEntry]


class PlaylistCacheMatchSummary(BaseModel):
    playlist_id: str
    cached: bool
    exact_count: int
    similar_count: int
    total: int


class PlaylistCacheMatchBatchRequest(BaseModel):
    playlist_ids: List[str] = Field(default_factory=list)
    tracks: List[PlaylistCacheMatchTrack] = Field(default_factory=list)


class PlaylistCacheMatchBatchResponse(BaseModel):
    results: List[PlaylistCacheMatchSummary]


class DuplicateOccurrence(BaseModel):
    uri: str
    position: int
    added_at: Optional[str] = None
    reason: Optional[str] = None


class DuplicateRemovalRequest(BaseModel):
    items: List[DuplicateOccurrence]
    snapshot_id: Optional[str] = None


def _fetch_playlist_items(sp: Any, playlist_id: str) -> List[Dict[str, Any]]:
    """Fetch all playlist items with pagination."""
    items: List[Dict[str, Any]] = []
    limit = 100
    offset = 0
    while True:
        res = sp.playlist_items(
            playlist_id,
            limit=limit,
            offset=offset,
            fields="items(track(id,name,uri,duration_ms,artists(name),album(name,images,album_type,total_tracks,release_date,release_date_precision)),added_at,added_by.id),next"
        )
        page_items = res.get("items", []) or []
        items.extend(page_items)
        if not res.get("next"):
            break
        offset += limit
    return items


def _fetch_playlist_artists(sp: Any, playlist_id: str) -> List[Dict[str, Any]]:
    """Fetch unique artists from a playlist with track counts."""
    artists: Dict[str, Dict[str, Any]] = {}
    limit = 100
    offset = 0
    while True:
        res = sp.playlist_items(
            playlist_id,
            limit=limit,
            offset=offset,
            fields="items(track(artists(id,name,uri,external_urls(spotify)))),next"
        )
        for item in res.get("items", []) or []:
            track = item.get("track") or {}
            for artist in track.get("artists") or []:
                name = artist.get("name")
                if not name:
                    continue
                artist_id = artist.get("id")
                key = artist_id or f"name::{name.lower().strip()}"
                if key not in artists:
                    artists[key] = {
                        "id": artist_id,
                        "name": name,
                        "uri": artist.get("uri"),
                        "external_url": (artist.get("external_urls") or {}).get("spotify"),
                        "track_count": 0,
                    }
                artists[key]["track_count"] += 1
        if not res.get("next"):
            break
        offset += limit
    artist_list = list(artists.values())
    artist_list.sort(key=lambda entry: (entry.get("name") or "").lower())
    return artist_list


def _chunk_list(items: List[str], chunk_size: int = 50) -> List[List[str]]:
    return [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]


def _build_artist_payload(artist: Dict[str, Any]) -> Dict[str, Any]:
    artist_id = artist.get("id") or None
    artist_name = artist.get("name") or ""
    artist_uri = artist.get("uri") or (f"spotify:artist:{artist_id}" if artist_id else None)
    payload = {
        "id": artist_id,
        "name": artist_name,
        "uri": artist_uri,
    }
    external_url = _spotify_external_url("artist", artist_id)
    if external_url:
        payload["external_urls"] = {"spotify": external_url}
    return payload


def _build_track_payload_from_cache(track_data: Dict[str, Any]) -> Dict[str, Any]:
    track_id = track_data.get("id") or None
    artists = []
    for artist in track_data.get("artists") or []:
        if isinstance(artist, dict):
            artists.append(_build_artist_payload(artist))
        else:
            artists.append({"id": None, "name": str(artist), "uri": None})

    album_id = track_data.get("album_id") or None
    album_uri = track_data.get("album_uri") or (f"spotify:album:{album_id}" if album_id else None)
    album_payload = {
        "id": album_id,
        "name": track_data.get("album") or "",
        "uri": album_uri,
        "images": [],
        "release_date": track_data.get("album_release_date"),
        "release_date_precision": track_data.get("album_release_date_precision"),
        "album_type": track_data.get("album_type"),
        "total_tracks": track_data.get("album_total_tracks"),
    }
    album_external_url = _spotify_external_url("album", album_id)
    if album_external_url:
        album_payload["external_urls"] = {"spotify": album_external_url}
    album_art_url = track_data.get("album_art_url")
    if album_art_url:
        album_payload["images"] = [{"url": album_art_url}]

    track_uri = track_data.get("track_uri") or (f"spotify:track:{track_id}" if track_id else None)
    return {
        "id": track_id,
        "name": track_data.get("name") or "",
        "artists": artists,
        "album": album_payload,
        "duration_ms": track_data.get("duration_ms"),
        "uri": track_uri,
    }


def _track_missing_artist_ids(track_data: Dict[str, Any]) -> bool:
    artists = track_data.get("artists") or []
    if not artists:
        return True
    for artist in artists:
        if not isinstance(artist, dict):
            return True
        if not artist.get("id"):
            return True
    return False


def _get_cached_tracks_chunked(
    track_ids: List[str],
    session_id: Optional[str],
    allow_stale: bool = True,
    require_artist_ids: bool = False,
) -> tuple[Dict[str, Dict[str, Any]], set[str]]:
    cached_tracks: Dict[str, Dict[str, Any]] = {}
    missing_ids: set[str] = set()
    if not track_ids:
        return cached_tracks, missing_ids

    for chunk in _chunk_list(track_ids, 500):
        cached_chunk, missing_chunk = CacheService.get_tracks(
            chunk,
            session_id,
            allow_stale=allow_stale,
            allow_legacy=True,
        )
        cached_tracks.update(cached_chunk)
        missing_ids.update(missing_chunk)
    if require_artist_ids:
        for track_id, track_data in cached_tracks.items():
            if _track_missing_artist_ids(track_data):
                missing_ids.add(track_id)
    return cached_tracks, missing_ids


def _fetch_tracks_from_spotify(spotify: SpotifyService, track_ids: List[str]) -> List[Dict[str, Any]]:
    if not track_ids:
        return []
    client = spotify.get_client()
    fetched_tracks = []
    for chunk in _chunk_list(track_ids, 50):
        response = client.tracks(chunk)
        fetched_tracks.extend([track for track in response.get("tracks", []) if track])
    return fetched_tracks


def _build_cached_playlist_items(
    spotify: SpotifyService,
    playlist_id: str,
    session_id: Optional[str],
) -> Optional[List[Dict[str, Any]]]:
    facts = playlist_cache_store.get_facts_for_playlists([playlist_id]).get(playlist_id)
    if not facts or facts.get("is_dirty") == 1:
        return None

    items = playlist_cache_store.get_cached_playlist_items(playlist_id)
    if not items:
        return []

    track_ids = [item.get("track_id") for item in items if item.get("track_id")]
    cached_tracks, missing_ids = _get_cached_tracks_chunked(
        track_ids,
        session_id,
        allow_stale=True,
        require_artist_ids=True,
    )

    if missing_ids:
        fetched_tracks = _fetch_tracks_from_spotify(spotify, list(missing_ids))
        if fetched_tracks:
            CacheService.set_tracks(fetched_tracks, session_id)
            for track in fetched_tracks:
                normalized = _normalize_spotify_track(track)
                if normalized.get("id"):
                    cached_tracks[normalized["id"]] = normalized

    hydrated_items = []
    for item in items:
        track_id = item.get("track_id")
        track_data = cached_tracks.get(track_id)
        if not track_data:
            continue
        hydrated_items.append(
            {
                "track": _build_track_payload_from_cache(track_data),
                "added_at": item.get("added_at"),
                "added_by": None,
            }
        )
    return hydrated_items


def _build_playlist_artists_from_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    artists: Dict[str, Dict[str, Any]] = {}
    for item in items:
        track = item.get("track") or {}
        for artist in track.get("artists") or []:
            if not isinstance(artist, dict):
                name = str(artist)
                artist_id = None
                artist_uri = None
                external_url = None
            else:
                name = artist.get("name") or ""
                artist_id = artist.get("id") or None
                artist_uri = artist.get("uri") or (f"spotify:artist:{artist_id}" if artist_id else None)
                external_url = (artist.get("external_urls") or {}).get("spotify")
            if not name:
                continue
            key = artist_id or f"name::{name.lower().strip()}"
            if key not in artists:
                artists[key] = {
                    "id": artist_id,
                    "name": name,
                    "uri": artist_uri,
                    "external_url": external_url or _spotify_external_url("artist", artist_id),
                    "track_count": 0,
                }
            artists[key]["track_count"] += 1

    artist_list = list(artists.values())
    artist_list.sort(key=lambda entry: (entry.get("name") or "").lower())
    return artist_list


def _ensure_playlist_cache(
    spotify: SpotifyService,
    session_mgr: SessionManager,
    playlist_id: str,
) -> PlaylistContextMeta:
    meta = spotify.get_playlist_context_meta(playlist_id)
    facts = playlist_cache_store.get_facts_for_playlists([playlist_id]).get(playlist_id)
    last_snapshot_id = facts.get("last_snapshot_id") if facts else None
    cached_track_count = int(facts.get("track_count_cached") or 0) if facts else 0
    is_dirty = bool(facts.get("is_dirty")) if facts else True
    current_snapshot_id = meta.snapshot_id
    current_track_count = meta.total_tracks or 0

    snapshot_mismatch = bool(last_snapshot_id) and bool(current_snapshot_id) and last_snapshot_id != current_snapshot_id
    count_mismatch = cached_track_count != current_track_count
    missing_cache = not facts or not last_snapshot_id
    needs_refresh = missing_cache or is_dirty or snapshot_mismatch or count_mismatch

    if needs_refresh:
        if facts and (snapshot_mismatch or count_mismatch):
            playlist_cache_store.mark_dirty(playlist_id)
        _refresh_playlist_cache_snapshot(spotify, session_mgr, playlist_id)

    return meta

def _normalize_spotify_track(track: Dict[str, Any]) -> Dict[str, Any]:
    artists = []
    for artist in track.get("artists") or []:
        if not artist:
            continue
        artists.append({
            "id": artist.get("id") or "",
            "name": artist.get("name") or "",
            "uri": artist.get("uri") or "",
        })

    album_data = track.get("album") or {}
    album_images = album_data.get("images") or []
    album_art_url = None
    if album_images:
        album_art_url = next(
            (img.get("url") for img in album_images if img.get("height") == 300),
            album_images[0].get("url"),
        )

    return {
        "id": track.get("id"),
        "name": track.get("name"),
        "artists": artists,
        "album": album_data.get("name"),
        "album_id": album_data.get("id"),
        "album_uri": album_data.get("uri"),
        "album_release_date": album_data.get("release_date"),
        "album_release_date_precision": album_data.get("release_date_precision"),
        "album_type": album_data.get("album_type"),
        "album_total_tracks": album_data.get("total_tracks"),
        "duration_ms": track.get("duration_ms"),
        "album_art_url": album_art_url,
        "track_uri": track.get("uri"),
    }


def _build_playlist_track_from_cache(track_data: Dict[str, Any], added_at: Optional[str]) -> PlaylistTrack:
    artists = []
    for artist in track_data.get("artists") or []:
        if isinstance(artist, dict):
            artist_id = artist.get("id") or ""
            artist_name = artist.get("name") or ""
            artist_uri = artist.get("uri") or ""
        else:
            artist_id = ""
            artist_name = str(artist)
            artist_uri = ""
        artists.append(ArtistSimple(id=artist_id, name=artist_name, uri=artist_uri))

    images = []
    album_art_url = track_data.get("album_art_url")
    if album_art_url:
        images.append(ImageObject(url=album_art_url))

    album = AlbumSimple(
        id=track_data.get("album_id") or "",
        name=track_data.get("album") or "",
        images=images,
        release_date=track_data.get("album_release_date"),
        release_date_precision=track_data.get("album_release_date_precision"),
        album_type=track_data.get("album_type"),
        total_tracks=track_data.get("album_total_tracks"),
        uri=track_data.get("album_uri") or "",
    )

    track_id = track_data.get("id") or ""
    return PlaylistTrack(
        id=track_id,
        name=track_data.get("name") or "",
        artists=artists,
        album=album,
        duration_ms=int(track_data.get("duration_ms") or 0),
        added_at=added_at,
        uri=track_data.get("track_uri") or f"spotify:track:{track_id}",
        preview_url=None,
        explicit=False,
        popularity=None,
    )


def _get_cached_playlist_tracks_page(
    spotify: SpotifyService,
    playlist_id: str,
    offset: int,
    limit: int,
    session_id: Optional[str],
    should_warm_cache: bool,
    allow_dirty: bool = False,
    facts: Optional[Dict[str, Any]] = None,
) -> Optional[PaginatedTracks]:
    facts = facts or playlist_cache_store.get_facts_for_playlists([playlist_id]).get(playlist_id)
    if not facts:
        return None
    if facts.get("is_dirty") == 1 and not allow_dirty:
        return None

    total = int(facts.get("track_count_cached") or 0)
    items = playlist_cache_store.get_cached_playlist_items_page(playlist_id, offset, limit)
    if not items:
        return PaginatedTracks(
            tracks=[],
            offset=offset,
            limit=limit,
            total=total,
            has_more=offset < total,
            cache_info=CacheInfo(hits=0, misses=0, warmed=0, details={"track_count": 0}),
        )

    track_ids = [item["track_id"] for item in items if item.get("track_id")]
    cached_tracks, missing_ids = _get_cached_tracks_chunked(
        track_ids,
        session_id,
        allow_stale=True,
        require_artist_ids=True,
    )
    cache_hits = len(cached_tracks)
    cache_misses = len(missing_ids)
    cache_warmed = 0

    if missing_ids:
        fetched_tracks = _fetch_tracks_from_spotify(spotify, list(missing_ids))
        if fetched_tracks:
            cache_warmed = CacheService.set_tracks(fetched_tracks, session_id)
            for track in fetched_tracks:
                normalized = _normalize_spotify_track(track)
                if normalized.get("id"):
                    cached_tracks[normalized["id"]] = normalized
            missing_ids = {track_id for track_id in missing_ids if track_id not in cached_tracks}

    tracks: List[PlaylistTrack] = []
    for item in items:
        track_id = item.get("track_id")
        if not track_id:
            continue
        track_data = cached_tracks.get(track_id)
        if not track_data:
            continue
        tracks.append(_build_playlist_track_from_cache(track_data, item.get("added_at")))

    has_more = (offset + len(items)) < total
    return PaginatedTracks(
        tracks=tracks,
        offset=offset,
        limit=limit,
        total=total,
        has_more=has_more,
        cache_info=CacheInfo(
            hits=cache_hits,
            misses=cache_misses,
            warmed=cache_warmed,
            details={"track_count": len(tracks)},
        ),
    )


@router.post("/{playlist_id}/clone")
async def clone_playlist(
    playlist_id: str,
    body: PlaylistCloneRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Clone a playlist (create new and copy tracks)."""
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated")
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    user_id = session_mgr.get_user_id()
    try:
        logger.info(
          "Cloning playlist %s for user=%s with name=%s public=%s collaborative=%s",
          playlist_id, user_id, body.name, body.public, body.collaborative
        )
        new_playlist = sp.user_playlist_create(
            user=user_id,
            name=body.name,
            public=body.public,
            collaborative=body.collaborative,
            description=body.description,
        )
        # fetch all tracks from source
        track_uris = []
        offset = 0
        limit = 100
        while True:
            res = sp.playlist_items(playlist_id, limit=limit, offset=offset, fields="items(track(uri)),next")
            for item in res.get("items", []):
                uri = item.get("track", {}).get("uri")
                if uri:
                    track_uris.append(uri)
            if res.get("next") is None:
                break
            offset += limit
        # add to new playlist in batches
        for i in range(0, len(track_uris), 100):
            sp.playlist_add_items(new_playlist["id"], track_uris[i:i+100])
        logger.info("Cloned playlist %s to new id %s with %d tracks", playlist_id, new_playlist["id"], len(track_uris))
        return {"message": "Playlist cloned", "new_playlist_id": new_playlist["id"]}
    except Exception as e:
        logger.error(f"Failed to clone playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{playlist_id}/tracks/add")
async def add_tracks_to_playlist(
    playlist_id: str,
    body: PlaylistTrackAddRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Add tracks to an existing playlist."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    track_uris = [uri for uri in body.track_uris if uri]
    if not track_uris:
        return {"message": "No tracks to add", "added": 0}
    try:
        position = body.position
        inserted = 0
        for i in range(0, len(track_uris), 100):
            batch = track_uris[i:i + 100]
            if position is not None:
                sp.playlist_add_items(playlist_id, batch, position=position + inserted)
                inserted += len(batch)
            else:
                sp.playlist_add_items(playlist_id, batch)
        playlist_cache_store.mark_dirty(playlist_id)
        _queue_cache_refresh(session_mgr, playlist_id, "tracks_add")
        return {"message": "Tracks added", "added": len(track_uris)}
    except Exception as e:
        logger.error("Failed to add tracks to playlist %s: %s", playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to add tracks")


@router.post("/{playlist_id}/tracks/remove")
async def remove_tracks_from_playlist(
    playlist_id: str,
    body: PlaylistTrackRemoveRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Remove specific tracks from a playlist (by uri/position)."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    if not body.items:
        return {"message": "No tracks selected", "removed": 0}
    logger.info(
        "Remove tracks request for playlist %s: items=%s, snapshot_id=%s",
        playlist_id,
        [{"uri": item.uri, "position": item.position} for item in body.items],
        body.snapshot_id
    )

    try:
        # Fetch current playlist snapshot
        current_snapshot = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
        if body.snapshot_id and body.snapshot_id != current_snapshot:
            logger.info(
                "Snapshot mismatch for playlist %s: client=%s server=%s",
                playlist_id,
                body.snapshot_id,
                current_snapshot
            )
        
        items_with_positions = [item for item in body.items if item.position is not None]
        if items_with_positions:
            # Build a map of current URIs to their actual positions (full playlist scan)
            requested_uris = {item.uri for item in items_with_positions if item.uri}

            def collect_positions(target_uris):
                positions_map = {uri: [] for uri in target_uris}
                offset = 0
                limit = 100
                total = 0
                while True:
                    res = sp.playlist_items(
                        playlist_id,
                        limit=limit,
                        offset=offset,
                        fields="items(track(uri)),next"
                    )
                    items = res.get("items", [])
                    total = offset + len(items)
                    for idx, track_item in enumerate(items, start=offset):
                        track = track_item.get("track") or {}
                        uri = track.get("uri")
                        if uri in positions_map:
                            positions_map[uri].append(idx)
                    if res.get("next") is None:
                        break
                    offset += limit
                return positions_map, total

            uri_to_positions, total_items = collect_positions(requested_uris)
            before_counts = {uri: len(positions) for uri, positions in uri_to_positions.items()}
            logger.info(
                "Resolved removal positions for playlist %s: total_items=%s, uris=%s",
                playlist_id,
                total_items,
                before_counts
            )
            
            # Process each removal individually - do NOT group by URI
            # This ensures we only remove exactly what the user selected
            payload_items = []
            positions_to_remove = []
            for item in items_with_positions:
                positions = uri_to_positions.get(item.uri) or []
                if positions:
                    available = positions.copy()
                    # Find the closest available position to the requested one
                    # This handles cases where the playlist has been modified since frontend loaded
                    closest = min(available, key=lambda p: abs(p - item.position))
                    logger.info(
                        "Removal resolve for playlist %s uri=%s requested=%s available=%s chosen=%s",
                        playlist_id,
                        item.uri,
                        item.position,
                        available,
                        closest
                    )
                    # Add this specific removal
                    payload_items.append({"uri": item.uri, "positions": [closest]})
                    positions_to_remove.append(closest)
                    # Remove from available so if there are multiple selections of same URI, we don't duplicate
                    uri_to_positions[item.uri].remove(closest)
                else:
                    logger.warning(
                        "No positions found for removal in playlist %s uri=%s requested=%s",
                        playlist_id,
                        item.uri,
                        item.position
                    )
            
            if positions_to_remove:
                positions_to_remove = sorted(set(positions_to_remove), reverse=True)
                logger.info(
                    "Removing %s track(s) from playlist %s at positions=%s snapshot=%s",
                    len(positions_to_remove),
                    playlist_id,
                    positions_to_remove,
                    current_snapshot
                )
                remove_payload = {"positions": positions_to_remove, "snapshot_id": current_snapshot}
                remove_result = sp._delete(f"playlists/{playlist_id}/tracks", payload=remove_payload)
                logger.info(
                    "Removal response for playlist %s: %s",
                    playlist_id,
                    remove_result
                )
                after_positions, after_total = collect_positions(requested_uris)
                after_counts = {uri: len(positions) for uri, positions in after_positions.items()}
                logger.info(
                    "Removal verification for playlist %s: before=%s after=%s total_before=%s total_after=%s",
                    playlist_id,
                    before_counts,
                    after_counts,
                    total_items,
                    after_total
                )
                removed_count = len(positions_to_remove)
            else:
                removed_count = 0
        else:
            uris = list({item.uri for item in body.items if item.uri})
            if not uris:
                return {"message": "No tracks selected", "removed": 0}
            sp.playlist_remove_all_occurrences_of_items(
                playlist_id,
                uris,
                snapshot_id=current_snapshot
            )
            removed_count = len(uris)

        playlist_cache_store.mark_dirty(playlist_id)
        _queue_cache_refresh(session_mgr, playlist_id, "tracks_remove")
        return {"message": "Tracks removed", "removed": removed_count}
    except Exception as e:
        logger.error("Failed to remove tracks from playlist %s: %s", playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to remove tracks")


@router.post("/create")
async def create_playlist_from_tracks(
    body: PlaylistCreateRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Create a new playlist and optionally add tracks."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    user_id = session_mgr.get_user_id()
    try:
        payload_public = body.public
        payload_collab = body.collaborative if payload_public is False else False
        new_playlist = sp.user_playlist_create(
            user=user_id,
            name=body.name,
            public=payload_public,
            collaborative=payload_collab,
            description=body.description,
        )
        track_uris = [uri for uri in body.track_uris if uri]
        for i in range(0, len(track_uris), 100):
            sp.playlist_add_items(new_playlist["id"], track_uris[i:i + 100])
        return {"message": "Playlist created", "new_playlist_id": new_playlist["id"]}
    except Exception as e:
        logger.error("Failed to create playlist for user %s: %s", user_id, e)
        raise HTTPException(status_code=500, detail="Failed to create playlist")


@router.get("/{playlist_id}/backup/status", response_model=PlaylistBackupStatusResponse)
async def get_playlist_backup_status(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth),
):
    facts = playlist_cache_store.get_facts_for_playlists([playlist_id]).get(playlist_id)
    if not facts:
        return PlaylistBackupStatusResponse(
            cached=False,
            track_count=0,
            last_cached_at_utc=None,
            last_snapshot_id=None,
            is_dirty=False,
        )
    return PlaylistBackupStatusResponse(
        cached=True,
        track_count=int(facts.get("track_count_cached") or 0),
        last_cached_at_utc=facts.get("last_cached_at_utc"),
        last_snapshot_id=facts.get("last_snapshot_id"),
        is_dirty=bool(facts.get("is_dirty") == 1),
    )


@router.post("/{playlist_id}/backup/create", response_model=PlaylistBackupSummary)
async def create_playlist_backup(
    playlist_id: str,
    body: PlaylistBackupCreateRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Backup name is required")
    playlist_name = None
    if body.cache_first:
        sp = spotify.get_spotify_client(session_mgr.get_user_id())
        if not sp:
            raise HTTPException(status_code=401, detail="Spotify authentication expired")
        try:
            _, playlist_name = _refresh_playlist_cache_snapshot(spotify, session_mgr, playlist_id)
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Failed to refresh cache before backup for playlist %s: %s", playlist_id, exc)
            raise HTTPException(status_code=502, detail="Failed to refresh cache before backup")
    else:
        try:
            playlist_detail = spotify.get_playlist_details(playlist_id, should_warm_cache=False)
            playlist_name = getattr(playlist_detail, "name", None)
        except Exception as exc:
            logger.warning("Failed to load playlist %s name for backup: %s", playlist_id, exc)
    backup = playlist_backup_store.create_backup_from_cache(
        playlist_id,
        session_mgr.get_user_id(),
        name,
        description=body.description,
        source="manual",
        playlist_name=playlist_name,
    )
    if not backup:
        raise HTTPException(
            status_code=409,
            detail="No cached backup available. Open the playlist once to warm the cache before creating a backup.",
        )
    return PlaylistBackupSummary(
        id=backup["id"],
        playlist_id=backup["playlist_id"],
        name=backup["name"],
        track_count=backup["track_count"],
        created_at=backup["created_at"],
        playlist_name=backup.get("playlist_name"),
        snapshot_id=backup.get("snapshot_id"),
        source=backup.get("source"),
    )


@router.get("/backups/all", response_model=PlaylistBackupListResponse)
async def list_all_backups(
    session_mgr: SessionManager = Depends(require_auth),
):
    backups = playlist_backup_store.list_all_backups(session_mgr.get_user_id())
    summaries = [
        PlaylistBackupSummary(
            id=backup["id"],
            playlist_id=backup["playlist_id"],
            name=backup["name"],
            track_count=backup["track_count"],
            created_at=backup["created_at"],
            playlist_name=backup.get("playlist_name"),
            snapshot_id=backup.get("snapshot_id"),
            source=backup.get("source"),
        )
        for backup in backups
    ]
    return PlaylistBackupListResponse(backups=summaries)


@router.get("/{playlist_id}/backups", response_model=PlaylistBackupListResponse)
async def list_playlist_backups(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth),
):
    backups = playlist_backup_store.list_backups(playlist_id, session_mgr.get_user_id())
    summaries = [
        PlaylistBackupSummary(
            id=backup["id"],
            playlist_id=backup["playlist_id"],
            name=backup["name"],
            track_count=backup["track_count"],
            created_at=backup["created_at"],
            playlist_name=backup.get("playlist_name"),
            snapshot_id=backup.get("snapshot_id"),
            source=backup.get("source"),
        )
        for backup in backups
    ]
    return PlaylistBackupListResponse(backups=summaries)


@router.get("/{playlist_id}/backups/{backup_id}/preview", response_model=PlaylistBackupPreviewResponse)
async def preview_playlist_backup(
    playlist_id: str,
    backup_id: int = Path(..., ge=1),
    limit: int = Query(50, ge=1, le=200),
    session_mgr: SessionManager = Depends(require_auth),
):
    backup = playlist_backup_store.get_backup(backup_id, playlist_id, session_mgr.get_user_id())
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    tracks = playlist_backup_store.get_backup_preview(backup_id, limit)
    return PlaylistBackupPreviewResponse(
        backup_id=backup_id,
        playlist_id=playlist_id,
        track_count=backup.get("track_count") or 0,
        limit=limit,
        tracks=tracks,
    )


@router.get("/{playlist_id}/backups/{backup_id}", response_model=PlaylistBackupDetailResponse)
async def get_playlist_backup_detail(
    playlist_id: str,
    backup_id: int = Path(..., ge=1),
    session_mgr: SessionManager = Depends(require_auth),
):
    backup = playlist_backup_store.get_backup(backup_id, playlist_id, session_mgr.get_user_id())
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    tracks = playlist_backup_store.get_backup_tracks(backup_id)
    return PlaylistBackupDetailResponse(
        backup_id=backup_id,
        playlist_id=playlist_id,
        track_count=backup.get("track_count") or 0,
        created_at=backup.get("created_at") or "",
        name=backup.get("name") or "",
        playlist_name=backup.get("playlist_name"),
        tracks=tracks,
    )


@router.post("/{playlist_id}/backups/{backup_id}/restore")
async def restore_playlist_from_named_backup(
    playlist_id: str,
    backup_id: int = Path(..., ge=1),
    body: PlaylistRestoreRequest = Body(...),
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")

    backup = playlist_backup_store.get_backup(backup_id, playlist_id, session_mgr.get_user_id())
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    track_ids = playlist_backup_store.get_backup_track_ids(backup_id)
    if not track_ids:
        raise HTTPException(status_code=409, detail="Backup is empty")

    return _restore_playlist_from_track_ids(sp, session_mgr, playlist_id, track_ids, body)


@router.patch("/{playlist_id}/backups/{backup_id}", response_model=PlaylistBackupSummary)
async def rename_playlist_backup(
    playlist_id: str,
    backup_id: int = Path(..., ge=1),
    body: PlaylistBackupRenameRequest = Body(...),
    session_mgr: SessionManager = Depends(require_auth),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Backup name is required")
    backup = playlist_backup_store.get_backup(backup_id, playlist_id, session_mgr.get_user_id())
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    updated = playlist_backup_store.rename_backup(backup_id, playlist_id, session_mgr.get_user_id(), name)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to rename backup")
    backup["name"] = name
    return PlaylistBackupSummary(
        id=backup["id"],
        playlist_id=backup["playlist_id"],
        name=backup["name"],
        track_count=backup["track_count"],
        created_at=backup["created_at"],
        playlist_name=backup.get("playlist_name"),
        snapshot_id=backup.get("snapshot_id"),
        source=backup.get("source"),
    )


@router.delete("/{playlist_id}/backups/{backup_id}")
async def delete_playlist_backup(
    playlist_id: str,
    backup_id: int = Path(..., ge=1),
    session_mgr: SessionManager = Depends(require_auth),
):
    deleted = playlist_backup_store.delete_backup(backup_id, playlist_id, session_mgr.get_user_id())
    if not deleted:
        raise HTTPException(status_code=404, detail="Backup not found")
    return {"message": "Backup deleted"}


def _replace_playlist_tracks(sp: Any, playlist_id: str, track_uris: List[str]) -> None:
    if not track_uris:
        sp.playlist_replace_items(playlist_id, [])
        return
    first_batch = track_uris[:100]
    rest = track_uris[100:]
    sp.playlist_replace_items(playlist_id, first_batch)
    for i in range(0, len(rest), 100):
        sp.playlist_add_items(playlist_id, rest[i:i + 100])


def _refresh_playlist_cache_snapshot(
    spotify: SpotifyService,
    session_mgr: SessionManager,
    playlist_id: str,
) -> tuple[int, Optional[str]]:
    playlist_detail = spotify.get_playlist_details(playlist_id, should_warm_cache=True)
    items = []
    for idx, track in enumerate(playlist_detail.tracks or []):
        if not track or not getattr(track, "id", None):
            continue
        added_at = track.added_at.isoformat() if getattr(track, "added_at", None) else None
        items.append({"position": idx, "track_id": track.id, "added_at": added_at})
    playlist_cache_store.refresh_cached_playlist(
        playlist_id=playlist_id,
        items=items,
        snapshot_id=getattr(playlist_detail, "snapshot_id", None),
    )
    return len(items), getattr(playlist_detail, "name", None)


def _restore_playlist_from_track_ids(
    sp: Any,
    session_mgr: SessionManager,
    playlist_id: str,
    track_ids: List[str],
    body: PlaylistRestoreRequest,
) -> Dict[str, Any]:
    track_uris = [f"spotify:track:{track_id}" for track_id in track_ids]

    target_playlist_id = playlist_id
    if body.mode == "clone":
        meta = None
        try:
            meta = sp.playlist(playlist_id, fields="name,description,public,collaborative,owner(id)")
        except SpotifyException as exc:
            if exc.http_status == 404:
                logger.warning("Playlist %s not found for clone restore; using fallback metadata.", playlist_id)
            else:
                raise
        base_name = (meta.get("name") if meta else None) or "Restored playlist"
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        target_name = body.name or f"{base_name} (backup {timestamp})"
        payload_public = body.public if body.public is not None else (meta.get("public") if meta else False)
        payload_collab = body.collaborative if body.collaborative is not None else (
            meta.get("collaborative") if meta else False
        )
        if payload_public:
            payload_collab = False
        target_description = body.description if body.description is not None else (
            meta.get("description") or "" if meta else ""
        )
        new_playlist = sp.user_playlist_create(
            user=session_mgr.get_user_id(),
            name=target_name,
            public=payload_public,
            collaborative=payload_collab,
            description=target_description,
        )
        target_playlist_id = new_playlist.get("id")
        if not target_playlist_id:
            raise HTTPException(status_code=502, detail="Failed to create restored playlist")

    _replace_playlist_tracks(sp, target_playlist_id, track_uris)
    snapshot_after = sp.playlist(target_playlist_id, fields="snapshot_id").get("snapshot_id")
    playlist_cache_store.mark_dirty(target_playlist_id)
    _queue_cache_refresh(session_mgr, target_playlist_id, "backup_restore")

    if body.mode == "clone":
        return {
            "message": "Playlist restored to new playlist",
            "new_playlist_id": target_playlist_id,
            "snapshot_id": snapshot_after,
        }
    return {
        "message": "Playlist restored",
        "snapshot_id": snapshot_after,
    }


@router.post("/{playlist_id}/backup/restore")
async def restore_playlist_from_backup(
    playlist_id: str,
    body: PlaylistRestoreRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")

    cached_items = playlist_cache_store.get_cached_playlist_items(playlist_id)
    track_ids = [item.get("track_id") for item in cached_items if item.get("track_id")]
    if not track_ids:
        raise HTTPException(
            status_code=409,
            detail="No cached backup available. Open the playlist once to warm the cache before restoring.",
        )
    return _restore_playlist_from_track_ids(sp, session_mgr, playlist_id, track_ids, body)


@router.post("/{playlist_id}/cache/matches", response_model=PlaylistCacheMatchResponse)
async def get_playlist_cache_matches(
    playlist_id: str,
    body: PlaylistCacheMatchRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    """Return cache-only match status for tracks against a cached playlist."""
    tracks = body.tracks or []
    return _get_cached_match(playlist_id, tracks, include_matches=True)


@router.post("/cache/matches", response_model=PlaylistCacheMatchBatchResponse)
async def get_playlist_cache_matches_batch(
    body: PlaylistCacheMatchBatchRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    """Return cache-only match summaries for multiple playlists."""
    tracks = body.tracks or []
    results: List[Dict[str, Any]] = []
    for playlist_id in [pid for pid in body.playlist_ids if pid]:
        summary = _get_cached_match(playlist_id, tracks, include_matches=False)
        results.append({"playlist_id": playlist_id, **summary})
    return {"results": results}


@router.post("/{playlist_id}/duplicates/analyze")
async def analyze_duplicates(
    playlist_id: str,
    include_similar: bool = False,
    prefer_album_release: bool = False,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Analyze playlist for exact duplicate tracks (by track id)."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    
    # Get ignored pairs for this session
    from ..db.database import get_db_connection
    ignored_pairs = set()
    session_id = session_mgr.get_session_id()
    if session_id:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT track_id_1, track_id_2 FROM ignored_pairs
                WHERE session_id = ? AND (playlist_id = ? OR playlist_id IS NULL)
            """, (session_id, playlist_id))
            for row in cursor.fetchall():
                ignored_pairs.add((row['track_id_1'], row['track_id_2']))
    
    try:
        meta = _ensure_playlist_cache(spotify, session_mgr, playlist_id)
        snapshot_id = meta.snapshot_id
        items = _build_cached_playlist_items(
            spotify,
            playlist_id,
            session_mgr.get_session_id(),
        )
        if items is None:
            snapshot_id = snapshot_id or sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
            items = _fetch_playlist_items(sp, playlist_id)
        groups: Dict[str, Dict[str, Any]] = {}
        seen_keys: Dict[str, List[int]] = {}

        def album_pref_score(album: Dict[str, Any]) -> int:
            a_type = (album or {}).get("album_type") or ""
            score_map = {"album": 3, "single": 2, "compilation": 1}
            return score_map.get(a_type, 0)

        for idx, item in enumerate(items):
            track = item.get("track") or {}
            track_id = track.get("id")
            if not track_id:
                continue
            album = track.get("album") or {}
            norm_title = _normalize_title(track.get("name", ""))
            norm_artist = _normalize_artist((track.get("artists") or [{}])[0].get("name", ""))
            key = track_id
            reason = "exact"
            duration = track.get("duration_ms") or 0
            if include_similar:
                key = f"{norm_title}::{norm_artist}"
                existing_group = groups.get(key)
                if existing_group and any(o.get("track_id") == track_id for o in existing_group.get("occurrences", [])):
                    reason = "exact"
                else:
                    prior_durations = seen_keys.get(key, [])
                    if prior_durations:
                        reason = "similar" if any(abs(duration - d) < 2000 for d in prior_durations) else "similar"
                    else:
                        reason = "similar"
                seen_keys.setdefault(key, []).append(duration)
            if not include_similar:
                # exact matching also needs seen to mark duplicates
                if key in seen_keys:
                    reason = "exact"
                seen_keys.setdefault(key, []).append(duration)

            album_type = album.get("album_type")
            album_total_tracks = album.get("total_tracks")
            album_release_date = album.get("release_date")
            album_release_date_precision = album.get("release_date_precision")
            occ = {
                "uri": track.get("uri"),
                "position": idx,
                "added_at": item.get("added_at"),
                "added_by": (item.get("added_by") or {}).get("id"),
                "name": track.get("name"),
                "artists": [a.get("name") for a in (track.get("artists") or [])],
                "artist_ids": [a.get("id") for a in (track.get("artists") or [])],
                "artist_uris": [a.get("uri") for a in (track.get("artists") or [])],
                "artist_external_urls": [a.get("external_urls", {}).get("spotify") for a in (track.get("artists") or [])],
                "album": (track.get("album") or {}).get("name"),
                "album_id": album.get("id"),
                "album_uri": album.get("uri"),
                "album_external_url": album.get("external_urls", {}).get("spotify"),
                "album_images": (track.get("album") or {}).get("images") or [],
                "duration_ms": track.get("duration_ms"),
                "reason": reason if reason in ("exact", "similar") else "exact",
                "track_id": track_id,
                "album_type": album_type,
                "album_total_tracks": album_total_tracks,
                "album_release_date": album_release_date,
                "album_release_date_precision": album_release_date_precision,
                "album_preference_score": album_pref_score(album) if prefer_album_release else 0,
            }
            if key not in groups:
                groups[key] = {
                    "track_id": track_id,
                    "track_uri": track.get("uri"),
                    "name": track.get("name"),
                    "artists": [a.get("name") for a in (track.get("artists") or [])],
                    "artist_ids": [a.get("id") for a in (track.get("artists") or [])],
                    "artist_uris": [a.get("uri") for a in (track.get("artists") or [])],
                    "artist_external_urls": [a.get("external_urls", {}).get("spotify") for a in (track.get("artists") or [])],
                    "album": album.get("name"),
                    "album_id": album.get("id"),
                    "album_uri": album.get("uri"),
                    "album_external_url": album.get("external_urls", {}).get("spotify"),
                    "album_images": album.get("images") or [],
                    "occurrences": [],
                    "match_key": key,
                    "track_ids": set(),
                }
            groups[key]["track_ids"].add(track_id)
            groups[key]["occurrences"].append(occ)
            # If in similar mode and we find multiple entries with the same track_id inside this group, mark them as exact.
            if include_similar and len(groups[key]["track_ids"]) < len(groups[key]["occurrences"]):
                track_id_counts = {}
                for o in groups[key]["occurrences"]:
                    tid = o.get("track_id")
                    if tid:
                        track_id_counts[tid] = track_id_counts.get(tid, 0) + 1
                for o in groups[key]["occurrences"]:
                    if o.get("track_id") and track_id_counts.get(o["track_id"], 0) > 1:
                        o["reason"] = "exact"

        duplicate_groups = [g for g in groups.values() if len(g["occurrences"]) > 1]
        
        # Filter out ignored pairs
        filtered_groups = []
        for g in duplicate_groups:
            # Check if this is an ignored pair (for 2-occurrence groups only)
            if len(g["occurrences"]) == 2:
                track_ids = sorted([g["occurrences"][0]["track_id"], g["occurrences"][1]["track_id"]])
                if tuple(track_ids) in ignored_pairs:
                    continue  # Skip this pair
            
            # Convert track_ids set to list for JSON serialization
            g["track_ids"] = list(g["track_ids"])
            filtered_groups.append(g)
        
        total_extra = sum(len(g["occurrences"]) - 1 for g in filtered_groups)
        logger.info(
            "Duplicate analysis for playlist %s (user=%s): %s groups, %s extra occurrences (include_similar=%s, prefer_album_release=%s, ignored=%s)",
            playlist_id,
            session_mgr.get_user_id(),
            len(filtered_groups),
            total_extra,
            include_similar,
            prefer_album_release,
            len(ignored_pairs),
        )
        return {
            "snapshot_id": snapshot_id,
            "total_groups": len(filtered_groups),
            "total_extra": total_extra,
            "groups": filtered_groups
        }
    except Exception as e:
        logger.error("Failed to analyze duplicates for playlist %s: %s", playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to analyze duplicates")


@router.post("/{playlist_id}/duplicates/remove")
async def remove_duplicates(
    playlist_id: str,
    body: DuplicateRemovalRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Remove specific duplicate occurrences by uri/position."""
    if not body.items:
        return {"message": "No duplicates selected"}
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    try:
        # Recompute current items to ensure positions are accurate and filter out stale selections
        current_items = _fetch_playlist_items(sp, playlist_id)
        current_snapshot = body.snapshot_id or sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")

        logger.info(
            "Duplicate removal request: %s items for playlist %s (user=%s) snapshot=%s",
            len(body.items),
            playlist_id,
            session_mgr.get_user_id(),
            current_snapshot,
        )
        logger.debug("Requested duplicates payload: %s", [occ.dict() for occ in body.items])

        # Build occurrence map per URI with positions
        occ_map: Dict[str, List[int]] = {}
        for idx, it in enumerate(current_items):
            track = it.get("track") or {}
            uri = track.get("uri")
            if not uri:
                continue
            occ_map.setdefault(uri, []).append(idx)

        # Collect positions to remove (validated)
        positions_to_remove: List[int] = []
        for occ in body.items:
            positions = occ_map.get(occ.uri, [])
            if occ.position in positions:
                positions_to_remove.append(occ.position)

        if not positions_to_remove:
            logger.info("No valid duplicate occurrences to remove for playlist %s", playlist_id)
            return {"message": "No duplicates removed", "removed": 0}

        # Capture details for undo before we delete anything
        removed_items = []
        for pos in sorted(set(positions_to_remove)):
            if 0 <= pos < len(current_items):
                track = (current_items[pos] or {}).get("track") or {}
                removed_items.append({
                    "uri": track.get("uri"),
                    "position": pos,
                    "name": track.get("name"),
                    "artists": [a.get("name") for a in (track.get("artists") or [])],
                    "album": (track.get("album") or {}).get("name"),
                    "added_at": current_items[pos].get("added_at"),
                })

        positions_to_remove = sorted(positions_to_remove, reverse=True)

        logger.info(
            "Removing %s occurrences by position for playlist %s (user=%s) snapshot=%s",
            len(positions_to_remove),
            playlist_id,
            session_mgr.get_user_id(),
            current_snapshot,
        )
        logger.debug("Removal positions: %s", positions_to_remove)

        # Use positions-only delete to mirror spotify-dedup approach
        payload = {"positions": positions_to_remove, "snapshot_id": current_snapshot}
        sp._delete(f"playlists/{playlist_id}/tracks", payload=payload)

        # Verify removal by refetching count
        after_items = _fetch_playlist_items(sp, playlist_id)
        removed_count = len(current_items) - len(after_items)
        after_snapshot = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")

        try:
            op_store.cleanup_expired()
            op_store.record_operation(
                playlist_id=playlist_id,
                user_id=session_mgr.get_user_id(),
                op_type="duplicates_remove",
                snapshot_before=current_snapshot,
                snapshot_after=after_snapshot,
                payload={"removed_items": removed_items},
            )
        except Exception as log_err:
            logger.warning("Failed to persist undo record for playlist %s: %s", playlist_id, log_err)

        logger.info(
            "Removed %s occurrences for playlist %s; playlist length %s -> %s",
            removed_count,
            playlist_id,
            len(current_items),
            len(after_items),
        )
        playlist_cache_store.mark_dirty(playlist_id)
        _queue_cache_refresh(session_mgr, playlist_id, "duplicates_remove")
        return {"message": "Duplicates removed", "removed": removed_count}
    except Exception as e:
        logger.error("Failed to remove duplicates for playlist %s: %s", playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to remove duplicates")


@router.post("/{playlist_id}/undo")
async def undo_last_operation(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Undo the most recent bulk playlist operation for this playlist/user."""
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    op_store.cleanup_expired()
    op = op_store.get_latest_operation(playlist_id, session_mgr.get_user_id())
    if not op:
        raise HTTPException(status_code=404, detail="No undoable operations found for this playlist")

    try:
        current_snapshot = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
        expected_snapshot = op.get("snapshot_after")
        if expected_snapshot and current_snapshot and current_snapshot != expected_snapshot:
            logger.warning(
                "Undo snapshot mismatch for playlist %s (user=%s): expected=%s current=%s. Blocking undo.",
                playlist_id,
                session_mgr.get_user_id(),
                expected_snapshot,
                current_snapshot,
            )
            raise HTTPException(
                status_code=409,
                detail="Playlist changed since this action; undo not available. Refresh and try again if you just updated.",
            )

        if op.get("op_type") == "duplicates_remove":
            payload = op.get("payload") or {}
            removed_items = payload.get("removed_items") or []
            if not removed_items:
                raise HTTPException(status_code=400, detail="No removal data stored for undo.")

            # Insert back in ascending position order to restore layout.
            for item in sorted(removed_items, key=lambda x: x.get("position", 0)):
                uri = item.get("uri")
                position = item.get("position")
                if not uri:
                    continue
                sp.playlist_add_items(playlist_id, [uri], position=position)

            new_snapshot = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
            op_store.mark_undone(op["id"])
            logger.info(
                "Undo duplicates_remove for playlist %s (user=%s) restored %s tracks",
                playlist_id,
                session_mgr.get_user_id(),
                len(removed_items),
            )
            playlist_cache_store.mark_dirty(playlist_id)
            _queue_cache_refresh(session_mgr, playlist_id, "undo_duplicates")
            return {
                "message": f"Restored {len(removed_items)} tracks",
                "snapshot_id": new_snapshot,
                "operation_id": op["id"],
                "op_type": op["op_type"],
            }

        if op.get("op_type") == "sort_reorder":
            payload = op.get("payload") or {}
            original_order = payload.get("original_order") or []
            if not original_order:
                raise HTTPException(status_code=400, detail="No sort history stored for undo.")

            try:
                # Replace playlist with original order (first batch replaces, rest appended)
                first_batch = original_order[:100]
                rest = original_order[100:]
                if not first_batch:
                    raise HTTPException(status_code=400, detail="Stored sort order is empty.")

                sp.playlist_replace_items(playlist_id, first_batch)
                for i in range(0, len(rest), 100):
                    sp.playlist_add_items(playlist_id, rest[i:i+100])

                new_snapshot = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
                op_store.mark_undone(op["id"])
                logger.info(
                    "Undo sort_reorder for playlist %s (user=%s) restored previous order (%s tracks)",
                    playlist_id,
                    session_mgr.get_user_id(),
                    len(original_order),
                )
                playlist_cache_store.mark_dirty(playlist_id)
                _queue_cache_refresh(session_mgr, playlist_id, "undo_sort")
                return {
                    "message": f"Restored previous order ({len(original_order)} tracks)",
                    "snapshot_id": new_snapshot,
                    "operation_id": op["id"],
                    "op_type": op["op_type"],
                }
            except Exception as restore_err:
                logger.error("Failed to restore order for playlist %s: %s", playlist_id, restore_err)
                raise HTTPException(status_code=500, detail="Failed to restore previous order")

        raise HTTPException(status_code=400, detail=f"Unsupported undo type: {op.get('op_type')}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to undo operation %s for playlist %s: %s", op.get("id"), playlist_id, e)
        raise HTTPException(status_code=500, detail="Failed to undo last operation")


@router.get("/{playlist_id}/history")
async def get_playlist_history(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    """Return recent undoable operations for this playlist/user."""
    op_store.cleanup_expired()
    history = op_store.get_history(playlist_id, session_mgr.get_user_id(), limit=10)
    # Trim payload for readability
    cleaned = []
    current_snapshot = None
    try:
        sp = spotify.get_spotify_client(session_mgr.get_user_id())
        if sp:
            current_snapshot = sp.playlist(playlist_id, fields="snapshot_id").get("snapshot_id")
    except Exception as e:
        logger.warning("Failed to fetch current snapshot for history state: %s", e)

    for entry in history:
        payload = entry.get("payload") or {}
        sort_meta = None
        if entry.get("op_type") == "sort_reorder":
            tracks_moved = payload.get("tracks_moved", 0)
            sort_meta = {
                "sort_by": payload.get("sort_by"),
                "direction": payload.get("direction"),
                "method": payload.get("method"),
                "track_count": len(payload.get("original_order") or []),
                "tracks_moved": tracks_moved,
                "no_changes": tracks_moved == 0,
            }
        expected_snapshot = entry.get("snapshot_after")
        cache_meta = None
        if entry.get("op_type") in {"cache_refresh", "cache_refresh_full"}:
            cache_meta = {
                "mode": payload.get("mode"),
                "cached_track_count_before": payload.get("cached_track_count_before"),
                "cached_track_count_after": payload.get("cached_track_count_after"),
            }
        can_undo = bool(not entry.get("undone") and expected_snapshot and current_snapshot and expected_snapshot == current_snapshot)
        cleaned.append({
            "id": entry.get("id"),
            "op_type": entry.get("op_type"),
            "created_at": entry.get("created_at"),
            "expires_at": entry.get("expires_at"),
            "snapshot_before": entry.get("snapshot_before"),
            "snapshot_after": expected_snapshot,
            "removed_count": len(payload.get("removed_items") or []) if entry.get("op_type") == "duplicates_remove" else None,
            "sort": sort_meta,
            "cache_refresh": cache_meta,
            "undone": bool(entry.get("undone")),
            "can_undo": can_undo,
            "changes_made": bool(entry.get("changes_made", True)),
            "source": payload.get("source"),
            "schedule_id": payload.get("schedule_id"),
        })
    return {"history": cleaned}


@router.get("/{playlist_id}/history/{operation_id}/export")
async def export_history(
    playlist_id: str,
    operation_id: int,
    session_mgr: SessionManager = Depends(require_auth),
):
    """Export removed items from a history entry (duplicates_remove) as JSON."""
    op_store.cleanup_expired()
    op = op_store.get_operation_by_id(operation_id, session_mgr.get_user_id())
    if not op or op.get("playlist_id") != playlist_id:
        raise HTTPException(status_code=404, detail="History entry not found")
    if op.get("op_type") != "duplicates_remove":
        raise HTTPException(status_code=400, detail="Only removal operations can be exported")

    payload = op.get("payload") or {}
    removed_items = payload.get("removed_items") or []
    if not removed_items:
        raise HTTPException(status_code=400, detail="No removed items to export")

    export_payload = {
        "playlist_id": playlist_id,
        "operation_id": operation_id,
        "op_type": op.get("op_type"),
        "created_at": op.get("created_at"),
        "snapshot_before": op.get("snapshot_before"),
        "snapshot_after": op.get("snapshot_after"),
        "removed_items": [],
    }
    for item in removed_items:
        export_payload["removed_items"].append({
            "title": (item.get("name") or "").strip(),
            "artists": item.get("artists") or [],
            "album": (item.get("album") or "").strip(),
            "added_at": item.get("added_at") or "",
            "uri": item.get("uri") or "",
        })
    headers = {"Content-Disposition": f'attachment; filename="removed-{operation_id}.json"'}
    return StreamingResponse(
        iter([json.dumps(export_payload, indent=2)]),
        media_type="application/json",
        headers=headers
    )

@router.get("/history/all")
async def get_all_user_history(
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    """Return recent operations across ALL playlists for this user."""
    op_store.cleanup_expired()
    history = op_store.get_all_history(session_mgr.get_user_id(), limit=50)
    
    # Get user's playlists for names
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    playlist_names = {}
    if sp:
        try:
            playlists = sp.current_user_playlists(limit=50)
            for p in playlists.get('items', []):
                playlist_names[p['id']] = p['name']
        except Exception as e:
            logger.warning("Failed to fetch playlist names for history: %s", e)
    
    # Format history entries
    cleaned = []
    for entry in history:
        payload = entry.get("payload") or {}
        sort_meta = None
        if entry.get("op_type") == "sort_reorder":
            tracks_moved = payload.get("tracks_moved", 0)
            sort_meta = {
                "sort_by": payload.get("sort_by"),
                "direction": payload.get("direction"),
                "method": payload.get("method"),
                "track_count": len(payload.get("original_order") or []),
                "tracks_moved": tracks_moved,
                "no_changes": tracks_moved == 0,
            }
        
        playlist_id = entry.get("playlist_id")
        cache_meta = None
        if entry.get("op_type") in {"cache_refresh", "cache_refresh_full"}:
            cache_meta = {
                "mode": payload.get("mode"),
                "cached_track_count_before": payload.get("cached_track_count_before"),
                "cached_track_count_after": payload.get("cached_track_count_after"),
            }
        cleaned.append({
            "id": entry.get("id"),
            "playlist_id": playlist_id,
            "playlist_name": playlist_names.get(playlist_id, "Unknown Playlist"),
            "op_type": entry.get("op_type"),
            "created_at": entry.get("created_at"),
            "expires_at": entry.get("expires_at"),
            "removed_count": len(payload.get("removed_items") or []) if entry.get("op_type") == "duplicates_remove" else None,
            "sort": sort_meta,
            "cache_refresh": cache_meta,
            "undone": bool(entry.get("undone")),
            "changes_made": bool(entry.get("changes_made", True)),
            "source": payload.get("source"),
            "schedule_id": payload.get("schedule_id"),
        })
    
    return cleaned

@router.delete("/{playlist_id}")
async def delete_playlist(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """Unfollow/delete a playlist (removes from user's library)."""
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated")
    sp = spotify.get_spotify_client(session_mgr.get_user_id())
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired")
    try:
        logger.info("Deleting/unfollowing playlist %s for user=%s", playlist_id, session_mgr.get_user_id())
        sp.current_user_unfollow_playlist(playlist_id)
        return {"message": "Playlist removed"}
    except Exception as e:
        logger.error(f"Failed to delete playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Install a plain logger handler for FastAPI access logs to match app log format
uvicorn_access_logger = logging.getLogger("uvicorn.access")
if uvicorn_access_logger.handlers:
    for h in uvicorn_access_logger.handlers:
        class AdelaideFormatter(logging.Formatter):
            def formatTime(self, record, datefmt=None):
                dt = datetime.fromtimestamp(record.created, ZoneInfo("Australia/Adelaide"))
                if datefmt:
                    s = dt.strftime(datefmt)
                else:
                    s = dt.strftime("%Y-%m-%d %H:%M:%S")
                return s
        h.setFormatter(AdelaideFormatter("%(asctime)s - uvicorn.access - %(levelname)s - %(message)s"))
else:
    class AdelaideFormatter(logging.Formatter):
        def formatTime(self, record, datefmt=None):
            dt = datetime.fromtimestamp(record.created, ZoneInfo("Australia/Adelaide"))
            if datefmt:
                s = dt.strftime(datefmt)
            else:
                s = dt.strftime("%Y-%m-%d %H:%M:%S")
            return s
    handler = logging.StreamHandler()
    handler.setFormatter(AdelaideFormatter("%(asctime)s - uvicorn.access - %(levelname)s - %(message)s"))
    uvicorn_access_logger.addHandler(handler)
uvicorn_access_logger.propagate = False
def _normalize_title(title: str) -> str:
    """Normalize track title for similarity detection."""
    if not title:
        return ''
    title = title.lower()
    # Remove parenthetical/bracketed content
    import re
    title = re.sub(r"\([^)]*\)", "", title)
    title = re.sub(r"\[[^\]]*\]", "", title)
    # Remove feat/featuring segments
    title = re.sub(r"\s+-\s+.*", "", title)
    title = title.replace("feat.", "").replace("featuring", "").strip()
    return " ".join(title.split())


def _normalize_artist(name: str) -> str:
    if not name:
        return ''
    name = name.lower()
    if " feat" in name:
        name = name.split(" feat")[0]
    if " featuring" in name:
        name = name.split(" featuring")[0]
    return " ".join(name.split())


def _build_similarity_key(title: str, artist: str) -> Optional[str]:
    norm_title = _normalize_title(title)
    norm_artist = _normalize_artist(artist)
    if not norm_title or not norm_artist:
        return None
    return f"{norm_title}::{norm_artist}"


def _get_cached_match(
    playlist_id: str,
    tracks: List[PlaylistCacheMatchTrack],
    include_matches: bool,
) -> Dict[str, Any]:
    total = len(tracks)
    cached_track_ids = playlist_cache_store.get_cached_track_ids(playlist_id)
    if not cached_track_ids:
        facts = playlist_cache_store.get_facts_for_playlists([playlist_id])
        cached_flag = bool(facts.get(playlist_id))
        result: Dict[str, Any] = {
            "cached": cached_flag,
            "exact_count": 0,
            "similar_count": 0,
            "total": total,
        }
        if include_matches:
            result["matches"] = [
                {"client_key": track.client_key, "status": None} for track in tracks
            ]
        return result

    cached_set = set(cached_track_ids)
    requested_keys = set()
    for track in tracks:
        artist_name = (track.artists or [None])[0] if track.artists else None
        key = _build_similarity_key(track.name or "", artist_name or "")
        if key:
            requested_keys.add(key)

    similar_map: Dict[str, List[int]] = {}
    if requested_keys:
        ttl_days, _ = app_settings.get_track_cache_ttl_days()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=ttl_days)).isoformat()
        cached_rows = playlist_cache_store.get_cached_playlist_tracks(playlist_id, cutoff)
        for row in cached_rows:
            try:
                artists = json.loads(row.get("artists_json") or "[]")
            except json.JSONDecodeError:
                artists = []
            artist_name = artists[0] if artists else ""
            key = _build_similarity_key(row.get("name") or "", artist_name)
            if key and key in requested_keys:
                similar_map.setdefault(key, []).append(row.get("duration_ms") or 0)

    exact_count = 0
    similar_count = 0
    matches: List[Dict[str, Optional[str]]] = []
    for index, track in enumerate(tracks):
        client_key = track.client_key or track.track_id or f"track-{index}"
        status = None
        if track.track_id and track.track_id in cached_set:
            status = "exact"
            exact_count += 1
        else:
            artist_name = (track.artists or [None])[0] if track.artists else None
            key = _build_similarity_key(track.name or "", artist_name or "")
            durations = similar_map.get(key) if key else None
            if durations and track.duration_ms is not None:
                for duration in durations:
                    if abs(track.duration_ms - duration) < 2000:
                        status = "similar"
                        similar_count += 1
                        break
        if include_matches:
            matches.append({"client_key": client_key, "status": status})

    result = {
        "cached": True,
        "exact_count": exact_count,
        "similar_count": similar_count,
        "total": total,
    }
    if include_matches:
        result["matches"] = matches
    return result


@router.post("/tracks/batch")
async def get_tracks_batch(
    track_ids: List[str],
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """
    Get Track Details in Batch
    
    Fetches detailed information for multiple tracks by their Spotify IDs.
    Uses cache-aside pattern: checks cache first, fetches missing tracks from Spotify,
    then updates cache with fresh data.
    
    Args:
        track_ids: List of Spotify track IDs
        
    Returns:
        List of track detail objects with name, artists, album, duration, etc.
        
    Raises:
        HTTPException: 401 if not authenticated, 400 if invalid IDs
        
    Example Response:
        [
            {
                "id": "3n3Ppam7vgaVa1iaRUc9Lp",
                "name": "Mr. Brightside",
                "artists": [{"name": "The Killers"}],
                "album": {"name": "Hot Fuss", "images": [...]},
                "duration_ms": 222973,
                "uri": "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp",
                "album_art": "https://i.scdn.co/image/..."
            }
        ]
    """
    from app.services.cache_service import CacheService
    
    if not track_ids:
        return []
    
    if len(track_ids) > 50:
        raise HTTPException(
            status_code=400,
            detail="Maximum 50 track IDs per request"
        )
    
    try:
        session_id = session_mgr.session_id
        
        # Step 1: Check cache
        cached_tracks, missing_ids = CacheService.get_tracks(track_ids, session_id)
        results = []
        
        # Step 2: Fetch missing tracks from Spotify
        if missing_ids:
            client = spotify.get_client()
            tracks_data = client.tracks(list(missing_ids))
            
            fresh_tracks = []
            for track in tracks_data.get('tracks', []):
                if track is None:
                    continue
                fresh_tracks.append(track)
                
                # Format for response
                results.append({
                    'id': track['id'],
                    'name': track['name'],
                    'artists': [{'name': artist['name']} for artist in track.get('artists', [])],
                    'album': {
                        'name': track['album']['name'],
                        'images': track['album'].get('images', []),
                        'release_date': track['album'].get('release_date'),
                        'release_date_precision': track['album'].get('release_date_precision')
                    },
                    'duration_ms': track.get('duration_ms', 0),
                    'uri': track['uri'],
                    'album_art': track['album']['images'][0]['url'] if track['album'].get('images') else None
                })
            
            # Step 3: Update cache with fresh data
            if fresh_tracks:
                CacheService.set_tracks(fresh_tracks, session_id)
        
        # Step 4: Add cached tracks to results
        for track_id in track_ids:
            if track_id in cached_tracks:
                track = cached_tracks[track_id]
                artists = []
                for artist in track['artists']:
                    if isinstance(artist, dict):
                        artists.append({'name': artist.get('name')})
                    else:
                        artists.append({'name': artist})
                results.append({
                    'id': track['id'],
                    'name': track['name'],
                    'artists': artists,
                    'album': {
                        'name': track['album'],
                        'images': [],
                        'release_date': track.get('album_release_date'),
                        'release_date_precision': track.get('album_release_date_precision'),
                        'id': track.get('album_id'),
                        'uri': track.get('album_uri'),
                    },
                    'duration_ms': track['duration_ms'],
                    'uri': track.get('track_uri') or f"spotify:track:{track['id']}",
                    'album_art': track.get('album_art_url')
                })
        
        # Preserve original order
        result_map = {r['id']: r for r in results}
        ordered_results = [result_map[tid] for tid in track_ids if tid in result_map]
        
        logger.info(f"Returned {len(ordered_results)} tracks ({len(cached_tracks)} from cache, {len(missing_ids)} from API)")
        return ordered_results
        
    except SpotifyException as e:
        logger.error(f"Spotify API error fetching tracks: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch track details from Spotify")
    except Exception as e:
        logger.error(f"Error fetching track batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))
