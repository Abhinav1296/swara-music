"""MongoDB-backed catalog service — serves the precomputed Swara catalog.

This is the bridge between the scraper (which filled `swara.songs` with audio
handles + multi-source Telugu lyrics) and the app. It exposes the SAME public
async interface as ``app.services.lyrica`` (search_songs / get_trending /
search_jiosaavn_tracks / get_song_details / get_stream_details / lookup_artist /
lookup_album), so the routes switch sources with no shape changes.

Two things make this fast and independent:
  * reads come straight from our own MongoDB (~50ms), not three hops of other
    people's free infra;
  * audio is resolved LOCALLY from the stored ``encrypted_media_url`` via the
    scraper's DES decrypt — no network call at play time.

Telugu is the primary lyric shown; a romanized/English version is kept alongside
for a future side-box. Synced (karaoke) lines are served only when they are
themselves Telugu, so the main view stays Telugu-first.
"""
from __future__ import annotations

import asyncio
import logging
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

# Make the repo-root `scraper` package importable from inside the backend.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scraper import db as scraper_db            # noqa: E402  (path set above)
from scraper.jiosaavn import resolve_stream, search_artists  # noqa: E402
from scraper import jiosaavn as saavn_api         # noqa: E402  (trending/search live calls)
from scraper import scrub                         # noqa: E402  (norm/compilation helpers)

# Reuse the exception the routes already translate into a 404.
from app.services.lyrica import SongNotFound     # noqa: E402

logger = logging.getLogger("swara.catalog")

SOURCE = "mongo"
_DEFAULT_LIMIT = 25
_MAX_LIMIT = 50
_TELUGU = re.compile(r"[ఀ-౿]")
_text_index_ready = False


# ── helpers ──────────────────────────────────────────────────────────────────
def _col():
    return scraper_db.get_songs_collection()


def _clamp(limit: Optional[int], ceiling: int = _MAX_LIMIT) -> int:
    try:
        limit = int(limit)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        limit = _DEFAULT_LIMIT
    return min(max(limit, 1), ceiling)


# Album/artist detail lists can be longer than a search page (full soundtrack).
_MAX_LOOKUP = 100


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _is_telugu(text: Optional[str], min_chars: int = 8) -> bool:
    return len(_TELUGU.findall(text or "")) >= min_chars


def _ensure_text_index(col) -> None:
    """Create a text index once so free-text search can rank by relevance."""
    global _text_index_ready
    if _text_index_ready:
        return
    try:
        col.create_index(
            [("title", "text"), ("movie", "text"), ("singers", "text"), ("lyrics_text", "text")],
            name="swara_text",
            # Title/artist matches must outrank a lyric-body hit, so weight the
            # lyrics field far lower (see scraper/build_search_index.py).
            weights={"title": 10, "movie": 6, "singers": 4, "lyrics_text": 1},
            default_language="none",   # no stemming — safer for Telugu + mixed
            # Docs carry language:"telugu"; stop Mongo using it as a per-doc
            # stemming override (unsupported) by pointing at a nonexistent field.
            language_override="__txt_lang__",
        )
    except Exception:
        pass  # index may already exist / differ; regex fallback still works
    _text_index_ready = True


# ── document -> UI shapes ────────────────────────────────────────────────────
def _to_song(doc: Dict[str, Any], stream_url: Optional[str] = None) -> Dict[str, Any]:
    """Map a `swara.songs` document into the frontend `Song` shape (+aliases)."""
    title = doc.get("title") or ""
    artist = doc.get("singers") or ""
    album = doc.get("movie") or ""
    artwork = doc.get("artwork") or ""
    dur = doc.get("duration_sec")
    duration_ms = int(dur * 1000) if dur else None
    perma = doc.get("perma_url") or None
    has_stream = bool(doc.get("encrypted_media_url"))
    lyrics_avail = bool(doc.get("lyrics_versions")) and not doc.get("lyrics_missing", True)
    return {
        "id": doc.get("_id"),
        "title": title,
        "artist": artist,
        "album": album,
        "year": doc.get("year"),
        "artwork": artwork,
        "durationMs": duration_ms,
        "streamUrl": stream_url,
        "hasFullStream": bool(stream_url) or has_stream,
        "source": SOURCE,
        "lyricsAvailable": lyrics_avail,
        # legacy iTunes-era aliases the presentational components still read
        "trackName": title,
        "artistName": artist,
        "collectionName": album,
        "artworkUrl100": artwork,
        "artworkUrl600": artwork,
        "previewUrl": stream_url,
        "trackTimeMillis": duration_ms,
        "artistId": None,
        "collectionId": None,
        "jiosaavnUrl": perma,
    }


