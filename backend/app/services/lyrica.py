"""Lyrica integration — the Swara music proxy.

The backend is a thin, opinionated proxy in front of a personal **Lyrica**
instance, which in turn pulls:

* lyrics + rich metadata from LRCLib / MusicBrainz  (``/lyrics/``)
* full-length audio streams from JioSaavn           (``/api/jiosaavn/search``
  + ``/api/jiosaavn/play?songLink=``)

Responsibilities:
* Add a Telugu / Tollywood bias to free-text queries so the catalog stays
  on-topic (unless the user already specified a Telugu indicator or searches
  in the Telugu script).
* Enrich search suggestions with JioSaavn artwork + a ``perma_url`` so the
  grid/player have art and a fast stream handle.
* Resolve a track into stream URL + synced/plain lyrics + metadata, with an
  in-memory success cache keyed by normalized (artist, song).
* Centralize HTTP errors so routes can translate them into proper statuses
  (504 timeout, 502 upstream, 404 not found).
"""
import contextvars
import hashlib
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from app.config import settings

logger = logging.getLogger("swara.lyrica")

# Diagnostic correlation id, set per-request by the FastAPI middleware in
# app.main so upstream timings can be tied back to the originating request.
# (DIAGNOSTIC ONLY — safe to remove along with the perf middleware.)
_request_id_ctx = contextvars.ContextVar("swara_rid", default="")

# Keywords that already signal "this query is about Telugu / South Indian music".
_TELUGU_INDICATORS = ("telugu", "tollywood", "kollywood", "south", "dj", "tamil")

# In-memory TTL cache for /api/song-details successes.
#   key  -> (expires_at_epoch, payload_dict)
# A plain dict is safe here: FastAPI runs one event loop per worker and we never
# await between the check and the set, so there is no interleaving to guard.
_SONG_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}


class LyricaError(Exception):
    """Base class for Lyrica/upstream failures mapped to 5xx by the route."""


class LyricaTimeout(LyricaError):
    """Upstream timed out — route maps this to 504."""


class SongNotFound(LyricaError):
    """Both lyrics and stream are unresolvable for the given (artist, song)."""


# --------------------------------------------------------------------------- #
# Query normalization + id stability
# --------------------------------------------------------------------------- #
def _looks_telugu(text: str) -> bool:
    """Return True if the text already contains a Telugu-language indicator."""
    lowered = text.lower()
    if any(indicator in lowered for indicator in _TELUGU_INDICATORS):
        return True
    # Unicode block for Telugu script (U+0C00–U+0C7F).
    return any("ఀ" <= ch <= "౿" for ch in text)


def normalize_query(query: str) -> str:
    """Make a user query Telugu-biased when it isn't already.

    * Empty query -> fall back to a generic Telugu search.
    * Already contains a Telugu indicator or Telugu script -> keep as-is.
    * Otherwise append " telugu" so Lyrica favors the Telugu catalog.
    """
    q = (query or "").strip()
    if not q:
        return "telugu"
    if _looks_telugu(q):
        return q
    return f"{q} telugu"


