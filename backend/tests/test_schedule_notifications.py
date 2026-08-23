import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_failed_schedule_is_recorded_and_notified(monkeypatch):
    from app.services import scheduler_service

    recorded = []
    notified = []
    service = scheduler_service.SchedulerService()

    monkeypatch.setattr(
        service,
        "_run_sort_schedule",
        lambda *args: (_ for _ in ()).throw(RuntimeError("Spotify authorization expired")),
    )
    monkeypatch.setattr(
        scheduler_service.schedule_store,
        "mark_run",
        lambda *args, **kwargs: recorded.append((args, kwargs)),
    )
    monkeypatch.setattr(
        scheduler_service,
        "send_schedule_failure_notification",
        lambda **kwargs: notified.append(kwargs),
    )

    service._run_schedule(
        {
            "id": 42,
            "action_type": "sort",
            "playlist_id": "playlist",
            "user_id": "user",
            "session_id": "session",
            "frequency_minutes": 1440,
            "params": {},
        }
    )

    assert recorded == [((42, "user", 1440), {"success": False, "error": "Spotify authorization expired"})]
    assert notified == [
        {
            "schedule_id": 42,
            "action_type": "sort",
            "error": "Spotify authorization expired",
        }
    ]