def _jiosaavn_to_song(rec: Dict[str, Any], stream_url: Optional[str] = None) -> Dict[str, Any]:
    """Map a live JioSaavn record (scraper.jiosaavn shape) into the SAME frontend
    `Song` shape as `_to_song`, so home rows sourced from JioSaavn are shaped
    identically to catalog songs. `lyricsAvailable` is False here — a JioSaavn
    home track isn't in our vetted lyrics store, so we never *claim* Telugu
    lyrics for it (purity: coverage is never faked)."""
    title = rec.get("title") or ""
    artist = rec.get("singers") or ""
    album = rec.get("movie") or ""
    artwork = rec.get("artwork") or ""
    dur = rec.get("duration_sec")
    duration_ms = int(dur * 1000) if dur else None
    perma = rec.get("perma_url") or None
    return {
        "id": rec.get("jiosaavn_id") or perma or title,
        "title": title,
        "artist": artist,
        "album": album,
        "year": rec.get("year"),
        "artwork": artwork,
        "durationMs": duration_ms,
        "streamUrl": stream_url,
        "hasFullStream": bool(stream_url) or bool(rec.get("encrypted_media_url")),
        "source": SOURCE,
        "lyricsAvailable": False,
        "trackName": title,
        "artistName": artist,
        "collectionName": album,
        "artworkUrl100": artwork,
        "artworkUrl600": artwork,
        "previewUrl": stream_url,
        "trackTimeMillis": duration_ms,
        "artistId": None,
        "collectionId": None,
        "jiosaavnUrl": perma,
    }