def _stable_id(artist: str, title: str, album: str = "") -> str:
    """A stable string id derived from artist|title|album.

    Avoids 0 / empty ids and stays constant across sessions so localStorage
    likes/playlists key consistently on the same track.
    """
    raw = f"{artist}|{title}|{album}".lower().strip()
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _norm(s: Optional[str]) -> str:
    """Aggressive normalize for fuzzy matching (lowercase, alnum only)."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _js_album(js: Dict[str, Any]) -> str:
    """Extract a plain album name from a JioSaavn result.

    JioSaavn (and the Lyrica wrapper) may expose the album as a bare string or as
    a nested object (``{"name": …, "id": …}``). Normalize to a plain string.
    """
    alb = (js or {}).get("album")
    if not alb:
        return ""
    if isinstance(alb, dict):
        return alb.get("name") or alb.get("title") or ""
    return str(alb)


def _js_artist(js: Dict[str, Any]) -> str:
    """Extract a plain artist name from a JioSaavn result (string or nested dict)."""
    a = (js or {}).get("artist")
    if isinstance(a, dict):
        return a.get("name") or a.get("title") or ""
    return a or ""


# --------------------------------------------------------------------------- #
# Transport helpers
# --------------------------------------------------------------------------- #
def _headers() -> Dict[str, str]:
    base = {"Accept": "application/json"}
    base.update(settings.LYRICA_EXTRA_HEADERS)
    return base


async def _get_json(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """GET JSON from Lyrica, translating httpx failures into LyricaError."""
    rid = _request_id_ctx.get()
    path = urlparse(url).path
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            timeout=settings.lyrica_timeout,
            headers=_headers(),
            follow_redirects=True,
        ) as client:
            logger.info("[perf] upstream %s GET %s", rid, path)
            resp = await client.get(url, params=params)
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "[perf] upstream %s %s status=%d in %.1fms",
            rid,
            path,
            resp.status_code,
            elapsed,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.TimeoutException as exc:  # connect or read timeout
        elapsed = (time.perf_counter() - t0) * 1000
        logger.warning("[perf] upstream %s %s TIMEOUT in %.1fms", rid, path, elapsed)
        raise LyricaTimeout(f"Lyrica upstream timed out: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        logger.warning(
            "[perf] upstream %s %s HTTP %s in %.1fms",
            rid,
            path,
            exc.response.status_code,
            elapsed,
        )
        raise LyricaError(
            f"Lyrica upstream returned {exc.response.status_code}"
        ) from exc
    except httpx.HTTPError as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        logger.warning("[perf] upstream %s %s ERROR in %.1fms", rid, path, elapsed)
        raise LyricaError(f"Lyrica upstream error: {exc}") from exc


def _sanitize(params: Dict[str, Any]) -> Dict[str, Any]:
    """Drop anything that looks like a secret before logging."""
    return {k: ("***" if "key" in k.lower() or "token" in k.lower() else v)
            for k, v in params.items()}


# --------------------------------------------------------------------------- #
# Lyrics + metadata
# --------------------------------------------------------------------------- #
def _lyrics_found(payload: Dict[str, Any]) -> bool:
    if not payload or payload.get("status") == "error":
        return False
    data = payload.get("data") or {}
    if not data:
        return False
    has_lyrics = bool(data.get("lyrics")) or bool(data.get("timed_lyrics"))
    has_meta = bool(payload.get("metadata"))
    return has_lyrics or has_meta


async def _fetch_lyrics(artist: str, song: str) -> Optional[Dict[str, Any]]:
    """Fetch the raw Lyrica /lyrics/ payload. Returns None when not found.

    Transport/timeout failures raise LyricaTimeout/LyricaError (mapped to
    5xx by the route) — a not-found result is *not* an error here.
    """
    try:
        payload = await _get_json(
            f"{settings.LYRICA_URL}/lyrics/",
            {
                "artist": artist,
                "song": song,
                "fast": "true",
                "timestamps": "true",
                "metadata": "true",
                "mood": "true",
            },
        )
    except LyricaError:
        # Lyrics upstream down → treat as "no lyrics" but surface the error so
        # the caller can decide not-found vs 5xx. We re-raise to map to 5xx.
        raise
    if not _lyrics_found(payload):
        logger.info("lyrics not found for %s / %s", artist, song)
        return None
    return payload


# --------------------------------------------------------------------------- #
# JioSaavn stream (best effort — never raises; returns None on failure)
# --------------------------------------------------------------------------- #
async def _search_jiosaavn(query: str) -> List[Dict[str, Any]]:
    try:
        payload = await _get_json(
            f"{settings.LYRICA_URL}/api/jiosaavn/search",
            {"q": query},
        )
        return payload.get("results") or []
    except LyricaError as exc:
        logger.warning("jiosaavn search failed (%s): %s", query, exc)
        return []


async def _fetch_stream(perma_url: str) -> Optional[str]:
    if not perma_url:
        return None
    try:
        payload = await _get_json(
            f"{settings.LYRICA_URL}/api/jiosaavn/play",
            {"songLink": perma_url},
        )
        return (payload.get("data") or {}).get("stream_url") or None
    except LyricaError as exc:
        logger.warning("jiosaavn play failed (%s): %s", perma_url, exc)
        return None


# --------------------------------------------------------------------------- #
# Song-details cache
# --------------------------------------------------------------------------- #
def _cache_key(artist: str, song: str) -> str:
    return f"{artist.lower().strip()}|{song.lower().strip()}"


def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    item = _SONG_CACHE.get(key)
    if not item:
        return None
    expires_at, payload = item
    if time.time() > expires_at:
        _SONG_CACHE.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: Dict[str, Any]) -> None:
    _SONG_CACHE[key] = (time.time() + settings.SONG_CACHE_TTL, payload)


def cache_clear() -> None:
    """Drop all cached song-details (used by tests / admin)."""
    _SONG_CACHE.clear()


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def _build_song_details(
    artist: str,
    song: str,
    lyrics_payload: Optional[Dict[str, Any]],
    stream_url: Optional[str],
    jiosaavn_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Assemble the normalized SongDetails dict from upstream payloads."""
    data = (lyrics_payload or {}).get("data", {}) or {}
    metadata = (lyrics_payload or {}).get("metadata") or {}

    title = data.get("title") or song
    artist_r = data.get("artist") or artist
    album = metadata.get("album") or data.get("album") or ""

    # Artwork: prefer Lyrica metadata art, fall back to wiki thumbnail.
    artwork = metadata.get("album_art") or metadata.get("wiki_thumbnail") or ""

    # Duration: prefer metadata.ms, else data.duration (seconds).
    duration_ms: Optional[int] = None
    md = metadata.get("duration") or {}
    if md.get("ms"):
        duration_ms = int(md["ms"])
    elif data.get("duration"):
        try:
            duration_ms = int(round(float(data["duration"]) * 1000))
        except (TypeError, ValueError):
            duration_ms = None

    # Lyrics
    timed = data.get("timed_lyrics") or []
    synced = [
        {"timeMs": int(t.get("start_time") or 0), "text": t.get("text", "")}
        for t in timed
    ]
    plain = data.get("lyrics") or None
    lyrics_available = bool(plain or synced)
    lyrics_synced = bool(synced)

    mood = (lyrics_payload or {}).get("mood_analysis")

    sid = _stable_id(artist, song)

    return {
        "id": sid,
        # canonical
        "title": title,
        "artist": artist_r,
        "album": album,
        "artwork": artwork,
        "durationMs": duration_ms,
        "streamUrl": stream_url,
        "hasFullStream": bool(stream_url),
        "source": "lyrica",
        "lyricsAvailable": lyrics_available,
        # aliases
        "trackName": title,
        "artistName": artist_r,
        "collectionName": album,
        "artworkUrl100": artwork,
        "artworkUrl600": artwork,
        "previewUrl": stream_url,
        "trackTimeMillis": duration_ms,
        "artistId": None,
        "collectionId": None,
        "jiosaavnUrl": jiosaavn_url or (metadata.get("links", {}) or {}).get("external")
        or None,
        # extra
        "lyricsSynced": lyrics_synced,
        "lyrics": {
            "synced": synced,
            "plain": plain,
            "source": data.get("source"),
            "available": lyrics_available,
        },
        "mood": mood,
        "metadata": metadata or None,
    }


