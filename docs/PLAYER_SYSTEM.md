# Player System

Owned by `context/PlayerContext.jsx`. One shared `<audio>` element, a three-part
queue model, and localStorage persistence. This is the highest-traffic and most
stateful part of the app — read it carefully before changing playback.

## State (exposed via `usePlayer()`)

```
current:  Song | null      // track playing now
upcoming: Song[]           // queued after current (Play Next inserts here)
played:   Song[]           // history before current (for prev / shuffle pool)
isPlaying: boolean
progress:  number          // seconds (UI display)
duration:  number          // seconds (UI display)
volume:   number           // 0..1 (persisted)
shuffle:  boolean          // persisted (as string)
repeat:   "off" | "all" | "one"   // persisted
queueOpen: boolean         // QueuePanel visibility
fullscreen: boolean        // FullScreenPlayer visibility

// Async stream resolution (post-Lyrica)
isResolvingStream: boolean // true while /api/song-details is in flight
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

## Async stream resolution (the key change)

Playback no longer uses 30s iTunes previews. On every play (and on `goNext` /
`goPrev` / restore), `resolveAndPlay(track, autoplay)` runs:

1. Optimistically set `current` to the clicked track's metadata (title/art show
   instantly) and `isResolvingStream = true`.
2. `GET /api/song-details?artist=<artist>&song=<title>` (passing `jiosaavnUrl`
   when the search result carried one, to skip a JioSaavn search hop).
3. On success: merge the resolved `streamUrl` / `artwork` / `durationMs` /
   `hasFullStream` into `current` (preserving `current.id`), store the normalized
   `lyrics` + `lyricsStatus`, set `audio.src = streamUrl`, and (if the user
   intended to play) `audio.play()`.
4. On no stream: set `streamError = "no_stream"`, do not play, keep queue intact.
5. On failure (404/502/504): set `streamError` (`"not_found"` / `"upstream"`),
   clear `lyricsStatus`, do not crash the queue.

Resilience details:
- **Dedupe**: identical in-flight resolves (same `artist|title`) are reused.
- **Stale guard**: a token is bumped on each new resolve; late responses for a
  superseded track are ignored (so skipping quickly never applies a stale src).
- **Pause during resolve**: a `wantPlayRef` flag means a quick pause while the
  request is in flight is respected (the track won't auto-start on arrival).
- The `<audio>` element uses `crossOrigin="anonymous"` so the CDN stream can be
  analysed if needed; playback itself needs no CORS.

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
