# Swara — a Telugu-only music app

An Apple Music–style player focused **exclusively on Telugu music**, with lyrics
at the center. Swara owns its whole stack: it scrapes and cleans its own catalog,
stores it in MongoDB, resolves audio itself, and never depends on a third-party
music API at play time.

**Guiding principle — purity over coverage.** A song enters the catalog only when
there is *hard evidence* it is Telugu (a `telugu` language tag, Telugu script, or
proven Telugu lyrics). Songs of uncertain language are quarantined and never shown
until proven — never guessed in. See [Purity model](#purity-model).

---

## Architecture — decouple scrape from serve

The old design did all its scraping *during* playback (three hops through other
people's free infra). Swara now splits that into two independent journeys:

```
Journey 1 — Scraper (runs ahead of time, offline)
  JioSaavn search ─▶ clean / version / dedupe ─▶ fetch Telugu lyrics ─▶ MongoDB

Journey 2 — App (live, one step)
  React ─▶ FastAPI ─▶ read record from MongoDB (~50ms) ─▶ resolve fresh audio locally ─▶ play
```

The only live step at play time is resolving a fresh audio URL, which Swara does
**itself** (local DES decrypt of JioSaavn's `encrypted_media_url`) — no external
music-API proxy.

## Stack

- **Scraper:** Python package (`scraper/`) — independent JioSaavn client, lyric
  adapters, a Wikidata-backed Telugu-films reference, and the quarantine pipeline.
- **Database:** MongoDB Atlas (`swara.songs` + `swara.quarantine`). The song
  fingerprint *is* the Mongo `_id`, so dedup is free.
- **Backend:** Python + FastAPI (`backend/`) — reads from MongoDB and resolves
  audio locally. No API key, no proxy.
- **Frontend:** React + Vite + Tailwind CSS + Framer Motion (`frontend/`) — an
  Apple Music look with glassmorphism, full-screen player, synced lyrics, custom
  playlists, and URL routing.

## Layout

```
.
├── scraper/      catalog pipeline: JioSaavn client, lyrics, quarantine machine
├── backend/      FastAPI app (Mongo-backed catalog + local audio resolver)
├── frontend/     React + Vite app (UI, player, lyrics, playlists)
└── output.json   code-graph snapshot of the whole project (reference)
```

---

## Quick start — run the app

The backend needs `scraper/.env` with a `MONGODB_URI` (Atlas connection string;
`.env.example` is committed as a template). Then:

```bash
# Terminal 1 — backend (serves the pre-built catalog from MongoDB)
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

The frontend dev server proxies `/api` → `http://localhost:8000` (no CORS or
hard-coded URLs in app code). The first `/api/search` builds a MongoDB text index
once (a few seconds).

The data source is switchable via `SWARA_SOURCE` (`config.DATA_SOURCE`): default
`mongo` serves the new catalog; `lyrica` restores the old live proxy.

---

## The scraper — build & grow the catalog

Everything below runs from the backend venv (`python -m scraper.<module>`). Jobs
are resumable and idempotent — safe to stop and re-run.

**Catalog crawl (breadth):**
```bash
python -m scraper.crawl_all         # search JioSaavn across movie/artist queries, fence to Telugu
```

**Quarantine machine (depth, purity-safe):**
```bash
python -m scraper.movies_ref        # 1. build the Telugu-films reference from Wikidata
python -m scraper.expand_movies     # 2. expand each film → live Telugu / quarantine unknowns
python -m scraper.promote_quarantine# 3. promote a parked song only if its lyrics prove Telugu
```

**Lyrics fill:**
```bash
python -m scraper.lyrics 300        # fill lyrics for N songs (LyricStape ▸ telugulyrics.com ▸ LRCLib)
```

**Manual review (for parked songs with no findable lyrics):**
```bash
python -m scraper.review_server     # http://localhost:8765 — listen & classify by ear (T/B/F)
```

**Monitor a running job:**
```bash
python -m scraper.monitor           # read-only live progress
```

### Purity model

Metadata lies, so Swara demands proof before a song goes live:

- **Live now** — language is `telugu`, or the title/movie contains Telugu script
  (U+0C00–U+0C7F; no other language uses it).
- **Quarantined** — language is `unknown`/blank *and* the song's album matches a
  verified Telugu film by name+year. Held aside, never shown, **never deleted** —
  a later proof can still rescue it.
- **Promoted from quarantine** — only when its *fetched lyrics* are Telugu script,
  or a human confirms it by ear. Never on a guess.
- **Dropped** — an explicit non-Telugu language tag.

Telugu-film **instrumentals / background scores** are kept (music is
language-neutral); only *foreign vocals* are refused.

---

## Current catalog

- **~33,400 songs**, effectively 100% Telugu (0 foreign contamination).
- **127 parked** in quarantine (reviewed-foreign, hidden).
- Lyrics fill is in progress — most of the freshly-crawled catalog is still
  `pending_lyrics`; the lyric sources fill it incrementally.

## Notes

- **JioSaavn is the identity anchor.** Lyrics are matched *to* the exact recording
  Swara plays, so a song never shows lyrics from the wrong cut. Different versions
  (sad / female / lofi) are separate records.
- **`_id` = SHA1(clean_title | movie | version)[:16]** — duration is a matching
  signal, not identity.
- Lyric sources are pluggable ~30-line adapters, onboarded best-first
  (LyricStape = highest trust). All versions are stored; the highest-trust one is
  displayed. An LM-Arena-style A/B vote to pick between versions is planned.