async def get_song_details(
    artist: str,
    song: str,
    url: Optional[str] = None,
) -> Dict[str, Any]:
    """Resolve a track into stream URL + lyrics + metadata.

    Resolution order for the stream:
      1. If a JioSaavn ``perma_url`` is supplied (e.g. from search enrichment),
         use it directly.
      2. Otherwise search JioSaavn by "artist song" and use the top match.

    Raises
    ------
    SongNotFound
        When neither lyrics nor a stream can be resolved (Lyrica says not found).
    LyricaTimeout / LyricaError
        On upstream transport failures (mapped to 504 / 502 by the route).
    """
    key = _cache_key(artist, song)
    cached = _cache_get(key)
    if cached is not None:
        logger.info("[perf] song-details cache HIT %s", key)
        return cached
    logger.info("[perf] song-details cache MISS %s", key)

    # 1) Lyrics + metadata (can raise → 5xx)
    lyrics_payload = await _fetch_lyrics(artist, song)

    # 2) Stream (best effort — never raises)
    stream_url: Optional[str] = None
    if url:
        stream_url = await _fetch_stream(url)
    if not stream_url:
        js = await _search_jiosaavn(f"{artist} {song}")
        if js and js[0].get("perma_url"):
            stream_url = await _fetch_stream(js[0]["perma_url"])

    if not lyrics_payload and not stream_url:
        logger.info("song not found: %s / %s", artist, song)
        raise SongNotFound(f"No lyrics or stream found for {artist} — {song}")

    if not stream_url:
        logger.info("stream missing for %s / %s (lyrics only)", artist, song)
    if not lyrics_payload:
        logger.info("lyrics missing for %s / %s (stream only)", artist, song)

    result = _build_song_details(artist, song, lyrics_payload, stream_url, url)
    _cache_set(key, result)
    return result