def _lyrics_payload(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Build the LyricsPayload the player expects — Telugu-first.

    `plain` = the chosen (highest-trust) version's Telugu text (romanized only as
    a fallback). `synced` = timed karaoke lines, but ONLY when those lines are
    themselves Telugu, so we never show romanized karaoke over Telugu words.
    """
    versions = doc.get("lyrics_versions") or []
    if not versions:
        return {"synced": [], "plain": None, "source": None, "available": False}

    by_source = {v.get("source"): v for v in versions}
    chosen = by_source.get(doc.get("chosen_source")) or min(
        versions, key=lambda v: v.get("priority", 99)
    )
    plain = (chosen.get("text_telugu") or chosen.get("text_roman") or "").strip() or None
    source_label = chosen.get("source")

    synced_lines: List[Dict[str, Any]] = []
    sv = by_source.get(doc.get("synced_source")) if doc.get("synced_source") else None
    if sv and sv.get("synced"):
        joined = " ".join(l.get("text", "") for l in sv["synced"])
        if _is_telugu(joined):  # Telugu karaoke available -> use it
            synced_lines = [
                {"timeMs": int(l.get("timeMs", 0) or 0), "text": l.get("text", "")}
                for l in sv["synced"]
            ]
            source_label = sv.get("source")

    return {
        "synced": synced_lines,
        "plain": plain,
        "source": source_label,
        "available": bool(plain or synced_lines),
    }


def _find_doc(col, artist: str, song: Optional[str], url: Optional[str]) -> Optional[Dict[str, Any]]:
    """Locate a song. `url` (perma_url) is the reliable key; fall back to title."""
    if url:
        d = col.find_one({"perma_url": url})
        if d:
            return d
    if song:
        rx = re.compile(f"^{re.escape(song.strip())}$", re.I)
        cands = list(col.find({"title": rx}, limit=10))
        if cands and artist:
            na = _norm(artist)
            for c in cands:
                if na and na in _norm(c.get("singers", "")):
                    return c
        if cands:
            return cands[0]
    return None


# ── sync cores (run off the event loop via asyncio.to_thread) ────────────────
def _search_sync(q: str, limit: int) -> List[Dict[str, Any]]:
    col = _col()
    q = (q or "").strip()
    if not q:
        return []
    _ensure_text_index(col)
    docs: List[Dict[str, Any]] = []
    try:
        cur = (
            col.find({"$text": {"$search": q}}, {"score": {"$meta": "textScore"}})
            .sort([("score", {"$meta": "textScore"})])
            .limit(limit)
        )
        docs = list(cur)
    except Exception:
        docs = []
    if not docs:  # regex fallback (also covers Telugu-script queries)
        rx = re.compile(re.escape(q), re.I)
        docs = list(
            col.find(
                {"$or": [{"title": rx}, {"movie": rx}, {"singers": rx}, {"lyrics_text": rx}]},
                limit=limit,
            )
        )
    return [_to_song(d) for d in docs]


def _trending_sync(limit: int) -> List[Dict[str, Any]]:
    col = _col()
    # A pleasant home shelf: songs that already HAVE lyrics, newest first.
    docs = list(col.find({"lyrics_missing": False}).sort("year", -1).limit(limit))
    if len(docs) < limit:  # top up with any songs so the home page is never empty
        have = {d["_id"] for d in docs}
        for d in col.find({"artwork": {"$ne": ""}}).sort("year", -1).limit(limit * 3):
            if d["_id"] not in have:
                docs.append(d)
            if len(docs) >= limit:
                break
    return [_to_song(d) for d in docs[:limit]]


# ── album index (canonical movie key + browse list, cached in-memory) ─────────
# An album's identity is a canonical (movie, year). `scrub.norm_key` is perfect
# for merging variant spellings (Aarya-2 / Aarya, 2 / Aarya - 2) BUT it strips
# every non-ASCII char, which would collapse ALL Telugu-script movie names into
# one empty key. So we keep the Telugu block too. Digits are kept, so sequels
# ("Arya" vs "Arya 2") stay distinct.
_ZW = str.maketrans({c: None for c in "​‌‍﻿"})
_ALBUM_KEY_RE = re.compile(r"[^0-9a-zఀ-౿]")


def canonical_movie_key(movie: Optional[str]) -> str:
    s = (movie or "").translate(_ZW).replace(" ", " ").lower()
    key = _ALBUM_KEY_RE.sub("", s)
    return key or f"#{(movie or '').strip().lower()}"  # keep all-punct names distinct


_ALBUM_TTL_SEC = 600
_album_cache: Dict[str, Any] = {"built_at": 0.0, "key_to_raws": {}, "albums": []}


def _build_album_index(col) -> Dict[str, Any]:
    """One aggregation over songs → (a) canonical-key → raw movie spellings, and
    (b) a browse list of real multi-song albums (singletons + compilations out).
    movie/year/version don't change during a lyrics fill, so this is stable."""
    key_to_raws: Dict[str, set] = {}
    merged: Dict[tuple, Dict[str, Any]] = {}
    pipe = [
        {"$match": {"movie": {"$nin": [None, ""]}}},
        {"$group": {
            "_id": {"m": "$movie", "y": "$year"},
            "n": {"$sum": 1},
            "arts": {"$push": "$artwork"},
            "singer": {"$first": "$singers"},
        }},
    ]
    for r in col.aggregate(pipe):
        raw = r["_id"]["m"]
        year = r["_id"]["y"]
        key = canonical_movie_key(raw)
        key_to_raws.setdefault(key, set()).add(raw)
        e = merged.setdefault(
            (key, year),
            {"names": Counter(), "covers": Counter(), "n": 0, "singer": ""},
        )
        e["names"][raw] += r["n"]
        for a in r["arts"]:
            if a:
                e["covers"][a] += 1
        e["n"] += r["n"]
        if not e["singer"]:
            e["singer"] = r.get("singer") or ""

    albums: List[Dict[str, Any]] = []
    for (key, year), e in merged.items():
        name = e["names"].most_common(1)[0][0]          # dominant raw spelling = display
        cover = e["covers"].most_common(1)[0][0] if e["covers"] else None
        # A real album to browse = 2+ tracks and not a hits/vol/jukebox compilation.
        # 1-song entries are usually just a film we scraped thinly — kept reachable
        # via the song's "Go to Album", but left out of the browse grid's clutter.
        listable = e["n"] >= 2 and not scrub._is_compilation(name)
        albums.append({
            "key": key, "name": name, "year": year, "cover": cover,
            "singers": e["singer"], "count": e["n"], "listable": listable,
        })
    return {"key_to_raws": {k: sorted(v) for k, v in key_to_raws.items()}, "albums": albums}


