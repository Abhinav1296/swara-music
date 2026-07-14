# Features

What is actually built and working. Phases are historical milestones; the
current app is the union of all three.

## Phase 1 — Foundation
- Search Telugu songs via `/api/search` (debounced live search in the top bar).
- Trending Telugu list powers the Home hero + first shelf.
- Apple Music–style layout: glass sidebar (desktop), top search bar, content
  area, frosted Now Playing bar (mobile + desktop).
- Song cards with hover lift + play button.
- 30-second preview playback via a single `<audio>` element; seekable progress
  bar; volume; mute.
- Library: Liked Songs (collection of liked tracks) + Recently Played.
- Like/unlike any song (heart), persisted to localStorage.
- Artist + Album detail pages (resolved via `/api/lookup`).
- Mobile bottom tab nav.

## Phase 2 — Player polish
- Queue model: Play Next / Add to Queue from any track's "•••" menu.
- Slide-in "Up Next" panel (`QueuePanel`) with per-track remove + Clear.
- `PlayerContext` with shuffle, repeat (off/all/one), volume persistence.
- Spacebar play/pause (ignored when a control/field is focused).
- Premium Home shelves (moods) + Popular Artists row.

## Phase 3 — Premium UX (current)
- **Full-screen Now Playing view** (`FullScreenPlayer`): open from the mini
  bar (click artwork, click title, or the expand button). Large blurred-artwork
  backdrop, glass transport controls, seek + volume, shuffle/repeat, and an
  in-view "Up Next" list. Spring open/close; Esc or chevron minimizes.
- **Custom Playlists** (localStorage): create / rename / delete; add/remove
  songs via any track's "•••" → "Add to Playlist". Library shows Liked Songs +
  your playlists + Recently Played. Playlist detail page has Play All / Shuffle.
- **Persisted queue + current track**: restored on reload (best effort, no
  autoplay; press play to resume from saved position).
- **Deep-link / routing boot**: app boots from the URL for
  `/search?q=`, `/artist?id=`, `/album?id=`, `/playlist?id=`; back/forward stable.
- **UI polish**: full-screen glass, playlist empty states, consistent tokens.
- **External full-song links (legal bridge)**: TrackMenu and the full-screen
  player offer an `Open In` submenu / pills — YouTube, Spotify, Apple Music —
  that open search URLs built from track name + artist in a new tab. No in-app
  full-track streaming.
- **Lyrics foundation**: a lyrics module with LRC parsing, plain/timed types,
  and an active-line resolver. The full-screen player has a Lyrics tab
  (loading / available / unavailable) with active-line highlight, auto-scroll,
  and click-to-seek. Local demo lyrics load by track id / title match; no
  scraping.

## What works now (summary)
- Search, Home shelves, Trending, Artist/Album detail, Library, Playlists.
- Full player: play/pause/next/prev/seek/volume/shuffle/repeat.
- Mini bar + full-screen player + Up Next panel.
- Likes, recently played, playlists — all survive reload.
- Queue + current track + position survive reload (best effort).
- External links (YouTube / Spotify / Apple Music) from any track and the
  full-screen player; a Lyrics tab with local demo data.

## User flows

### Search
1. Type in the top bar → debounced (350ms) live `/api/search` → SearchView.
2. Enter or click a suggestion/recent → `navigate("search", {q})` (history
   replaced if already on search) → term saved to recent searches.
3. Click a song → `play(song, results)`.

### Play (single / context)
- Click a `SongCard` or `TrackRow` → `play(song, list)` where `list` is the
  section/album/playlist the card lives in. The clicked song becomes `current`
  and the rest of `list` becomes `upcoming`.

### Like
- Click the heart (`LikeButton`) on any card/row → `toggleLike(song)`.
  Liked songs feed the "Liked Songs" collection in Library.

### Playlist
- Library → "New" → name modal → `createPlaylist(name)` → navigates to the new
  playlist.
- Any track's "•••" → "Add to Playlist" → pick a playlist (or "New Playlist…").
- Open a playlist → Play All (`play(songs[0], songs)`) or toggle Shuffle.
- Playlist "•••" → Rename / Delete (delete has a confirm step).
- Playlists are stored as full Song objects (no id-only lookup), so playback is
  instant and works offline.

### Queue
- "•••" → "Play Next" (`playNext`) inserts right after current; "Add to Queue"
  (`addToQueue`) appends to the end.
- Mini bar queue button → `QueuePanel` (slide-in). Full-screen player shows its
  own Up Next list. Per-track remove + Clear available in `QueuePanel`.

### Full-screen player
- Open: click artwork/title or expand button in the mini bar →
  `openFullscreen()`.
- Controls: seek, volume, shuffle, repeat, prev/next, like, Up Next list.
- Close: chevron-down or `Esc` → `closeFullscreen()` (returns to mini bar).

### Deep links
- Open `/artist?id=123&name=...` or `/playlist?id=...` directly (or refresh any
  view) → `RouterContext.routeFromLocation()` parses the URL on boot → correct
  view renders; history is seeded so Back works.

### External links
- Any track's `•••` → `Open In` → YouTube / Spotify / Apple Music opens the
  service in a new tab (search by track name + artist). The full-screen player
  also shows these as pills under the volume control.

### Lyrics
- Full-screen player → `Lyrics` tab → loads demo lyrics if a track id / title
  match exists. The active line highlights and auto-scrolls with playback; tap
  a timed line to seek the preview. No match → `Lyrics not available`.
