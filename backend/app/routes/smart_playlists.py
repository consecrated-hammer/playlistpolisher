"""
Smart playlist builder endpoints.

Uses cached track/artist metadata to generate tag facets and previews.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.db.database import get_db_connection
from app.utils.session_manager import SessionManager, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/smart-playlists", tags=["smart-playlists"])


def get_session_manager(request: Request) -> SessionManager:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    return SessionManager(session_id=session_id)


def require_auth(session_mgr: SessionManager = Depends(get_session_manager)) -> SessionManager:
    if not session_mgr.is_authenticated():
        raise HTTPException(status_code=401, detail="Authentication required. Please login with Spotify.")
    return session_mgr


class SmartPlaylistFacetsRequest(BaseModel):
    playlist_ids: List[str] = Field(default_factory=list)


class SmartPlaylistPreviewRequest(BaseModel):
    playlist_ids: List[str] = Field(default_factory=list)
    match_mode: str = "any"
    genres: List[str] = Field(default_factory=list)
    decades: List[int] = Field(default_factory=list)
    years: List[int] = Field(default_factory=list)
    artist_ids: List[str] = Field(default_factory=list)
    title_contains: List[str] = Field(default_factory=list)
    album_contains: List[str] = Field(default_factory=list)
    limit: int = 200
    offset: int = 0


@dataclass
class TrackRecord:
    track_id: str
    name: str
    artists: List[Dict]
    artist_ids: Set[str]
    genres: List[str]
    genre_keys: Set[str]
    year: Optional[int]
    decade: Optional[int]
    album: Optional[str]
    album_id: Optional[str]
    album_uri: Optional[str]
    album_release_date: Optional[str]
    album_release_date_precision: Optional[str]
    album_type: Optional[str]
    album_label: Optional[str]
    duration_ms: Optional[int]
    album_art_url: Optional[str]
    track_uri: Optional[str]
    track_number: Optional[int]
    disc_number: Optional[int]
    isrc: Optional[str]
    available_markets: List[str]
    preview_url: Optional[str]
    popularity: Optional[int]
    explicit: bool


GENRE_GROUPS = [
    ("hip hop", "Hip Hop"),
    ("hip-hop", "Hip Hop"),
    ("r&b", "R&B"),
    ("rock", "Rock"),
    ("pop", "Pop"),
    ("dance", "Dance"),
    ("edm", "Electronic"),
    ("electronic", "Electronic"),
    ("house", "House"),
    ("techno", "Techno"),
    ("trance", "Trance"),
    ("metal", "Metal"),
    ("punk", "Punk"),
    ("jazz", "Jazz"),
    ("blues", "Blues"),
    ("folk", "Folk"),
    ("classical", "Classical"),
    ("country", "Country"),
    ("soul", "Soul"),
    ("funk", "Funk"),
    ("reggae", "Reggae"),
    ("latin", "Latin"),
    ("indie", "Indie"),
    ("alternative", "Alternative"),
    ("ambient", "Ambient"),
    ("soundtrack", "Soundtrack"),
]


def _genre_group(genre: str) -> str:
    genre_lower = genre.lower()
    for key, label in GENRE_GROUPS:
        if key in genre_lower:
            return label
    return "Other"


def _parse_year(release_date: Optional[str]) -> Optional[int]:
    if not release_date or len(release_date) < 4:
        return None
    year_part = release_date[:4]
    if not year_part.isdigit():
        return None
    return int(year_part)


def _parse_artists(artists_json: str) -> List[Dict]:
    try:
        artists_payload = json.loads(artists_json or "[]")
    except json.JSONDecodeError:
        artists_payload = []

    if artists_payload and isinstance(artists_payload[0], dict):
        return [
            {
                "id": artist.get("id") or "",
                "name": artist.get("name") or "",
                "uri": artist.get("uri") or "",
            }
            for artist in artists_payload
        ]
    return [{"id": "", "name": name, "uri": ""} for name in artists_payload]


def _fetch_artist_genres(artist_ids: Iterable[str]) -> Dict[str, List[str]]:
    artist_ids = [aid for aid in set(artist_ids) if aid]
    if not artist_ids:
        return {}
    placeholders = ",".join(["?"] * len(artist_ids))
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT artist_id, genres_json
            FROM artist_cache
            WHERE artist_id IN ({placeholders})
        """, tuple(artist_ids))
        rows = cursor.fetchall()

    genres_by_artist = {}
    for row in rows:
        genres = []
        try:
            genres = json.loads(row["genres_json"] or "[]")
        except json.JSONDecodeError:
            genres = []
        genres_by_artist[row["artist_id"]] = [g for g in genres if isinstance(g, str)]
    return genres_by_artist