def _album_index(col) -> Dict[str, Any]:
    now = time.time()
    if not _album_cache["albums"] or now - _album_cache["built_at"] > _ALBUM_TTL_SEC:
        built = _build_album_index(col)
        _album_cache.update(built_at=now, **built)
    return _album_cache


def _lookup_sync(
    kind: str,
    name: str,
    artist: Optional[str],
    limit: int,
    year: Optional[int] = None,
) -> List[Dict[str, Any]]:
    col = _col()
    name = (name or "").strip()
    if kind == "album":
        # An album is (movie, year) — NOT just the movie name. Two different films
        # share a title (Maharshi 2000 vs 2019 → split by year), and one film is
        # spelled several ways (Aarya-2 / Aarya, 2 → one album via canonical key).
        # We resolve the incoming name to its canonical key and match every raw
        # spelling that shares it; fall back to an anchored exact match if the
        # index has no entry yet. Substring matching (the old bug) is gone.
        raws = _album_index(col)["key_to_raws"].get(canonical_movie_key(name))
        if raws:
            query: Dict[str, Any] = {"movie": {"$in": raws}}
        else:
            query = {"movie": re.compile(f"^{re.escape(name)}$", re.I)}
        if year is not None:
            query["year"] = year
        docs = list(col.find(query).sort([("title", 1)]).limit(limit))
    else:
        # A singer legitimately appears as a substring inside a multi-artist
        # "A, B, C" list, so substring matching is correct for artist pages.
        rx = re.compile(re.escape(name), re.I)
        docs = list(col.find({"singers": rx}, limit=limit))
    return [_to_song(d) for d in docs]


def _album_cover(results: List[Dict[str, Any]]) -> Optional[str]:
    """The album's cover = the poster the tracks SHARE (the mode), not whatever
    track happened to sort first. Robust to a stray remix with its own art."""
    from collections import Counter

    arts = [r.get("artworkUrl600") for r in results if r.get("artworkUrl600")]
    if not arts:
        return None
    return Counter(arts).most_common(1)[0][0]


def _albums_sync(limit: int, offset: int) -> Dict[str, Any]:
    """A page of real, browsable movie-albums: newest first, biggest first."""
    idx = _album_index(_col())
    listable = [a for a in idx["albums"] if a["listable"]]
    listable.sort(key=lambda a: (-(a["year"] or 0), -a["count"], a["name"].lower()))
    page = listable[offset:offset + limit]
    results = [
        {
            "key": a["key"],
            "name": a["name"],
            "year": a["year"],
            "artworkUrl600": a["cover"],
            "count": a["count"],
            "singers": a["singers"],
        }
        for a in page
    ]
    return {"count": len(listable), "results": results, "source": SOURCE}


