# Player System

Owned by `context/PlayerContext.jsx`. One shared `<audio>` element, a three-part
queue model, and localStorage persistence. This is the highest-traffic and most
stateful part of the app — read it carefully before changing playback.

## State (exposed via `usePlayer()`)

```
current:  Song | null      // track playing now
upcoming: Song[]           // queued after current (Play Next inserts here)
played:   Song[]           // history before current (for prev / shuffle pool)
isPlaying: boolean         // STRICTLY mirrors <audio> element state via event listeners
isBuffering: boolean       // true when audio is waiting for data (waiting/playing events)
progress:  number          // seconds (UI display)
duration:  number          // seconds (UI display)
volume:   number           // 0..1 (persisted)
shuffle:  boolean          // persisted (as string)
repeat:   "off" | "all" | "one"   // persisted
queueOpen: boolean         // QueuePanel visibility
fullscreen: boolean        // FullScreenPlayer visibility

// Async stream resolution (stream-first architecture)
isResolvingStream: boolean // true while /api/stream is in flight
streamError: null | "no_stream" | "not_found" | "upstream"
lyrics:   { kind, lines, plain, source } | null  // resolved synced/plain lyrics
lyricsStatus: "idle" | "loading" | "available" | "unavailable"
```

## Queue model: current / upcoming / played

```
[ played … ]  [ current ]  [ upcoming … ]
```

- `play(song, contextList)`: sets `current = song`, `upcoming = contextList[idx+1:]`,
  `played = contextList[:idx]`, `isPlaying = true`, records recently played, then
  kicks off async stream resolution. If you click the already-current song, it
  toggles play/pause instead.
- `playNext(song)`: unshifts onto `upcoming` (plays immediately after current).
- `addToQueue(song)`: appends to `upcoming`.
- `removeFromQueue(index)` / `clearQueue()`: operate on `upcoming` only.

### goNext() (pseudo-code)
```
goNext():
  if repeat == "one":
      audio.currentTime = 0; play(); return          # replay same track
  if shuffle:
      pool = played + upcoming
      if pool empty:
          if repeat == "all": restart current
          else: stop (isPlaying=false); return
      pick = random from pool
      remove pick from played|upcoming; set current=pick; resolve+play
      return
  # sequential
  if upcoming not empty: shift one into current, push old current to played; resolve+play
  elif repeat == "all": rebuild from played+current; resolve+play
  else: stop
```

### goPrev() (pseudo-code)
```
goPrev():
  if audio.currentTime > 3: audio.currentTime = 0; return   # restart
  if played not empty: pop last played → current; push old current to front of upcoming; resolve+play
  elif audio: audio.currentTime = 0                          # just restart
```

### On track end (`ended` event)
`goNext()` is called via `goNextRef.current()` so it always sees fresh state.

## Stream-First Architecture (NEW)

This phase moves Swara to a **stream-first, lyrics-later** model. The key principle:
**audio must never wait on lyrics or metadata**. The `<audio>` element state is the
single source of truth for `isPlaying`/`isBuffering`.

### Flow: Play → Resolve Stream → Play Audio → (Background) Resolve Lyrics → Merge

