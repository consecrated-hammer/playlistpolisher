import logging
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db import app_settings as settings_store
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME
from fastapi import Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/app-settings", tags=["settings"])


def get_session_manager(request: Request) -> SessionManager:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


def require_auth(session_mgr: SessionManager = Depends(get_session_manager)) -> SessionManager:
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
    return session_mgr


class AppSettingsResponse(BaseModel):
    track_cache_ttl_days: int
    track_cache_ttl_source: Literal["env", "stored"]


class AppSettingsUpdate(BaseModel):
    track_cache_ttl_days: Optional[int] = Field(None, ge=1, le=3650)


@router.get("", response_model=AppSettingsResponse)
async def get_app_settings(session_mgr: SessionManager = Depends(require_auth)):
    ttl_days, source = settings_store.get_track_cache_ttl_days()
    return AppSettingsResponse(track_cache_ttl_days=ttl_days, track_cache_ttl_source=source)


@router.patch("", response_model=AppSettingsResponse)
async def update_app_settings(
    body: AppSettingsUpdate,
    session_mgr: SessionManager = Depends(require_auth),
):
    if body.track_cache_ttl_days is not None:
        settings_store.set_track_cache_ttl_days(body.track_cache_ttl_days)
    ttl_days, source = settings_store.get_track_cache_ttl_days()
    return AppSettingsResponse(track_cache_ttl_days=ttl_days, track_cache_ttl_source=source)
