"""
Playlist sorting algorithms for Spotify.

Implements two methods:
1. Fast: Replace entire playlist (loses date_added)
2. Preserve: Use reorder API (keeps date_added, slower)
"""

import logging
from typing import List, Dict, Any, Callable, Tuple, Optional
from spotipy import Spotify

logger = logging.getLogger(__name__)


def _build_sorted_indexed(
    tracks: List[Dict[str, Any]],
    key_func: Callable,
    reverse: bool,
) -> List[Tuple[int, Dict[str, Any], Any]]:
    indexed_tracks = [(i, track, key_func(track)) for i, track in enumerate(tracks)]
    keys = [item[2] for item in indexed_tracks]
    if keys and len(set(keys)) == 1:
        # When all keys match, descending should still reverse the order.
        return sorted(indexed_tracks, key=lambda x: (x[2], x[0]), reverse=reverse)
    return sorted(indexed_tracks, key=lambda x: x[2], reverse=reverse)


def get_sort_key_function(sort_by: str, direction: str) -> Callable:
    """
    Get the sort key function for a given sort criterion.
    
    Args:
        sort_by: Field to sort by (title, artist, album, release_date, date_added, duration)
        direction: 'asc' or 'desc'
    
    Returns:
        Function that extracts the sort key from a track
    """
    reverse = (direction == 'desc')
    
    def safe_get(track: Dict, *keys: str, default: str = ''):
        """Safely get nested dict values."""
        value = track
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key)
            elif isinstance(value, list) and len(value) > 0:
                value = value[0] if key == '0' else value
            else:
                return default
            
            if value is None:
                return default
        
        return value or default
    
    # Define sort key extractors
    if sort_by == 'title':
        key_func = lambda t: safe_get(t, 'name', default='').lower()
    elif sort_by == 'artist':
        key_func = lambda t: safe_get(t, 'artists', '0', 'name', default='').lower()
    elif sort_by == 'album':
        key_func = lambda t: safe_get(t, 'album', 'name', default='').lower()
    elif sort_by == 'release_date':
        key_func = lambda t: safe_get(t, 'album', 'release_date', default='0000-00-00')
    elif sort_by == 'date_added':
        key_func = lambda t: safe_get(t, 'added_at', default='1970-01-01T00:00:00Z')
    elif sort_by == 'duration':
        key_func = lambda t: int(safe_get(t, 'duration_ms', default='0'))
    else:
        raise ValueError(f"Unknown sort_by value: {sort_by}")
    
    return key_func, reverse


def calculate_moves_needed(
    tracks: List[Dict],
    key_func: Optional[Callable] = None,
    reverse: bool = False,
) -> int:
    """
    Calculate how many tracks need to be moved.

    Uses a stable sort based on the key function to account for duplicates.
    """
    if not tracks:
        return 0

    if key_func:
        sorted_indexed = _build_sorted_indexed(tracks, key_func, reverse)
        return sum(1 for i, (orig_idx, _, _) in enumerate(sorted_indexed) if orig_idx != i)

    return 0


