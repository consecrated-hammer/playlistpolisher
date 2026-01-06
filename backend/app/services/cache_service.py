"""
Track metadata caching service for Playlist Polisher.

This service implements a cache-aside pattern with opportunistic warming:
- Check cache first, fetch from Spotify on miss
- Automatically warm cache when loading playlists
- Global cache shared across all users
- Track usage per user for user-specific cache management
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Set, Tuple
from contextlib import contextmanager

from app.db.database import get_db_connection
from app.db import app_settings

logger = logging.getLogger(__name__)


class CacheService:
    """Service for managing track metadata cache."""
    
    @staticmethod
    def _get_ttl_cutoff() -> str:
        """Calculate the cutoff datetime for cache expiry based on TTL setting."""
        ttl_days, _ = app_settings.get_track_cache_ttl_days()
        cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
        return cutoff.isoformat()
    
    @staticmethod
    def get_tracks(
        track_ids: List[str],
        session_id: Optional[str] = None,
        allow_stale: bool = False,
        allow_legacy: bool = False,
    ) -> Tuple[Dict[str, Dict], Set[str]]:
        """
        Get cached track metadata for given track IDs.
        
        Args:
            track_ids: List of Spotify track IDs
            session_id: Optional session ID to track usage
        
        Returns:
            Tuple of (cached_tracks_dict, missing_track_ids_set)
            cached_tracks_dict maps track_id -> track_info_dict
        """
        if not track_ids:
            return {}, set()
        
        cached = {}
        missing = set(track_ids)
        cutoff = CacheService._get_ttl_cutoff() if not allow_stale else None
        now = datetime.now(timezone.utc).isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ','.join('?' * len(track_ids))
            
            # Fetch from cache, excluding expired entries
            if cutoff:
                cursor.execute(f"""
                    SELECT track_id, name, artists_json, album, album_id, album_uri,
                           album_release_date, album_release_date_precision, album_type,
                           album_total_tracks, album_label, duration_ms, album_art_url, track_uri,
                           track_number, disc_number, explicit, popularity, isrc, 
                           is_playable, available_markets_json, preview_url
                    FROM track_cache
                    WHERE track_id IN ({placeholders})
                    AND cached_at > ?
                """, (*track_ids, cutoff))
            else:
                cursor.execute(f"""
                    SELECT track_id, name, artists_json, album, album_id, album_uri,
                           album_release_date, album_release_date_precision, album_type,
                           album_total_tracks, album_label, duration_ms, album_art_url, track_uri,
                           track_number, disc_number, explicit, popularity, isrc,
                           is_playable, available_markets_json, preview_url
                    FROM track_cache
                    WHERE track_id IN ({placeholders})
                """, tuple(track_ids))
            
            rows = cursor.fetchall()
            for row in rows:
                track_id = row['track_id']
                # Treat old rows (from before we stored release date fields) as a cache miss so the caller
                # can re-fetch from Spotify and rehydrate the cache.
                album_release_date = row["album_release_date"]
                album_release_date_precision = row["album_release_date_precision"]
                has_release_info = bool(album_release_date) or bool(album_release_date_precision)
                if not has_release_info and not allow_legacy:
                    continue

                artists_payload = json.loads(row["artists_json"])
                if artists_payload and isinstance(artists_payload[0], dict):
                    artists = [
                        {
                            "id": artist.get("id") or "",
                            "name": artist.get("name") or "",
                            "uri": artist.get("uri") or "",
                        }
                        for artist in artists_payload
                    ]
                else:
                    artists = [
                        {"id": "", "name": name, "uri": ""}
                        for name in artists_payload
                    ]

                # Parse available markets if present
                available_markets = []
                available_markets_json = row["available_markets_json"] if "available_markets_json" in row.keys() else None
                if available_markets_json:
                    try:
                        available_markets = json.loads(available_markets_json)
                    except (json.JSONDecodeError, TypeError):
                        pass

                cached[track_id] = {
                    "id": track_id,
                    "name": row["name"],
                    "artists": artists,
                    "album": row["album"],
                    "album_id": row["album_id"],
                    "album_uri": row["album_uri"],
                    "album_release_date": album_release_date,
                    "album_release_date_precision": album_release_date_precision,
                    "album_type": row["album_type"],
                    "album_total_tracks": row["album_total_tracks"],
                    "album_label": row["album_label"] if "album_label" in row.keys() else None,
                    "duration_ms": row["duration_ms"],
                    "album_art_url": row["album_art_url"],
                    "track_uri": row["track_uri"],
                    "track_number": row["track_number"] if "track_number" in row.keys() else None,
                    "disc_number": row["disc_number"] if "disc_number" in row.keys() else None,
                    "explicit": bool(row["explicit"]) if "explicit" in row.keys() and row["explicit"] is not None else False,
                    "popularity": row["popularity"] if "popularity" in row.keys() else None,
                    "isrc": row["isrc"] if "isrc" in row.keys() else None,
                    "is_playable": bool(row["is_playable"]) if "is_playable" in row.keys() and row["is_playable"] is not None else None,
                    "available_markets": available_markets,
                    "preview_url": row["preview_url"] if "preview_url" in row.keys() else None,
                }
                missing.discard(track_id)
            
            # Update last_accessed for cache hits
            if cached:
                cache_hit_ids = list(cached.keys())
                placeholders_hits = ','.join('?' * len(cache_hit_ids))
                cursor.execute(f"""
                    UPDATE track_cache
                    SET last_accessed = ?
                    WHERE track_id IN ({placeholders_hits})
                """, (now, *cache_hit_ids))
                
                # Track usage if session_id provided
                if session_id:
                    for track_id in cache_hit_ids:
                        cursor.execute("""
                            INSERT INTO track_usage (track_id, session_id, last_used_at)
                            VALUES (?, ?, ?)
                            ON CONFLICT(track_id, session_id) DO UPDATE SET last_used_at = ?
                        """, (track_id, session_id, now, now))
                
                conn.commit()
        
        if cached:
            logger.info(
                "Cache hit%s: %s/%s tracks, %s misses",
                " (stale ok)" if allow_stale else "",
                len(cached),
                len(track_ids),
                len(missing),
            )
        if missing:
            logger.info("Cache misses%s: %s", " (stale ok)" if allow_stale else "", len(missing))
        
        return cached, missing
    
    @staticmethod
    def set_tracks(tracks: List[Dict], session_id: Optional[str] = None) -> int:
        """
        Cache track metadata from Spotify API response.
        
        Args:
            tracks: List of track dicts from Spotify API
            session_id: Optional session ID to track usage
        
        Returns:
            Number of tracks cached
        """
        if not tracks:
            return 0
        
        now = datetime.now(tz=datetime.utcnow().astimezone().tzinfo).isoformat()
        cached_count = 0
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            for track in tracks:
                try:
                    track_id = track['id']
                    artists = track.get('artists') or []
                    artists_payload = [
                        {
                            "id": artist.get("id"),
                            "name": artist.get("name"),
                            "uri": artist.get("uri"),
                        }
                        for artist in artists
                        if artist
                    ]
                    artists_json = json.dumps(artists_payload)
                    
                    album_data = track.get('album') or {}
                    album = album_data.get('name')
                    album_id = album_data.get("id")
                    album_uri = album_data.get("uri")
                    album_release_date = album_data.get('release_date')
                    album_release_date_precision = album_data.get('release_date_precision')
                    album_type = album_data.get("album_type")
                    album_total_tracks = album_data.get("total_tracks")
                    album_label = album_data.get("label")
                    duration_ms = track.get('duration_ms')
                    track_uri = track.get("uri")
                    track_number = track.get("track_number")
                    disc_number = track.get("disc_number")
                    explicit = 1 if track.get("explicit") else 0
                    popularity = track.get("popularity")
                    
                    # External IDs
                    external_ids = track.get("external_ids") or {}
                    isrc = external_ids.get("isrc")
                    
                    # Market availability
                    is_playable = 1 if track.get("is_playable") else 0 if track.get("is_playable") is not None else None
                    available_markets = track.get("available_markets") or []
                    available_markets_json = json.dumps(available_markets) if available_markets else None
                    preview_url = track.get("preview_url")
                    
                    # Get album art (prefer medium size)
                    album_art_url = None
                    album_images = album_data.get('images') or []
                    if album_images:
                        # Try to get medium-sized image (300x300)
                        album_art_url = next(
                            (img['url'] for img in album_images if img.get('height') == 300),
                            album_images[0]['url']  # Fallback to first image
                        )
                    
                    # Insert or update cache
                    cursor.execute("""
                        INSERT INTO track_cache (
                            track_id, name, artists_json, album, album_id, album_uri,
                            album_release_date, album_release_date_precision, album_type,
                            album_total_tracks, album_label, duration_ms, album_art_url,
                            track_uri, track_number, disc_number, explicit, popularity, isrc,
                            is_playable, available_markets_json, preview_url,
                            cached_at, last_accessed
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(track_id) DO UPDATE SET
                            name = excluded.name,
                            artists_json = excluded.artists_json,
                            album = excluded.album,
                            album_id = excluded.album_id,
                            album_uri = excluded.album_uri,
                            album_release_date = excluded.album_release_date,
                            album_release_date_precision = excluded.album_release_date_precision,
                            album_type = excluded.album_type,
                            album_total_tracks = excluded.album_total_tracks,
                            album_label = excluded.album_label,
                            duration_ms = excluded.duration_ms,
                            album_art_url = excluded.album_art_url,
                            track_uri = excluded.track_uri,
                            track_number = excluded.track_number,
                            disc_number = excluded.disc_number,
                            explicit = excluded.explicit,
                            popularity = excluded.popularity,
                            isrc = excluded.isrc,
                            is_playable = excluded.is_playable,
                            available_markets_json = excluded.available_markets_json,
                            preview_url = excluded.preview_url,
                            cached_at = excluded.cached_at,
                            last_accessed = excluded.last_accessed
                    """, (
                        track_id, track['name'], artists_json, album, album_id, album_uri,
                        album_release_date, album_release_date_precision, album_type,
                        album_total_tracks, album_label, duration_ms, album_art_url,
                        track_uri, track_number, disc_number, explicit, popularity, isrc,
                        is_playable, available_markets_json, preview_url, now, now,
                    ))
                    
                    # Track usage if session_id provided
                    if session_id:
                        cursor.execute("""
                            INSERT INTO track_usage (track_id, session_id, last_used_at)
                            VALUES (?, ?, ?)
                            ON CONFLICT(track_id, session_id) DO UPDATE SET last_used_at = ?
                        """, (track_id, session_id, now, now))
                    
                    cached_count += 1
                    
                except Exception as e:
                    logger.error(f"Failed to cache track {track.get('id')}: {e}")
                    continue
            
            conn.commit()
        
        logger.info(f"Cached {cached_count} tracks")
        return cached_count
    
    @staticmethod
    def warm_cache(track_ids: List[str], tracks_data: List[Dict], session_id: Optional[str] = None) -> int:
        """
        Opportunistically warm cache with track data (typically when loading playlists).
        
        Args:
            track_ids: List of track IDs we care about
            tracks_data: Full track data from Spotify API
            session_id: Optional session ID to track usage
        
        Returns:
            Number of tracks cached
        """
        # Filter to only tracks we care about
        relevant_tracks = [t for t in tracks_data if t.get('id') in track_ids]
        return CacheService.set_tracks(relevant_tracks, session_id)
    
    @staticmethod
    def get_cache_stats(session_id: Optional[str] = None) -> Dict:
        """
        Get cache statistics.
        
        Args:
            session_id: Optional - if provided, include user-specific stats
        
        Returns:
            Dict with cache statistics
        """
        cutoff = CacheService._get_ttl_cutoff()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Collect all session_ids for this user (all current sessions) so "your tracks" is stable across re-logins
            session_ids_for_user = []
            if session_id:
                cursor.execute("SELECT user_id FROM user_sessions WHERE session_id = ?", (session_id,))
                row = cursor.fetchone()
                if row and row["user_id"]:
                    cursor.execute("SELECT session_id FROM user_sessions WHERE user_id = ?", (row["user_id"],))
                    session_ids_for_user = [r["session_id"] for r in cursor.fetchall()]
                else:
                    session_ids_for_user = [session_id]
            
            # Total cached tracks (not expired)
            cursor.execute("""
                SELECT COUNT(*) as count
                FROM track_cache
                WHERE cached_at > ?
            """, (cutoff,))
            total_cached = cursor.fetchone()['count']
            
            # Expired tracks
            cursor.execute("""
                SELECT COUNT(*) as count
                FROM track_cache
                WHERE cached_at <= ?
            """, (cutoff,))
            expired_count = cursor.fetchone()['count']
            
            # Total tracks in cache (including expired)
            cursor.execute("SELECT COUNT(*) as count FROM track_cache")
            total_in_db = cursor.fetchone()['count']
            
            # User-specific stats
            user_track_count = None
            if session_ids_for_user:
                placeholders = ",".join(["?"] * len(session_ids_for_user))
                cursor.execute(f"""
                    SELECT COUNT(DISTINCT track_id) as count
                    FROM track_usage
                    WHERE session_id IN ({placeholders})
                """, tuple(session_ids_for_user))
                user_track_count = cursor.fetchone()['count']
            
            return {
                'total_cached': total_cached,
                'expired': expired_count,
                'total_in_db': total_in_db,
                'user_tracks': user_track_count,
                'ttl_days': app_settings.get_track_cache_ttl_days()[0],
                'cutoff_date': cutoff
            }

    @staticmethod
    def get_playlist_cache_stats(track_ids: List[str], session_id: Optional[str] = None) -> Dict:
        """
        Get cache statistics for a specific playlist using track IDs (legacy method).

        Args:
            track_ids: List of Spotify track IDs
            session_id: Optional - if provided, include user-specific stats

        Returns:
            Dict with playlist-specific cache statistics
        """
        if not track_ids:
            return {
                'user_tracks': 0,
                'user_expired': 0,
                'total_tracks': 0
            }

        cutoff = CacheService._get_ttl_cutoff()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Collect all session_ids for this user
            session_ids_for_user = []
            if session_id:
                cursor.execute("SELECT user_id FROM user_sessions WHERE session_id = ?", (session_id,))
                row = cursor.fetchone()
                if row and row["user_id"]:
                    cursor.execute("SELECT session_id FROM user_sessions WHERE user_id = ?", (row["user_id"],))
                    session_ids_for_user = [r["session_id"] for r in cursor.fetchall()]
                else:
                    session_ids_for_user = [session_id]

            track_placeholders = ",".join(["?"] * len(track_ids))

            cursor.execute(f"""
                SELECT COUNT(DISTINCT track_id) as count
                FROM track_cache
                WHERE track_id IN ({track_placeholders})
            """, tuple(track_ids))
            total_tracks = cursor.fetchone()['count']

            user_track_count = 0
            user_expired_count = 0
            if session_ids_for_user:
                session_placeholders = ",".join(["?"] * len(session_ids_for_user))
                cursor.execute(f"""
                    SELECT COUNT(DISTINCT tc.track_id) as count
                    FROM track_cache tc
                    INNER JOIN track_usage tu ON tc.track_id = tu.track_id
                    WHERE tc.track_id IN ({track_placeholders})
                    AND tu.session_id IN ({session_placeholders})
                    AND tc.cached_at > ?
                """, tuple(track_ids) + tuple(session_ids_for_user) + (cutoff,))
                user_track_count = cursor.fetchone()['count']

                cursor.execute(f"""
                    SELECT COUNT(DISTINCT tc.track_id) as count
                    FROM track_cache tc
                    INNER JOIN track_usage tu ON tc.track_id = tu.track_id
                    WHERE tc.track_id IN ({track_placeholders})
                    AND tu.session_id IN ({session_placeholders})
                    AND tc.cached_at <= ?
                """, tuple(track_ids) + tuple(session_ids_for_user) + (cutoff,))
                user_expired_count = cursor.fetchone()['count']

            return {
                'user_tracks': user_track_count,
                'user_expired': user_expired_count,
                'total_tracks': total_tracks
            }
    
    @staticmethod
    def get_playlist_cache_stats_by_id(playlist_id: str, session_id: Optional[str] = None) -> Dict:
        """
        Get cache statistics for a specific playlist using playlist_cache_items.
        
        Args:
            playlist_id: Spotify playlist ID
            session_id: Optional - if provided, include user-specific stats
        
        Returns:
            Dict with playlist-specific cache statistics
        """
        cutoff = CacheService._get_ttl_cutoff()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Collect all session_ids for this user
            session_ids_for_user = []
            if session_id:
                cursor.execute("SELECT user_id FROM user_sessions WHERE session_id = ?", (session_id,))
                row = cursor.fetchone()
                if row and row["user_id"]:
                    cursor.execute("SELECT session_id FROM user_sessions WHERE user_id = ?", (row["user_id"],))
                    session_ids_for_user = [r["session_id"] for r in cursor.fetchall()]
                else:
                    session_ids_for_user = [session_id]
            
            # Get track IDs for this playlist from playlist_cache_items
            cursor.execute("""
                SELECT DISTINCT track_id
                FROM playlist_cache_items
                WHERE playlist_id = ?
                AND track_id IS NOT NULL
            """, (playlist_id,))
            track_ids = [r['track_id'] for r in cursor.fetchall()]
            
            if not track_ids:
                return {
                    'user_cached_tracks': 0,
                    'user_expired_tracks': 0,
                    'total_cached_tracks': 0
                }
            
            track_placeholders = ",".join(["?"] * len(track_ids))
            
            # Total cached tracks from this playlist (all users) - count from track_cache
            cursor.execute(f"""
                SELECT COUNT(DISTINCT track_id) as count
                FROM track_cache
                WHERE track_id IN ({track_placeholders})
            """, tuple(track_ids))
            total_cached = cursor.fetchone()['count']
            
            # User-specific stats for this playlist
            user_track_count = 0
            user_expired_count = 0
            if session_ids_for_user:
                session_placeholders = ",".join(["?"] * len(session_ids_for_user))
                
                # Cached tracks from this playlist for this user (not expired)
                cursor.execute(f"""
                    SELECT COUNT(DISTINCT tc.track_id) as count
                    FROM track_cache tc
                    INNER JOIN track_usage tu ON tc.track_id = tu.track_id
                    WHERE tc.track_id IN ({track_placeholders})
                    AND tu.session_id IN ({session_placeholders})
                    AND tc.cached_at > ?
                """, tuple(track_ids) + tuple(session_ids_for_user) + (cutoff,))
                user_track_count = cursor.fetchone()['count']
                
                # Expired tracks from this playlist for this user
                cursor.execute(f"""
                    SELECT COUNT(DISTINCT tc.track_id) as count
                    FROM track_cache tc
                    INNER JOIN track_usage tu ON tc.track_id = tu.track_id
                    WHERE tc.track_id IN ({track_placeholders})
                    AND tu.session_id IN ({session_placeholders})
                    AND tc.cached_at <= ?
                """, tuple(track_ids) + tuple(session_ids_for_user) + (cutoff,))
                user_expired_count = cursor.fetchone()['count']
            
            return {
                'user_cached_tracks': user_track_count,
                'user_expired_tracks': user_expired_count,
                'total_cached_tracks': total_cached
            }
    
    @staticmethod
    def clear_expired() -> int:
        """
        Remove expired tracks from cache.
        
        Returns:
            Number of tracks removed
        """
        cutoff = CacheService._get_ttl_cutoff()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Delete expired tracks
            cursor.execute("""
                DELETE FROM track_cache
                WHERE cached_at <= ?
            """, (cutoff,))
            
            deleted = cursor.rowcount
            conn.commit()
        
        logger.info(f"Cleared {deleted} expired tracks from cache")
        return deleted
    
    @staticmethod
    def clear_user_cache(session_id: str) -> int:
        """
        Clear cache entries for a specific user (only tracks they use).
        
        Args:
            session_id: User session ID
        
        Returns:
            Number of tracks removed from user's usage
        """
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Delete user's track usage entries
            cursor.execute("""
                DELETE FROM track_usage
                WHERE session_id = ?
            """, (session_id,))
            
            deleted = cursor.rowcount
            
            # Clean up orphaned tracks (not used by any user)
            cursor.execute("""
                DELETE FROM track_cache
                WHERE track_id NOT IN (SELECT DISTINCT track_id FROM track_usage)
            """)
            
            orphaned = cursor.rowcount
            conn.commit()
        
        logger.info(f"Cleared {deleted} track usage entries for user, removed {orphaned} orphaned tracks")
        return deleted
    
    @staticmethod
    def clear_all_cache() -> int:
        """
        Clear entire track cache (admin operation).
        
        Returns:
            Number of tracks removed
        """
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Clear track usage first (foreign key constraint)
            cursor.execute("DELETE FROM track_usage")
            usage_deleted = cursor.rowcount

            # Clear auxiliary metadata caches
            cursor.execute("DELETE FROM audio_features_cache")
            audio_deleted = cursor.rowcount
            cursor.execute("DELETE FROM artist_cache")
            artist_deleted = cursor.rowcount
            
            # Clear track cache
            cursor.execute("DELETE FROM track_cache")
            cache_deleted = cursor.rowcount
            
            conn.commit()
        
        logger.info(
            "Cleared entire cache: %s tracks, %s usage entries, %s audio features, %s artists",
            cache_deleted,
            usage_deleted,
            audio_deleted,
            artist_deleted,
        )
        return cache_deleted
    
    # ===== Artist Cache Methods =====
    
    @staticmethod
    def get_artists(
        artist_ids: List[str],
        session_id: Optional[str] = None,
        allow_stale: bool = False,
    ) -> Tuple[Dict[str, Dict], Set[str]]:
        """
        Get cached artist metadata for given artist IDs.
        
        Args:
            artist_ids: List of Spotify artist IDs
            session_id: Optional session ID to track usage
            allow_stale: If True, return expired cache entries
        
        Returns:
            Tuple of (cached_artists_dict, missing_artist_ids_set)
        """
        if not artist_ids:
            return {}, set()
        
        cached = {}
        missing = set(artist_ids)
        cutoff = CacheService._get_ttl_cutoff() if not allow_stale else None
        now = datetime.now(timezone.utc).isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ','.join('?' * len(artist_ids))
            
            if cutoff:
                cursor.execute(f"""
                    SELECT artist_id, name, genres_json, popularity, followers
                    FROM artist_cache
                    WHERE artist_id IN ({placeholders})
                    AND cached_at > ?
                """, (*artist_ids, cutoff))
            else:
                cursor.execute(f"""
                    SELECT artist_id, name, genres_json, popularity, followers
                    FROM artist_cache
                    WHERE artist_id IN ({placeholders})
                """, tuple(artist_ids))
            
            rows = cursor.fetchall()
            for row in rows:
                artist_id = row['artist_id']
                
                # Parse genres
                genres = []
                genres_json = row["genres_json"] if "genres_json" in row.keys() else None
                if genres_json:
                    try:
                        genres = json.loads(genres_json)
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                cached[artist_id] = {
                    "id": artist_id,
                    "name": row["name"],
                    "genres": genres,
                    "popularity": row["popularity"] if "popularity" in row.keys() else None,
                    "followers": row["followers"] if "followers" in row.keys() else None,
                }
                missing.discard(artist_id)
            
            # Update last_accessed for cache hits
            if cached:
                cache_hit_ids = list(cached.keys())
                placeholders_hits = ','.join('?' * len(cache_hit_ids))
                cursor.execute(f"""
                    UPDATE artist_cache
                    SET last_accessed = ?
                    WHERE artist_id IN ({placeholders_hits})
                """, (now, *cache_hit_ids))
                conn.commit()
        
        return cached, missing
    
    @staticmethod
    def set_artists(artists: List[Dict], session_id: Optional[str] = None) -> int:
        """
        Cache artist metadata from Spotify API response.
        
        Args:
            artists: List of artist dicts from Spotify API
            session_id: Optional session ID to track usage
        
        Returns:
            Number of artists cached
        """
        if not artists:
            return 0
        
        now = datetime.now(tz=datetime.utcnow().astimezone().tzinfo).isoformat()
        cached_count = 0
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            for artist in artists:
                try:
                    artist_id = artist['id']
                    name = artist.get('name', '')
                    genres = artist.get('genres', [])
                    genres_json = json.dumps(genres) if genres else None
                    popularity = artist.get('popularity')
                    followers = artist.get('followers', {}).get('total') if artist.get('followers') else None
                    
                    cursor.execute("""
                        INSERT INTO artist_cache (
                            artist_id, name, genres_json, popularity, followers,
                            cached_at, last_accessed
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(artist_id) DO UPDATE SET
                            name = excluded.name,
                            genres_json = excluded.genres_json,
                            popularity = excluded.popularity,
                            followers = excluded.followers,
                            cached_at = excluded.cached_at,
                            last_accessed = excluded.last_accessed
                    """, (artist_id, name, genres_json, popularity, followers, now, now))
                    
                    cached_count += 1
                except Exception as e:
                    logger.warning(f"Failed to cache artist {artist.get('id')}: {e}")
                    continue
            
            conn.commit()
        
        logger.info(f"Cached {cached_count} artists")
        return cached_count
    
    # ===== Audio Features Cache Methods =====
    
    @staticmethod
    def get_audio_features(
        track_ids: List[str],
        allow_stale: bool = False,
    ) -> Tuple[Dict[str, Dict], Set[str]]:
        """
        Get cached audio features for given track IDs.
        
        Args:
            track_ids: List of Spotify track IDs
            allow_stale: If True, return expired cache entries
        
        Returns:
            Tuple of (cached_features_dict, missing_track_ids_set)
        """
        if not track_ids:
            return {}, set()
        
        cached = {}
        missing = set(track_ids)
        cutoff = CacheService._get_ttl_cutoff() if not allow_stale else None
        now = datetime.now(timezone.utc).isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ','.join('?' * len(track_ids))
            
            if cutoff:
                cursor.execute(f"""
                    SELECT track_id, danceability, energy, key, loudness, mode,
                           speechiness, acousticness, instrumentalness, liveness,
                           valence, tempo, time_signature
                    FROM audio_features_cache
                    WHERE track_id IN ({placeholders})
                    AND cached_at > ?
                """, (*track_ids, cutoff))
            else:
                cursor.execute(f"""
                    SELECT track_id, danceability, energy, key, loudness, mode,
                           speechiness, acousticness, instrumentalness, liveness,
                           valence, tempo, time_signature
                    FROM audio_features_cache
                    WHERE track_id IN ({placeholders})
                """, tuple(track_ids))
            
            rows = cursor.fetchall()
            for row in rows:
                track_id = row['track_id']
                
                cached[track_id] = {
                    "id": track_id,
                    "danceability": row["danceability"] if "danceability" in row.keys() else None,
                    "energy": row["energy"] if "energy" in row.keys() else None,
                    "key": row["key"] if "key" in row.keys() else None,
                    "loudness": row["loudness"] if "loudness" in row.keys() else None,
                    "mode": row["mode"] if "mode" in row.keys() else None,
                    "speechiness": row["speechiness"] if "speechiness" in row.keys() else None,
                    "acousticness": row["acousticness"] if "acousticness" in row.keys() else None,
                    "instrumentalness": row["instrumentalness"] if "instrumentalness" in row.keys() else None,
                    "liveness": row["liveness"] if "liveness" in row.keys() else None,
                    "valence": row["valence"] if "valence" in row.keys() else None,
                    "tempo": row["tempo"] if "tempo" in row.keys() else None,
                    "time_signature": row["time_signature"] if "time_signature" in row.keys() else None,
                }
                missing.discard(track_id)
            
            # Update last_accessed for cache hits
            if cached:
                cache_hit_ids = list(cached.keys())
                placeholders_hits = ','.join('?' * len(cache_hit_ids))
                cursor.execute(f"""
                    UPDATE audio_features_cache
                    SET last_accessed = ?
                    WHERE track_id IN ({placeholders_hits})
                """, (now, *cache_hit_ids))
                conn.commit()
        
        return cached, missing
    
    @staticmethod
    def set_audio_features(features_list: List[Dict]) -> int:
        """
        Cache audio features from Spotify API response.
        
        Args:
            features_list: List of audio features dicts from Spotify API
        
        Returns:
            Number of features cached
        """
        if not features_list:
            return 0
        
        now = datetime.now(tz=datetime.utcnow().astimezone().tzinfo).isoformat()
        cached_count = 0
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            for features in features_list:
                # Spotify API can return None for tracks without audio features
                if not features or not features.get('id'):
                    continue
                
                try:
                    track_id = features['id']
                    
                    cursor.execute("""
                        INSERT INTO audio_features_cache (
                            track_id, danceability, energy, key, loudness, mode,
                            speechiness, acousticness, instrumentalness, liveness,
                            valence, tempo, time_signature, cached_at, last_accessed
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(track_id) DO UPDATE SET
                            danceability = excluded.danceability,
                            energy = excluded.energy,
                            key = excluded.key,
                            loudness = excluded.loudness,
                            mode = excluded.mode,
                            speechiness = excluded.speechiness,
                            acousticness = excluded.acousticness,
                            instrumentalness = excluded.instrumentalness,
                            liveness = excluded.liveness,
                            valence = excluded.valence,
                            tempo = excluded.tempo,
                            time_signature = excluded.time_signature,
                            cached_at = excluded.cached_at,
                            last_accessed = excluded.last_accessed
                    """, (
                        track_id,
                        features.get('danceability'),
                        features.get('energy'),
                        features.get('key'),
                        features.get('loudness'),
                        features.get('mode'),
                        features.get('speechiness'),
                        features.get('acousticness'),
                        features.get('instrumentalness'),
                        features.get('liveness'),
                        features.get('valence'),
                        features.get('tempo'),
                        features.get('time_signature'),
                        now,
                        now
                    ))
                    
                    cached_count += 1
                except Exception as e:
                    logger.warning(f"Failed to cache audio features for {features.get('id')}: {e}")
                    continue
            
            conn.commit()
        
        logger.info(f"Cached audio features for {cached_count} tracks")
        return cached_count