def _details_sync(artist: str, song: Optional[str], url: Optional[str]) -> Optional[Dict[str, Any]]:
    col = _col()
    # Exact perma_url → that recording only (never a same-titled different song,
    # which would show the WRONG lyrics); otherwise legacy title/artist match.
    doc = col.find_one({"perma_url": url}) if url else _find_doc(col, artist, song, None)
    if not doc:
        # A JioSaavn-sourced home track (not in our catalog). Serve playable
        # details with NO lyrics — we never fabricate Telugu lyrics for an
        # unvetted track (purity #1).
        rec = _saavn_lookup_by_url(url, song, artist)
        if not rec:
            return None
        base = _jiosaavn_to_song(rec, resolve_stream(rec.get("encrypted_media_url") or ""))
        base.update({
            "lyricsAvailable": False,
            "lyricsSynced": False,
            "lyrics": {"synced": [], "plain": None, "source": None, "available": False},
            "mood": None,
            "metadata": {
                "movie": rec.get("movie"),
                "year": rec.get("year"),
                "singers": rec.get("singers"),
                "version": None,
                "language": rec.get("language"),
            },
        })
        return base
    stream_url = resolve_stream(doc.get("encrypted_media_url") or "")
    base = _to_song(doc, stream_url)
    lyrics = _lyrics_payload(doc)
    base.update({
        "lyricsAvailable": lyrics["available"],
        "lyricsSynced": bool(lyrics["synced"]),
        "lyrics": lyrics,
        "mood": None,
        "metadata": {
            "movie": doc.get("movie"),
            "year": doc.get("year"),
            "singers": doc.get("singers"),
            "version": doc.get("version"),
            "language": doc.get("language"),
        },
    })
    return base


def _stream_sync(artist: str, song: Optional[str], url: Optional[str]) -> Optional[Dict[str, Any]]:
    col = _col()
    # With an exact perma_url we accept ONLY that recording from our catalog — a
    # fuzzy title match could stream a DIFFERENT song that shares the title
    # (e.g. the many "Evarevaro"s). Without a url, use the legacy title match.
    doc = col.find_one({"perma_url": url}) if url else _find_doc(col, artist, song, None)
    if not doc:
        # Home rows come from JioSaavn and aren't in Mongo — resolve them live so
        # they play through the exact same path as catalog songs.
        rec = _saavn_lookup_by_url(url, song, artist)
        if not rec:
            return None
        su = resolve_stream(rec.get("encrypted_media_url") or "")
        if not su:
            return None
        dur = rec.get("duration_sec")
        return {
            "status": "success",
            "stream_url": su,
            "artist": rec.get("singers") or artist,
            "title": rec.get("title") or song or "",
            "album": rec.get("movie") or None,
            "artwork": rec.get("artwork") or None,
            "durationMs": int(dur * 1000) if dur else None,
            "source": SOURCE,
        }
    stream_url = resolve_stream(doc.get("encrypted_media_url") or "")
    if not stream_url:
        return None
    dur = doc.get("duration_sec")
    return {
        "status": "success",
        "stream_url": stream_url,
        "artist": doc.get("singers") or artist,
        "title": doc.get("title") or song or "",
        "album": doc.get("movie") or None,
        "artwork": doc.get("artwork") or None,
        "durationMs": int(dur * 1000) if dur else None,
        "source": SOURCE,
    }


# ── public async interface (mirrors app.services.lyrica) ─────────────────────
async def search_songs(query: str, limit: Optional[int] = None) -> Dict[str, Any]:
    limit = _clamp(limit)
    results = await asyncio.to_thread(_search_sync, query, limit)
    return {"query": query or "", "count": len(results), "results": results, "source": SOURCE}


# ── live JioSaavn home rows (Trending / mood shelves, refreshed daily) ────────
# The home page pulls fresh Telugu rows straight from JioSaavn (the user's ask:
# "fetch from jiosaavn from api daily"). We cache each row in memory for ~12h so
# a page view costs at most a couple of JioSaavn calls a day, and we keep the raw
# record per perma_url so the SAME songs play (and resolve details) at click time
# with no extra network. If JioSaavn is unreachable we fall back to our own
# catalog so the home page is never blank.
_HOME_TTL = 12 * 3600
_HOME_CACHE: Dict[str, tuple] = {}                 # row key -> (songs, expires_at)
_HOME_REC: Dict[str, Dict[str, Any]] = {}          # perma_url -> raw jiosaavn record