async def sort_playlist_fast(
    sp: Spotify,
    playlist_id: str,
    tracks: List[Dict[str, Any]],
    sort_by: str,
    direction: str,
    progress_callback: Callable[[int, str], None] = None
) -> None:
    """
    Fast sort using playlist_replace_items API.
    
    WARNING: This resets the date_added field for all tracks.
    
    Args:
        sp: Spotipy client
        playlist_id: Playlist to sort
        tracks: List of track objects
        sort_by: Field to sort by
        direction: 'asc' or 'desc'
        progress_callback: Optional callback(progress, message)
    """
    logger.info(f"Fast sort: {len(tracks)} tracks by {sort_by} ({direction})")
    
    # Sort tracks
    key_func, reverse = get_sort_key_function(sort_by, direction)
    sorted_indexed = _build_sorted_indexed(tracks, key_func, reverse)
    sorted_tracks = [track for _, track, _ in sorted_indexed]
    
    # Extract URIs
    track_uris = [track['uri'] for track in sorted_tracks]
    
    # Replace playlist in batches of 100
    batch_size = 100
    total_batches = (len(track_uris) + batch_size - 1) // batch_size
    
    for i in range(0, len(track_uris), batch_size):
        batch = track_uris[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        
        if i == 0:
            # First batch: replace entire playlist
            sp.playlist_replace_items(playlist_id, batch)
            if progress_callback:
                progress_callback(len(batch), f"Replaced first {len(batch)} tracks")
        else:
            # Subsequent batches: add to playlist
            sp.playlist_add_items(playlist_id, batch)
            if progress_callback:
                progress_callback(i + len(batch), f"Added batch {batch_num}/{total_batches}")
    
    logger.info(f"Fast sort completed: {len(tracks)} tracks sorted")


async def sort_playlist_preserve_dates(
    sp: Spotify,
    playlist_id: str,
    tracks: List[Dict[str, Any]],
    sort_by: str,
    direction: str,
    progress_callback: Callable[[int, str], None] = None,
    should_cancel: Callable[[], bool] = None
) -> None:
    """
    Sort playlist using reorder API to preserve date_added fields.
    
    Uses insertion sort algorithm - only moves tracks that are out of position.
    Optimized for playlists that are mostly sorted already.
    
    Args:
        sp: Spotipy client
        playlist_id: Playlist to sort
        tracks: List of track objects with current positions
        sort_by: Field to sort by
        direction: 'asc' or 'desc'
        progress_callback: Optional callback(progress, message)
        should_cancel: Optional function that returns True if job should be cancelled
    """
    logger.info(f"Preserve dates sort: {len(tracks)} tracks by {sort_by} ({direction})")
    
    # Get sort key function
    key_func, reverse = get_sort_key_function(sort_by, direction)
    
    # Create list of (index, track, sort_key) tuples
    sorted_indexed = _build_sorted_indexed(tracks, key_func, reverse)
    
    # Calculate moves needed
    moves_needed = sum(1 for i, (orig_idx, _, _) in enumerate(sorted_indexed) if orig_idx != i)
    logger.info(f"Need to move {moves_needed} of {len(tracks)} tracks")
    
    if moves_needed == 0:
        logger.info("Playlist already sorted!")
        if progress_callback:
            progress_callback(len(tracks), "Playlist already sorted")
        return
    
    # Use insertion sort algorithm - move one track at a time into correct position
    current_positions = list(range(len(tracks)))  # Track where each original track currently is
    moves_made = 0
    
    for target_pos in range(len(sorted_indexed)):
        # Check for cancellation
        if should_cancel and should_cancel():
            logger.info("Sort cancelled by user")
            return
        
        # Find which track should be at this position
        target_orig_idx, target_track, _ = sorted_indexed[target_pos]
        
        # Where is this track currently?
        current_pos = current_positions.index(target_orig_idx)
        
        if current_pos != target_pos:
            # Need to move track from current_pos to target_pos
            sp.playlist_reorder_items(
                playlist_id,
                range_start=current_pos,
                insert_before=target_pos if target_pos < current_pos else target_pos + 1,
                range_length=1
            )
            
            # Update our tracking of positions
            moved_track = current_positions.pop(current_pos)
            current_positions.insert(target_pos, moved_track)
            
            moves_made += 1
            
            if progress_callback:
                progress_callback(
                    moves_made,
                    f"Moved track {moves_made}/{moves_needed}: {target_track['name'][:40]}"
                )
            
            # Small delay to avoid rate limiting
            if moves_made % 10 == 0:
                import time
                time.sleep(0.1)
    
    logger.info(f"Preserve dates sort completed: {moves_made} tracks moved")


def estimate_sort_time(
    total_tracks: int,
    tracks_to_move: int,
    method: str,
    timing: Optional[Dict[str, float]] = None,
) -> int:
    """
    Estimate sort time in seconds.
    
    Args:
        total_tracks: Total tracks in playlist
        tracks_to_move: How many tracks need to be repositioned
        method: 'fast' or 'preserve'
    
    Returns:
        Estimated time in seconds
    """
    def clamp(value: float, min_value: float, max_value: float) -> float:
        return max(min_value, min(max_value, value))

    timing = timing or {}
    if method == 'fast':
        per_track = timing.get("seconds_per_track")
        if per_track:
            per_track = clamp(per_track, 0.01, 0.2)
            return max(4, int(round((per_track * total_tracks) + 2)))
        batches = (total_tracks + 99) // 100
        return max(4, int(round((batches * 0.5) + 2)))

    if tracks_to_move <= 0:
        return 3

    per_move = timing.get("seconds_per_move")
    if per_move:
        per_move = clamp(per_move, 0.1, 1.0)
        return max(6, int(round((per_move * tracks_to_move) + 4)))

    sleep_time = (tracks_to_move // 10) * 0.1
    return max(8, int(round((tracks_to_move * 0.5) + sleep_time + 5)))
