"""
Data Models and Schemas

This module defines all Pydantic models used for request/response validation
and data serialization throughout the application.

Classes:
    Token: OAuth token response model
    UserProfile: Spotify user profile information
    PlaylistSimple: Simplified playlist information for list views
    PlaylistTrack: Individual track information within a playlist
    PlaylistDetail: Detailed playlist with all tracks
    ErrorResponse: Standard error response format
"""

from pydantic import BaseModel, Field, HttpUrl, ConfigDict
from typing import Optional, List, Dict, Literal
from datetime import datetime


class Token(BaseModel):
    """
    OAuth Token Response
    
    Represents the token information returned from Spotify OAuth flow.
    
    Attributes:
        access_token: Short-lived access token for API requests
        token_type: Type of token (usually "Bearer")
        expires_in: Token lifetime in seconds
        refresh_token: Long-lived token for getting new access tokens
        scope: Granted permission scopes
    """
    access_token: str
    token_type: str
    expires_in: int
    refresh_token: Optional[str] = None
    scope: str


class ImageObject(BaseModel):
    """
    Spotify Image Object
    
    Represents an image at a specific size.
    
    Attributes:
        url: Image URL
        height: Image height in pixels (None if unknown)
        width: Image width in pixels (None if unknown)
    """
    url: HttpUrl
    height: Optional[int] = None
    width: Optional[int] = None


class UserProfile(BaseModel):
    """
    Spotify User Profile
    
    Simplified user profile information from Spotify.
    
    Attributes:
        id: Spotify user ID
        display_name: User's display name
        email: User's email address
        images: Profile images
        followers: Follower count
        product: Subscription level (always 'free' in development mode)
    """
    id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    images: List[ImageObject] = []
    followers: Optional[int] = Field(None, alias="followers.total")
    product: Optional[str] = None


class ArtistSimple(BaseModel):
    """
    Simplified Artist Information
    
    Basic artist information for track listings.
    
    Attributes:
        id: Spotify artist ID
        name: Artist name
        uri: Spotify URI
    """
    id: str
    name: str
    uri: str


class AlbumSimple(BaseModel):
    """
    Simplified Album Information
    
    Basic album information for track listings.
    
    Attributes:
        id: Spotify album ID
        name: Album name
        images: Album cover images
        release_date: Album release date
        release_date_precision: Precision for release date (year, month, day)
        album_type: Album type (album, single, compilation)
        total_tracks: Total tracks in the album
        uri: Spotify URI
    """
    id: str
    name: str
    images: List[ImageObject] = []
    release_date: Optional[str] = None
    release_date_precision: Optional[str] = None
    album_type: Optional[str] = None
    total_tracks: Optional[int] = None
    uri: str


class PlaylistOwner(BaseModel):
    """Playlist Owner Information"""
    display_name: Optional[str] = None
    id: str


class PlaylistTracks(BaseModel):
    """Playlist Tracks Summary"""
    href: str
    total: int


class PlaylistSimple(BaseModel):
    """
    Simplified Playlist Information
    
    Basic playlist information for list views. Contains enough data to
    display playlists in a list without loading full track details.
    
    Attributes:
        id: Spotify playlist ID
        name: Playlist name
        description: Playlist description
        images: Playlist cover images
        tracks: Tracks summary with total count
        owner: Playlist owner information
        public: Whether playlist is public
        collaborative: Whether playlist is collaborative
        uri: Spotify URI
    """
    id: str
    name: str
    description: Optional[str] = None
    images: List[ImageObject] = []
    tracks: PlaylistTracks
    owner: PlaylistOwner
    public: Optional[bool] = None
    collaborative: Optional[bool] = None
    uri: str
    
    @property
    def tracks_total(self) -> int:
        """Get total track count"""
        return self.tracks.total
    
    @property
    def owner_name(self) -> str:
        """Get owner display name"""
        return self.owner.display_name or self.owner.id
    
    model_config = ConfigDict(populate_by_name=True)


class PlaylistContextMeta(BaseModel):
    """Lightweight playlist metadata for playback context display and initial page load."""
    id: str
    name: str
    description: Optional[str] = None
    images: List[ImageObject] = []
    owner: PlaylistOwner
    public: Optional[bool] = None
    collaborative: bool = False
    followers: Optional[int] = None
    snapshot_id: Optional[str] = None
    uri: str
    external_url: Optional[str] = None
    total_tracks: Optional[int] = None


class PlaylistTrack(BaseModel):
    """
    Playlist Track Information
    
    Represents a single track within a playlist with all relevant metadata.
    
    Attributes:
        id: Spotify track ID
        name: Track name
        artists: List of artists
        album: Album information
        duration_ms: Track duration in milliseconds
        added_at: When track was added to playlist
        uri: Spotify URI
        preview_url: 30-second preview URL (if available)
        explicit: Whether track has explicit content
        popularity: Track popularity (0-100)
    """
    id: str
    name: str
    artists: List[ArtistSimple]
    album: AlbumSimple
    duration_ms: int
    added_at: Optional[datetime] = None
    uri: str
    preview_url: Optional[HttpUrl] = None
    explicit: bool = False
    popularity: Optional[int] = None
    
    @property
    def duration_formatted(self) -> str:
        """
        Get formatted duration string (MM:SS)
        
        Returns:
            str: Duration in format "3:45"
        """
        minutes = self.duration_ms // 60000
        seconds = (self.duration_ms % 60000) // 1000
        return f"{minutes}:{seconds:02d}"
    
    @property
    def artist_names(self) -> str:
        """
        Get comma-separated artist names
        
        Returns:
            str: Artist names joined by ", "
        """
        return ", ".join(artist.name for artist in self.artists)