async def _home_row(key: str, fetch) -> List[Dict[str, Any]]:
    """Cached JioSaavn row. `fetch` is a zero-arg coroutine returning raw records."""
    now = time.time()
    hit = _HOME_CACHE.get(key)
    if hit and hit[1] > now:
        return hit[0]
    try:
        recs = await fetch()
    except Exception as exc:  # noqa: BLE001 - a dead row must never break the page
        logger.warning("home row %r failed: %s", key, exc)
        return hit[0] if hit else []          # serve stale if we have it
    songs: List[Dict[str, Any]] = []
    for rec in recs:
        perma = rec.get("perma_url")
        if perma:
            _HOME_REC[perma] = rec            # remember it for play/details later
        songs.append(_jiosaavn_to_song(rec, resolve_stream(rec.get("encrypted_media_url") or "")))
    _HOME_CACHE[key] = (songs, now + _HOME_TTL)
    return songs


def _saavn_lookup_by_url(url: Optional[str], song: Optional[str], artist: Optional[str]) -> Optional[Dict[str, Any]]:
    """Find the raw JioSaavn record for a home track. Warm hit from `_HOME_REC`
    (no network); cold fallback re-searches JioSaavn by title and matches the
    perma_url / artist. Runs inside a worker thread, so a private event loop is
    safe here."""
    if url and url in _HOME_REC:
        return _HOME_REC[url]
    q = (song or "").strip()
    if not q:
        return None
    try:
        recs = asyncio.run(saavn_api.search_songs(q, limit=10))
    except Exception as exc:  # noqa: BLE001
        logger.warning("jiosaavn lookup_by_url search failed for %r: %s", song, exc)
        return None
    if url:
        for r in recs:
            if r.get("perma_url") == url:
                return r
    na = _norm(artist)
    for r in recs:
        if na and na in _norm(r.get("singers", "")):
            return r
    return recs[0] if recs else None


async def search_jiosaavn_tracks(query: str, limit: Optional[int] = None) -> Dict[str, Any]:
    """A home mood shelf — live Telugu songs from JioSaavn (cached ~12h). Broad
    mood searches can leak other languages, so we keep only Telugu rows; if the
    row comes back empty (JioSaavn down) we fall back to our own catalog."""
    limit = _clamp(limit)
    q = (query or "").strip()

    async def fetch():
        recs = await saavn_api.search_songs(q, limit=max(limit * 2, 20))
        telugu = [r for r in recs if (r.get("language") or "").lower() == "telugu"]
        return (telugu or recs)[: max(limit, 20)]

    songs = await _home_row(f"shelf:{q.lower()}", fetch)
    if not songs:
        db = await asyncio.to_thread(_search_sync, q, limit)
        return {"query": q, "count": len(db), "results": db, "source": SOURCE}
    out = songs[:limit]
    return {"query": q, "count": len(out), "results": out, "source": SOURCE}


async def get_trending(limit: Optional[int] = None) -> Dict[str, Any]:
    """Trending Telugu now — JioSaavn's live feed (cached ~12h), with our own
    catalog trending as the offline fallback so the hero is never empty."""
    limit = _clamp(limit)
    songs = await _home_row("trending:telugu", lambda: saavn_api.trending_songs("telugu", 24))
    if not songs:
        db = await asyncio.to_thread(_trending_sync, limit)
        return {"query": "trending", "count": len(db), "results": db, "source": SOURCE}
    out = songs[:limit]
    return {"query": "trending", "count": len(out), "results": out, "source": SOURCE}


async def get_albums(limit: Optional[int] = None, offset: int = 0) -> Dict[str, Any]:
    """Browse real movie-albums (dedup'd by canonical name+year, junk filtered)."""
    limit = min(max(int(limit or 40), 1), 100)
    offset = max(int(offset or 0), 0)
    return await asyncio.to_thread(_albums_sync, limit, offset)


