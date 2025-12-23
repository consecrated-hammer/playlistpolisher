import time
import asyncio
from collections import defaultdict, deque
from typing import Iterable, Set

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window = window_seconds
        self.storage = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window
        async with self.lock:
            dq = self.storage[key]
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= self.max_requests:
                return False
            dq.append(now)
            return True


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        max_requests: int,
        window_seconds: int,
        exclude_paths: Iterable[str] | None = None,
    ):
        super().__init__(app)
        self.limiter = RateLimiter(max_requests, window_seconds)
        self.exclude_paths: Set[str] = set(exclude_paths or [])

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in self.exclude_paths:
            return await call_next(request)

        client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
            request.client.host if request.client else "unknown"
        )
        key = f"{client_ip}:{path}"
        allowed = await self.limiter.is_allowed(key)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too Many Requests"},
                headers={"Retry-After": str(self.limiter.window)},
            )
        return await call_next(request)