class CacheInfo(BaseModel):
    """Metadata about cache usage for a playlist response."""
    hits: int = 0
    misses: int = 0
    warmed: int = 0
    details: Dict[str, int] | None = None


class PaginatedTracks(BaseModel):
    """
    Paginated Track Response
    
    Response model for paginated track fetching.
    
    Attributes:
        tracks: List of tracks for this page
        offset: Starting position of this page
        limit: Page size
        total: Total number of tracks in the playlist
        has_more: Whether there are more tracks to load
        cache_info: Cache statistics for this page
    """
    tracks: List[PlaylistTrack] = []
    offset: int
    limit: int
    total: int
    has_more: bool
    cache_info: Optional[CacheInfo] = None


class PlaylistDetail(BaseModel):
    """
    Detailed Playlist Information
    
    Complete playlist information including all tracks. Used when viewing
    a specific playlist.
    
    Attributes:
        id: Spotify playlist ID
        name: Playlist name
        description: Playlist description
        images: Playlist cover images
        owner: Playlist owner display name
        public: Whether playlist is public
        collaborative: Whether playlist is collaborative
        tracks: List of all tracks in the playlist
        total_tracks: Total number of tracks (for pagination)
        followers: Follower count
        uri: Spotify URI
    """
    id: str
    name: str
    description: Optional[str] = None
    images: List[ImageObject] = []
    owner: PlaylistOwner
    public: Optional[bool] = None
    collaborative: bool = False
    tracks: List[PlaylistTrack] = []
    total_tracks: Optional[int] = None
    followers: Optional[int] = None
    snapshot_id: Optional[str] = None
    uri: str
    cache_info: Optional[CacheInfo] = None
    
    @property
    def owner_name(self) -> str:
        """Get owner display name"""
        return self.owner.display_name or self.owner.id
    
    model_config = ConfigDict(populate_by_name=True)
    
    @property
    def total_tracks(self) -> int:
        """Get total number of tracks"""
        return len(self.tracks)
    
    @property
    def total_duration_ms(self) -> int:
        """Get total playlist duration in milliseconds"""
        return sum(track.duration_ms for track in self.tracks)
    
    @property
    def total_duration_formatted(self) -> str:
        """
        Get formatted total duration (H:MM:SS or MM:SS)
        
        Returns:
            str: Total duration formatted appropriately
        """
        total_seconds = self.total_duration_ms // 1000
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        
        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"


class ErrorResponse(BaseModel):
    """
    Standard Error Response
    
    Consistent error response format for all API endpoints.
    
    Attributes:
        error: Error type or code
        message: Human-readable error message
        detail: Additional error details (optional)
    """
    error: str
    message: str
    detail: Optional[str] = None


class AuthUrlResponse(BaseModel):
    """
    Authentication URL Response
    
    Response containing the Spotify OAuth authorization URL.
    
    Attributes:
        auth_url: URL to redirect user for OAuth authorization
    """
    auth_url: str


class AuthSuccessResponse(BaseModel):
    """
    Authentication Success Response
    
    Response after successful OAuth callback.
    
    Attributes:
        message: Success message
        user: User profile information
    """
    message: str
    user: UserProfile


class AuthExchangeRequest(BaseModel):
    """Request payload for exchanging a short-lived auth code for a session cookie."""
    code: str


class AuthExchangeResponse(BaseModel):
    """Response payload after successfully establishing a session cookie."""
    message: str


class PlaybackTokenResponse(BaseModel):
    """Short-lived access token for the Spotify Web Playback SDK."""
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    scope: str


class UserPreferences(BaseModel):
    """User preference payload persisted per account."""
    playlist_view: Literal["grid", "list", "table"] = "grid"
    cache_playlist_scope: Literal["all", "selected", "manual"] = "all"
    cache_selected_playlist_ids: List[str] = []
    cache_auto_include_new: bool = True
    now_playing_details_open: bool = False
    playlist_action_details_open: bool = False
    playlist_album_details_open: bool = False
    queue_modal: Dict[str, float] = {}


class UserPreferencesUpdate(BaseModel):
    """Partial updates for user preferences."""
    playlist_view: Optional[Literal["grid", "list", "table"]] = None
    cache_playlist_scope: Optional[Literal["all", "selected", "manual"]] = None
    cache_selected_playlist_ids: Optional[List[str]] = None
    cache_auto_include_new: Optional[bool] = None
    now_playing_details_open: Optional[bool] = None
    playlist_action_details_open: Optional[bool] = None
    playlist_album_details_open: Optional[bool] = None
    queue_modal: Optional[Dict[str, float]] = None

    model_config = ConfigDict(extra="forbid")
