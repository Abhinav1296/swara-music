# Known Limitations

Accurate as of the Lyrica/JioSaavn migration (backend v2.0.0). These are scope
boundaries or inherent constraints, not all necessarily bugs — but a few real
edge cases are noted at the end.

## Product / scope limitations

- **Full-length streams, not 30s previews**: Playback now streams **full
  tracks** resolved from JioSaavn (via the personal Lyrica instance) and played
  directly into the single `<audio>` element. There is no more iTunes 30-second
  `previewUrl` clipping. This is the core change of the migration.
- **No account / no sync**: All library data (likes, recents, playlists, queue,
  prefs) lives in `localStorage` on the current device/browser. There is no
  login, no cloud sync, no cross-device continuity.
- **Lyrics are real but not always present**: On every play,
  `/api/song-details` returns synced/plain lyrics when Lyrica/LRCLib has them.
  Many tracks (especially newer or obscure ones) still return no lyrics — the
  player shows a clean "Lyrics not available" state. The local `demoLyrics`
  dataset is **no longer the primary path**; it only helps if a future
  fallback is wired.
- **External links are a legal bridge, not playback**: YouTube / Spotify /
  Apple Music buttons open search URLs in a new tab. In-app audio is the full
  JioSaavn stream (resolved through Lyrica) — no in-app scraping of those
  services.
- **Recommendations engine not implemented**: Home shelves are curated static
  Telugu mood queries + a fixed Popular Artists list. There is no personalized
  recommendation system. (Out of scope.)
- **No social features**: No sharing, following, or collaborative playlists.
- **Telugu-only by design**: `normalize_query` biases every search toward Telugu.
  Non-Telugu queries are still biased (appended " telugu"), so the app is not a
  general music search.

## Backend / API limitations

- **Depends on a personal Lyrica instance** (`LYRICA_URL`, default
  `https://lyrica-jwtd.onrender.com`). That instance in turn pulls lyrics from
  LRCLib/MusicBrainz and audio from JioSaavn. If Lyrica is down or cold-starting
  (Render free tier), `/api/search` / `/api/song-details` may return `502` /
  `504`. The player degrades to a "Couldn't reach the music service" state and
  retries are user-initiated.
- **Stream URLs are CDN links, not identity**: A track is identified by a stable
  `id` (hash of `artist|title`), but its `streamUrl` is a JioSaavn CDN link
  resolved at play time and cached in-memory (TTL 6h). CDN links can in
  principle expire; the player re-resolves on the next play if needed.
- **`/api/search` artwork is best-effort**: search suggestions come from Lyrica
  `/suggestion` and are enriched with JioSaavn artwork/`perma_url` when titles
  match. When they don't match, search results fall back to a deterministic
  placeholder gradient (see `trackAdapter.placeholderArtwork`). The real cover
  still arrives when the track is played (song-details returns true artwork).
  `/api/trending` and `/api/lookup` use JioSaavn directly, so their artwork is
  usually present.
- **No caching layer for search**: each search hits Lyrica live (with in-memory
  song-details caching only). Repeated identical searches are not cached
  server-side.
- **`country`/locale is implicit**: results follow whatever Lyrica/JioSaavn
  return for the Telugu-biased query; not configurable per request.

## Persistence limitations

- Queue restore is **best effort** (see STORAGE.md / PLAYER_SYSTEM.md): exact
  `progress` is captured at unload, not continuously; restored sessions are
  paused (no autoplay, by browser policy).
- No schema migration for stored shapes; changing a stored model risks reading
  stale data (writers are defensive, but there is no migration path).
- ~5MB localStorage quota; large playlists (full Song objects) could, in
  theory, exceed it (errors are silently ignored).

## Performance notes

- Single shared `<audio>` element; low memory footprint.
- Search is debounced 350ms; Home "Popular Artists" fires 7 parallel
  `searchSongs` calls on mount (acceptable, but a cold Home does ~8 network
  requests). Could be optimized later.
- Lists render full `SongCard`/`TrackRow` components; very large grids are not
  virtualized (fine for typical Telugu result sizes, but not infinite-scroll
  safe).
- Framer Motion lifts/transitions are cheap; no heavy animation libraries.
- On every play, an async `/api/song-details` call resolves the stream + lyrics
  (a "Resolving full song…" state shows). A quick pause during resolution is
  respected (`wantPlayRef`).

