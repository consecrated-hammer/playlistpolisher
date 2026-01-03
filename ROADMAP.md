# Playlist Polisher feature list

## Backup and restore
- **Backup:** reuse the existing cache as the backup source.
- **Restore options:**
  - **Overwrite existing playlist** (in-place restore)
  - **Restore to new playlist** (clone-style restore)
- **Scheduling:** enable scheduled backups of selected or all playlists.

## Known issues
- **Web Playback SDK (Edge/Win11):** `requestMediaKeySystemAccess` robustness warning persists; investigate later.
- In /playlist view, "Reorder in Spotify" hover text is rendering behind the playlist album art.
- Newly-created playlist track counts show as 0 in /playlists if cache hasn't run yet.

## Artist following (playlist-scoped)
- Add an **Artist Following** action that opens a modal listing **all artists in the playlist**.
- **Bulk actions:**
  - **Follow all**
  - **Unfollow all**
- **Selective control:**
  - Checkbox list to **tick/untick** individual artists
  - Optional **Select all / Clear all** toggle for faster curation

## Remove explicit tracks
- Add a **Remove Explicit Tracks** action for the current playlist.
- Opens a modal showing **all tracks marked as explicit**.
- Default behaviour:
  - **Select all explicit tracks** for removal (with the ability to deselect).
- Controls (mirrors current dedupe UX):
  - Checkbox list to **select/deselect** individual explicit tracks
  - Optional **Select all / Clear all** toggle
- Apply behaviour:
  - Remove the selected tracks from the playlist (with a preview count before applying).

## Metadata enrichment and smart playlists
- Enrich cached tracks with extra metadata for filtering, sorting, and smart playlist creation:
  - **Album release date** (and precision)
  - **Artist genres**
  - Optional extras: label, album type, markets, popularity
- Use enriched metadata to generate “smart playlists”, for example:
  - **90s rock**
  - **2000s pop**
  - **Indie chill 2010s**
- **Implementation shape:**
  - Store an **enrichment snapshot** per track (with `FetchedAt`, `Source`, `Confidence`) so smart operations are fast and repeatable.
  - Optional “external enrichment” later (for true *original* release year across reissues/remasters), run **on-demand**.

## Playlist merge
- Combine **Playlist A + Playlist B** into a target playlist.
- **Duplicate handling rules (choose one):**
  - Keep **earliest added**
  - Keep **latest added**
  - Keep **highest popularity**
  - Prefer **studio over live**
  - Prefer **original over remaster**
  - Prefer **explicit or clean** (user preference)
- **Ordering rules (choose one):**
  - Preserve **A then append B**
  - **Interleave** by date added
  - **Re-sort** after merge (by your chosen sort mode)
- **Output options:**
  - Merge **into existing playlist**
  - Merge **into new playlist**
  - **Preview only** (diff report)

## Playlist split
- Split one playlist into multiple playlists using:
  - **By artist**
  - **By decade** (using album release date)
  - **By genre** (using artist genres)
  - **By audio features** (energy, danceability, valence, tempo, etc.)
  - **By liked vs not** (user’s library likes)
- **Controls:**
  - Max playlists (overflow bucket like **Other**)
  - Naming template (for example: `Playlist Name (1990s)`)

## Advanced duplicate detection (variants-aware)
- Detect duplicates beyond simple title matching:
  - Normalise track names (strip “remaster”, “live”, “radio edit”, “mono”, “feat.” tags)
  - Prefer strong identifiers when available (ISRC)
  - Classify **near-duplicates** (live vs studio, remaster vs original, explicit vs clean, regional variants)
- Provide user preference rules for auto-resolution:
  - Prefer **studio**
  - Prefer **original**
  - Prefer **explicit/clean**
  - Prefer **playable** track when one is unavailable in the user’s region

## Mobile-friendly
- **History:** enable mobile-friendly history view.
- **Schedules:** enable mobile-friendly schedules view.
- **Ignored tracks:** enable mobile-friendly ignored tracks view.
- **Cache:** enable mobile-friendly track cache view.

## Persistent config:
- Ensure user views, sorting, etc, are persisted across sessions.

## UI Cosmetics
- Create a dashboard page should playlist/system stats, e.g. # of playlists, backups, schedules, etc.
- In /playlists table view, add total playlist time, private/public/etc.
- In /playlists view, add action buttons on right-click of playlist, e.g. reorder, backup, dedupe, etc.