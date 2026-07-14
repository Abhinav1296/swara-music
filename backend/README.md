# Swara Lyrica — Backend (FastAPI)

A thin, Telugu-biased proxy in front of a personal **Lyrica** instance
(https://github.com/.../lyrica), which in turn pulls lyrics/metadata from
LRCLib / MusicBrainz and full-length audio streams from JioSaavn.

The iTunes Search API is **no longer used** — playback is full tracks, not
30-second previews.

## Features
- `GET /api/health` — liveness probe.
- `GET /api/search?q=...` — Telugu-biased song search (Lyrica `/suggestion`,
  enriched best-effort with JioSaavn artwork + `perma_url`).
- `GET /api/trending` — popular Telugu tracks for the Home page (JioSaavn-backed;
  an optional `q` selects a mood shelf).
- `GET /api/song-details?artist=...&song=...[&url=...]` — resolve a track into a
  full-length stream URL + synced/plain lyrics + metadata. Called by the player
  on every play.
- `GET /api/lookup?artist=...` — best-effort artist/album lookup (JioSaavn search
  by artist name).
- CORS enabled for the React dev server.
- Clean JSON: canonical Swara fields (`title`, `artist`, `artwork`, `streamUrl`,
  `hasFullStream`, …) **and** legacy aliases (`trackName`, `artistName`,
  `artworkUrl100/600`, `previewUrl`, `trackTimeMillis`, …).

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000/docs or http://localhost:8000/api/trending.

## Notes
- No API key is required — the app talks to your (free) Lyrica instance, which is
  configured via `LYRICA_URL` (default `https://lyrica-jwtd.onrender.com`).
- Queries that don't already mention Telugu/Tollywood (or contain Telugu script)
  get " telugu" appended so results stay on-topic.
- Stream URLs are JioSaavn CDN links resolved at play time (in-memory cached,
  TTL 6h). They are treated as a cache, not identity — tracks are identified by a
  stable `id` hash of `artist|title`.
