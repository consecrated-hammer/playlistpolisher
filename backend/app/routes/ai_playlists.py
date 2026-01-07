"""
AI playlist builder endpoints.

Uses OpenAI to suggest tracks and maps them to Spotify results.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import settings
from app.services.spotify_service import SpotifyService, get_spotify_service
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-playlists", tags=["ai-playlists"])

MAX_AI_TRACKS = 200


def get_session_manager(request: Request) -> SessionManager:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


def require_auth(session_mgr: SessionManager = Depends(get_session_manager)) -> SessionManager:
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
    return session_mgr


class AiPlaylistPreviewRequest(BaseModel):
    mode: Literal["describe", "build"] = "describe"
    description: Optional[str] = None
    decades: List[int] = Field(default_factory=list)
    years: List[int] = Field(default_factory=list)
    genres: List[str] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=list)
    size: int = 50


class AiTrackSuggestion(BaseModel):
    title: str
    artist: str


def _build_prompt(body: AiPlaylistPreviewRequest, size: int) -> str:
    if body.mode == "describe":
        description = (body.description or "").strip()
        if not description:
            raise HTTPException(status_code=400, detail="Description is required.")
        criteria = f'Description: "{description}".'
    else:
        parts = []
        decades = sorted({int(value) for value in body.decades if value})
        years = sorted({int(value) for value in body.years if value})
        genres = [genre.strip() for genre in body.genres if genre.strip()]
        keywords = [word.strip() for word in body.keywords if word.strip()]
        if decades:
            parts.append(f"Decades: {', '.join(f'{decade}s' for decade in decades)}.")
        if years:
            parts.append(f"Years: {', '.join(str(year) for year in years)}.")
        if genres:
            parts.append(f"Primary genres: {', '.join(genres)}.")
        if keywords:
            parts.append(f"Keywords: {', '.join(keywords)}.")
        if not parts:
            raise HTTPException(status_code=400, detail="Select at least one filter to build a playlist.")
        criteria = " ".join(parts)

    return (
        "You are a Spotify playlist curator. Return a JSON object only (no markdown). "
        "Schema: {\"name\": \"...\", \"tracks\": [{\"title\": \"...\", \"artist\": \"...\"}]}. "
        f"Provide exactly {size} tracks with known Spotify catalog entries. "
        "Avoid duplicates and use a concise name prefixed with \"AI playlist:\" based on the criteria. "
        f"{criteria}"
    )


def _load_model_sequence() -> List[str]:
    models = [settings.openai_model]
    if settings.openai_fallback_models:
        models.extend([m.strip() for m in settings.openai_fallback_models.split(",") if m.strip()])
    seen = set()
    ordered = []
    for model in models:
        if model and model not in seen:
            ordered.append(model)
            seen.add(model)
    return ordered


def _call_openai(messages: List[Dict[str, str]]) -> Dict[str, Any]:
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY is not configured.")
    if not settings.openai_base_url:
        raise HTTPException(status_code=400, detail="OPENAI_BASE_URL is not configured.")

    models = _load_model_sequence()
    if not models:
        raise HTTPException(status_code=400, detail="OPENAI_MODEL is not configured.")

    headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
    base_payload = {
        "messages": messages,
    }

    errors = []
    for model in models:
        payload = dict(base_payload)
        payload["model"] = model
        payload["response_format"] = {"type": "json_object"}
        try:
            response = httpx.post(
                settings.openai_base_url,
                headers=headers,
                json=payload,
                timeout=30,
            )
            if response.status_code == 400 and "response_format" in response.text:
                payload.pop("response_format", None)
                response = httpx.post(
                    settings.openai_base_url,
                    headers=headers,
                    json=payload,
                    timeout=30,
                )
            if response.status_code >= 400:
                errors.append(f"{model}: {response.status_code}")
                continue
            return response.json()
        except Exception as exc:
            errors.append(f"{model}: {exc}")

    logger.error("OpenAI request failed: %s", "; ".join(errors))
    raise HTTPException(status_code=502, detail="Failed to generate AI playlist.")


def _extract_json_payload(content: str) -> Dict[str, Any]:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, flags=re.S)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return {}
    return {}


def _normalize_suggestions(raw_tracks: Any) -> List[AiTrackSuggestion]:
    suggestions: List[AiTrackSuggestion] = []
    if not isinstance(raw_tracks, list):
        return suggestions

    seen = set()
    for entry in raw_tracks:
        title = ""
        artist = ""
        if isinstance(entry, dict):
            title = (entry.get("title") or entry.get("track") or entry.get("name") or "").strip()
            artist_value = entry.get("artist") or entry.get("artists") or ""
            if isinstance(artist_value, list):
                artist = ", ".join([str(item).strip() for item in artist_value if str(item).strip()])
            else:
                artist = str(artist_value).strip()
        elif isinstance(entry, str):
            cleaned = entry.strip()
            for separator in [" - ", " — ", " – "]:
                if separator in cleaned:
                    parts = cleaned.split(separator, 1)
                    artist = parts[0].strip()
                    title = parts[1].strip()
                    break
        if not title or not artist:
            continue
        key = f"{title.lower()}|{artist.lower()}"
        if key in seen:
            continue
        seen.add(key)
        suggestions.append(AiTrackSuggestion(title=title, artist=artist))
    return suggestions


def _chunked(items: Iterable[str], size: int) -> Iterable[List[str]]:
    chunk: List[str] = []
    for item in items:
        chunk.append(item)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _fetch_album_labels(sp, album_ids: Iterable[str]) -> Dict[str, str]:
    album_map: Dict[str, str] = {}
    for chunk in _chunked([album_id for album_id in album_ids if album_id], 20):
        try:
            data = sp.albums(chunk)
            for album in data.get("albums", []):
                album_id = album.get("id")
                if album_id:
                    album_map[album_id] = album.get("label") or ""
        except Exception as exc:
            logger.warning("Failed to fetch album labels: %s", exc)
    return album_map


def _extract_album_art(album: Dict[str, Any]) -> Optional[str]:
    images = album.get("images") or []
    if not images:
        return None
    for image in images:
        if image.get("height") == 300:
            return image.get("url")
    return images[0].get("url")


def _map_track_payload(track: Dict[str, Any], album_labels: Dict[str, str]) -> Dict[str, Any]:
    album = track.get("album") or {}
    album_id = album.get("id")
    return {
        "id": track.get("id"),
        "name": track.get("name"),
        "artists": [
            {
                "id": artist.get("id") or "",
                "name": artist.get("name") or "",
                "uri": artist.get("uri") or "",
            }
            for artist in track.get("artists") or []
        ],
        "album": album.get("name"),
        "album_id": album_id,
        "album_uri": album.get("uri"),
        "album_release_date": album.get("release_date"),
        "album_release_date_precision": album.get("release_date_precision"),
        "album_type": album.get("album_type"),
        "album_label": album_labels.get(album_id, "") if album_id else "",
        "duration_ms": track.get("duration_ms") or 0,
        "album_art_url": _extract_album_art(album),
        "track_uri": track.get("uri"),
        "track_number": track.get("track_number"),
        "disc_number": track.get("disc_number"),
        "isrc": (track.get("external_ids") or {}).get("isrc"),
        "available_markets": track.get("available_markets") or [],
        "preview_url": track.get("preview_url"),
        "popularity": track.get("popularity"),
        "explicit": bool(track.get("explicit")),
        "genres": [],
    }


def _search_spotify_track(sp, title: str, artist: str) -> Optional[Dict[str, Any]]:
    queries = [
        f'track:"{title}" artist:"{artist}"',
        f'{title} {artist}',
        f'track:"{title}"',
    ]
    for query in queries:
        try:
            results = sp.search(q=query, type="track", limit=1, market="from_token")
            items = results.get("tracks", {}).get("items", [])
            if items:
                return items[0]
        except Exception as exc:
            logger.debug("Search failed for query %s: %s", query, exc)
    return None


@router.post("/preview")
async def preview_ai_playlist(
    body: AiPlaylistPreviewRequest,
    session_mgr: SessionManager = Depends(require_auth),
    spotify: SpotifyService = Depends(get_spotify_service),
):
    """Generate AI track suggestions and map them to Spotify tracks."""
    size = max(1, min(body.size, MAX_AI_TRACKS))
    prompt = _build_prompt(body, size)

    messages = [
        {"role": "system", "content": "You generate Spotify playlist suggestions."},
        {"role": "user", "content": prompt},
    ]

    response = _call_openai(messages)
    content = (
        response.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    payload = _extract_json_payload(content or "")
    raw_tracks = payload.get("tracks", [])
    suggestions = _normalize_suggestions(raw_tracks)

    name = payload.get("name") or "AI playlist: discovery"
    suggestions = suggestions[:size]

    user_id = session_mgr.get_user_id()
    sp = spotify.get_spotify_client(user_id)
    if not sp:
        raise HTTPException(status_code=401, detail="Spotify authentication expired.")

    matched_tracks: List[Dict[str, Any]] = []
    unmatched: List[Dict[str, str]] = []
    seen_ids = set()

    for suggestion in suggestions:
        track = _search_spotify_track(sp, suggestion.title, suggestion.artist)
        if not track or not track.get("id"):
            unmatched.append({"title": suggestion.title, "artist": suggestion.artist})
            continue
        track_id = track.get("id")
        if track_id in seen_ids:
            continue
        seen_ids.add(track_id)
        matched_tracks.append(track)
        if len(matched_tracks) >= size:
            break

    album_ids = [track.get("album", {}).get("id") for track in matched_tracks]
    album_labels = _fetch_album_labels(sp, album_ids)

    preview_tracks = [_map_track_payload(track, album_labels) for track in matched_tracks]

    return {
        "name": name,
        "requested": size,
        "matched": len(preview_tracks),
        "tracks": preview_tracks,
        "unmatched": unmatched,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
