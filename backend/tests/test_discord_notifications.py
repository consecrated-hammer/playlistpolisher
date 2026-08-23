import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_schedule_failure_notification_uses_configured_webhook(monkeypatch):
    from app.services import discord_notifications

    posted = {}

    class Response:
        def raise_for_status(self):
            return None

    monkeypatch.setattr(discord_notifications.settings, "discord_webhook_url", "https://example.test/webhook")
    monkeypatch.setattr(
        discord_notifications.httpx,
        "post",
        lambda url, **kwargs: posted.update({"url": url, **kwargs}) or Response(),
    )

    assert discord_notifications.send_schedule_failure_notification(
        schedule_id=7,
        action_type="sort",
        error="Spotify authorization expired",
    )
    assert posted["url"] == "https://example.test/webhook"
    assert posted["timeout"] == 10
    assert posted["json"]["allowed_mentions"] == {"parse": []}
    assert posted["json"]["embeds"][0]["title"] == "Playlist Polisher scheduled action failed"
    assert posted["json"]["embeds"][0]["fields"] == [
        {"name": "Action", "value": "sort", "inline": True},
        {"name": "Schedule", "value": "7", "inline": True},
    ]


def test_schedule_failure_notification_is_optional(monkeypatch):
    from app.services import discord_notifications

    monkeypatch.setattr(discord_notifications.settings, "discord_webhook_url", None)

    assert not discord_notifications.send_schedule_failure_notification(
        schedule_id=7,
        action_type="sort",
        error="Spotify authorization expired",
    )
