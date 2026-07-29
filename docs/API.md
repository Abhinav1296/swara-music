# API (Backend)

FastAPI app in `backend/app`. Base URL in the browser is `/api` (Vite proxy),
or set `VITE_API_BASE` to point at a remote backend. Interactive docs at
`http://localhost:8000/docs`.

All endpoints are JSON GET. The proxy never requires auth. CORS is enabled for
`http://localhost:5173` (configurable via `CORS_ORIGINS`).

## Data source

The backend is a thin proxy in front of a personal **Lyrica** instance
(`LYRICA_URL`, default `https://lyrica-jwtd.onrender.com`), which in turn pulls:

* **lyrics + metadata** from LRCLib / MusicBrainz — `GET {LYRICA_URL}/lyrics/`
* **full-length audio streams** from JioSaavn —
  `GET {LYRICA_URL}/api/jiosaavn/search` then
  `GET {LYRICA_URL}/api/jiosaavn/play?songLink=<perma_url>`

No iTunes API is used anymore. Full tracks (not 30s previews) are streamed
directly to the `<audio>` element from JioSaavn's CDN.

## Endpoints

### `GET /api/health`
Liveness probe.
- Response: `{ "status": "ok", "service": "swara-music", "source": "lyrica" }`

### `GET /api/search`
Telugu-biased free-text song search (used by the search box).
- Query params:
  - `q` **(required)** `string`, min length 1
  - `limit` `int` 1–50 (default 25)
- Behavior: the query is normalized server-side (see Telugu bias below) and sent
  to Lyrica `/suggestion`. Each suggestion is then enriched (best effort, never
  fails the search) with JioSaavn artwork + a `perma_url` so the grid has art and
  a fast stream handle. When the JioSaavn title match misses, the frontend falls
  back to a deterministic placeholder gradient and the real cover arrives when the
  track is played (see `/api/song-details`).
- Response: `SearchResponse` (see schema below).

### `GET /api/trending`
Curated lists for the Home page (hero + mood shelves).
- Query params:
  - `q` `string` (optional) — a vibe/shelf query (e.g. `"telugu romantic songs"`).
    When present, searches JioSaavn for that vibe (artwork-rich, stream-ready).
  - `limit` `int` 1–50 (default 25)
- With no `q`, returns a Telugu-biased JioSaavn search ("latest telugu songs") —
  real, artwork-rich tracks for the hero. JioSaavn is used here (not
  `/suggestion`) because it returns far better results for broad queries.

### `GET /api/song-details`
Resolve a single track into a **full-length stream URL + synced/plain lyrics +
metadata**. This is what the player calls on every play.
- Query params:
  - `artist` **(required)** `string`
  - `song` **(required)** `string` — also aliased by `title` / `track`
  - `url` `string` (optional) — a JioSaavn `perma_url` for fast stream resolution
    (search results carry one; restores/recently-played may not)
- Response: `SongDetails` (see schema below).
- Successes are cached in-memory (keyed by normalized `artist|song`, TTL
  `SONG_CACHE_TTL` = 6h). Failures are never cached.
- A successful resolution with **no stream URL** still returns `200` with
  `hasFullStream=false` (player shows "stream unavailable"). Only when *both*
  lyrics and stream are unresolvable does it return `404`.

### `GET /api/lookup`
Best-effort artist/album lookup, resolved by **name** (Lyrica/JioSaavn have no
ids). Powers the artist/album detail views.
- Query params:
  - `type` `string` (optional, default `artist`) — `artist` or `album`.
  - `name` / `album` / `artist` / `q` `string` (optional) — the artist or album
    name to resolve. `name` is the primary key; `album` is an alias for album
    lookups; `artist` is an optional hint that also disambiguates `type=album`.
  - `id` `string` (optional) — legacy numeric id; unused now. When no name is
    given it returns a safe empty `LookupResponse` so old deep links never
    hard-crash.
  - `limit` `int` 1–50 (default 25).
- Behavior: `type=artist` searches JioSaavn for `"<name> telugu"` and keeps
  tracks whose artist fuzzy-matches `name` (falls back to raw results if none
  match). `type=album` searches JioSaavn by the album name (optionally
  `"<album> <artist>"`) and keeps tracks whose album matches `name`. Both return
  a `LookupResponse` (`type`, `title`, `artworkUrl600`, `results`).

### `GET /api/stream`
**Lightweight stream-only endpoint** — returns ONLY the stream URL + minimal
metadata needed to start playback immediately. Does NOT fetch lyrics, mood, or
rich metadata. Designed for sub-4s p95 latency.
- Query params:
  - `artist` **(required)** `string`
  - `song` **(required)** `string` — also aliased by `title` / `track`
  - `url` `string` (optional) — a JioSaavn `perma_url` for fast stream resolution
- Response: `StreamResponse` (see schema below).
- Behavior:
  1. If `url` provided, resolves stream directly via Lyrica `/api/jiosaavn/play`.
  2. Otherwise searches JioSaavn for "artist song" and uses top match.
  3. Best-effort enrichment: fetches artwork, album, duration from JioSaavn
     search result (never fails the response).
- Never returns HTTP 500 for "not found" — returns 404 with `status: "not_found"`.
- Errors: 504 (upstream timeout), 502 (upstream error), 422 (missing params).