## Stream-First Tradeoffs (NEW)

- **Album art appears from search result immediately** — the optimistic `current`
  update on play means artwork/title/artist show instantly from the user's
  selection. The backend `/api/stream` response may include different artwork
  (from JioSaavn metadata), but the frontend **never overwrites** the
  user-selected artwork/title/artist. Only `streamUrl` and `durationMs` are
  merged.
- **Lyrics may lag audio by a few seconds** — `/api/song-details` runs in the
  background after stream starts. The Lyrics tab shows a loading state until
  they arrive. This is intentional: audio must never wait on lyrics.
- **Prefetch is stream-only** — planned-next tracks are prefetched via
  `/api/stream` only. Lyrics are fetched on actual play. This keeps prefetch
  fast and bandwidth-light.
- **Retry logic is scoped to stream** — 504/502 on `/api/stream` retries once;
  lyrics failures only set `lyricsStatus = "unavailable"` and never affect
  playback.

## Real edge cases / bugs to be aware of

- **Restored track won't autoplay** — by design (browser policy). The user must
  press play; the saved position is re-applied once metadata loads.
- **Shuffle affects only subsequent tracks**: pressing Shuffle on a playing
  track keeps the current track, then shuffles the rest (Apple-style).
- **Deep link to a deleted playlist** (`/playlist?id=…` where the id was
  removed) → `PlaylistView` shows a "Playlist not found" state.
- **No auto-stop at end of a track unless `ended` fires**: `ended` → `goNext()`;
  with `repeat=off` and an empty queue, playback simply stops (isPlaying=false)
  rather than looping.
- **Spacebar handler** is global; it intentionally ignores focused
  INPUT/TEXTAREA/BUTTON/A, but a focused non-button element (e.g. a div with
  `tabindex`) would still capture Space for play/pause.
- **`Song.id` collisions are now unlikely but possible**: `id` is a 16-char SHA-1
  of `artist|title|album`. Two genuinely different tracks with identical
  artist+title+album would collide for likes/playlists/queue identity. Rare.
- **Artist / Album deep links — FIXED (name-based)**: artist/album browsing now
  navigates by `artistName` / `collectionName` (Lyrica/JioSaavn have no ids), and
  `/api/lookup` resolves by name (`type=artist|album`). The "Go to Artist" /
  "Go to Album" affordances render from `artistName` / `collectionName`, and
  `DetailView` resolves the name via `/api/lookup`. Deep-link URLs are
  `/artist?name=…` and `/album?name=…[&artist=…]`; on refresh they land on the
  right view. See ROUTING.md.
- **Album deep links are best-effort (metadata-dependent)**: `collectionName` is
  only populated when JioSaavn returns an album for the track, so the "Go to
  Album" affordance appears only for those tracks. `/api/lookup?type=album`
  searches by album name and filters to matching album metadata when present,
  otherwise it returns the raw album-name search results. Search/trending grids
  frequently carry no album, so album links are sparser than artist links (which
  always have `artistName`).
- **Artist pages are a filtered JioSaavn search, not a canonical catalog**:
  `/api/lookup?type=artist` searches `"<artist> telugu"` and keeps tracks whose
  artist fuzzy-matches the name; if none match it falls back to the raw results.
  It is best-effort browsing, not a verified artist discography.
- **Search covers may show placeholders**: see "Backend / API limitations"
  above — when JioSaavn enrichment doesn't match a `/suggestion` title, the grid
  shows the gradient placeholder until the track is played.
- **Stream-first tradeoff: lyrics may lag behind audio**: Because `/api/stream`
  fires first and `/api/song-details` runs in the background, lyrics and rich
  metadata (mood, album art from metadata) can appear seconds after playback
  starts. The UI shows the search-result artwork/title immediately (optimistic),
  so there's no visual "loading" gap for the user — but the Lyrics tab may show
  "Loading…" briefly after audio begins.
- **Stream-first tradeoff: rare bad-match risk**: The fast `/api/stream` path
  uses a JioSaavn search for "artist song" and takes the top match. In rare
  cases (ambiguous names, multiple versions) this could resolve a different
  recording than the user expects. The full `/api/song-details` resolution (with
  Lyrica lyrics/metadata) runs afterward and may correct metadata, but the
  stream URL itself won't be swapped once playback starts (to avoid audio
  glitches). This is an accepted tradeoff for sub-4s time-to-first-audio.
