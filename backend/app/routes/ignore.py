"""
Ignore Routes

API endpoints for managing ignored duplicate track pairs.
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from ..db.database import get_db_connection
from ..utils.session_manager import SessionManager, SESSION_COOKIE_NAME
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ignore", tags=["ignore"])


def get_session_manager(request: Request) -> SessionManager:
    """Extract session manager from the incoming request cookie."""
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


def _get_user_session_ids(conn, session_id: str):
    """Return all session_ids for the same user as the given session."""
    if not session_id:
        return []
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM user_sessions WHERE session_id = ?", (session_id,))
    row = cursor.fetchone()
    if not row or not row["user_id"]:
        return [session_id]
    cursor.execute("SELECT session_id FROM user_sessions WHERE user_id = ?", (row["user_id"],))
    return [r["session_id"] for r in cursor.fetchall()]


def require_auth(session_mgr: SessionManager = Depends(get_session_manager)) -> SessionManager:
    """Authentication dependency - validates user is authenticated."""
    if not session_mgr.is_authenticated():
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please login with Spotify."
        )
    return session_mgr


class IgnorePairRequest(BaseModel):
    """Request to ignore a duplicate pair"""
    track_id_1: str
    track_id_2: str
    playlist_id: Optional[str] = None  # None = ignore globally


class IgnorePairResponse(BaseModel):
    """Response after ignoring a pair"""
    id: int
    message: str


class IgnoredPair(BaseModel):
    """Ignored pair information"""
    id: int
    track_id_1: str
    track_id_2: str
    playlist_id: Optional[str]
    scope: str  # "playlist" or "global"
    created_at: str


@router.post("/pair", response_model=IgnorePairResponse)
async def add_ignored_pair(
    request: IgnorePairRequest,
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Add a track pair to the ignore list.
    
    If playlist_id is provided, the pair is ignored only in that playlist.
    If playlist_id is None, the pair is ignored globally across all playlists.
    """
    session_id = session_mgr.get_session_id()
    
    # Sort track IDs to avoid duplicates (abc,def) and (def,abc)
    track_id_1, track_id_2 = sorted([request.track_id_1, request.track_id_2])
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT INTO ignored_pairs (session_id, track_id_1, track_id_2, playlist_id, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (session_id, track_id_1, track_id_2, request.playlist_id, datetime.now(timezone.utc).isoformat()))
            
            conn.commit()
            pair_id = cursor.lastrowid
            
            scope = f"playlist {request.playlist_id}" if request.playlist_id else "all playlists"
            logger.info(f"Ignored pair {track_id_1}/{track_id_2} in {scope} for session {session_id}")
            
            return IgnorePairResponse(
                id=pair_id,
                message=f"Pair ignored in {scope}"
            )
            
        except Exception as e:
            if "UNIQUE constraint failed" in str(e):
                raise HTTPException(status_code=409, detail="This pair is already ignored")
            raise HTTPException(status_code=500, detail=f"Failed to ignore pair: {str(e)}")


@router.get("/list", response_model=List[IgnoredPair])
async def list_ignored_pairs(
    playlist_id: Optional[str] = None,
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    List all ignored pairs for the current session.
    
    If playlist_id is provided, returns only pairs ignored in that playlist plus global ignores.
    Otherwise, returns all ignored pairs.
    """
    session_id = session_mgr.get_session_id()
    with get_db_connection() as conn:
        session_ids = _get_user_session_ids(conn, session_id)

        cursor = conn.cursor()

        if playlist_id:
            # Get playlist-specific and global ignores
            placeholders = ",".join(["?"] * len(session_ids))
            cursor.execute(f"""
                SELECT id, track_id_1, track_id_2, playlist_id, created_at
                FROM ignored_pairs
                WHERE session_id IN ({placeholders}) AND (playlist_id = ? OR playlist_id IS NULL)
                ORDER BY created_at DESC
            """, (*session_ids, playlist_id))
        else:
            # Get all ignores
            placeholders = ",".join(["?"] * len(session_ids))
            cursor.execute(f"""
                SELECT id, track_id_1, track_id_2, playlist_id, created_at
                FROM ignored_pairs
                WHERE session_id IN ({placeholders})
                ORDER BY created_at DESC
            """, tuple(session_ids))
        
        rows = cursor.fetchall()
    
    return [
        IgnoredPair(
            id=row['id'],
            track_id_1=row['track_id_1'],
            track_id_2=row['track_id_2'],
            playlist_id=row['playlist_id'],
            scope="playlist" if row['playlist_id'] else "global",
            created_at=row['created_at']
        )
        for row in rows
    ]


@router.delete("/{ignore_id}")
async def remove_ignored_pair(
    ignore_id: int,
    session_mgr: SessionManager = Depends(require_auth)
):
    """Remove an ignored pair by ID."""
    session_id = session_mgr.get_session_id()
    
    with get_db_connection() as conn:
        session_ids = _get_user_session_ids(conn, session_id)
        cursor = conn.cursor()
        
        # Verify ownership
        placeholders = ",".join(["?"] * len(session_ids))
        cursor.execute(f"""
            SELECT id FROM ignored_pairs
            WHERE id = ? AND session_id IN ({placeholders})
        """, (ignore_id, *session_ids))
        
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Ignored pair not found")
        
        cursor.execute(f"""
            DELETE FROM ignored_pairs
            WHERE id = ? AND session_id IN ({placeholders})
        """, (ignore_id, *session_ids))
        
        conn.commit()
        
        logger.info(f"Removed ignored pair {ignore_id} for session {session_id}")
        
        return {"message": "Ignored pair removed"}


@router.get("/check")
async def check_if_ignored(
    track_id_1: str,
    track_id_2: str,
    playlist_id: Optional[str] = None,
    session_mgr: SessionManager = Depends(require_auth)
):
    """
    Check if a specific track pair is ignored.
    
    Returns true if the pair is ignored globally or in the specified playlist.
    """
    session_id = session_mgr.get_session_id()
    
    # Sort track IDs
    tid1, tid2 = sorted([track_id_1, track_id_2])
    
    with get_db_connection() as conn:
        session_ids = _get_user_session_ids(conn, session_id)
        cursor = conn.cursor()
        
        if playlist_id:
            # Check both playlist-specific and global
            placeholders = ",".join(["?"] * len(session_ids))
            cursor.execute(f"""
                SELECT id FROM ignored_pairs
                WHERE session_id IN ({placeholders}) AND track_id_1 = ? AND track_id_2 = ?
                  AND (playlist_id = ? OR playlist_id IS NULL)
                LIMIT 1
            """, (*session_ids, tid1, tid2, playlist_id))
        else:
            # Check only global
            placeholders = ",".join(["?"] * len(session_ids))
            cursor.execute(f"""
                SELECT id FROM ignored_pairs
                WHERE session_id IN ({placeholders}) AND track_id_1 = ? AND track_id_2 = ?
                  AND playlist_id IS NULL
                LIMIT 1
            """, (*session_ids, tid1, tid2))
        
        is_ignored = cursor.fetchone() is not None
        
        return {"ignored": is_ignored}
