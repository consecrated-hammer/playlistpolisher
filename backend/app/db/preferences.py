import json
from datetime import datetime, timezone
from typing import Any, Dict

from app.db.database import get_db_connection


DEFAULT_PREFERENCES: Dict[str, Any] = {
    "playlist_view": "grid",
    "cache_playlist_scope": "all",
    "cache_selected_playlist_ids": [],
    "cache_auto_include_new": True,
    "now_playing_details_open": False,
    "playlist_action_details_open": False,
    "playlist_album_details_open": False,
    "queue_modal": {"x": 0, "y": -300, "height": 420},
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_user_preferences(user_id: str) -> Dict[str, Any]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT preferences_json FROM user_preferences WHERE user_id = ?",
            (user_id,),
        )
        row = cur.fetchone()

    if not row or not row["preferences_json"]:
        return dict(DEFAULT_PREFERENCES)

    try:
        stored = json.loads(row["preferences_json"])
    except (json.JSONDecodeError, TypeError):
        stored = {}

    if not isinstance(stored, dict):
        stored = {}

    merged = dict(DEFAULT_PREFERENCES)
    merged.update(stored)
    if merged.get("playlist_view") not in {"grid", "list", "table"}:
        merged["playlist_view"] = DEFAULT_PREFERENCES["playlist_view"]
    if merged.get("cache_playlist_scope") not in {"all", "selected", "manual"}:
        merged["cache_playlist_scope"] = DEFAULT_PREFERENCES["cache_playlist_scope"]
    selected_ids = merged.get("cache_selected_playlist_ids")
    if not isinstance(selected_ids, list) or not all(isinstance(item, str) for item in selected_ids):
        merged["cache_selected_playlist_ids"] = []
    if not isinstance(merged.get("cache_auto_include_new"), bool):
        merged["cache_auto_include_new"] = DEFAULT_PREFERENCES["cache_auto_include_new"]
    if not isinstance(merged.get("now_playing_details_open"), bool):
        merged["now_playing_details_open"] = DEFAULT_PREFERENCES["now_playing_details_open"]
    if not isinstance(merged.get("playlist_action_details_open"), bool):
        merged["playlist_action_details_open"] = DEFAULT_PREFERENCES["playlist_action_details_open"]
    if not isinstance(merged.get("playlist_album_details_open"), bool):
        merged["playlist_album_details_open"] = DEFAULT_PREFERENCES["playlist_album_details_open"]
    queue_modal = merged.get("queue_modal")
    if not isinstance(queue_modal, dict):
        merged["queue_modal"] = dict(DEFAULT_PREFERENCES["queue_modal"])
    else:
        sanitized = {}
        for key in ("x", "y", "height"):
            value = queue_modal.get(key)
            if isinstance(value, (int, float)):
                sanitized[key] = float(value)
        merged["queue_modal"] = {
            "x": sanitized.get("x", DEFAULT_PREFERENCES["queue_modal"]["x"]),
            "y": sanitized.get("y", DEFAULT_PREFERENCES["queue_modal"]["y"]),
            "height": sanitized.get("height", DEFAULT_PREFERENCES["queue_modal"]["height"]),
        }
    return merged


def update_user_preferences(user_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    if not updates:
        return get_user_preferences(user_id)

    merged = get_user_preferences(user_id)
    merged.update(updates)

    now = _now_iso()
    payload = json.dumps(merged)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT created_at FROM user_preferences WHERE user_id = ?",
            (user_id,),
        )
        row = cur.fetchone()

        if row:
            cur.execute(
                """
                UPDATE user_preferences
                SET preferences_json = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (payload, now, user_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO user_preferences
                (user_id, preferences_json, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, payload, now, now),
            )

        conn.commit()

    return merged


def should_warm_playlist_cache(user_id: str, playlist_id: str) -> bool:
    prefs = get_user_preferences(user_id)
    scope = prefs.get("cache_playlist_scope")
    if scope == "manual":
        return False
    if scope == "selected":
        return playlist_id in (prefs.get("cache_selected_playlist_ids") or [])
    return True
