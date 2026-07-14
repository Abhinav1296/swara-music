# Swara — Telugu Apple Music Clone

An Apple Music–style player focused **only on Telugu music**. Iterative build;
this first session delivers the full foundation, and the backend has since been
migrated to a **Lyrica + JioSaavn** proxy (full-track streaming + real lyrics),
replacing the old iTunes Search API.

## Stack
- **Backend:** Python + FastAPI — a clean, Telugu-biased proxy in front of a
  personal **Lyrica** instance (LRCLib/MusicBrainz lyrics + JioSaavn audio). No
  API key required.
- **Frontend:** React + Vite + Tailwind CSS + Framer Motion — an Apple Music
  look with heavy glassmorphism, dark by default.

## Layout
```
.
├── backend/      FastAPI app (Lyrica/JioSaavn proxy: search, trending,
│                 song-details, lookup, health)
└── frontend/     React + Vite app (UI, player, glass components)
```

## Quick start

```bash
# Terminal 1 — backend
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

The frontend dev server proxies `/api` → `http://localhost:8000`, so no CORS
or hard-coded URLs are needed in app code.

## What works (Phase 1)
- Search Telugu songs via the backend (`/api/search`).
- Trending Telugu list on the Home page (`/api/trending`).
- Apple Music–style layout: glass sidebar, top search bar, content area, and a
  frosted "Now Playing" bar.
- Beautiful song cards with hover lift + play button.

## What works (Phase 3)
- **Full-screen Now Playing view** — open from the mini bar (artwork, title, or
  the expand button). Large blurred-artwork backdrop, glass transport controls,
  seek + volume, shuffle/repeat, and an in-view "Up Next" list. Smooth
  spring open/close; Esc or the chevron minimizes back to the mini bar.
- **Custom Playlists (localStorage)** — create / rename / delete playlists and
  add/remove songs (via any track's "•••" menu → *Add to Playlist*). The Library
  shows Liked Songs + your playlists + Recently Played; each playlist has a
  detail page with Play All / Shuffle.
- **Persisted queue + current track** — the queue, current song, and position
  are saved to localStorage and restored on reload (no autoplay; press play to
  resume from the saved position).
- **Deep-link / routing** — the app boots from the URL (`/search?q=…`,
  `/artist?id=…`, `/album?id=…`, `/playlist?id=…`), so refreshes and shared links
  land on the right view; back/forward remain stable.
- **UI polish** — premium glass on the full-screen player, empty states for
  playlists, and consistent design tokens (`bg-white/5-10`, `border-white/10`,
  `rounded-2xl/3xl`, accent `#fa233b`).

## What works (Lyrica migration)
- **Full-track streaming** — on every play, `/api/song-details` resolves a real
  JioSaavn stream URL (not a 30s preview) and the single `<audio>` element plays
  it. A "Resolving full song…" state shows during resolution.
- **Real lyrics** — synced/plain lyrics from Lyrica/LRCLib render in the
  full-screen Lyrics tab (active line highlight + auto-scroll; tap a line to
  seek). When Lyrica has no lyrics, the player shows a clean "not available"
  state.
- See `docs/` (especially `ARCHITECTURE.md`, `API.md`, `PLAYER_SYSTEM.md`,
  `KNOWN_LIMITATIONS.md`) for the full picture.

### Known post-migration caveats
- **Artist / Album deep links work by name**: since Lyrica/JioSaavn have no ids,
  browsing navigates by `artistName` / `collectionName`. "Go to Artist" /
  "Go to Album" render from those fields; `/api/lookup?type=artist|album` resolves
  by name. Album links are best-effort (only when JioSaavn returns album metadata).
  See `docs/KNOWN_LIMITATIONS.md` / `docs/HANDOFF.md`.
- The app depends on a reachable Lyrica instance; if it's down or cold-starting,
  search/song-details may return 5xx and the player degrades gracefully.
