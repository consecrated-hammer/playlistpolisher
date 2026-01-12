# Changelog

## v1.5.5 - 2026-01-12
**Live-first playlists**
- Playlists: refresh live snapshot after sort/dedupe/add/remove/move/edit so the view matches Spotify.
- Cache: reduce auto-warm/refresh triggers (summary + add/remove) and use live-first tracks with cache fallback.
- UI: move cache activity pill above modals, add visible artist follow confirmation, fix playlist view init crash.

## v1.5.4 - 2026-01-08
**Cache responsiveness**
- Cache: update playlist cache immediately after add/remove/duplicate operations to keep UI in sync.
- Cache: avoid blocking playlist summary loads with a full cache refresh.

## v1.5.3 - 2026-01-08
**Release alignment**
- Release: bump version after branch cleanup.

## v1.5.2 - 2026-01-08
**Release alignment**
- Release: bump version to reflect the latest main commit after a premature release.

## v1.5.1 - 2026-01-08
**Selection + cache match fixes**
- Tracks: add select-all (Ctrl/Cmd+A) for full playlist selection.
- Cache check: harden playlist cache matching normalization for mixed payloads.

## v1.5.0 - 2026-01-08
**AI playlist discovery**
- Playlists: replace the single smart-playlist button with a create playlist dropdown (smart vs AI).
- AI playlists: add a full-page builder for describing or manually guiding AI playlist suggestions.
- AI playlists: generate Spotify catalog previews with selectable tracks and AI-generated playlist names.

## v1.4.6 - 2026-01-08
**Smart playlist builder + cache polish**
- Smart playlists: add full-page builder with responsive desktop/mobile layouts, active filters, and live preview tooling.
- Smart playlists: add backend-scoped facets, tag selection UX, and configurable preview caps (including unlimited).
- Cache: avoid blocking infinite scroll during background refresh; coalesce refresh jobs and keep stale cache usable.
- Playlist view: apply optimistic track removal for instant feedback; prevent follow badge wrapping.

## v1.4.5 - 2026-01-05
**Playlist action navigation**
- Playlist view: replace the action strip with grouped dropdowns on desktop and accordions on mobile.
- Context links: add playlist-scoped navigation controls for schedules/history/backups pages.
- Stability: fix playlist view crash caused by action menu initialization order.

## v1.4.4 - 2026-01-05
**Artist follow availability**
- Cache: rehydrate legacy track cache entries missing artist IDs to restore follow status on playlist load.

## v1.4.3 - 2026-01-05
**Cache-first playlist entry**
- Cache: enforce snapshot checks on playlist entry and refresh caches before serving data.
- Cache: build artist lists and duplicate analysis from cached playlist items when available.
- UI: soften cache refresh overlay so the header remains visible.

## v1.4.2 - 2026-01-05
**Playlist browsing fixes**
- Playlists: use cached playlist tracks for paging when available, with stale-cache fallback for faster search.
- Playlist view: resolve tooltip layering over artwork and stabilize search/infinite scroll behavior.
- Artist following: cache follow status per session for quicker status refresh.

## v1.4.1 - 2026-01-05
**Build metadata**
- UI: display commit-based build identifiers in the footer instead of release versions.

## v1.4.0 - 2026-01-05
**Artist following**
- Artist Following: add a playlist-scoped modal with per-artist follow status, mixed follow/unfollow apply, totals, and sorting.
- Playlist view: show primary artist follow status in the table and mobile details.
- Context menu: add artist follow/unfollow actions from the track list.

## v1.3.0 - 2026-01-04
**Backups**
- Backups: add a global backups library with grouped view, filtering, sorting, and detail restore flow.
- Backups: show deleted playlist indicators and snapshot names when playlists are removed.
- Backups: support rename/delete actions and cache-based snapshot restores.
- Settings: introduce a new settings page for backup cadence, retention, template, and cache TTL controls.

## v1.2.1 - 2026-01-03
**Mobile-friendly polish**
- Cache: refresh playlist cache after mutations (sort, dedupe, add/remove, undo).
- Sorting: improve move analysis and estimate timing using prior sort history.

## v1.2.0 - 2026-01-03
**Mobile-friendly**
- Mobile: fix playlist detail overflow, centre controls/artwork, and refine action button layout.
- Mobile: reorder modal uses text buttons; track "Added" shows date + time.
- Playlists: tighten table view columns on mobile, round row edges, align Tracks header icon, remove cache icon from table rows.
- UX: remove infinite scroll debug logging.
- Docs: add ROADMAP.md.

## v1.1.0 - 2026-01-02
**Cache enhancements**
- Cache: add playlist freshness checks via snapshot IDs to avoid unnecessary refreshes.
- Cache: support user-wide and per-playlist refresh actions with improved progress feedback.
- Scheduling: expand cache refresh actions and clarify options with tooltips.
- UX: persist playlist sort preference across sessions.
- CI: fetch tags for versioned builds.

## v1.0.2 - 2025-12-25
**Security hardening**
- Security: harden selector escaping when locating tracks in the UI.
- Security: guard static file routing against path traversal.
- Security: restrict GitHub Actions token permissions in workflows.

## v1.0.1 - 2025-12-25
**Security patching**
- Security: update backend dependencies to patched versions (spotipy, python-jose, python-multipart, black).
- Security: bump frontend tooling to pull patched esbuild in dev dependencies.

## v1.0.0 - 2025-12-25
**First public release**
First public release of Playlist Polisher, a modern Spotify playlist management tool.

### Highlights
- **Smart playlist sorting:** multiple criteria including date added, release date, duration, and name.
- **Track caching system:** 30-day TTL cache for improved performance.
- **Scheduled operations:** automate playlist management tasks.
- **Duplicate detection:** find and manage duplicate tracks.
- **Web player integration:** control playback directly from the interface.
- **Modern UI:** React frontend with a Spotify-inspired design (Tailwind CSS).
- **Fast backend:** Python FastAPI with SQLite database.

### Tech stack
- Frontend: React 18, Vite 5, Tailwind CSS 3.4
- Backend: Python 3.12, FastAPI, Spotipy
- Database: SQLite
- Deployment: Docker with GitHub Actions CI/CD

### Getting started
See README.md for setup instructions.

### Self-hosting
Docker images available at `ghcr.io/consecrated-hammer/playlistpolisher:latest`

> Note: This application runs in Spotify Development Mode (limited to 25 users).