```
User clicks track
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. IMMEDIATELY set `current` = user-picked track metadata   │
│    (optimistic UI — art/title/artist show instantly from    │
│    search results, no flash)                                 │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FIRE /api/stream (fast, stream-only) with AbortController│
│    • Returns: { status, stream_url, artist, title, album,   │
│      artwork, durationMs, source }                           │
│    • Timeout budget: <4s p95, hard 10s                       │
│    • 504/502 → retry once after 1.5–2.5s                     │
│    • 404/not_found → auto-skip if upcoming has items         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼ (when stream_url arrives)
┌─────────────────────────────────────────────────────────────┐
│ 3. Set audio.src = stream_url                               │
│    audio.load()                                              │
│    if (autoplay && wantPlayRef.current) audio.play()        │
│    Merge ONLY safe fields into `current`:                   │
│      • streamUrl, durationMs, hasFullStream                  │
│    NEVER overwrite: title, artist, artwork (user's selection)│
└─────────────────────────────────────────────────────────────┘
      │
      ▼ IMMEDIATELY (non-blocking)
┌─────────────────────────────────────────────────────────────┐
│ 4. FIRE /api/song-details in BACKGROUND (separate AbortCtrl)│
│    • Returns full SongDetails: lyrics, mood, metadata       │
│    • On success: merge lyrics/mood/metadata into `current`  │
│      and `lyrics` state                                     │
│    • On failure: lyricsStatus = "unavailable", audio UNTOUCHED│
└─────────────────────────────────────────────────────────────┘
```

### Audio Event Bindings — `isPlaying` Mirrors `<audio>` Exactly

`isPlaying` and `isBuffering` are **derived from native audio events**, never set
speculatively:

| Event        | `isPlaying` | `isBuffering` |
|--------------|-------------|---------------|
| `play`       | `true`      | `false`       |
| `playing`    | `true`      | `false`       |
| `pause`      | `false`     | `false`       |
| `ended`      | `false`     | `false`       |
| `waiting`    | unchanged   | `true`        |
| `error`      | `false`     | `false`       |

This guarantees the play/pause icon **can never desync** from actual audio state
(tab switch, autoplay block, output device unplugged, etc.).

### Skip (Next/Prev)

- Abort in-flight stream + lyrics requests for the previous track (`AbortController.abort()`)
- Start the same stream-first flow for the new track
- Token guards (`resolveTokenRef`) ignore stale responses after new resolves begin

### Prefetch Planned-Next (Stream-Only)

- Prefetch ONLY via `/api/stream` (fast). **Never prefetch lyrics.**
- Store result in `prefetchCacheRef` keyed by stable `artist|title`
- **Never mutate `current` from prefetch**
- On actual `goNext()`, if prefetched `stream_url` exists, use it instantly

### Retry / Auto-Skip Rules (Scoped to `/api/stream`)

| Condition          | Action                                    |
|--------------------|-------------------------------------------|
| 504 / timeout      | Retry once after 1.5–2.5s                 |
| 502 / upstream     | Retry once after 1.5–2.5s                 |
| 404 / not_found    | Auto-skip if `upcoming.length > 0`        |
| Any failure        | Never corrupt queue; show glass error + Retry only if truly stuck |

### `isBuffering` Derived State

Exposed via `usePlayer()` for UI spinners. True during `waiting`, false on
`playing`/`canplay`. The mini bar and full-screen player can show a subtle
buffering indicator without ever blocking on lyrics.

## Async stream resolution (stream-first architecture)

Playback uses **stream-first, lyrics-later** architecture. On every play (and on
`goNext` / `goPrev` / restore):

1. **Optimistic UI**: immediately set `current` to the clicked track's metadata
   (title/artist/artwork from search result show instantly) and
   `isResolvingStream = true`.
2. **Fast stream resolution**: fire `GET /api/stream?artist=...&song=...` FIRST
   (with `AbortController`). This endpoint returns ONLY `stream_url` + minimal
   metadata (artist, title, album, artwork, durationMs) — no lyrics, no mood.
   Target: <4s p95.
3. **On `stream_url` arrival**:
   - Set `audio.src = stream_url`
   - Call `audio.play()` if user intended to play
   - Merge ONLY safe fields into `current`: `streamUrl`, `durationMs`,
     `hasFullStream`. **Never overwrite** `title`, `artist`, `artwork`,
     `album` from the user's original selection.
4. **IMMEDIATELY after starting stream**, fire `GET /api/song-details` in the
   background (separate `AbortController`) for lyrics/mood/rich metadata.
   - When it returns: attach lyrics/mood/metadata to `current` and `lyrics` state.
   - If it fails: `lyricsStatus = "unavailable"`, do not touch audio.
   - Do NOT overwrite `title`/`artist`/`artwork` with potentially mismatched values.