def _match_jiosaavn(
    suggestions: List[Dict[str, str]],
    js_results: List[Dict[str, Any]],
) -> Dict[str, Optional[Dict[str, Any]]]:
    """Map each suggestion (artist,title) to the best JioSaavn result."""
    by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for js in js_results:
        by_key[(_norm(js.get("title")), _norm(js.get("artist")))] = js

    out: Dict[str, Optional[Dict[str, Any]]] = {}
    for sug in suggestions:
        sn, sa = _norm(sug.get("title")), _norm(sug.get("artist"))
        best: Optional[Dict[str, Any]] = None
        best_score = 0
        for js in js_results:
            jn, ja = _norm(js.get("title")), _norm(js.get("artist"))
            if jn == sn and ja == sa:
                best, best_score = js, 3
                break
            score = 0
            if jn == sn:
                score = 2
            elif sn and (sn in jn or jn in sn):
                score = 1
            if score > best_score:
                best, best_score = js, score
        out[f"{sug.get('artist')}|{sug.get('title')}"] = best if best_score >= 1 else None
    return out


def _to_search_song(artist: str, title: str, js: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    sid = _stable_id(artist, title)
    js = js or {}
    artwork = js.get("thumbnail") or ""
    dur = js.get("duration")
    duration_ms = int(round(float(dur) * 1000)) if dur else None
    jurl = js.get("perma_url")
    album = _js_album(js)
    return {
        "id": sid,
        "title": title,
        "artist": artist,
        "album": album,
        "artwork": artwork,
        "durationMs": duration_ms,
        "streamUrl": None,
        "hasFullStream": bool(jurl),  # stream resolvable via JioSaavn
        "source": "lyrica",
        "lyricsAvailable": False,
        # aliases
        "trackName": title,
        "artistName": artist,
        "collectionName": album,
        "artworkUrl100": artwork,
        "artworkUrl600": artwork,
        "previewUrl": None,
        "trackTimeMillis": duration_ms,
        "artistId": None,
        "collectionId": None,
        "jiosaavnUrl": jurl,
    }


async def search_songs(query: str, limit: Optional[int] = None) -> Dict[str, Any]:
    """Telugu-biased search.

    Calls Lyrica ``/suggestion`` for the catalog list and enriches each result
    with JioSaavn artwork + ``perma_url`` (best effort, never fails the search).
    """
    term = normalize_query(query)
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)

    suggestion_task = _get_json(
        f"{settings.LYRICA_URL}/suggestion", {"q": term, "limit": limit}
    )

    try:
        suggestion = await suggestion_task
    except LyricaError as exc:
        # The primary catalog source failed → surface as upstream error.
        raise

    raw_results: List[Dict[str, str]] = (suggestion.get("results") or [])
    # Best-effort parallel JioSaavn enrichment (does not fail the search).
    js_results = await _search_jiosaavn(term)
    matched = _match_jiosaavn(raw_results, js_results)

    results = [
        _to_search_song(
            item.get("artist", ""),
            item.get("title", ""),
            matched.get(f"{item.get('artist')}|{item.get('title')}"),
        )
        for item in raw_results
    ]

    return {"query": term, "count": len(results), "results": results, "source": "lyrica"}


