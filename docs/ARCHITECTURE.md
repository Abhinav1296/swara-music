# Architecture

Swara is an Apple Music–style, **Telugu-only** music player. It is a small
two-package monorepo: a thin FastAPI proxy in front of a personal **Lyrica**
instance, and a React SPA that does all rendering / playback / persistence
client-side. There is **no database, no auth, and no user accounts**.

The backend is now a **Lyrica proxy**: Lyrica supplies lyrics + metadata (from
LRCLib / MusicBrainz) and full-length audio streams (from JioSaavn). The iTunes
Search API is **no longer used** — playback is full tracks, not 30s previews.

## Monorepo layout

```
apple clone/
├── backend/                 FastAPI app (Lyrica/JioSaavn proxy)
│   ├── app/
│   │   ├── main.py          FastAPI app + CORS + / health + /api/health
│   │   ├── config.py        env-driven settings
│   │   ├── schemas.py       Pydantic response models (Song/Search/Lookup)
│   │   ├── routes/search.py /api/health, /api/search, /api/trending,
│   │   │                     /api/song-details, /api/lookup
│   │   └── services/lyrica.py  Lyrica integration + Telugu bias + normalize
│   └── requirements.txt     fastapi, uvicorn, httpx, python-dotenv
├── frontend/                React 18 + Vite + Tailwind + Framer Motion
│   ├── src/
│   │   ├── api/client.js        fetch wrapper for /api
│   │   ├── components/          UI components (one file per component)
│   │   ├── context/             React Context providers (state)
│   │   ├── hooks/               useRecentSearches
│   │   ├── utils/               storage.js, format.js, trackAdapter.js,
│   │   │                       externalLinks.js
│   │   ├── lyrics/              lyrics.js (LRC parser) + demoLyrics.js
│   │   └── App.jsx              provider composition + view switch
│   ├── index.html, tailwind.config.js, vite.config.js
└── docs/                    this documentation set
```

There is **no shared types package** — the frontend treats the Lyrica payload
as a plain object ("Song") and does not import the backend Pydantic models.

## Tech stack

| Layer    | Choice                    | Notes                                            |
|----------|---------------------------|--------------------------------------------------|
| Backend  | FastAPI (Python 3.10+)    | Async; `/docs` Swagger UI at :8000              |
| Proxy    | httpx (async)             | Calls Lyrica (`/lyrics/`, `/api/jiosaavn/*`)     |
| Frontend | React 18 + Vite 5         | SPA, no SSR                                     |
| Styling  | Tailwind CSS 3            | Glassmorphism via `@layer components` in CSS     |
| Motion   | Framer Motion 11          | View transitions, modals, Now Playing expand     |
| State    | React Context (no Redux)  | One provider per concern (see below)            |
| Persist  | localStorage              | likes, recents, playlists, queue, prefs         |

Dependencies did not change between the iTunes era and the Lyrica migration.

## Request flow (UI → FastAPI → Lyrica → UI)

```
React component
  → api/client.js  (fetch(`${BASE}/search?q=…`))
  → Vite dev proxy /api → http://localhost:8000  (vite.config.js)
  → FastAPI route  (/api/search)
  → services/lyrica.py  (normalize_query + httpx → Lyrica /suggestion)
  → Lyrica /suggestion → list of song titles/artists (Telugu-biased)
  → best-effort JioSaavn enrichment for artwork + perma_url
  → FastAPI returns { query, count, results }        (SearchResponse)

Per-track playback (resolves stream + lyrics):
React PlayerContext.resolveAndPlay(track)
  → api/client.js GET /api/song-details?artist=…&song=…[&url=…]
  → services/lyrica.py:
       1) Lyrica /lyrics/  → synced/plain lyrics + metadata
       2) JioSaavn search (or perma_url) + /api/jiosaavn/play → streamUrl
  → FastAPI returns SongDetails { streamUrl, lyrics, … }
  → frontend sets audio.src = streamUrl; on play, audio streams the full track
```

- `BASE` = `import.meta.env.VITE_API_BASE || "/api"`. In dev, Vite proxies
  `/api` to the FastAPI server (see `vite.config.js`), so **no CORS config is
  needed in the browser** (CORS is still enabled server-side for non-proxied use).
- **Playback goes through the backend (indirectly)**: the `<audio>` element
  plays the JioSaavn **CDN stream URL** returned by `/api/song-details`. The
  browser loads that CDN URL directly (no CORS needed for `<audio>` playback);
  the backend only *resolves* the URL.