async def _new_release_cards() -> List[Dict[str, Any]]:
    """Fresh Telugu album CARDS from JioSaavn (cached ~12h). Each carries an
    `albumId` so the detail page can expand it into tracks via lookup_saavn_album."""
    key = "new_releases:telugu"
    now = time.time()
    hit = _HOME_CACHE.get(key)
    if hit and hit[1] > now:
        return hit[0]
    try:
        albums = await saavn_api.new_release_albums("telugu", 24)
    except Exception as exc:  # noqa: BLE001
        logger.warning("new releases fetch failed: %s", exc)
        return hit[0] if hit else []
    cards = [
        {
            "key": f"saavn:{a['album_id']}",
            "albumId": a["album_id"],
            "name": a["name"],
            "year": a["year"],
            "artworkUrl600": a["image"],
            "count": a.get("song_count") or 0,
            "singers": None,
        }
        for a in albums if a.get("album_id")
    ]
    _HOME_CACHE[key] = (cards, now + _HOME_TTL)
    return cards


async def get_new_releases(limit: Optional[int] = None, offset: int = 0) -> Dict[str, Any]:
    """A row of fresh Telugu album cards (true new releases, not a keyword search)."""
    limit = min(max(int(limit or 20), 1), 40)
    offset = max(int(offset or 0), 0)
    cards = await _new_release_cards()
    return {"count": len(cards), "results": cards[offset:offset + limit], "source": SOURCE}


async def lookup_saavn_album(album_id: str, limit: Optional[int] = None) -> Dict[str, Any]:
    """Expand a JioSaavn album id into a LookupResponse of playable tracks. Warms
    `_HOME_REC` so each track streams/details through the same fallback as home
    rows. Album art is the shared (movie) cover — the user's stated preference."""
    limit = _clamp(limit, _MAX_LOOKUP)
    try:
        recs = await saavn_api.album_tracks(album_id, limit=limit)
    except Exception as exc:  # noqa: BLE001
        logger.warning("saavn album %r expand failed: %s", album_id, exc)
        recs = []
    results: List[Dict[str, Any]] = []
    for rec in recs:
        perma = rec.get("perma_url")
        if perma:
            _HOME_REC[perma] = rec
        results.append(_jiosaavn_to_song(rec, resolve_stream(rec.get("encrypted_media_url") or "")))
    n = len(results)
    name = recs[0].get("movie") if recs else ""
    year = recs[0].get("year") if recs else None
    bits = [str(year)] if year else []
    bits.append(f"{n} song{'s' if n != 1 else ''}")
    return {
        "type": "album",
        "title": name or "",
        "year": year,
        "subtitle": " · ".join(bits),
        "artworkUrl600": _album_cover(results),
        "results": results,
        "source": SOURCE,
    }


async def get_song_details(artist: str, song: str, url: Optional[str] = None) -> Dict[str, Any]:
    res = await asyncio.to_thread(_details_sync, artist, song, url)
    if res is None:
        raise SongNotFound(f"No song found for {artist} — {song}")
    return res


async def get_stream_details(artist: str, song: str, url: Optional[str] = None) -> Dict[str, Any]:
    res = await asyncio.to_thread(_stream_sync, artist, song, url)
    if res is None:
        raise SongNotFound(f"No stream found for {artist} — {song}")
    return res


# ── artist portraits (singer pages show the SINGER, not a movie poster) ───────
# A singer page used to borrow its first song's poster as the header image — a
# movie cover, not the artist. We pull the real portrait from JioSaavn's artist
# search and cache it in memory (write-free, survives no restart, refills lazily
# — exactly the "fetch from JioSaavn" model). If JioSaavn has no genuine portrait
# we fall back to the poster, so the worst case is the old behaviour, never worse.
_NAME_RE = re.compile(r"[^0-9a-zఀ-౿]+")
_ARTIST_SPLIT_RE = re.compile(r"\s*[,&/]\s*|\s+feat\.?\s+|\s+ft\.?\s+", re.I)
_ARTIST_IMG_CACHE: Dict[str, tuple] = {}
_ARTIST_IMG_TTL = 24 * 3600      # a portrait is stable; refetch at most daily
_ARTIST_MISS_TTL = 3600          # re-try a "no photo" name in an hour, not forever