async def get_trending(limit: Optional[int] = None) -> Dict[str, Any]:
    """Home-page default list: a Telugu-biased JioSaavn search for popular songs.

    Uses JioSaavn (not ``/suggestion``) because it returns real, artwork-rich
    Telugu tracks for broad queries — ideal for the Home hero + shelves.
    """
    return await search_jiosaavn_tracks("latest telugu songs", limit)


async def search_jiosaavn_tracks(
    query: str, limit: Optional[int] = None
) -> Dict[str, Any]:
    """Telugu-biased search backed directly by JioSaavn.

    Returns real, artwork-rich, stream-ready Telugu tracks — used for the Home
    trending/shelf queries where ``/suggestion`` quality is poor for broad terms.
    """
    term = normalize_query(query)
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)
    js_results = await _search_jiosaavn(term)
    js_results = js_results[:limit]
    results = [
        _to_search_song(js.get("artist", ""), js.get("title", ""), js)
        for js in js_results
    ]
    return {"query": term, "count": len(results), "results": results, "source": "lyrica"}


def _fuzzy_contains(haystack: str, needle: str) -> bool:
    """True when two normalized names are equal OR one contains the other."""
    if not needle:
        return False
    return haystack == needle or needle in haystack


async def lookup_artist(name: str, limit: Optional[int] = None) -> Dict[str, Any]:
    """Best-effort artist page: JioSaavn search filtered to that artist.

    Returns a LookupResponse-shaped dict (type="artist"). Used by /api/lookup
    when called with a name (rather than a legacy numeric id). Results are
    biased toward tracks whose artist matches ``name``; if the fuzzy filter
    yields nothing we fall back to the raw JioSaavn results so the page is
    never needlessly empty.
    """
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)
    js_results = await _search_jiosaavn(f"{name} telugu")
    norm_target = _norm(name)
    matched = [
        js for js in js_results
        if _fuzzy_contains(_norm(js.get("artist")), norm_target)
    ]
    chosen = (matched or js_results)[:limit]
    results = [
        _to_search_song(_js_artist(js) or name, js.get("title") or "", js)
        for js in chosen
    ]
    artwork = results[0]["artworkUrl600"] if results else None
    return {
        "type": "artist",
        "title": name,
        "artworkUrl600": artwork,
        "results": results,
        "source": "lyrica",
    }


async def lookup_album(
    name: str, artist: Optional[str] = None, limit: Optional[int] = None
) -> Dict[str, Any]:
    """Best-effort album page: JioSaavn search filtered to that album.

    Returns a LookupResponse-shaped dict (type="album"). JioSaavn has no album
    id, so we search by album name (optionally disambiguated by ``artist``) and
    keep the tracks whose album matches ``name``; if none match we fall back to
    the raw search results so the page still renders something useful.
    """
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)
    query = f"{name} {artist}".strip() if artist else name
    js_results = await _search_jiosaavn(query)
    norm_target = _norm(name)
    matched = [
        js for js in js_results
        if _fuzzy_contains(_norm(_js_album(js)), norm_target)
    ]
    chosen = (matched or js_results)[:limit]
    results = [
        _to_search_song(_js_artist(js) or "", js.get("title") or "", js)
        for js in chosen
    ]
    artwork = results[0]["artworkUrl600"] if results else None
    return {
        "type": "album",
        "title": name,
        "artworkUrl600": artwork,
        "results": results,
        "source": "lyrica",
    }
