"""
User preferences routes.

Stores per-user UI settings such as playlist view mode.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request

from app.db import preferences as preference_store
from app.models.schemas import UserPreferences, UserPreferencesUpdate
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/preferences", tags=["preferences"])


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


@router.get("", response_model=UserPreferences)
async def get_preferences(
    session_mgr: SessionManager = Depends(require_auth),
):
    """Return stored preferences for the current user."""
    try:
        user_id = session_mgr.get_user_id()
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
        prefs = preference_store.get_user_preferences(user_id)
        return prefs
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to load user preferences: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load user preferences")


@router.patch("", response_model=UserPreferences)
async def update_preferences(
    body: UserPreferencesUpdate,
    session_mgr: SessionManager = Depends(require_auth),
):
    """Update user preferences with provided fields only."""
    try:
        user_id = session_mgr.get_user_id()
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
        updates = body.model_dump(exclude_unset=True, exclude_none=True)
        prefs = preference_store.update_user_preferences(user_id, updates)
        return prefs
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update user preferences: %s", e)
        raise HTTPException(status_code=500, detail="Failed to update user preferences")
