"""
Token Manager Utility

This module handles OAuth token storage, retrieval, and refresh operations.
Provides a simple file-based token storage system with support for token refresh.

Classes:
    TokenManager: Manages OAuth token lifecycle
    
Functions:
    get_token_manager: Dependency injection function for FastAPI routes
"""

import json
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from pathlib import Path
import logging

from app.config import settings

logger = logging.getLogger(__name__)


class TokenManager:
    """
    OAuth Token Manager
    
    Handles storage and retrieval of OAuth tokens. Currently implements
    file-based storage, but designed to be extensible for Redis/database storage.
    
    Attributes:
        storage_path: Path to token storage file
        
    Methods:
        save_token: Store a new token with metadata
        get_token: Retrieve the current valid token
        refresh_token: Update stored token (called after refresh)
        clear_token: Remove stored token (logout)
        is_authenticated: Check if valid token exists
    """
    
    def __init__(self, storage_path: Optional[str] = None):
        """
        Initialize Token Manager
        
        Args:
            storage_path: Path to token storage file. If None, uses config setting.
        """
        self.storage_path = Path(storage_path or settings.token_file_path)
        self._ensure_storage_dir()
    
    def _ensure_storage_dir(self) -> None:
        """
        Ensure the storage directory exists
        
        Creates the parent directory if it doesn't exist.
        """
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
    
    def save_token(
        self,
        access_token: str,
        refresh_token: str,
        expires_in: int,
        token_type: str = "Bearer",
        scope: str = ""
    ) -> None:
        """
        Save OAuth token to storage
        
        Stores the token along with metadata including expiration time.
        
        Args:
            access_token: Short-lived access token
            refresh_token: Long-lived refresh token
            expires_in: Token lifetime in seconds
            token_type: Token type (usually "Bearer")
            scope: Granted OAuth scopes
            
        Raises:
            IOError: If unable to write to storage file
        """
        token_data = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": token_type,
            "scope": scope,
            "expires_at": (datetime.now() + timedelta(seconds=expires_in)).isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        try:
            with open(self.storage_path, "w") as f:
                json.dump(token_data, f, indent=2)
            logger.info("Token saved successfully")
        except IOError as e:
            logger.error(f"Failed to save token: {e}")
            raise
    
    def get_token(self) -> Optional[Dict[str, Any]]:
        """
        Retrieve the current token from storage
        
        Returns:
            Dict containing token data if exists and valid, None otherwise
            
        Note:
            This method does not validate token expiration. Use is_authenticated()
            or check expires_at manually.
        """
        if not self.storage_path.exists():
            logger.debug("Token file does not exist")
            return None
        
        try:
            with open(self.storage_path, "r") as f:
                token_data = json.load(f)
            return token_data
        except (IOError, json.JSONDecodeError) as e:
            logger.error(f"Failed to read token: {e}")
            return None
    
    def update_token(
        self,
        access_token: str,
        expires_in: int,
        refresh_token: Optional[str] = None
    ) -> None:
        """
        Update existing token (typically after refresh)
        
        Preserves existing refresh_token if not provided (some refresh
        responses don't return a new refresh token).
        
        Args:
            access_token: New access token
            expires_in: New token lifetime in seconds
            refresh_token: New refresh token (if provided)
        """
        existing_token = self.get_token()
        if not existing_token:
            logger.warning("No existing token to update")
            return
        
        # Keep existing refresh token if not provided
        final_refresh_token = refresh_token or existing_token.get("refresh_token")
        
        self.save_token(
            access_token=access_token,
            refresh_token=final_refresh_token,
            expires_in=expires_in,
            token_type=existing_token.get("token_type", "Bearer"),
            scope=existing_token.get("scope", "")
        )
    
    def clear_token(self) -> None:
        """
        Remove stored token (logout)
        
        Deletes the token storage file.
        """
        if self.storage_path.exists():
            try:
                self.storage_path.unlink()
                logger.info("Token cleared successfully")
            except OSError as e:
                logger.error(f"Failed to clear token: {e}")
    
    def is_authenticated(self) -> bool:
        """
        Check if user is authenticated with a valid token
        
        Returns:
            bool: True if valid token exists, False otherwise
            
        Note:
            This checks for token existence and expiration, but does not
            validate the token with Spotify. The token could be revoked.
        """
        token = self.get_token()
        if not token:
            return False
        
        # Check if token is expired
        try:
            expires_at = datetime.fromisoformat(token["expires_at"])
            # Add 60 second buffer to account for clock skew
            return datetime.now() < (expires_at - timedelta(seconds=60))
        except (KeyError, ValueError) as e:
            logger.error(f"Invalid token format: {e}")
            return False
    
    def get_access_token(self) -> Optional[str]:
        """
        Get the current access token if valid
        
        Returns:
            str: Access token if authenticated, None otherwise
        """
        if not self.is_authenticated():
            return None
        
        token = self.get_token()
        return token.get("access_token") if token else None
    
    def get_refresh_token(self) -> Optional[str]:
        """
        Get the refresh token
        
        Returns:
            str: Refresh token if exists, None otherwise
        """
        token = self.get_token()
        return token.get("refresh_token") if token else None


def get_token_manager() -> TokenManager:
    """
    Dependency injection function for FastAPI routes
    
    Returns:
        TokenManager: Token manager instance
        
    Example:
        @app.get("/protected")
        async def protected_route(token_mgr: TokenManager = Depends(get_token_manager)):
            if not token_mgr.is_authenticated():
                raise HTTPException(status_code=401)
    """
    return TokenManager()