def _load_tracks_for_playlists(playlist_ids: List[str]) -> List[TrackRecord]:
    playlist_ids = [pid for pid in playlist_ids if pid]
    if not playlist_ids:
        return []

    placeholders = ",".join(["?"] * len(playlist_ids))
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT DISTINCT
                tc.track_id,
                tc.name,
                tc.artists_json,
                tc.album,
                tc.album_id,
                tc.album_uri,
                tc.album_release_date,
                tc.album_release_date_precision,
                tc.album_type,
                tc.album_label,
                tc.duration_ms,
                tc.album_art_url,
                tc.track_uri,
                tc.track_number,
                tc.disc_number,
                tc.isrc,
                tc.available_markets_json,
                tc.preview_url,
                tc.popularity,
                tc.explicit
            FROM playlist_cache_items pci
            INNER JOIN track_cache tc ON tc.track_id = pci.track_id
            WHERE pci.playlist_id IN ({placeholders})
            AND pci.track_id IS NOT NULL
        """, tuple(playlist_ids))
        rows = cursor.fetchall()

    artist_ids = set()
    base_tracks = []
    for row in rows:
        artists = _parse_artists(row["artists_json"])
        artist_ids.update({artist["id"] for artist in artists if artist.get("id")})
        year = _parse_year(row["album_release_date"])
        decade = (year // 10) * 10 if year else None
        available_markets = []
        markets_payload = row["available_markets_json"] if "available_markets_json" in row.keys() else None
        if markets_payload:
            try:
                available_markets = json.loads(markets_payload) or []
            except json.JSONDecodeError:
                available_markets = []
        base_tracks.append(
            TrackRecord(
                track_id=row["track_id"],
                name=row["name"],
                artists=artists,
                artist_ids={artist["id"] for artist in artists if artist.get("id")},
                genres=[],
                genre_keys=set(),
                year=year,
                decade=decade,
                album=row["album"],
                album_id=row["album_id"] if "album_id" in row.keys() else None,
                album_uri=row["album_uri"] if "album_uri" in row.keys() else None,
                album_release_date=row["album_release_date"],
                album_release_date_precision=row["album_release_date_precision"],
                album_type=row["album_type"] if "album_type" in row.keys() else None,
                album_label=row["album_label"] if "album_label" in row.keys() else None,
                duration_ms=row["duration_ms"],
                album_art_url=row["album_art_url"],
                track_uri=row["track_uri"],
                track_number=row["track_number"] if "track_number" in row.keys() else None,
                disc_number=row["disc_number"] if "disc_number" in row.keys() else None,
                isrc=row["isrc"] if "isrc" in row.keys() else None,
                available_markets=available_markets,
                preview_url=row["preview_url"] if "preview_url" in row.keys() else None,
                popularity=row["popularity"],
                explicit=bool(row["explicit"]) if row["explicit"] is not None else False,
            )
        )

    genres_by_artist = _fetch_artist_genres(artist_ids)
    for track in base_tracks:
        genres = set()
        for artist_id in track.artist_ids:
            for genre in genres_by_artist.get(artist_id, []):
                if isinstance(genre, str) and genre.strip():
                    genres.add(genre.strip())
        track.genres = sorted(genres)
        track.genre_keys = {genre.lower() for genre in track.genres}

    return base_tracks


@router.post("/facets")
async def get_smart_playlist_facets(
    body: SmartPlaylistFacetsRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    """Return cached metadata facets for smart playlist building."""
    try:
        _ = session_mgr.get_user_id()
        tracks = _load_tracks_for_playlists(body.playlist_ids)
        total_tracks = len(tracks)

        genre_counts: Dict[str, int] = defaultdict(int)
        genre_labels: Dict[str, str] = {}
        genre_group_counts: Dict[str, int] = defaultdict(int)
        genre_group_tags: Dict[str, Set[str]] = defaultdict(set)

        artist_counts: Dict[str, int] = defaultdict(int)
        artist_labels: Dict[str, str] = {}

        year_counts: Dict[int, int] = defaultdict(int)
        decade_counts: Dict[int, int] = defaultdict(int)
        decade_year_counts: Dict[int, Dict[int, int]] = defaultdict(lambda: defaultdict(int))

        for track in tracks:
            if track.year:
                year_counts[track.year] += 1
                decade_counts[track.decade] += 1
                decade_year_counts[track.decade][track.year] += 1

            for artist in track.artists:
                artist_id = artist.get("id")
                if not artist_id:
                    continue
                artist_counts[artist_id] += 1
                artist_labels.setdefault(artist_id, artist.get("name") or "")

            seen_genres = set()
            seen_groups = set()
            for genre in track.genres:
                genre_key = genre.lower()
                if genre_key in seen_genres:
                    continue
                seen_genres.add(genre_key)
                genre_counts[genre_key] += 1
                genre_labels.setdefault(genre_key, genre)
                group = _genre_group(genre)
                if group not in seen_groups:
                    genre_group_counts[group] += 1
                    seen_groups.add(group)
                genre_group_tags[group].add(genre_key)

        genres = [
            {
                "name": genre_labels[key],
                "count": count,
                "group": _genre_group(genre_labels[key]),
            }
            for key, count in genre_counts.items()
        ]
        genres.sort(key=lambda g: (-g["count"], g["name"].lower()))

        genre_groups = []
        for group, count in genre_group_counts.items():
            tag_keys = genre_group_tags[group]
            tags = [
                {"name": genre_labels[key], "count": genre_counts[key]}
                for key in tag_keys
            ]
            tags.sort(key=lambda t: (-t["count"], t["name"].lower()))
            genre_groups.append(
                {
                    "group": group,
                    "count": count,
                    "tags": tags,
                }
            )
        genre_groups.sort(key=lambda g: (-g["count"], g["group"].lower()))

        decades = []
        for decade, count in decade_counts.items():
            years = [
                {"year": year, "count": year_count}
                for year, year_count in decade_year_counts[decade].items()
            ]
            years.sort(key=lambda y: (-y["year"]))
            decades.append(
                {
                    "decade": decade,
                    "label": f"{decade}s",
                    "count": count,
                    "years": years,
                }
            )
        decades.sort(key=lambda d: (-d["decade"]))

        artists = [
            {
                "id": artist_id,
                "name": artist_labels.get(artist_id, ""),
                "count": count,
            }
            for artist_id, count in artist_counts.items()
        ]
        artists.sort(key=lambda a: (-a["count"], a["name"].lower()))

        return {
            "total_tracks": total_tracks,
            "genres": genres,
            "genre_groups": genre_groups,
            "decades": decades,
            "artists": artists,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.error("Failed to build smart playlist facets: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to build smart playlist facets")


@router.post("/preview")
async def get_smart_playlist_preview(
    body: SmartPlaylistPreviewRequest,
    session_mgr: SessionManager = Depends(require_auth),
):
    """Return a cached preview of tracks matching the smart playlist criteria."""
    try:
        _ = session_mgr.get_user_id()
        tracks = _load_tracks_for_playlists(body.playlist_ids)

        selected_genres = {genre.lower() for genre in body.genres if genre}
        selected_decades = {int(decade) for decade in body.decades if decade}
        selected_years = {int(year) for year in body.years if year}
        selected_artists = {artist_id for artist_id in body.artist_ids if artist_id}
        title_filters = [term.strip().lower() for term in body.title_contains if term.strip()]
        album_filters = [term.strip().lower() for term in body.album_contains if term.strip()]

        category_count = sum(
            1
            for flag in [
                bool(selected_genres),
                bool(selected_decades),
                bool(selected_years),
                bool(selected_artists),
                bool(title_filters),
                bool(album_filters),
            ]
            if flag
        )

        matches = []
        for track in tracks:
            if not track.track_uri:
                continue

            genre_hits = len(track.genre_keys & selected_genres) if selected_genres else 0
            decade_match = track.decade in selected_decades if selected_decades else False
            year_match = track.year in selected_years if selected_years else False
            artist_hits = len(track.artist_ids & selected_artists) if selected_artists else 0

            if title_filters:
                name_lower = track.name.lower()
                if body.match_mode == "all":
                    title_match = all(term in name_lower for term in title_filters)
                else:
                    title_match = any(term in name_lower for term in title_filters)
            else:
                title_match = False

            if album_filters:
                album_name = (track.album or "").lower()
                if body.match_mode == "all":
                    album_match = all(term in album_name for term in album_filters)
                else:
                    album_match = any(term in album_name for term in album_filters)
            else:
                album_match = False

            if category_count == 0:
                match = True
            elif body.match_mode == "all":
                match = True
                if selected_genres and not genre_hits:
                    match = False
                if selected_decades and not decade_match:
                    match = False
                if selected_years and not year_match:
                    match = False
                if selected_artists and not artist_hits:
                    match = False
                if title_filters and not title_match:
                    match = False
                if album_filters and not album_match:
                    match = False
            else:
                match = any([
                    genre_hits > 0,
                    decade_match,
                    year_match,
                    artist_hits > 0,
                    title_match,
                    album_match,
                ])

            if not match:
                continue

            match_score = genre_hits + artist_hits
            if decade_match:
                match_score += 1
            if year_match:
                match_score += 1
            if title_match:
                match_score += 1
            if album_match:
                match_score += 1

            matches.append(
                {
                    "track": track,
                    "match_score": match_score,
                    "match_tags": {
                        "genres": sorted(track.genre_keys & selected_genres),
                        "years": [track.year] if year_match else [],
                        "decades": [track.decade] if decade_match else [],
                        "artists": sorted(track.artist_ids & selected_artists),
                        "title": title_filters if title_match else [],
                        "albums": album_filters if album_match else [],
                    },
                }
            )

        matches.sort(
            key=lambda item: (
                -item["match_score"],
                -(item["track"].popularity or 0),
                item["track"].name.lower(),
            )
        )

        total_matches = len(matches)
        limit = max(1, min(body.limit, 500))
        offset = max(0, body.offset)
        page = matches[offset:offset + limit]

        preview_tracks = []
        for item in page:
            track = item["track"]
            preview_tracks.append(
                {
                    "id": track.track_id,
                    "name": track.name,
                    "artists": track.artists,
                    "album": track.album,
                    "album_id": track.album_id,
                    "album_uri": track.album_uri,
                    "album_release_date": track.album_release_date,
                    "album_release_date_precision": track.album_release_date_precision,
                    "album_type": track.album_type,
                    "album_label": track.album_label,
                    "year": track.year,
                    "decade": track.decade,
                    "genres": track.genres,
                    "duration_ms": track.duration_ms,
                    "album_art_url": track.album_art_url,
                    "track_uri": track.track_uri,
                    "track_number": track.track_number,
                    "disc_number": track.disc_number,
                    "isrc": track.isrc,
                    "available_markets": track.available_markets,
                    "preview_url": track.preview_url,
                    "popularity": track.popularity,
                    "explicit": track.explicit,
                    "match_tags": item["match_tags"],
                }
            )

        return {
            "total_matches": total_matches,
            "tracks": preview_tracks,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.error("Failed to build smart playlist preview: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to build smart playlist preview")