## Response schemas

### `SearchResponse` / `Song` (per result)
```json
{
  "query": "samajavaragamana telugu",
  "count": 10,
  "source": "lyrica",
  "results": [
    {
      "id": "84b1b32d35f1b345",
      "title": "Samajavaragamana",
      "artist": "Sid Sriram",
      "album": "",
      "artwork": "https://c.saavncdn.com/.../500x500.jpg",
      "durationMs": 219000,
      "streamUrl": null,
      "hasFullStream": true,
      "source": "lyrica",
      "lyricsAvailable": false,
      "trackName": "Samajavaragamana",
      "artistName": "Sid Sriram",
      "collectionName": "",
      "artworkUrl100": "https://c.saavncdn.com/.../500x500.jpg",
      "artworkUrl600": "https://c.saavncdn.com/.../500x500.jpg",
      "previewUrl": null,
      "trackTimeMillis": 219000,
      "artistId": null,
      "collectionId": null,
      "jiosaavnUrl": "https://www.jiosaavn.com/song/.../FzIYeDVlWnw"
    }
  ]
}
```
Each `Song` carries **both** the canonical Swara fields (`title`, `artist`,
`album`, `artwork`, `durationMs`, `streamUrl`, `hasFullStream`, `source`,
`lyricsAvailable`) **and** legacy aliases (`trackName`, `artistName`,
`artworkUrl100/600`, `previewUrl`, `trackTimeMillis`, `artistId`,
`collectionId`) that the existing presentational components read. `id` is a
stable string hash of `artist|title` (never 0/empty). `jiosaavnUrl` is a
best-effort JioSaavn `perma_url` used to resolve the stream quickly at play time.

### `SongDetails`
Extends `Song` with:
```json
{
  "lyricsSynced": true,
  "lyrics": {
    "synced": [ { "timeMs": 1030, "text": "Nee kaallani pattuku…" } ],
    "plain": "[00:01.03] Nee kaallani…",
    "source": "lrclib",
    "available": true
  },
  "mood": { "sentiment": { "mood": "Neutral", ... } },
  "metadata": { "album": "Ala Vaikunthapurramuloo", "album_art": "https://...", ... }
}
```
`lyrics.synced` is an array of `{ timeMs, text }` (milliseconds). The frontend
adapter converts these to `{ time, text }` (seconds) for the karaoke highlight.

### `LookupResponse`
```json
{ "type": "artist", "title": "Sid Sriram", "artworkUrl600": "...", "results": [ /* Song[] */ ] }
```

### `StreamResponse`
```json
{
  "status": "success",
  "stream_url": "https://c.saavncdn.com/.../stream.mp4",
  "artist": "Sid Sriram",
  "title": "Samajavaragamana",
  "album": "Ala Vaikunthapurramuloo",
  "artwork": "https://c.saavncdn.com/.../500x500.jpg",
  "durationMs": 219000,
  "source": "lyrica"
}
```
`status` is one of `"success" | "not_found" | "error"`. On 404, the response body
includes `status: "not_found"` with null `stream_url` — the frontend treats this
as an auto-skip trigger when `upcoming` has items.

## Telugu bias (`services/lyrica.py::normalize_query`)
- Empty query → `"telugu"`.
- Already contains a Telugu indicator (`telugu`, `tollywood`, `kollywood`,
  `south`, `dj`, `tamil`) **or** Telugu-script characters (U+0C00–U+0C7F) → kept
  as-is (never double-appended).
- Otherwise the query is appended with `" telugu"`.

## Error behavior
- Missing `q` (search) or `song` (song-details) → **422** with a `detail` message.
- Upstream **timeout** → **504** `{"detail": "Lyrica upstream timed out: …"}`.
- Upstream **HTTP error / connection failure** → **502** `{"detail": "…"}`.
- Both lyrics and stream unresolvable → **404** `{"detail": "No lyrics or stream
  found for <artist> — <song>"}`.
- Any other unexpected error → **500** `{"detail": "Unexpected error"}` (no stack
  traces leak).
- Frontend: `api/client.js::getJson` throws `Error(detail)` (with `.status`) on
  non-2xx so views/player can show an error state.

## Config (env, see `backend/.env.example`)
- `LYRICA_URL` (default `https://lyrica-jwtd.onrender.com`)
- `LYRICA_CONNECT_TIMEOUT` (5s), `LYRICA_READ_TIMEOUT` (20s)
- `LYRICA_EXTRA_HEADERS` (optional, forwarded to Lyrica if the instance is protected)
- `DEFAULT_LIMIT` (25), `MAX_LIMIT` (50)
- `SONG_CACHE_TTL` (21600s = 6h)
- `CORS_ORIGINS` (comma-separated; default `http://localhost:5173`)

## Notes / constraints
- Full-length streaming via JioSaavn is the primary playback path (no more
  30s iTunes previews). Stream URLs are resolved at play time and treated as a
  cache, not identity — tracks are identified by `id` / `artist`+`title`.
- The upstream (Render free tier) can **cold-start** (first request after idle
  may be slow or briefly fail). The player shows a "resolving" state and a
  graceful error on failure; retries are user-initiated.
- Some tracks resolve lyrics but no stream (or vice-versa); both are handled
  gracefully.
