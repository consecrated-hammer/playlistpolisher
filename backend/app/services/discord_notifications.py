"""Best-effort Discord notifications for operational schedule failures."""

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_MAX_ERROR_LENGTH = 1500


def send_schedule_failure_notification(*, schedule_id: int, action_type: str, error: str) -> bool:
    """Post a schedule failure to the configured webhook without affecting the job."""
    webhook_url = (settings.discord_webhook_url or "").strip()
    if not webhook_url:
        logger.info("Schedule failure notification skipped; Discord webhook is not configured")
        return False

    detail = (error or "Unknown error").strip()
    if len(detail) > _MAX_ERROR_LENGTH:
        detail = f"{detail[:_MAX_ERROR_LENGTH - 1]}…"

    payload = {
        "username": "Playlist Polisher",
        "allowed_mentions": {"parse": []},
        "embeds": [
            {
                "title": "Playlist Polisher scheduled action failed",
                "description": detail,
                "color": 0xE74C3C,
                "fields": [
                    {"name": "Action", "value": action_type or "unknown", "inline": True},
                    {"name": "Schedule", "value": str(schedule_id), "inline": True},
                ],
            }
        ],
    }

    try:
        response = httpx.post(webhook_url, json=payload, timeout=10)
        response.raise_for_status()
        return True
    except httpx.HTTPError as exc:
        # Notification delivery must never mask or alter the original schedule failure.
        logger.warning("Could not send schedule failure notification: %s", exc)
        return False
