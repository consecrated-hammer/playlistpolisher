import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.db.database import get_db_connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_run_from_now(frequency_minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=frequency_minutes)).isoformat()


def _compute_next_run(schedule: Dict[str, Any], from_time: Optional[datetime] = None) -> str:
    """Compute the next run datetime (iso) based on schedule params."""
    base = from_time or datetime.now(timezone.utc)
    params = schedule.get("params") or {}
    sched_type = params.get("schedule_type", "daily")
    hour = int(params.get("hour_of_day", 9))
    dow = (params.get("day_of_week") or "mon").lower()
    dom = int(params.get("day_of_month", 1))
    offset_minutes = int(params.get("timezone_offset_minutes", 0))

    # Work in "local" time using provided offset, then convert back to UTC
    base_local = base + timedelta(minutes=offset_minutes)

    target_local = base_local.replace(minute=0, second=0, microsecond=0, hour=hour)

    if sched_type == "daily":
        if target_local <= base_local:
            target_local += timedelta(days=1)
    elif sched_type == "weekly":
        dow_map = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
        wanted = dow_map.get(dow, 0)
        days_ahead = (wanted - target_local.weekday()) % 7
        if days_ahead == 0 and target_local <= base_local:
          days_ahead = 7
        target_local += timedelta(days=days_ahead)
    elif sched_type == "monthly":
        # Move to this month/day at hour, if already past then next month
        year = target_local.year
        month = target_local.month
        day = max(1, min(dom, 28))  # safe fallback, avoid invalid date
        try:
            candidate = target_local.replace(year=year, month=month, day=day)
        except Exception:
            candidate = target_local.replace(year=year, month=month, day=1)
        if candidate <= base_local:
            # next month
            if month == 12:
                year += 1
                month = 1
            else:
                month += 1
            try:
                candidate = candidate.replace(year=year, month=month, day=day)
            except Exception:
                candidate = candidate.replace(year=year, month=month, day=1)
        target_local = candidate
    else:
        # fallback
        target_local = base_local + timedelta(minutes=int(schedule.get("frequency_minutes") or 1440))

    # convert back to UTC
    target_utc = target_local - timedelta(minutes=offset_minutes)
    return target_utc.isoformat()


def create_schedule(
    *,
    playlist_id: str,
    user_id: str,
    session_id: Optional[str],
    action_type: str,
    params: Dict[str, Any],
    frequency_minutes: int,
    first_run_at: Optional[str] = None,
) -> int:
    created_at = _now_iso()
    schedule_data = {
        "params": params,
        "frequency_minutes": frequency_minutes,
    }
    next_run_at = first_run_at or _compute_next_run(schedule_data)
    with get_db_connection() as conn:
        cur = conn.cursor()
        # Ensure only one schedule per playlist/user/action by replacing any existing row
        cur.execute(
            "DELETE FROM playlist_schedules WHERE playlist_id = ? AND user_id = ? AND action_type = ?",
            (playlist_id, user_id, action_type),
        )
        cur.execute(
            """
            INSERT INTO playlist_schedules
            (playlist_id, user_id, session_id, action_type, params, frequency_minutes, next_run_at, created_at, updated_at, enabled, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'scheduled')
            """,
            (playlist_id, user_id, session_id, action_type, json.dumps(params), frequency_minutes, next_run_at, created_at, created_at),
        )
        conn.commit()
        return cur.lastrowid


def list_schedules(playlist_id: str, user_id: str) -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM playlist_schedules WHERE playlist_id = ? AND user_id = ? ORDER BY created_at DESC",
            (playlist_id, user_id),
        )
        rows = cur.fetchall()
    return [_row_to_dict(r) for r in rows]


def list_for_user(user_id: str) -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM playlist_schedules WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        rows = cur.fetchall()
    return [_row_to_dict(r) for r in rows]


def get_schedule(schedule_id: int, user_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM playlist_schedules WHERE id = ? AND user_id = ?", (schedule_id, user_id))
        row = cur.fetchone()
    return _row_to_dict(row) if row else None


def update_schedule(schedule_id: int, user_id: str, **fields) -> bool:
    allowed = {"frequency_minutes", "next_run_at", "enabled", "status", "last_error", "params"}
    updates = []
    params = []
    manual_next_run = fields.get("next_run_at") is not None
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key == "params":
            val = json.dumps(val)
        updates.append(f"{key} = ?")
        params.append(val)
    if not updates:
        return False
    updates.append("updated_at = ?")
    params.append(_now_iso())
    params.extend([schedule_id, user_id])
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE playlist_schedules SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        return cur.rowcount > 0


def delete_schedule(schedule_id: int, user_id: str) -> bool:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM playlist_schedules WHERE id = ? AND user_id = ?", (schedule_id, user_id))
        conn.commit()
        return cur.rowcount > 0


def due_schedules(now_iso: Optional[str] = None, limit: int = 10) -> List[Dict[str, Any]]:
    now = now_iso or _now_iso()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM playlist_schedules
            WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
            ORDER BY next_run_at ASC
            LIMIT ?
            """,
            (now, limit),
        )
        rows = cur.fetchall()
    return [_row_to_dict(r) for r in rows]


def mark_run(schedule_id: int, user_id: str, frequency_minutes: int, success: bool, error: Optional[str] = None) -> None:
    now = _now_iso()
    sched = get_schedule(schedule_id, user_id)
    next_run = _compute_next_run(sched, from_time=datetime.now(timezone.utc)) if sched else (datetime.now(timezone.utc) + timedelta(minutes=frequency_minutes)).isoformat()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE playlist_schedules
            SET last_run_at = ?, next_run_at = ?, status = ?, last_error = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (now, next_run, "ok" if success else "failed", error, now, schedule_id, user_id),
        )
        conn.commit()


def _row_to_dict(row) -> Dict[str, Any]:
    data = dict(row)
    try:
        data["params"] = json.loads(data.get("params") or "{}")
    except Exception:
        data["params"] = {}
    return data
