"""
Player Routes

Logs playback-related events from the frontend for audit/debugging.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import List, Optional
import logging

from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/player", tags=["player"])


def get_session_manager(request: Request) -> SessionManager:
    """Extract session manager from the incoming request cookie."""
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


def require_auth(session_mgr: SessionManager = Depends(get_session_manager)) -> SessionManager:
    """Ensure the request is authenticated before logging playback events."""
    if not session_mgr.is_authenticated():
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please login with Spotify."
        )
    return session_mgr


class PlayerEvent(BaseModel):
    event: str = Field(..., description="Playback event name")
    track_id: Optional[str] = Field(None, description="Spotify track id")
    track_uri: Optional[str] = Field(None, description="Spotify track uri")
    track_name: Optional[str] = Field(None, description="Track name")
    artists: Optional[List[str]] = Field(default_factory=list, description="Artist names")
    context_uri: Optional[str] = Field(None, description="Playback context uri")
    device_name: Optional[str] = Field(None, description="Playback device name")
    remote: Optional[bool] = Field(None, description="Playback is running on a remote device")


class FrontendLog(BaseModel):
    level: str = Field(..., description="Log level: debug, info, warn, error")
    message: str = Field(..., description="Log message")
    data: Optional[dict] = Field(None, description="Additional data to log")


@router.post("/log")
async def log_frontend_message(
    payload: FrontendLog,
    session_mgr: SessionManager = Depends(require_auth)
):
    """Log frontend messages to backend log file."""
    user_id = session_mgr.get_user_id() or "unknown"
    level = payload.level.lower()
    message = f"[Frontend] {payload.message}"
    
    if payload.data:
        message += f" | data={payload.data}"
    
    message += f" [user={user_id}]"
    
    if level == "debug":
        return {"status": "ok"}
    elif level == "info":
        logger.info(message)
    elif level == "warn":
        logger.warning(message)
    elif level == "error":
        logger.error(message)
    else:
        logger.info(message)
    
    return {"status": "ok"}


@router.post("/events")
async def log_player_event(
    payload: PlayerEvent,
    session_mgr: SessionManager = Depends(require_auth)
):
    """Log playback events for operational visibility."""
    user_id = session_mgr.get_user_id() or "unknown"
    track_label = payload.track_name or payload.track_id or payload.track_uri or "Unknown track"
    artists_label = ", ".join(payload.artists or []) if payload.artists else "Unknown artist"
    extras = []
    if payload.context_uri:
        extras.append(f"context={payload.context_uri}")
    if payload.device_name:
        extras.append(f"device={payload.device_name}")
    if payload.remote is not None:
        extras.append(f"remote={payload.remote}")
    suffix = f" ({', '.join(extras)})" if extras else ""
    logger.info(f"Playback event: {payload.event} - {track_label} — {artists_label}{suffix} [user={user_id}]")
    return {"status": "ok"}
