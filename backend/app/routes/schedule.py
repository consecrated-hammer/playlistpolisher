import logging

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field, ValidationError
from typing import Optional, Literal, List

from app.utils.session_manager import SessionManager
from app.routes.playlists import require_auth
from app.db import schedules as schedule_store

router = APIRouter(prefix="/playlists/{playlist_id}/schedules", tags=["schedules"])
router_user = APIRouter(prefix="/schedules", tags=["schedules"])

logger = logging.getLogger(__name__)


class SortScheduleRequest(BaseModel):
    action_type: Literal["sort"] = "sort"
    sort_by: Literal['title', 'artist', 'album', 'release_date', 'date_added', 'duration'] = 'date_added'
    direction: Literal['asc', 'desc'] = 'desc'
    method: Literal['fast', 'preserve'] = 'preserve'
    timezone_offset_minutes: int = Field(0, description="Minutes offset from UTC for the user (e.g., +600 for UTC+10)")
    schedule_type: Literal['daily', 'weekly', 'monthly'] = 'daily'
    hour_of_day: int = Field(9, ge=0, le=23, description="Hour of day (0-23) for scheduled run")
    day_of_week: Literal['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] = 'mon'
    day_of_month: int = Field(1, ge=1, le=31)
    frequency_minutes: int = Field(ge=15, le=60 * 24 * 14, description="Fallback cadence in minutes", default=1440)
    first_run_at: Optional[str] = Field(None, description="ISO datetime for first run (UTC). Defaults to next scheduled time")


class ScheduleResponse(BaseModel):
    id: int
    playlist_id: str
    action_type: str
    params: dict
    frequency_minutes: int
    next_run_at: Optional[str]
    last_run_at: Optional[str]
    enabled: bool
    status: Optional[str]
    last_error: Optional[str]


class ScheduleUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    frequency_minutes: Optional[int] = Field(None, ge=15, le=60 * 24 * 14)
    timezone_offset_minutes: Optional[int] = None
    schedule_type: Optional[Literal['daily', 'weekly', 'monthly']] = None
    hour_of_day: Optional[int] = Field(None, ge=0, le=23)
    day_of_week: Optional[Literal['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']] = None
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    sort_by: Optional[Literal['title', 'artist', 'album', 'release_date', 'date_added', 'duration']] = None
    direction: Optional[Literal['asc', 'desc']] = None
    method: Optional[Literal['fast', 'preserve']] = None


class CacheScheduleRequest(BaseModel):
    action_type: Literal["cache_clear"] = "cache_clear"
    schedule_type: Literal['daily', 'weekly', 'monthly'] = 'daily'
    hour_of_day: int = Field(3, ge=0, le=23, description="Hour of day (0-23) for scheduled run")
    day_of_week: Literal['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] = 'sun'
    day_of_month: int = Field(1, ge=1, le=31)
    timezone_offset_minutes: int = Field(0, description="Minutes offset from UTC for the user (e.g., +600 for UTC+10)")
    frequency_minutes: int = Field(ge=15, le=60 * 24 * 30, description="Fallback cadence in minutes", default=1440)
    first_run_at: Optional[str] = Field(None, description="ISO datetime for first run (UTC). Defaults to next scheduled time")


@router.post("", response_model=ScheduleResponse)
async def create_schedule(
    playlist_id: str = Path(..., description="Spotify playlist ID"),
    body: SortScheduleRequest = None,
    session_mgr: SessionManager = Depends(require_auth),
):
    schedule_params = {
        "sort_by": body.sort_by,
        "direction": body.direction,
        "method": body.method,
        "schedule_type": body.schedule_type,
        "hour_of_day": body.hour_of_day,
        "day_of_week": body.day_of_week,
        "day_of_month": body.day_of_month,
        "timezone_offset_minutes": body.timezone_offset_minutes,
    }
    # Set default frequency for reference (daily/weekly/monthly)
    freq_map = {"daily": 1440, "weekly": 10080, "monthly": 43200}
    freq_minutes = freq_map.get(body.schedule_type, body.frequency_minutes)

    sched_id = schedule_store.create_schedule(
        playlist_id=playlist_id,
        user_id=session_mgr.get_user_id(),
        session_id=session_mgr.session_id,
        action_type=body.action_type,
        params=schedule_params,
        frequency_minutes=freq_minutes,
        first_run_at=body.first_run_at,
    )
    sched = schedule_store.get_schedule(sched_id, session_mgr.get_user_id())
    return _to_response(sched)


@router.get("", response_model=List[ScheduleResponse])
async def list_schedules(
    playlist_id: str,
    session_mgr: SessionManager = Depends(require_auth),
):
    schedules = schedule_store.list_schedules(playlist_id, session_mgr.get_user_id())
    validated = [_safe_to_response(s) for s in schedules]
    return [s for s in validated if s is not None]


@router.patch("/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(
    playlist_id: str,
    schedule_id: int,
    body: ScheduleUpdateRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    sched = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    if not sched or sched.get("playlist_id") != playlist_id:
        raise HTTPException(status_code=404, detail="Schedule not found")

    fields = {}
    if body.enabled is not None:
        fields["enabled"] = 1 if body.enabled else 0
    params_update = {}
    for key in ("sort_by", "direction", "method", "schedule_type", "hour_of_day", "day_of_week", "day_of_month", "timezone_offset_minutes"):
        val = getattr(body, key, None)
        if val is not None:
            params_update[key] = val
    if params_update:
        new_params = (sched.get("params") or {}).copy()
        new_params.update(params_update)
        fields["params"] = new_params
    if body.frequency_minutes is not None:
        fields["frequency_minutes"] = body.frequency_minutes
    if params_update or body.frequency_minutes is not None:
        fields["next_run_at"] = None  # will be recalculated on next tick
    if not fields:
        return _to_response(sched)

    schedule_store.update_schedule(schedule_id, session_mgr.get_user_id(), **fields)
    updated = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    if updated and updated.get("next_run_at") is None:
        # recompute based on updated params
        next_run = schedule_store._compute_next_run(updated)
        schedule_store.update_schedule(schedule_id, session_mgr.get_user_id(), next_run_at=next_run)
        updated = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    return _to_response(updated)


@router.delete("/{schedule_id}")
async def delete_schedule(
    playlist_id: str,
    schedule_id: int,
    session_mgr: SessionManager = Depends(require_auth),
):
    sched = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    if not sched or sched.get("playlist_id") != playlist_id:
        raise HTTPException(status_code=404, detail="Schedule not found")
    schedule_store.delete_schedule(schedule_id, session_mgr.get_user_id())
    return {"message": "Schedule deleted"}


def _to_response(s: dict) -> ScheduleResponse:
    return ScheduleResponse(
        id=s["id"],
        playlist_id=s.get("playlist_id"),
        action_type=s["action_type"],
        params=s.get("params") or {},
        frequency_minutes=s["frequency_minutes"],
        next_run_at=s.get("next_run_at"),
        last_run_at=s.get("last_run_at"),
        enabled=bool(s.get("enabled", 1)),
        status=s.get("status"),
        last_error=s.get("last_error"),
    )


class ScheduleListResponse(BaseModel):
    schedules: List[ScheduleResponse]


@router_user.get("", response_model=ScheduleListResponse)
async def list_user_schedules(session_mgr: SessionManager = Depends(require_auth)):
    schedules = schedule_store.list_for_user(session_mgr.get_user_id())
    valid_schedules = [_safe_to_response(s) for s in schedules]
    return {"schedules": [s for s in valid_schedules if s is not None]}

CACHE_GLOBAL_PLAYLIST_ID = "__cache_global__"


@router_user.post("/cache", response_model=ScheduleResponse)
async def create_cache_schedule(
    body: CacheScheduleRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    schedule_params = {
        "schedule_type": body.schedule_type,
        "hour_of_day": body.hour_of_day,
        "day_of_week": body.day_of_week,
        "day_of_month": body.day_of_month,
        "timezone_offset_minutes": body.timezone_offset_minutes,
    }
    freq_map = {"daily": 1440, "weekly": 10080, "monthly": 43200}
    freq_minutes = freq_map.get(body.schedule_type, body.frequency_minutes)

    sched_id = schedule_store.create_schedule(
        playlist_id=CACHE_GLOBAL_PLAYLIST_ID,
        user_id=session_mgr.get_user_id(),
        session_id=session_mgr.session_id,
        action_type=body.action_type,
        params=schedule_params,
        frequency_minutes=freq_minutes,
        first_run_at=body.first_run_at,
    )
    sched = schedule_store.get_schedule(sched_id, session_mgr.get_user_id())
    return _to_response(sched)


@router_user.patch("/cache/{schedule_id}", response_model=ScheduleResponse)
async def update_cache_schedule(
    schedule_id: int,
    body: ScheduleUpdateRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    sched = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    if not sched or sched.get("playlist_id") != CACHE_GLOBAL_PLAYLIST_ID:
        raise HTTPException(status_code=404, detail="Schedule not found")

    fields = {}
    if body.enabled is not None:
        fields["enabled"] = 1 if body.enabled else 0
    params_update = {}
    for key in ("schedule_type", "hour_of_day", "day_of_week", "day_of_month", "timezone_offset_minutes"):
        val = getattr(body, key, None)
        if val is not None:
            params_update[key] = val
    if params_update:
        new_params = (sched.get("params") or {}).copy()
        new_params.update(params_update)
        fields["params"] = new_params
    if body.frequency_minutes is not None:
        fields["frequency_minutes"] = body.frequency_minutes
    if params_update or body.frequency_minutes is not None:
        fields["next_run_at"] = None
    if not fields:
        return _to_response(sched)

    schedule_store.update_schedule(schedule_id, session_mgr.get_user_id(), **fields)
    updated = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    if updated and updated.get("next_run_at") is None:
        next_run = schedule_store._compute_next_run(updated)
        schedule_store.update_schedule(schedule_id, session_mgr.get_user_id(), next_run_at=next_run)
        updated = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    return _to_response(updated)


@router_user.delete("/cache/{schedule_id}")
async def delete_cache_schedule(
    schedule_id: int,
    session_mgr: SessionManager = Depends(require_auth),
):
    sched = schedule_store.get_schedule(schedule_id, session_mgr.get_user_id())
    if not sched or sched.get("playlist_id") != CACHE_GLOBAL_PLAYLIST_ID:
        raise HTTPException(status_code=404, detail="Schedule not found")
    schedule_store.delete_schedule(schedule_id, session_mgr.get_user_id())
    return {"message": "Schedule deleted"}


def _safe_to_response(schedule: dict) -> ScheduleResponse | None:
    try:
        return _to_response(schedule)
    except (ValidationError, KeyError, TypeError) as exc:
        logger.warning("Skipping invalid schedule %s: %s", schedule.get("id"), exc)
        return None