5. **Error handling** (scoped to `/api/stream`):
   - 504/timeout → retry once after ~1.5–2.5s
   - 404/not_found → auto-skip if `upcoming` has items; otherwise show glass error + Retry
   - Never corrupt queue on failure.

Resilience details:
- **Dedupe**: identical in-flight resolves (same `artist|title`) are reused.
- **Stale guard**: a token is bumped on each new resolve; late responses for a
  superseded track are ignored (rapid skips never apply stale src).
- **Pause during resolve**: `wantPlayRef` flag means a quick pause while the
  request is in flight is respected (track won't auto-start on arrival).
- The `<audio>` element uses `crossOrigin="anonymous"` so the CDN stream can be
  analysed if needed; playback itself needs no CORS.

## Audio-event-bound UI state (critical)

`isPlaying` and `isBuffering` **strictly mirror the `<audio>` element** via
event listeners — they can never desync from reality.

Event bindings (wired once in `useEffect`):
- `play` → `isPlaying = true`, `isBuffering = false`
- `playing` → `isPlaying = true`, `isBuffering = false`
- `pause` → `isPlaying = false`, `isBuffering = false`
- `ended` → `isPlaying = false`, `isBuffering = false` → calls `goNext()`
- `waiting` → `isBuffering = true` (stalled for data)
- `error` → `isPlaying = false`, `isBuffering = false`, `streamError = "upstream"`

This means:
- The play/pause icon in NowPlayingBar and FullScreenPlayer **always** reflects
  the true audio state (test: unplug headphones mid-play, switch tabs, hit
  autoplay block).
- `isBuffering` drives any spinner/loading indicator during rebuffer.

## play / pause / seek / volume

- `toggle()`: play/pause the single `<audio>`. If there is no `src` yet (still
  resolving), it triggers `resolveAndPlay(current, true)` and returns.
  `audio.play()` is wrapped in `.catch(() => setIsPlaying(false))` because
  browsers reject autoplay without a gesture.
- `resolveAndPlay(...)` (not `current`) sets `audio.src` and plays — see above.
- `seek(value)`: sets `audio.currentTime` and the progress display.
- `setVolume(v)`: clamped 0..1; a separate effect syncs `audio.volume`.
- Shuffle/repeat are plain state toggles (`cycleRepeat` cycles off→all→one→off).
  Shuffle only affects *subsequent* tracks (matches Apple's "Shuffle" button).

## Persistence + restore rules

- Saved under `swara:queue` as `{ current, upcoming, played, progress }`.
- **On mount** (`restoredRef`): load saved snapshot; if `current` exists, set
  `current/upcoming/played` and stash `progress` in `pendingSeekRef`, then call
  `resolveAndPlay(saved.current, false)` so stream + lyrics load but the session
  stays **paused** (no autoplay, per browser policy). The user presses play to
  resume.
- `pendingSeekRef` is applied in `onLoadedMeta`: once the restored track's
  metadata loads, `audio.currentTime = progress`.
- The queue is re-saved whenever `current/upcoming/played` change **after** the
  initial restore (gated by `restoredRef` so we never overwrite storage with the
  empty initial queue).
- A `beforeunload` listener also saves the latest `{current,upcoming,played,
  progress: progressRef.current}` so the exact position survives a hard close.
- Preferences (`volume`, `shuffle`, `repeat`) each save on change.

## Full-screen player

- `FullScreenPlayer.jsx` is a portal at `z-[80]`; it reads the same `usePlayer()`
  state. Rendered by `App.jsx` alongside `NowPlayingBar`/`QueuePanel`.
- Open: `openFullscreen()` (from mini bar artwork/title/expand button).
  Close: chevron-down or `Esc` (`closeFullscreen()`) — returns to the mini bar.
- Shows: large blurred-artwork backdrop, big cover, title/artist + LikeButton,
  seek bar (gradient fill), transport (shuffle/prev/play/next/repeat), volume,
  and an in-view **Up Next** list (`upcoming`; click to jump via `play`).
- A resolving overlay (spinner + "Resolving full song…") appears over the artwork
  while `isResolvingStream`. If `streamError` is set, a glass pill explains the
  state ("Full song unavailable", "Track not found", "Couldn't reach the music
  service") and the external links remain as a fallback.

## Important edge cases

- **Autoplay policy**: restored tracks never autoplay; `play()` from a user
  click is the only autoplay path. Any `audio.play()` rejection flips
  `isPlaying` to false.
- **preload="none"**: the `<audio>` does not buffer until `src` is set by
  `resolveAndPlay`. Metadata (duration) arrives asynchronously — seek-before-metadata
  in `pendingSeekRef` is tolerated via try/catch.
- **Stale closures**: `goNext`/`toggle` read queue state through `transportRef`
  (mirrored every render) and `ended` uses `goNextRef`; do not inline stale
  state into these handlers.
- **Spacebar**: global keydown toggles play/pause, but is ignored when focus is
  on INPUT/TEXTAREA/BUTTON/A/contentEditable (so native Space activation wins).
- **Repeat one**: rewinds and replays the same `current`; does not advance.
- **Shuffle with empty pool + no repeat**: stops playback (isPlaying=false).
- **No current track**: transport/seek/volume buttons are disabled in the UI.
- **No stream / no lyrics**: the player degrades gracefully (see above) rather
  than crashing; the user can still open external links.

## Files to touch for player changes
- `context/PlayerContext.jsx` — all state + logic (incl. async resolve).
- `components/NowPlayingBar.jsx` — mini bar UI (+ resolving/error hints).
- `components/FullScreenPlayer.jsx` — full-screen UI (+ lyrics + errors).
- `components/QueuePanel.jsx` — slide-in Up Next.
- `utils/storage.js` — `swara:queue` / `swara:volume` / `swara:shuffle` /
  `swara:repeat` keys.
- `utils/trackAdapter.js` — `normalizeTrack` / `normalizeLyrics` (backend → UI
  mapping + placeholder art + synced→seconds conversion).
- `api/client.js` — `searchSongs`, `getTrending`, `getShelf`, `getSongDetails`.

## Lyrics + external links

### Lyrics module (`src/lyrics/lyrics.js`)
- `parseLRC(text)` → `TimedLine[]` (time in seconds, sorted); supports multiple
  tags per line and `[mm:ss.xx]` / `[mm:ss.xxx]`.
- `resolveActiveLine(lines, currentTime)` → index of the last line with
  `time <= currentTime`, or -1. Drives the karaoke highlight.
- `loadLyrics(song)` still exists (local demo fallback) but is no longer the
  primary path.

### Lyrics resolution (real, via Lyrica)
- On every play, `getSongDetails` returns `lyrics.synced` (`{timeMs, text}[]`)
  and/or `lyrics.plain`. `normalizeLyrics` converts `timeMs` → seconds and
  produces `{ kind: 'timed' | 'plain', lines, plain, source }`.
- `PlayerContext` stores this as `lyrics` / `lyricsStatus`; `FullScreenPlayer`
  reads it (no separate fetch on tab open). Loading/available-synced/plain/
  unavailable all render distinctly.
- Active line highlights; the container auto-scrolls it to center; tapping a
  line calls `seek(time)`.

### External links (`src/utils/externalLinks.js`)
- `buildExternalLinks(song)` → `{ youtube, spotify, apple }` search URLs from
  `trackName + artistName`. Shown as `Open In` in TrackMenu and as pills in the
  full-screen player; opened in a new tab (`noopener,noreferrer`). They are a
  legal bridge — in-app audio is now the **full JioSaavn stream**, not a preview.
