# Changelog

## v1.3.0 - 2026-01-04
- Backups: add a global backups library with grouped view, filtering, sorting, and detail restore flow.
- Backups: show deleted playlist indicators and snapshot names when playlists are removed.
- Backups: support rename/delete actions and cache-based snapshot restores.
- Settings: introduce a new settings page for backup cadence, retention, template, and cache TTL controls.

## v1.2.1 - 2026-01-03
- Cache: refresh playlist cache after mutations (sort, dedupe, add/remove, undo).
- Sorting: improve move analysis and estimate timing using prior sort history.

## v1.2.0 - 2026-01-03
- Mobile: fix playlist detail overflow, center controls/artwork, and refine action button layout.
- Mobile: reorder modal uses text buttons; track "Added" shows date + time.
- Playlists: tighten table view columns on mobile, round row edges, align Tracks header icon, remove cache icon from table rows.
- UX: remove infinite scroll debug logging.
- Docs: add ROADMAP.md.

## v1.1.0 - 2026-01-02
- Cache: add playlist freshness checks via snapshot IDs to avoid unnecessary refreshes.
- Cache: support user-wide and per-playlist refresh actions with improved progress feedback.
- Scheduling: expand cache refresh actions and clarify options with tooltips.
- UX: persist playlist sort preference across sessions.
- CI: fetch tags for versioned builds.

## v1.0.2 - 2025-12-25
- Security: harden selector escaping when locating tracks in the UI.
- Security: guard static file routing against path traversal.
- Security: restrict GitHub Actions token permissions in workflows.

## v1.0.1 - 2025-12-25
- Security: update backend dependencies to patched versions (spotipy, python-jose, python-multipart, black).
- Security: bump frontend tooling to pull patched esbuild in dev dependencies.