## Context providers and responsibility

Provider composition (in `src/App.jsx`):

```
<LibraryProvider>          // liked songs + recently played (localStorage)
  <PlaylistProvider>       // custom playlists (localStorage)
    <RouterProvider>       // current route + history (no router lib)
      <PlayerProvider>     // audio engine + queue + prefs + fullscreen
        <Shell/>
```

| Provider        | File                          | Owns                                            | Consumers |
|-----------------|-------------------------------|-------------------------------------------------|-----------|
| LibraryProvider | context/LibraryContext.jsx    | `likedMap`, `recent[]`, toggleLike, addRecentlyPlayed | PlayerContext, LibraryView, LikeButton, TrackMenu, SongCard, TrackRow |
| PlaylistProvider| context/PlaylistContext.jsx   | `playlists[]`, CRUD + add/remove song          | LibraryView, PlaylistView, TrackMenu |
| RouterProvider  | context/RouterContext.jsx     | `route {name, params}`, navigate, history sync  | App (switch), Sidebar, MobileNav, TopBar, all *View, TrackMenu |
| PlayerProvider  | context/PlayerContext.jsx     | `current/upcoming/played`, isPlaying, progress, duration, volume, shuffle, repeat, queueOpen, fullscreen, the `<audio>` element, async stream resolution | NowPlayingBar, FullScreenPlayer, QueuePanel, SongCard, TrackRow, *View |

Notes:
- `PlayerProvider` calls `useLibrary()` (`addRecentlyPlayed`) — it must sit
  **inside** `LibraryProvider` (it does).
- All three `useLibrary` / `usePlaylists` / `usePlayer` / `useRouter` hooks
  `throw` if used outside their provider.

## Audio playback architecture

- A **single** `<audio ref={audioRef} preload="none" crossOrigin="anonymous" />`
  is rendered by `PlayerProvider` (at the end of its tree, after children).
  There is never more than one audio element.
- On play (`play()` / `goNext` / `goPrev` / restore), `resolveAndPlay(track,
  autoplay)` optimistically sets `current` to the track's metadata, then fetches
  `/api/song-details`. On success it merges the resolved `streamUrl`,
  `artwork`, `durationMs`, and `lyrics` into `current` (preserving `id`), sets
  `audio.src = streamUrl`, and (if the user intended to play) calls
  `audio.play()`. If the resolved track has no stream, it sets a graceful
  `streamError` and does not crash the queue.
- Transport events are wired **once** (`timeupdate`, `loadedmetadata`, `ended`)
  and call stable handlers. Because those handlers must read the latest queue
  state, the live state is mirrored into `transportRef.current` every render,
  and `ended` calls `goNextRef.current()` (also a ref) to avoid stale closures.
- A separate `restore` effect reads the saved queue from localStorage on mount
  (best-effort) and sets `current/upcoming/played`; a `restoredRef` guard
  prevents the queue-save effect from overwriting storage with an empty queue
  before restore completes. The restored session loads **paused** (browser
  autoplay policy); the user presses play to resume.
- Position persistence: `progressRef` tracks `audio.currentTime` on every
  `timeupdate`; the queue is saved on change **and** on `beforeunload`. The
  exact resume position is re-applied in `onLoadedMeta` after a reload.

## Why these design choices exist

- **Proxy instead of direct Lyrica calls**: avoids CORS in the browser, centralizes
  the Telugu bias + artwork/stream enrichment server-side, and maps Lyrica
  failures into proper HTTP statuses (504 timeout, 502 upstream, 404 not found).
- **Telugu bias in the proxy** (`normalize_query`): keeps the catalog on-topic
  by appending " telugu" unless the user already used a Telugu indicator or
  Telugu script.
- **No router library**: the app is small; `RouterContext` gives named routes +
  history with ~60 lines and no dependency.
- **Context over Redux/Zustand**: four independent concerns, all client-side;
  Context is enough and keeps the bundle small.
- **localStorage over a backend DB**: no accounts, no sync; "likes" and
  playlists are private to the device. This is intentional (see
  KNOWN_LIMITATIONS.md).
- **Full JioSaavn streams (not 30s previews)**: the migration's whole point — the
  backend resolves real stream URLs via Lyrica, and the `<audio>` element plays
  them. The previous iTunes `previewUrl` path is gone.

See PLAYER_SYSTEM.md, ROUTING.md, STORAGE.md, API.md, and DATA_MODELS.md for
deep dives.
