# Changelog

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
