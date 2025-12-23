"""
Spotify Service Module

This module provides a high-level interface to the Spotify Web API using Spotipy.
Handles all Spotify API interactions including authentication, playlists, and tracks.

Classes:
    SpotifyService: Main service class for Spotify API operations
    
Functions:
    get_spotify_service: Dependency injection function for FastAPI routes
"""

import spotipy
from spotipy.oauth2 import SpotifyOAuth, SpotifyClientCredentials
from typing import List, Optional, Dict, Any
import logging
from fastapi import Request
import httpx

from app.config import settings
from app.models.schemas import (
    PlaylistSimple,
    PlaylistContextMeta,
    PlaylistDetail,
    PlaylistTrack,
    PlaylistOwner,
    PlaylistTracks,
    UserProfile,
    ImageObject,
    ArtistSimple,
    AlbumSimple,
    CacheInfo
)
from app.utils.token_manager import TokenManager
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)


class SpotifyService:
    """
    Spotify API Service
    
    Provides methods to interact with Spotify Web API. Handles OAuth flow,
    token refresh, and data transformation from Spotify API format to
    application models.
    
    Attributes:
        token_manager: Token manager instance for OAuth
        oauth: SpotifyOAuth instance for authentication
        
    Methods:
        get_auth_url: Generate OAuth authorization URL
        handle_callback: Process OAuth callback and store tokens
        get_client: Get authenticated Spotify client
        get_user_profile: Fetch current user's profile
        get_user_playlists: Fetch user's playlists
        get_playlist_details: Fetch detailed playlist information with tracks
    """
    
    REQUIRED_SCOPES = [
        "user-read-private",
        "user-read-email",
        "playlist-read-private",
        "playlist-read-collaborative",
        "playlist-modify-public",
        "playlist-modify-private",
        "streaming",
        "user-read-playback-state",
        "user-modify-playback-state"
    ]
    
    def __init__(self, session_manager: Optional[SessionManager] = None, token_manager: Optional[TokenManager] = None):
        """
        Initialize Spotify Service
        
        Args:
            session_manager: Session manager instance (preferred, for session-based auth)
            token_manager: Token manager instance (fallback for compatibility)
        """
        # Prefer session manager over token manager
        self.session_manager = session_manager
        self.token_manager = token_manager or (SessionManager() if not session_manager else None)
        self.oauth = SpotifyOAuth(
            client_id=settings.spotify_client_id,
            client_secret=settings.spotify_client_secret,
            redirect_uri=settings.spotify_redirect_uri,
            scope=" ".join(self.REQUIRED_SCOPES),
            cache_handler=None  # We handle caching ourselves
        )
    
    def get_auth_url(self, state: str | None = None, show_dialog: bool = False) -> str:
        """
        Generate Spotify OAuth authorization URL
        
        Creates the URL where users should be redirected to authorize
        the application with their Spotify account.
        
        Returns:
            str: Authorization URL
            
        Example:
            auth_url = spotify_service.get_auth_url()
            return RedirectResponse(url=auth_url)
        """
        # Spotipy's get_authorize_url may not support show_dialog in older versions;
        # append the parameter manually when requested.
        auth_url = self.oauth.get_authorize_url(state=state)
        if show_dialog:
            separator = "&" if "?" in auth_url else "?"
            auth_url = f"{auth_url}{separator}show_dialog=true"
        logger.info("Generated OAuth authorization URL (show_dialog=%s)", show_dialog)
        return auth_url
    
    def handle_callback(self, code: str) -> Dict[str, Any]:
        """
        Handle OAuth callback and exchange code for tokens
        
        Processes the authorization code received from Spotify OAuth callback,
        exchanges it for access and refresh tokens, and stores them.
        
        Args:
            code: Authorization code from OAuth callback
            
        Returns:
            Dict containing token information
            
        Raises:
            Exception: If token exchange fails
            
        Example:
            token_info = spotify_service.handle_callback(code)
        """
        try:
            token_info = self.oauth.get_access_token(code, as_dict=True)
            
            # Store tokens using token manager
            self.token_manager.save_token(
                access_token=token_info["access_token"],
                refresh_token=token_info["refresh_token"],
                expires_in=token_info["expires_in"],
                token_type=token_info.get("token_type", "Bearer"),
                scope=token_info.get("scope", "")
            )
            
            logger.info("Successfully handled OAuth callback and stored tokens")
            return token_info
        except Exception as e:
            logger.error(f"Failed to handle OAuth callback: {e}")
            raise

    def revoke_refresh_token(self, refresh_token: str) -> bool:
        """
        Best-effort refresh token revocation using RFC7009-style call.
        Spotify does not publish a revocation endpoint; this may be ignored.
        """
        if not refresh_token:
            return False
        url = "https://accounts.spotify.com/api/token"
        data = {"token": refresh_token, "token_type_hint": "refresh_token"}
        auth = (settings.spotify_client_id, settings.spotify_client_secret)
        try:
            resp = httpx.post(url, data=data, auth=auth, timeout=5.0)
            if resp.status_code in (200, 400, 401, 404):
                # Treat non-5xx responses as best-effort handled
                logger.info("Sent token revocation request to Spotify (status %s)", resp.status_code)
                return True
            logger.warning("Token revocation returned unexpected status %s: %s", resp.status_code, resp.text)
        except Exception as e:
            logger.warning(f"Token revocation failed: {e}")
        return False
    
    def _refresh_token_if_needed(self) -> None:
        """
        Refresh access token if expired
        
        Checks if the current token is expired and refreshes it if necessary.
        Updates stored token with new access token.
        """
        # Use session manager if available, otherwise fall back to token manager
        mgr = self.session_manager if self.session_manager else self.token_manager
        
        # If access token is still valid, no need to refresh
        if mgr.is_authenticated():
            logger.debug("Access token still valid, no refresh needed")
            return
        
        # Access token expired, try to refresh it
        refresh_token = mgr.get_refresh_token()
        logger.info(f"Token expired, attempting refresh. Refresh token present: {bool(refresh_token)}")
        
        if not refresh_token:
            logger.error(f"No refresh token available. Session ID: {getattr(mgr, 'session_id', 'N/A')}")
            raise ValueError("No refresh token available")
        
        logger.info("Refreshing expired access token")
        token_info = self.oauth.refresh_access_token(refresh_token)
        
        mgr.update_tokens(
            access_token=token_info["access_token"],
            expires_in=token_info["expires_in"],
            refresh_token=token_info.get("refresh_token")  # May be None
        )
    
    def get_client(self) -> spotipy.Spotify:
        """
        Get authenticated Spotify client
        
        Creates a Spotify client with the current access token.
        Refreshes token if expired.
        
        Returns:
            spotipy.Spotify: Authenticated Spotify client
            
        Raises:
            ValueError: If no valid token available
            
        Example:
            client = spotify_service.get_client()
            user = client.current_user()
        """
        self._refresh_token_if_needed()
        
        # Use session manager if available, otherwise fall back to token manager
        mgr = self.session_manager if self.session_manager else self.token_manager
        access_token = mgr.get_access_token()
        if not access_token:
            raise ValueError("No access token available. Please authenticate first.")
        
        return spotipy.Spotify(auth=access_token)
    
    def get_spotify_client(self, user_id: str) -> Optional[spotipy.Spotify]:
        """
        Get authenticated Spotify client for a user.
        
        Note: Current implementation is single-user, so user_id is ignored.
        Future enhancement: Support multi-user with per-user token storage.
        
        Args:
            user_id: User ID (currently ignored)
        
        Returns:
            Authenticated Spotify client or None if not authenticated
        """
        try:
            return self.get_client()
        except (ValueError, Exception) as e:
            logger.warning(f"Failed to get Spotify client: {e}")
            return None
    
    def get_user_profile(self) -> UserProfile:
        """
        Fetch current user's Spotify profile
        
        Returns:
            UserProfile: User profile information
            
        Raises:
            ValueError: If not authenticated
            SpotifyException: If API call fails
        """
        client = self.get_client()
        user_data = client.current_user()
        
        return UserProfile(
            id=user_data["id"],
            display_name=user_data.get("display_name"),
            email=user_data.get("email"),
            images=[ImageObject(**img) for img in user_data.get("images", [])],
            followers=user_data.get("followers", {}).get("total"),
            product=user_data.get("product")
        )
    
    def get_user_playlists(self, limit: int = 50, offset: int = 0) -> List[PlaylistSimple]:
        """
        Fetch user's playlists
        
        Retrieves all playlists for the authenticated user. Handles pagination
        automatically if more than 50 playlists exist.
        
        Args:
            limit: Maximum playlists per page (max 50)
            offset: Starting position for pagination
            
        Returns:
            List[PlaylistSimple]: List of simplified playlist objects
            
        Raises:
            ValueError: If not authenticated
            SpotifyException: If API call fails
            
        Note:
            This fetches ALL user playlists by default, paginating as needed.
        """
        client = self.get_client()
        playlists = []
        
        # Fetch all playlists with pagination
        while True:
            results = client.current_user_playlists(limit=limit, offset=offset)
            
            for item in results["items"]:
                try:
                    # Debug log the first playlist structure
                    if len(playlists) == 0:
                        logger.debug(f"Sample playlist structure: {item}")
                    
                    playlist = PlaylistSimple(
                        id=item["id"],
                        name=item["name"],
                        description=item.get("description"),
                        images=[ImageObject(**img) for img in item.get("images", [])],
                        tracks=PlaylistTracks(
                            href=item["tracks"]["href"],
                            total=item["tracks"]["total"]
                        ),
                        owner=PlaylistOwner(
                            id=item["owner"]["id"],
                            display_name=item["owner"].get("display_name")
                        ),
                        public=item.get("public"),
                        collaborative=item.get("collaborative", False),
                        uri=item["uri"]
                    )
                    playlists.append(playlist)
                except Exception as e:
                    logger.warning(f"Failed to parse playlist {item.get('id')}: {e}")
                    continue
            
            # Check if there are more playlists
            if results["next"] is None:
                break
            
            offset += limit
        
        logger.info(f"Retrieved {len(playlists)} playlists")
        return playlists

    def get_playlist_context_meta(self, playlist_id: str) -> PlaylistContextMeta:
        """
        Fetch lightweight playlist metadata without loading track details.

        Args:
            playlist_id: Spotify playlist ID

        Returns:
            PlaylistContextMeta: Minimal playlist metadata for UI context
        """
        client = self.get_client()
        data = client.playlist(
            playlist_id, 
            fields="id,name,description,images,owner,public,collaborative,followers,snapshot_id,uri,external_urls(spotify),tracks(total)"
        )
        return PlaylistContextMeta(
            id=data["id"],
            name=data["name"],
            description=data.get("description"),
            images=[ImageObject(**img) for img in data.get("images", [])],
            owner=PlaylistOwner(
                id=data["owner"]["id"],
                display_name=data["owner"].get("display_name")
            ),
            public=data.get("public"),
            collaborative=data.get("collaborative", False),
            followers=data.get("followers", {}).get("total"),
            snapshot_id=data.get("snapshot_id"),
            uri=data["uri"],
            external_url=(data.get("external_urls") or {}).get("spotify"),
            total_tracks=data.get("tracks", {}).get("total")
        )
    
    def get_playlist_details(self, playlist_id: str, should_warm_cache: bool = True) -> PlaylistDetail:
        """
        Fetch detailed playlist information including all tracks
        
        Retrieves complete playlist information with all tracks. Handles
        pagination for playlists with more than 100 tracks.
        
        Args:
            playlist_id: Spotify playlist ID
            
        Returns:
            PlaylistDetail: Detailed playlist with all tracks
            
        Raises:
            ValueError: If not authenticated
            SpotifyException: If API call fails or playlist not found
            
        Note:
            For large playlists (1000+ tracks), this may take several seconds
            due to multiple API calls required for pagination.
        """
        client = self.get_client()
        
        # Fetch playlist metadata
        playlist_data = client.playlist(playlist_id, fields="id,name,description,images,owner,public,collaborative,followers,uri,snapshot_id")
        
        # Fetch all tracks with pagination
        tracks = []
        tracks_data_for_cache = []
        offset = 0
        limit = 100
        total_tracks = 0
        
        while True:
            results = client.playlist_tracks(
                playlist_id,
                limit=limit,
                offset=offset,
                fields="items(added_at,track(id,name,artists(id,name,uri),album(id,name,images,release_date,release_date_precision,album_type,total_tracks,uri),duration_ms,uri,preview_url,explicit,popularity)),total,next"
            )
            
            # Capture total on first iteration
            if offset == 0:
                total_tracks = results.get("total", 0)
            
            for item in results["items"]:
                try:
                    track_data = item["track"]
                    if not track_data or not track_data.get("id"):
                        # Skip local files or unavailable tracks
                        continue
                    
                    # Keep raw track data for cache warming later
                    tracks_data_for_cache.append(track_data)
                    
                    track = PlaylistTrack(
                        id=track_data["id"],
                        name=track_data["name"],
                        artists=[
                            ArtistSimple(**artist)
                            for artist in track_data["artists"]
                        ],
                        album=AlbumSimple(
                            id=track_data["album"]["id"],
                            name=track_data["album"]["name"],
                            images=[ImageObject(**img) for img in track_data["album"].get("images", [])],
                            release_date=track_data["album"].get("release_date"),
                            release_date_precision=track_data["album"].get("release_date_precision"),
                            album_type=track_data["album"].get("album_type"),
                            total_tracks=track_data["album"].get("total_tracks"),
                            uri=track_data["album"]["uri"]
                        ),
                        duration_ms=track_data["duration_ms"],
                        added_at=item.get("added_at"),
                        uri=track_data["uri"],
                        preview_url=track_data.get("preview_url"),
                        explicit=track_data.get("explicit", False),
                        popularity=track_data.get("popularity")
                    )
                    tracks.append(track)
                except Exception as e:
                    logger.warning(f"Failed to parse track: {e}")
                    continue
            
            # Check if there are more tracks
            if results["next"] is None:
                break
            
            offset += limit

        # Cache metadata
        track_ids = [track.id for track in tracks]
        session_id = self.session_manager.session_id if self.session_manager else None
        cache_hits = 0
        cache_misses = len(track_ids)
        cache_warmed = 0

        if track_ids and should_warm_cache:
            try:
                from app.services.cache_service import CacheService
                cached_tracks, missing_ids = CacheService.get_tracks(track_ids, session_id)
                cache_hits = len(cached_tracks)
                cache_misses = len(missing_ids)

                cache_warmed = CacheService.warm_cache(track_ids, tracks_data_for_cache, session_id)
                logger.info(
                    "Cache usage for playlist '%s': hits=%s, misses=%s, warmed=%s",
                    playlist_data["name"],
                    cache_hits,
                    cache_misses,
                    cache_warmed,
                )
            except Exception as e:
                logger.warning(f"Failed to warm cache for playlist: {e}")

        playlist = PlaylistDetail(
            id=playlist_data["id"],
            name=playlist_data["name"],
            description=playlist_data.get("description"),
            images=[ImageObject(**img) for img in playlist_data.get("images", [])],
            owner=PlaylistOwner(
                id=playlist_data["owner"]["id"],
                display_name=playlist_data["owner"].get("display_name")
            ),
            public=playlist_data.get("public"),
            collaborative=playlist_data.get("collaborative", False),
            tracks=tracks,
            total_tracks=total_tracks,
            followers=playlist_data.get("followers", {}).get("total"),
            snapshot_id=playlist_data.get("snapshot_id"),
            uri=playlist_data["uri"],
            cache_info=CacheInfo(
                hits=cache_hits,
                misses=cache_misses,
                warmed=cache_warmed,
                details={"track_count": len(track_ids)}
            )
        )
        
        logger.info(f"Retrieved playlist '{playlist.name}' with {len(tracks)} tracks")
        return playlist
    
    def get_playlist_tracks_paginated(
        self,
        playlist_id: str,
        offset: int = 0,
        limit: int = 100,
        should_warm_cache: bool = True
    ) -> tuple[List[PlaylistTrack], int]:
        """
        Fetch a page of playlist tracks
        
        Retrieves a specific page of tracks from a playlist. Used for
        infinite scroll pagination.
        
        Args:
            playlist_id: Spotify playlist ID
            offset: Starting position (0-based)
            limit: Number of tracks to fetch
            should_warm_cache: Whether to warm the track cache
            
        Returns:
            tuple: (list of tracks, total track count)
            
        Raises:
            ValueError: If not authenticated
            SpotifyException: If API call fails or playlist not found
        """
        client = self.get_client()
        
        # Fetch tracks for this page
        results = client.playlist_tracks(
            playlist_id,
            limit=limit,
            offset=offset,
            fields="items(added_at,track(id,name,artists(id,name,uri),album(id,name,images,release_date,release_date_precision,album_type,total_tracks,uri),duration_ms,uri,preview_url,explicit,popularity)),total"
        )
        
        total_tracks = results.get("total", 0)
        tracks = []
        tracks_data_for_cache = []
        
        for item in results["items"]:
            try:
                track_data = item["track"]
                if not track_data or not track_data.get("id"):
                    # Skip local files or unavailable tracks
                    continue
                
                # Keep raw track data for cache warming later
                tracks_data_for_cache.append(track_data)
                
                track = PlaylistTrack(
                    id=track_data["id"],
                    name=track_data["name"],
                    artists=[
                        ArtistSimple(**artist)
                        for artist in track_data["artists"]
                    ],
                    album=AlbumSimple(
                        id=track_data["album"]["id"],
                        name=track_data["album"]["name"],
                        images=[ImageObject(**img) for img in track_data["album"].get("images", [])],
                        release_date=track_data["album"].get("release_date"),
                        release_date_precision=track_data["album"].get("release_date_precision"),
                        album_type=track_data["album"].get("album_type"),
                        total_tracks=track_data["album"].get("total_tracks"),
                        uri=track_data["album"]["uri"]
                    ),
                    duration_ms=track_data["duration_ms"],
                    added_at=item.get("added_at"),
                    uri=track_data["uri"],
                    preview_url=track_data.get("preview_url"),
                    explicit=track_data.get("explicit", False),
                    popularity=track_data.get("popularity")
                )
                tracks.append(track)
            except Exception as e:
                logger.warning(f"Failed to parse track: {e}")
                continue
        
        # Cache metadata
        cache_hits = 0
        cache_misses = 0
        cache_warmed = 0
        
        if tracks and should_warm_cache:
            track_ids = [track.id for track in tracks]
            session_id = self.session_manager.session_id if self.session_manager else None
            try:
                from app.services.cache_service import CacheService
                cached_tracks, missing_ids = CacheService.get_tracks(track_ids, session_id)
                cache_hits = len(cached_tracks)
                cache_misses = len(missing_ids)
                
                cache_warmed = CacheService.warm_cache(track_ids, tracks_data_for_cache, session_id)
                logger.info(
                    "Cache usage for playlist %s page (offset=%s, limit=%s): hits=%s, misses=%s, warmed=%s",
                    playlist_id,
                    offset,
                    limit,
                    cache_hits,
                    cache_misses,
                    cache_warmed,
                )
            except Exception as e:
                logger.warning(f"Failed to warm cache for playlist page: {e}")
        
        return tracks, total_tracks, cache_hits, cache_misses, cache_warmed
    
    def logout(self) -> None:
        """
        Clear stored authentication tokens
        
        Removes all stored tokens, effectively logging out the user.
        """
        # Use session manager if available, otherwise fall back to token manager
        if self.session_manager:
            self.session_manager.delete_session()
        elif self.token_manager:
            self.token_manager.clear_token()
        logger.info("User logged out, tokens cleared")


def get_spotify_service(request: Request):
    """
    Dependency injection function for FastAPI routes
    
    Creates SpotifyService with session manager from request cookie.
    
    Args:
        request: FastAPI request object (optional)
    
    Returns:
        SpotifyService: Spotify service instance with SessionManager
        
    Example:
        @app.get("/playlists")
        async def get_playlists(
            spotify: SpotifyService = Depends(get_spotify_service)
        ):
            return spotify.get_user_playlists()
    """
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    session_mgr = SessionManager(session_id=session_id)
    return SpotifyService(session_manager=session_mgr)
