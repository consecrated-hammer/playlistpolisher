# Playlist Polisher Roadmap

> Planned features and improvements for Playlist Polisher. These are ideas under consideration—no timeline or guarantees, but feedback is welcome!

---

## Known Issues

**Web Playback SDK (Edge/Win11):** `requestMediaKeySystemAccess` robustness warning persists; investigate later.

---

## Remove Explicit Tracks

Add a **Remove Explicit Tracks** action for the current playlist.

**Features:**
- Opens a modal showing **all tracks marked as explicit**
- Default behavior: **Select all explicit tracks** for removal (with the ability to deselect)

**Controls** (mirrors current dedupe UX):
- Checkbox list to **select/deselect** individual explicit tracks
- Optional **Select all / Clear all** toggle

**Apply behavior:**
- Remove the selected tracks from the playlist (with a preview count before applying)

---

## Metadata Enrichment and Smart Playlists

Enrich cached tracks with extra metadata for filtering, sorting, and smart playlist creation.

**Metadata to enrich:**
- **Album release date** (and precision)
- **Artist genres**
- Optional extras: label, album type, markets, popularity

**Use cases:**
- Generate "smart playlists", for example:
  - **90s rock**
  - **2000s pop**
  - **Indie chill 2010s**

**Implementation approach:**
- Store an **enrichment snapshot** per track (with `FetchedAt`, `Source`, `Confidence`) so smart operations are fast and repeatable
- Optional "external enrichment" later (for true *original* release year across reissues/remasters), run **on-demand**

---

## Playlist Merge

Combine **Playlist A + Playlist B** into a target playlist.

**Duplicate handling rules** (choose one):
- Keep **earliest added**
- Keep **latest added**
- Keep **highest popularity**
- Prefer **studio over live**
- Prefer **original over remaster**
- Prefer **explicit or clean** (user preference)

**Ordering rules** (choose one):
- Preserve **A then append B**
- **Interleave** by date added
- **Re-sort** after merge (by your chosen sort mode)

**Output options:**
- Merge **into existing playlist**
- Merge **into new playlist**
- **Preview only** (diff report)

---

## Playlist Split

Split one playlist into multiple playlists using various criteria.

**Split criteria:**
- **By artist**
- **By decade** (using album release date)
- **By genre** (using artist genres)
- **By audio features** (energy, danceability, valence, tempo, etc.)
- **By liked vs not** (user's library likes)

**Controls:**
- Max playlists (overflow bucket like **Other**)
- Naming template (for example: `Playlist Name (1990s)`)

---

## Advanced Duplicate Detection (Variants-Aware)

Detect duplicates beyond simple title matching.

**Detection improvements:**
- Normalize track names (strip "remaster", "live", "radio edit", "mono", "feat." tags)
- Prefer strong identifiers when available (ISRC)
- Classify **near-duplicates** (live vs studio, remaster vs original, explicit vs clean, regional variants)

**User preference rules for auto-resolution:**
- Prefer **studio**
- Prefer **original**
- Prefer **explicit/clean**
- Prefer **playable** track when one is unavailable in the user's region

---

## Mobile-Friendly Pages

Improve mobile experience for additional pages:

- **History:** enable mobile-friendly history view
- **Schedules:** enable mobile-friendly schedules view
- **Ignored tracks:** enable mobile-friendly ignored tracks view
- **Cache:** enable mobile-friendly track cache view

---

## Persistent Configuration

Ensure user views, sorting preferences, and other settings are persisted across sessions.

---

## UI Cosmetics

Visual and UX improvements:

- Create a **dashboard page** with playlist/system stats (# of playlists, backups, schedules, etc.)
- In **/playlists table view**, add total playlist time, private/public indicators
- In **/playlists view**, add action buttons on right-click of playlist (reorder, backup, dedupe, etc.)

---

## Note

This app is built on Spotify's development mode API, which is limited to 25 users. Feature priorities may change based on technical constraints, user feedback, and available development time. Have suggestions? Let us know!
