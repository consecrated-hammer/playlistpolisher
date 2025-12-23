"""
Playlist Routes

This module defines all playlist-related API endpoints including:
- Listing user playlists
- Fetching detailed playlist information with tracks

All routes are prefixed with /playlists and require authentication.
"""

from fastapi import APIRouter, HTTPException, Depends, Path, Request
from fastapi.responses import StreamingResponse
from typing import List, Optional, Dict, Any
import logging
from spotipy.exceptions import SpotifyException
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import json

from app.services.spotify_service import SpotifyService, get_spotify_service
from app.config import settings
from app.models.schemas import PlaylistSimple, PlaylistContextMeta, PlaylistDetail, ErrorResponse, PaginatedTracks
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME
from pydantic import BaseModel, Field
from app.db import operations as op_store
from app.db import preferences as preference_store
from app.db import playlist_cache as playlist_cache_store
from app.services.sort_service import get_sort_key_function

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/playlists", tags=["playlists"])


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
        meta = spotify.get_playlist_context_meta(playlist_id)
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
        
        from app.models.schemas import CacheInfo
        
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


class PlaylistCacheMatchTrack(BaseModel):
    client_key: str
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
        snapshot_info = sp.playlist(playlist_id, fields="snapshot_id")
        snapshot_id = snapshot_info.get("snapshot_id")
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
        cleaned.append({
            "id": entry.get("id"),
            "playlist_id": playlist_id,
            "playlist_name": playlist_names.get(playlist_id, "Unknown Playlist"),
            "op_type": entry.get("op_type"),
            "created_at": entry.get("created_at"),
            "expires_at": entry.get("expires_at"),
            "removed_count": len(payload.get("removed_items") or []) if entry.get("op_type") == "duplicates_remove" else None,
            "sort": sort_meta,
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
        cutoff = (datetime.now(timezone.utc) - timedelta(days=settings.track_cache_ttl_days)).isoformat()
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
    for track in tracks:
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
            matches.append({"client_key": track.client_key, "status": status})

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
                results.append({
                    'id': track['id'],
                    'name': track['name'],
                    'artists': [{'name': name} for name in track['artists']],
                    'album': {
                        'name': track['album'],
                        'images': [],
                        'release_date': track.get('album_release_date'),
                        'release_date_precision': track.get('album_release_date_precision'),
                    },
                    'duration_ms': track['duration_ms'],
                    'uri': f"spotify:track:{track['id']}",
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
