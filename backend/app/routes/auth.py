"""
Authentication Routes

This module defines all authentication-related API endpoints including:
- OAuth flow initialization
- OAuth callback handling
- Authentication status checking
- Logout

All routes are prefixed with /auth
Uses session-based authentication with secure HTTP-only cookies.
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse, JSONResponse
import logging
import spotipy
from urllib.parse import urlparse
import secrets
import hmac
import hashlib
import time
from datetime import datetime

from app.config import settings
from app.services.spotify_service import SpotifyService, get_spotify_service
from app.models.schemas import (
    AuthUrlResponse,
    AuthSuccessResponse,
    AuthExchangeRequest,
    AuthExchangeResponse,
    PlaybackTokenResponse,
    UserProfile,
    ErrorResponse,
)
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME
from app.db.database import get_db_connection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])

# Session cookie settings
SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days
SESSION_COOKIE_SECURE = settings.is_production
# Use SameSite=None for production cross-site; Lax for dev
SESSION_COOKIE_SAMESITE = "none" if settings.is_production else "lax"
_parsed_frontend = urlparse(settings.frontend_url)
# Don't set domain for IP addresses in development - let browser handle it
SESSION_COOKIE_DOMAIN = (
    f".{_parsed_frontend.hostname}" 
    if _parsed_frontend and _parsed_frontend.hostname and not _parsed_frontend.hostname.replace('.', '').isdigit()
    else None
)
STATE_TTL_SECONDS = 10 * 60  # 10 minutes
AUTH_EXCHANGE_TTL_SECONDS = 5 * 60  # 5 minutes


def get_session_manager(request: Request) -> SessionManager:
    """
    Dependency to get session manager from request cookie
    
    Args:
        request: FastAPI request object
        
    Returns:
        SessionManager: Session manager instance with session_id from cookie
    """
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        logger.debug(f"Cookie check - name: {SESSION_COOKIE_NAME}, session_id prefix: {session_id[:6]}***")
    else:
        logger.debug(f"Cookie check - name: {SESSION_COOKIE_NAME}, session_id: None")
    return SessionManager(session_id=session_id)


def _store_state(state: str):
    """Store OAuth state in database with timestamp."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO oauth_states (state, created_at) VALUES (?, ?)",
            (state, int(time.time()))
        )
        conn.commit()


def _validate_state(state: str) -> bool:
    """Validate state param exists in database and hasn't expired."""
    if not state:
        return False
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT created_at FROM oauth_states WHERE state = ?",
            (state,)
        )
        row = cursor.fetchone()
        
        if not row:
            return False
        
        created_at = row[0]
        if time.time() - created_at > STATE_TTL_SECONDS:
            # Clean up expired state
            cursor.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
            conn.commit()
            return False
        
        # Clean up used state
        cursor.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
        conn.commit()
        return True


def _cleanup_expired_states():
    """Remove expired OAuth states from database."""
    cutoff = int(time.time()) - STATE_TTL_SECONDS
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM oauth_states WHERE created_at < ?", (cutoff,))
        conn.commit()