def _norm_name(s: Optional[str]) -> str:
    return _NAME_RE.sub("", (s or "").lower())


def _lead_artist(name: Optional[str]) -> str:
    """The first named singer in an "A, B & C" credit — the page's 'face'."""
    parts = _ARTIST_SPLIT_RE.split(name or "")
    return (parts[0] if parts else (name or "")).strip()


def _pick_artist_photo(candidates: List[Dict[str, Any]], query: str) -> Optional[str]:
    """Best real portrait for `query`, or None. Only ever a genuine `/artists/`
    photo (candidate.is_photo); prefer an exact name, else a name that overlaps
    the query. Never returns a placeholder or a movie-poster stand-in."""
    photos = [c for c in candidates if c.get("is_photo") and c.get("image")]
    if not photos:
        return None
    nq = _norm_name(query)
    for c in photos:                                   # 1) exact normalized name
        if _norm_name(c["name"]) == nq:
            return c["image"]
    for c in photos:                                   # 2) JioSaavn's top overlap
        nc = _norm_name(c["name"])
        if nq and nc and (nc in nq or nq in nc):
            return c["image"]
    return None


async def _artist_image(name: Optional[str]) -> Optional[str]:
    """Cached JioSaavn portrait URL for a singer name (None if none / on error)."""
    if not name or not name.strip():
        return None
    key = _norm_name(name)
    now = time.time()
    hit = _ARTIST_IMG_CACHE.get(key)
    if hit and hit[1] > now:
        return hit[0]

    url: Optional[str] = None
    # Try the whole credit first (rare exact combo), then the lead singer.
    queries: List[str] = []
    for q in (name.strip(), _lead_artist(name)):
        if q and q not in queries:
            queries.append(q)
    try:
        for q in queries:
            url = _pick_artist_photo(await search_artists(q, limit=5), q)
            if url:
                break
    except Exception as exc:  # noqa: BLE001 - a portrait miss must never break the page
        logger.warning("artist image lookup failed for %r: %s", name, exc)
        url = None

    _ARTIST_IMG_CACHE[key] = (url, now + (_ARTIST_IMG_TTL if url else _ARTIST_MISS_TTL))
    return url


async def lookup_artist(name: str, limit: Optional[int] = None) -> Dict[str, Any]:
    limit = _clamp(limit, _MAX_LOOKUP)
    results = await asyncio.to_thread(_lookup_sync, "artist", name, None, limit)
    # Header art: the singer's real portrait when JioSaavn has one, else the
    # poster of their first track (the old behaviour) so nothing regresses.
    photo = await _artist_image(name)
    cover = photo or (results[0]["artworkUrl600"] if results else None)
    return {
        "type": "artist",
        "title": name or "",
        "artworkUrl600": cover,
        "results": results,
        "source": SOURCE,
    }


async def lookup_album(
    name: str,
    artist: Optional[str] = None,
    year: Optional[int] = None,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    limit = _clamp(limit, _MAX_LOOKUP)
    results = await asyncio.to_thread(_lookup_sync, "album", name, artist, limit, year)
    # Subtitle is the album's own identity (year · song count), not a random
    # track's singer — a film has many singers; none of them "is" the album.
    n = len(results)
    eff_year = year or (results[0].get("year") if results else None)
    bits = [str(eff_year)] if eff_year else []
    bits.append(f"{n} song{'s' if n != 1 else ''}")
    return {
        "type": "album",
        "title": name or "",
        "year": eff_year,
        "subtitle": " · ".join(bits),
        "artworkUrl600": _album_cover(results),
        "results": results,
        "source": SOURCE,
    }
