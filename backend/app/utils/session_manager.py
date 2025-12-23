"""
Session-based Token Manager

Database-backed session management for OAuth tokens.
Replaces file-based token storage with persistent SQLite storage.

Key Features:
- Persistent storage across container restarts
- Multi-user support via session IDs
- Secure HTTP-only cookie-based sessions
- Automatic token refresh handling
- Session cleanup for expired tokens
"""

import sqlite3
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import logging
import hashlib
from base64 import urlsafe_b64encode

from cryptography.fernet import Fernet, InvalidToken

from app.db.database import DB_PATH
from app.config import settings

logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = "playlistpolisher_session"


def _fernet():
    key = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(urlsafe_b64encode(key))


def _encrypt_token(token: str) -> str:
    if token is None:
        return ""
    f = _fernet()
    return f.encrypt(token.encode()).decode()


def _decrypt_token(token: str) -> Optional[str]:
    if not token:
        return None
    f = _fernet()
    try:
        return f.decrypt(token.encode()).decode()
    except InvalidToken:
        # Likely a legacy plaintext token; return as-is to avoid breaking sessions
        logger.warning("Token not encrypted or invalid; returning raw token")
        return token


class SessionManager:
    """
    Session-based OAuth Token Manager
    
    Stores tokens in SQLite database with session-based access.
    Each user gets a unique session_id stored in an HTTP-only cookie.
    
    Attributes:
        session_id: Current session identifier
        
    Methods:
        create_session: Create new session with tokens
        get_session: Retrieve session data
        update_tokens: Update tokens after refresh
        delete_session: Remove session (logout)
        is_authenticated: Check if session is valid
        cleanup_expired_sessions: Remove old sessions
    """
    
    def __init__(self, session_id: Optional[str] = None):
        """
        Initialize Session Manager
        
        Args:
            session_id: Existing session ID from cookie, or None for new session
        """
        self.session_id = session_id

    def get_session_id(self) -> Optional[str]:
        """Return the active session identifier, if any."""
        return self.session_id
    
    def _get_connection(self):
        """Get database connection."""
        return sqlite3.connect(str(DB_PATH))
    
    def create_session(
        self,
        user_id: str,
        access_token: str,
        refresh_token: str,
        expires_in: int,
        token_type: str = "Bearer",
        scope: str = ""
    ) -> str:
        """
        Create a new session with OAuth tokens
        
        Args:
            user_id: Spotify user ID
            access_token: OAuth access token
            refresh_token: OAuth refresh token
            expires_in: Token lifetime in seconds
            token_type: Token type (usually "Bearer")
            scope: Granted OAuth scopes
            
        Returns:
            str: New session ID (to be stored in cookie)
        """
        # Generate secure session ID
        session_id = secrets.token_urlsafe(32)
        
        now = datetime.now()
        expires_at = now + timedelta(seconds=expires_in)
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT INTO user_sessions 
                (session_id, user_id, access_token, refresh_token, token_type, 
                 scope, expires_at, created_at, updated_at, last_used_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session_id, user_id, _encrypt_token(access_token), _encrypt_token(refresh_token), token_type,
                scope, expires_at.isoformat(), now.isoformat(), 
                now.isoformat(), now.isoformat()
            ))
            conn.commit()
            logger.info(f"Created new session for user {user_id}")
            return session_id
        except sqlite3.Error as e:
            logger.error(f"Failed to create session: {e}")
            raise
        finally:
            conn.close()
    
    def get_session(self) -> Optional[Dict[str, Any]]:
        """
        Retrieve current session data
        
        Returns:
            Dict containing session data if exists, None otherwise
        """
        if not self.session_id:
            logger.error("get_session called with no session_id")
            return None
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT user_id, access_token, refresh_token, token_type, 
                       scope, expires_at, created_at, updated_at, last_used_at
                FROM user_sessions
                WHERE session_id = ?
            """, (self.session_id,))
            
            row = cursor.fetchone()
            if not row:
                logger.error(f"No session found in DB for session_id: {self.session_id[:16]}...")
                return None
            
            # Reduced logging frequency - only log every ~60 requests (roughly once per minute)
            # to avoid flooding logs with session lookups
            # logger.debug(f"get_session found session for user {row[0]}, refresh_token length: {len(row[2]) if row[2] else 0}")
            
            # Update last_used_at
            now = datetime.now()
            cursor.execute("""
                UPDATE user_sessions 
                SET last_used_at = ?
                WHERE session_id = ?
            """, (now.isoformat(), self.session_id))
            conn.commit()
            
            return {
                "user_id": row[0],
                "access_token": _decrypt_token(row[1]),
                "refresh_token": _decrypt_token(row[2]),
                "token_type": row[3],
                "scope": row[4],
                "expires_at": row[5],
                "created_at": row[6],
                "updated_at": row[7],
                "last_used_at": row[8]
            }
        except sqlite3.Error as e:
            logger.error(f"Failed to get session: {e}")
            return None
        finally:
            conn.close()
    
    def update_tokens(
        self,
        access_token: str,
        expires_in: int,
        refresh_token: Optional[str] = None
    ) -> bool:
        """
        Update session tokens after refresh
        
        Args:
            access_token: New access token
            expires_in: New token lifetime in seconds
            refresh_token: New refresh token (if provided)
            
        Returns:
            bool: True if successful, False otherwise
        """
        if not self.session_id:
            return False
        
        session = self.get_session()
        if not session:
            return False
        
        now = datetime.now()
        expires_at = now + timedelta(seconds=expires_in)
        
        # Keep existing refresh token if not provided
        final_refresh_token = refresh_token or session["refresh_token"]
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                UPDATE user_sessions
                SET access_token = ?,
                    refresh_token = ?,
                    expires_at = ?,
                    updated_at = ?
                WHERE session_id = ?
            """, (
                _encrypt_token(access_token), _encrypt_token(final_refresh_token), 
                expires_at.isoformat(), now.isoformat(),
                self.session_id
            ))
            conn.commit()
            logger.info(f"Updated tokens for session {self.session_id[:8]}...")
            return True
        except sqlite3.Error as e:
            logger.error(f"Failed to update tokens: {e}")
            return False
        finally:
            conn.close()
    
    def delete_session(self) -> bool:
        """
        Delete current session (logout)
        
        Returns:
            bool: True if successful, False otherwise
        """
        if not self.session_id:
            return False
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            # Scrub tokens before deletion to reduce risk if vacuum fails
            cursor.execute(
                """
                UPDATE user_sessions
                SET access_token = '', refresh_token = ''
                WHERE session_id = ?
                """,
                (self.session_id,),
            )
            cursor.execute("""
                DELETE FROM user_sessions
                WHERE session_id = ?
            """, (self.session_id,))
            conn.commit()
            logger.info(f"Deleted session {self.session_id[:8]}...")
            return True
        except sqlite3.Error as e:
            logger.error(f"Failed to delete session: {e}")
            return False
        finally:
            conn.close()
    
    def is_authenticated(self) -> bool:
        """
        Check if current session is authenticated and valid
        
        Returns:
            bool: True if valid session exists, False otherwise
        """
        session = self.get_session()
        if not session:
            return False
        
        try:
            expires_at = datetime.fromisoformat(session["expires_at"])
            # Add 60 second buffer for clock skew
            return datetime.now() < (expires_at - timedelta(seconds=60))
        except (KeyError, ValueError) as e:
            logger.error(f"Invalid session format: {e}")
            return False
    
    def get_access_token(self) -> Optional[str]:
        """
        Get current access token if valid
        
        Returns:
            str: Access token if authenticated, None otherwise
        """
        if not self.is_authenticated():
            return None
        
        session = self.get_session()
        return session["access_token"] if session else None
    
    def get_refresh_token(self) -> Optional[str]:
        """
        Get current refresh token
        
        Returns:
            str: Refresh token if exists, None otherwise
        """
        session = self.get_session()
        return session["refresh_token"] if session else None
    
    def get_user_id(self) -> Optional[str]:
        """
        Get current user's Spotify ID
        
        Returns:
            str: Spotify user ID if authenticated, None otherwise
        """
        session = self.get_session()
        return session["user_id"] if session else None
    
    @staticmethod
    def cleanup_expired_sessions(days: int = 30) -> int:
        """
        Clean up old expired sessions
        
        Args:
            days: Remove sessions inactive for this many days
            
        Returns:
            int: Number of sessions deleted
        """
        cutoff = datetime.now() - timedelta(days=days)
        
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                DELETE FROM user_sessions
                WHERE last_used_at < ?
            """, (cutoff.isoformat(),))
            
            deleted = cursor.rowcount
            conn.commit()
            logger.info(f"Cleaned up {deleted} expired sessions")
            return deleted
        except sqlite3.Error as e:
            logger.error(f"Failed to cleanup sessions: {e}")
            return 0
        finally:
            conn.close()