def _store_auth_exchange_code(code: str, session_id: str):
    """Store short-lived auth exchange code for session establishment."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO auth_exchange_codes (code, session_id, created_at) VALUES (?, ?, ?)",
            (code, session_id, int(time.time()))
        )
        conn.commit()


def _consume_auth_exchange_code(code: str) -> str | None:
    """Validate and consume an auth exchange code, returning its session_id."""
    if not code:
        return None
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT session_id, created_at FROM auth_exchange_codes WHERE code = ?",
            (code,)
        )
        row = cursor.fetchone()
        if not row:
            return None
        created_at = row["created_at"]
        if time.time() - created_at > AUTH_EXCHANGE_TTL_SECONDS:
            cursor.execute("DELETE FROM auth_exchange_codes WHERE code = ?", (code,))
            conn.commit()
            return None
        cursor.execute("DELETE FROM auth_exchange_codes WHERE code = ?", (code,))
        conn.commit()
        return row["session_id"]


def _cleanup_expired_auth_exchange_codes():
    """Remove expired auth exchange codes from database."""
    cutoff = int(time.time()) - AUTH_EXCHANGE_TTL_SECONDS
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM auth_exchange_codes WHERE created_at < ?", (cutoff,))
        conn.commit()


@router.get("/login")
async def login(
    spotify: SpotifyService = Depends(get_spotify_service),
    show_dialog: bool = Query(False, description="Force Spotify account picker / consent prompt")
):
    """
    Initialize OAuth Flow
    
    Redirects directly to Spotify OAuth authorization with state cookie set.
    This ensures the state cookie is properly set before the OAuth flow begins.
    
    Returns:
        RedirectResponse: Redirects to Spotify authorization page
    """
    try:
        # Clean up old states periodically
        _cleanup_expired_states()
        
        # Generate and store state
        state = secrets.token_urlsafe(32)
        _store_state(state)
        
        auth_url = spotify.get_auth_url(state=state, show_dialog=show_dialog)
        logger.info(f"Redirecting to Spotify OAuth (show_dialog={show_dialog}, state={state[:8]}...)")
        
        return RedirectResponse(url=auth_url, status_code=303)
    except Exception as e:
        logger.error(f"Failed to generate auth URL: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate authentication URL: {str(e)}"
        )


@router.get("/callback")
async def callback(
    code: str = Query(..., description="Authorization code from Spotify"),
    state: str = Query(None, description="OAuth state"),
    request: Request = None,
    response: Response = None,
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """
    Handle OAuth Callback
    
    Processes the OAuth callback from Spotify. Exchanges the authorization
    code for access and refresh tokens, creates a session, sets secure cookie,
    and redirects to frontend.
    
    Args:
        code: Authorization code from Spotify OAuth flow
        response: FastAPI response object (for setting cookie)
        
    Returns:
        RedirectResponse: Redirects to frontend with success/error status
        
    Query Parameters:
        code: Authorization code (required)
        
    Note:
        After successful authentication, sets session cookie (best-effort) and redirects
        to frontend with ?status=success&code=... . On error, redirects with
        ?status=error&message=...
    """
    try:
        logger.debug(f"Callback - state param: {state}")
        if not _validate_state(state):
            logger.warning(f"OAuth state validation failed - state: {state}")
            return RedirectResponse(
                url=f"{settings.frontend_url}/callback?status=error&message=invalid_state"
            )

        _cleanup_expired_auth_exchange_codes()

        # Exchange code for tokens directly (bypass handle_callback which uses old token_manager)
        token_info = spotify.oauth.get_access_token(code, as_dict=True)
        
        # Get user profile to store user_id using the new token
        sp_client = spotipy.Spotify(auth=token_info["access_token"])
        user_profile = sp_client.current_user()
        user_id = user_profile['id']
        
        # Create session in database
        session_mgr = SessionManager()
        session_id = session_mgr.create_session(
            user_id=user_id,
            access_token=token_info["access_token"],
            refresh_token=token_info["refresh_token"],
            expires_in=token_info["expires_in"],
            token_type=token_info.get("token_type", "Bearer"),
            scope=token_info.get("scope", "")
        )
        
        logger.info(f"OAuth callback successful for user {user_id}, session created")
        
        # Create short-lived exchange code for frontend session establishment
        auth_code = secrets.token_urlsafe(32)
        _store_auth_exchange_code(auth_code, session_id)

        # Create redirect response with session cookie (best effort)
        redirect_response = RedirectResponse(
            url=f"{settings.frontend_url}/callback?status=success&code={auth_code}"
        )
        
        # Set secure HTTP-only cookie
        redirect_response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=session_id,
            max_age=SESSION_COOKIE_MAX_AGE,
            httponly=True,  # Prevents JavaScript access (XSS protection)
            secure=SESSION_COOKIE_SECURE,     # HTTPS only in prod, allow HTTP locally
            samesite=SESSION_COOKIE_SAMESITE,  # allow subdomain API calls from frontend origin
            domain=SESSION_COOKIE_DOMAIN,
            path="/"
        )
        logger.debug(f"Set session cookie: session_id={session_id[:8]}***, secure={SESSION_COOKIE_SECURE}, samesite={SESSION_COOKIE_SAMESITE}, domain={SESSION_COOKIE_DOMAIN}, max_age={SESSION_COOKIE_MAX_AGE}")
        
        return redirect_response
    except Exception as e:
        logger.error(f"OAuth callback failed: {e}")
        return RedirectResponse(
            url=f"{settings.frontend_url}/callback?status=error&message={str(e)}"
        )


@router.post("/exchange", response_model=AuthExchangeResponse)
async def exchange_session(payload: AuthExchangeRequest):
    """
    Exchange short-lived auth code for a session cookie.

    This endpoint is called by the frontend after the OAuth redirect to ensure
    the session cookie is set in a first-party API response.
    """
    _cleanup_expired_auth_exchange_codes()
    session_id = _consume_auth_exchange_code(payload.code)
    if not session_id:
        raise HTTPException(status_code=400, detail="Invalid or expired auth code.")

    response = JSONResponse({"message": "Session established"})
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,
        domain=SESSION_COOKIE_DOMAIN,
        path="/"
    )
    logger.debug(
        "Set session cookie via exchange: session_id=%s***, secure=%s, samesite=%s, domain=%s",
        session_id[:8],
        SESSION_COOKIE_SECURE,
        SESSION_COOKIE_SAMESITE,
        SESSION_COOKIE_DOMAIN,
    )
    return response


@router.get("/status")
async def auth_status(
    request: Request,
    session_mgr: SessionManager = Depends(get_session_manager)
):
    """
    Check Authentication Status
    
    Returns the current authentication status and user information if authenticated.
    Uses session cookie to identify the user.
    
    Returns:
        dict: Contains authenticated flag and user profile if logged in
        
    Example Response (authenticated):
        {
            "authenticated": true,
            "user": {
                "id": "user123",
                "display_name": "John Doe",
                "email": "john@example.com",
                ...
            }
        }
        
    Example Response (not authenticated):
        {
            "authenticated": false,
            "user": null
        }
    """
    try:
        is_authenticated = session_mgr.is_authenticated()
        
        logger.debug(f"Auth status check - session_id prefix: {session_mgr.session_id[:6] if session_mgr.session_id else 'None'}, is_auth: {is_authenticated}")
        
        if not is_authenticated:
            return {
                "authenticated": False,
                "user": None
            }
        
        # Get user profile using a properly initialized SpotifyService with this session
        spotify = SpotifyService(session_manager=session_mgr)
        user_profile = spotify.get_user_profile()
        
        # UserProfile is a Pydantic model; log via attribute access
        logger.info(f"User authenticated: {user_profile.id}")
        return {
            "authenticated": True,
            "user": user_profile
        }
    except Exception as e:
        logger.error(f"Failed to check auth status: {e}", exc_info=True)
        # If error getting profile, user is likely not authenticated
        return {
            "authenticated": False,
            "user": None
        }


@router.get("/player-token", response_model=PlaybackTokenResponse)
async def get_player_token(
    session_mgr: SessionManager = Depends(get_session_manager)
):
    """
    Get Playback Access Token

    Returns a short-lived Spotify access token and scope string for the
    Web Playback SDK. Uses the session cookie to refresh tokens if needed.
    """
    session = session_mgr.get_session()
    if not session:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated. Please login first."
        )

    try:
        spotify = SpotifyService(session_manager=session_mgr)
        spotify.get_client()
        refreshed = session_mgr.get_session()
        if not refreshed or not refreshed.get("access_token"):
            raise HTTPException(
                status_code=401,
                detail="No access token available. Please login again."
            )
        expires_at = datetime.fromisoformat(refreshed["expires_at"])
        expires_in = max(0, int((expires_at - datetime.now()).total_seconds()))
        return PlaybackTokenResponse(
            access_token=refreshed["access_token"],
            token_type=refreshed.get("token_type", "Bearer"),
            expires_in=expires_in,
            scope=refreshed.get("scope", "")
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch playback token: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch playback token: {str(e)}"
        )


@router.post("/logout")
async def logout(
    response: Response,
    session_mgr: SessionManager = Depends(get_session_manager)
):
    """
    Logout User
    
    Clears the session from database and removes the session cookie.
    
    Args:
        response: FastAPI response object (for clearing cookie)
        
    Returns:
        dict: Success message
        
    Example Response:
        {
            "message": "Successfully logged out"
        }
    """
    try:
        session = session_mgr.get_session()
        refresh_token = session.get("refresh_token") if session else None
        
        # Best-effort revocation of the refresh token before clearing local state
        if refresh_token:
            try:
                spotify = SpotifyService(session_manager=session_mgr)
                spotify.revoke_refresh_token(refresh_token)
            except Exception as revoke_err:
                logger.warning("Failed to revoke refresh token during logout: %s", revoke_err)
        
        # Delete session from database
        session_mgr.delete_session()
        
        # Clear the session cookie
        response.delete_cookie(
            key=SESSION_COOKIE_NAME,
            httponly=True,
            secure=SESSION_COOKIE_SECURE,
            samesite=SESSION_COOKIE_SAMESITE,
            domain=SESSION_COOKIE_DOMAIN
        )
        
        logger.info("User logged out successfully")
        return {"message": "Successfully logged out"}
    except Exception as e:
        logger.error(f"Logout failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Logout failed: {str(e)}"
        )


@router.get("/user", response_model=UserProfile)
async def get_current_user(
    session_mgr: SessionManager = Depends(get_session_manager),
    spotify: SpotifyService = Depends(get_spotify_service)
):
    """
    Get Current User Profile
    
    Fetches detailed information about the currently authenticated user.
    Uses session cookie to identify the user.
    
    Returns:
        UserProfile: Current user's profile information
        
    Raises:
        HTTPException: 401 if not authenticated, 500 on other errors
        
    Example Response:
        {
            "id": "user123",
            "display_name": "John Doe",
            "email": "john@example.com",
            "images": [...],
            "followers": 42,
            "product": "free"
        }
    """
    if not session_mgr.is_authenticated():
        raise HTTPException(
            status_code=401,
            detail="Not authenticated. Please login first."
        )
    
    try:
        user_profile = spotify.get_user_profile()
        return user_profile
    except Exception as e:
        logger.error(f"Failed to fetch user profile: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch user profile: {str(e)}"
        )
