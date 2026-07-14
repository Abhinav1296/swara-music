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
  and an in-view **Up Next** list (`upcoming`; click to jump via `play`). The
  right panel also has **Lyrics** and **Video** tabs (see "Video tab" below).
- A resolving overlay (spinner + "Resolving full song…") appears over the artwork
  while `isResolvingStream`. If `streamError` is set, a glass pill explains the
  state ("Full song unavailable", "Track not found", "Couldn't reach the music
  service") and the external links remain as a fallback.

### Video tab (Video Song Mode)

The right panel has a third tab, **Video**, alongside Up Next and Lyrics
(neither existing tab is removed). It shows a music video for the current
track without ever breaking in-app audio playback.

Video source strategy (in priority order):
1. **Direct video URL** — if a (future) Lyrica payload carries a video URL field
   on `song.metadata` or `song` (checked defensively: `videoUrl` / `video_url` /
   `youtubeUrl` / `youtube_url` / `playable_url` / `stream_url_video`), that URL
   is embedded directly. Today's Lyrica `metadata.links` only exposes
   itunes/lastfm/musicbrainz/wikipedia, so this path is forward-compatible only.
2. **YouTube search embed** — otherwise the player builds
   `https://www.youtube.com/embed?listType=search&list=<query>` where `<query>`
   is `` `${trackName} ${artistName} telugu official video` `` (URL-encoded).
   This shows the top YouTube result for the track inside the app.

Audio coordination (the key invariant): **opening the Video tab pauses the
in-app `<audio>` element so the user never hears two sources at once.** The
player only auto-resumes audio if *it* paused it and the audio is still paused —
a manual play/pause by the user on the Video tab is always respected. Audio is
restored when the user switches away from the Video tab **or** closes the
full-screen player while on it.

Graceful fallback: if there is no track loaded, the tab shows a "Video
unavailable" card. YouTube may refuse to embed certain videos (region/owner
restrictions); in that case the iframe itself shows YouTube's own "Video
unavailable" state, and the panel always offers an **"Open on YouTube"** button
that opens the search in a new tab. No embed failure ever crashes the player.

`TrackMenu` gained a **"Play Video Song"** action that plays the track (so it
becomes `current`) and opens the full-screen player directly on the Video tab.
The requested tab is stashed in `pendingTabRef` (PlayerContext) and honored once
on open, so reopening the player keeps the last-used tab unless a tab was
explicitly requested.

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
- `components/FullScreenPlayer.jsx` — full-screen UI (+ lyrics + video + errors).
- `components/VideoPanel.jsx` — Video tab body (YouTube embed + fallback).
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

## Robustness additions (Playback Robustness + Lyrics Sync phase)

Added so auto-advance feels reliable even when Lyrica is cold/slow or a track
is missing. No UI redesign, no schema changes, queue/shuffle/repeat untouched.

### AbortController — skip cancels the in-flight resolve
`resolveAndPlay` keeps one `abortControllerRef`. Before starting a NEW resolve it
aborts the previous controller and starts a fresh `AbortController`, passing
`signal` to `getSongDetails` (which forwards it to `getJson` → `fetch`). This
actually kills the network request (the token guard remains a second safety).
`getSongDetails({ artist, song, url, signal })` is the new signature. If the
fetch rejects with `AbortError`, the catch logs `[Swara] resolve aborted` and
does **NOT** set `streamError` — a skip is not a failure.

### Retry on 504 / timeout
A `504` (or any error whose message matches `/timed out/i`) is retried **once**
after a 1500–2500 ms backoff, reusing the same token guard (a newer resolve
aborts the retry mid-backoff). If the retry also fails, it falls through to the
definitive-failure path below.

### Auto-skip on definitive failure
A `404` (`/not found/i`) or a failed timeout is definitive: `streamError` is set
(`"not_found"` / `"upstream"`) and, **if `upcoming` is non-empty**,
`goNextRef.current()` is called immediately so the user is never stranded on a
dead track. When `upcoming` is empty the error stays and `FullScreenPlayer`
renders a glass error panel with a **Retry** button (calls `retry()`, which
re-resolves the current track). A chain of 404s walks the queue until it empties.

### Prefetch Next (instant auto-advance)
- `prefetchCacheRef` is an in-memory `Map` keyed by `trackKey(track)` =
  `artistName|trackName` (lowercased) → `{ song, lyrics }` (already normalized,
  so it can be applied with zero network wait).
- `schedulePrefetch()` runs after every successful play/next/prev/restore. It
  picks the next planned track: **shuffle OFF** → `upcoming[0]`; **shuffle ON** →
  `plannedNextRef.current` (the pre-decided next — see below). It fires
  `prefetchTrack` after a 600–1000 ms delay (so it never competes with the
  current track's resolve) and caps in-flight prefetches at 2 (own
  AbortControllers in `prefetchControllersRef`, so a skip does NOT abort them).
- `applyPrefetched(track, autoplay)` is tried **before** `resolveAndPlay` in
  `play`/`goNext`/`goPrev`. If a cached entry exists it sets `current`/lyrics/
  `audio.src` and plays **immediately** (no spinner). The prefetch cache is
  separate from `inflightRef` (the dedupe map for play resolves) so the two
  never interfere.

### Shuffle-safe planned-next
`plannedNextRef` holds the pre-decided next track in shuffle mode. It is chosen
**once** when a track starts (`play`) or after each shuffle advance (`goNext`),
from the live pool (`played + upcoming`), and **reused** on `ended`/manual Next
so the shuffle pointer never rerolls mid-list (fixes repeat/wrong-song drift).
`goNext` falls back to a fresh roll only if the planned track has left the pool.

### Lyrics sync polish (FullScreenPlayer)
- Timed lyrics hook to `progress` (driven by the audio `timeupdate`); the active
  line is `resolveActiveLine(lines, progress)` — deterministic, no jitter.
- Auto-scroll is **throttled**: it fires only when the active index actually
  changes, at most one smooth `scrollIntoView({behavior:'smooth', block:'center'})`
  per ~250 ms; line changes faster than that get a non-animated jump so we never
  stack animations or fall behind. Re-runs when the Lyrics tab opens so it lands
  on the current line.
- Click-to-seek is ms-accurate: `seek(Math.max(0, l.time))` sets
  `audio.currentTime` directly (timed lines carry `time` in seconds; plain lines
  are not seekable). Missing lyrics still show the premium "Lyrics not available"
  state and never block playback.
