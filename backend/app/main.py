"""Playlist Polisher - Backend API

A modern FastAPI backend for viewing and managing Spotify playlists.
Provides OAuth authentication and RESTful API endpoints for playlist operations.

Main Components:
    - FastAPI application with CORS middleware
    - OAuth authentication flow
    - Playlist viewing and management
    - Spotify Web API integration

Author: BatServer
License: MIT
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import logging
from logging.handlers import TimedRotatingFileHandler
from contextlib import asynccontextmanager
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response, FileResponse

from app.config import settings
from app.routes import auth, playlists, sort, schedule, ignore, player
from app.services.scheduler_service import scheduler
from app.middleware.rate_limit import RateLimitMiddleware

# Custom logging formatter with timezone support
class TimezoneFormatter(logging.Formatter):
    def __init__(self, fmt=None, datefmt=None, tz=None):
        super().__init__(fmt, datefmt)
        self.tz = ZoneInfo(tz) if tz else None
    
    def formatTime(self, record, datefmt=None):
        dt = datetime.fromtimestamp(record.created, tz=self.tz)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.isoformat()

# Configure logging
handler = logging.StreamHandler()
handler.setFormatter(TimezoneFormatter(
    fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    tz=settings.log_timezone
))

# File logging
handlers = [handler]
if settings.log_file_enabled:
    try:
        log_dir = Path(settings.log_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        file_handler = TimedRotatingFileHandler(
            log_dir / "playlistpolisher.log",
            when="midnight",
            backupCount=7,
            encoding="utf-8"
        )
        file_handler.setFormatter(TimezoneFormatter(
            fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
            tz=settings.log_timezone
        ))
        handlers.append(file_handler)
    except (PermissionError, OSError) as e:
        # Fall back to console-only logging if file logging fails
        logging.warning(f"Failed to set up file logging: {e}. Using console only.")

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    handlers=handlers
)

logger = logging.getLogger(__name__)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("spotipy").setLevel(logging.WARNING)
logging.getLogger("spotipy.client").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application Lifespan Manager
    
    Handles startup and shutdown events for the application.
    """
    # Startup
    logger.info("Starting Playlist Polisher API")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Backend URL: {settings.backend_url}")
    logger.info(f"Frontend URL: {settings.frontend_url}")
    
    # Recover interrupted jobs from previous run
    from app.services.job_service import SortJobService
    recovered = SortJobService.recover_interrupted_jobs()
    if recovered > 0:
        logger.info(f"Recovered {recovered} interrupted jobs")
    
    scheduler.start()
    
    yield
    
    # Shutdown
    scheduler.stop()
    logger.info("Shutting down Playlist Polisher API")


# Create FastAPI application
app = FastAPI(
    title="Playlist Polisher API",
    description="Backend API for viewing and managing Spotify playlists with OAuth authentication",
    version="3.0.0",
    docs_url="/docs",  # Swagger UI documentation
    redoc_url="/redoc",  # ReDoc documentation
    lifespan=lifespan
)


# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,  # Always use explicit origins with credentials
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include routers
app.include_router(auth.router)
app.include_router(playlists.router)
app.include_router(sort.router)
app.include_router(schedule.router)
app.include_router(schedule.router_user)
app.include_router(ignore.router)
app.include_router(player.router)

# Import and include cache router
from app.routes import cache
app.include_router(cache.router)

# Import and include preferences router
from app.routes import preferences
app.include_router(preferences.router)

# Security and cache headers middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response: Response = await call_next(request)
        # Prefer no-store for API responses; static assets are served elsewhere.
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Server"] = "playlistpolisher"
        # Ensure charset for text responses
        if "content-type" in response.headers:
            ct = response.headers["content-type"]
            if "charset" not in ct.lower() and ct.startswith(("text/", "application/json")):
                response.headers["content-type"] = f"{ct}; charset=utf-8"
        # Remove deprecated/undesired headers if present
        for h in ["X-XSS-Protection", "X-Frame-Options", "Expires"]:
            if h in response.headers:
                del response.headers[h]
        return response

app.add_middleware(SecurityHeadersMiddleware)

# Rate limiting middleware (simple in-memory per-IP)
if settings.rate_limit_enabled:
    app.add_middleware(
        RateLimitMiddleware,
        max_requests=settings.rate_limit_requests_per_minute,
        window_seconds=settings.rate_limit_window_seconds,
        exclude_paths={"/health", "/docs", "/redoc", "/openapi.json"},
    )


# Mount static files (frontend) if available
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    static_root = static_dir.resolve()
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")
    
    @app.get("/", response_class=FileResponse)
    async def serve_frontend():
        """Serve frontend index.html"""
        return FileResponse(str(static_dir / "index.html"))
    
    @app.get("/{full_path:path}", response_class=FileResponse)
    async def catch_all(full_path: str):
        """Catch-all route for frontend routing"""
        target_path = (static_root / full_path).resolve()
        if target_path.is_relative_to(static_root) and target_path.is_file():
            return FileResponse(str(target_path))
        # For frontend routes, return index.html (SPA)
        return FileResponse(str(static_root / "index.html"))
else:
    @app.get("/")
    async def root():
        """
        Root Endpoint
        
        Returns basic API information and status.
        
        Returns:
            dict: API information
        """
        return {
            "name": "Playlist Polisher API",
            "version": "3.0.0",
            "status": "running",
            "docs": f"{settings.backend_url}/docs" if settings.is_development else "disabled",
            "environment": settings.environment
        }


@app.get("/health")
async def health_check():
    """
    Health Check Endpoint
    
    Simple health check for monitoring and load balancers.
    
    Returns:
        dict: Health status
    """
    return {
        "status": "healthy",
        "environment": settings.environment
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Global Exception Handler
    
    Catches unhandled exceptions and returns a formatted error response.
    
    Args:
        request: FastAPI request object
        exc: Exception that was raised
        
    Returns:
        JSONResponse: Formatted error response
    """
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": "An unexpected error occurred",
            "detail": str(exc) if settings.is_development else None
        }
    )


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.is_development,
        log_level=settings.log_level.lower()
    )
