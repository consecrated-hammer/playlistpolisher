"""
Configuration Module

This module handles loading and validating environment variables using Pydantic Settings.
All application configuration is centralized here for easy management and type safety.

Classes:
    Settings: Main configuration class that loads all environment variables
    
Usage:
    from app.config import settings
    
    client_id = settings.spotify_client_id
    api_url = settings.backend_url
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import Literal
from pathlib import Path

# Only use Docker secrets directory if it exists to avoid noisy warnings in self-hosted setups
_secrets_dir = Path("/run/secrets")
_secrets_dir_str = str(_secrets_dir) if _secrets_dir.is_dir() else None


class Settings(BaseSettings):
    """
    Application Settings
    
    Loads configuration from environment variables with validation.
    Uses Pydantic for type checking and automatic parsing.
    
    Attributes:
        spotify_client_id: Spotify application client ID
        spotify_client_secret: Spotify application client secret
        spotify_redirect_uri: OAuth callback URL
        secret_key: Application secret for JWT signing
        environment: Current environment (development/production/testing)
        backend_host: Host to bind the backend server
        backend_port: Port to bind the backend server
        frontend_url: Frontend URL for CORS configuration
        token_storage: Storage method for OAuth tokens
        token_file_path: Path to token storage file
        log_level: Logging level
        track_cache_ttl_days: Days to keep track metadata in cache (default: 30)
    """
    
    # Spotify API Configuration (supports Docker secrets via /run/secrets)
    spotify_client_id: str
    spotify_client_secret: str
    spotify_redirect_uri: str = "http://localhost:8000/auth/callback"
    
    # Application Configuration
    secret_key: str
    environment: Literal["development", "production", "testing"] = "development"
    
    # Server Configuration
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    
    # Frontend Configuration
    frontend_url: str = "http://localhost:5173"
    frontend_allowed_origins: str | None = None
    
    # Token Storage Configuration
    token_storage: Literal["file", "redis", "database"] = "file"
    token_file_path: str = "./tokens.json"
    
    # Logging Configuration
    log_level: str = "INFO"
    log_timezone: str = "Australia/Adelaide"
    log_dir: str = "/data/logs"
    log_file_enabled: bool = True

    # Rate limiting
    rate_limit_enabled: bool = True
    rate_limit_requests_per_minute: int = 120
    rate_limit_window_seconds: int = 60
    
    # Track Cache Configuration
    track_cache_ttl_days: int = 30
    
    # Pagination Configuration
    playlist_page_size: int = 100
    
    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        secrets_dir=_secrets_dir_str,
        extra="ignore"
    )
    
    @property
    def backend_url(self) -> str:
        """
        Construct the full backend URL
        
        Returns:
            str: Full backend URL (e.g., http://localhost:8000)
        """
        return f"http://{self.backend_host}:{self.backend_port}"
    
    @property
    def is_development(self) -> bool:
        """Check if running in development mode"""
        return self.environment == "development"
    
    @property
    def is_production(self) -> bool:
        """Check if running in production mode"""
        return self.environment == "production"

    @property
    def allowed_origins(self) -> list[str]:
        """
        Allowed origins for CORS.

        Returns:
            list[str]: Origins parsed from frontend_allowed_origins or frontend_url.
        """
        if self.frontend_allowed_origins:
            return [o.strip() for o in self.frontend_allowed_origins.split(",") if o.strip()]
        return [self.frontend_url]


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance
    
    Uses lru_cache to ensure settings are loaded only once and cached.
    This is the recommended way to access settings throughout the application.
    
    Returns:
        Settings: Cached settings instance
        
    Example:
        from app.config import get_settings
        settings = get_settings()
        print(settings.spotify_client_id)
    """
    return Settings()


# Global settings instance for convenience
settings = get_settings()
