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
import asyncio
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

# Shared, pooled httpx.AsyncClient. Created once via the FastAPI lifespan hook
# (see app.main) and reused for every upstream call so keep-alive connections
# avoid the 0.5–1.5s TLS handshake that a per-request client pays each time.
# ``None`` until the lifespan starts it; all callers go through get_client().
_http_client: Optional[httpx.AsyncClient] = None

# Bounds concurrent upstream calls to Lyrica/JioSaavn so a burst of Home
# requests can't overload the personal Lyrica instance.
_upstream_semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_UPSTREAM)


def get_client() -> Optional[httpx.AsyncClient]:
    """Return the shared pooled client (or None before the lifespan starts it)."""
    return _http_client


def set_http_client(client: httpx.AsyncClient) -> None:
    """Install the process-wide pooled client (called from the FastAPI lifespan)."""
    global _http_client
    _http_client = client


def clear_http_client() -> None:
    """Drop the pooled client reference (called on lifespan shutdown)."""
    global _http_client
    _http_client = None


# --------------------------------------------------------------------------- #
# TTL cache + in-flight coalescing for the read-heavy list endpoints
# --------------------------------------------------------------------------- #
# Each namespace holds:
#   "store":    key -> (expires_at_epoch, payload)
#   "inflight": key -> asyncio.Task   (an in-progress upstream call)
# Concurrent identical requests share a single upstream call via the inflight
# task; on completion the result is cached. A size cap + LRU eviction bounds
# memory, and expired entries are dropped on access / during eviction sweeps.
_CACHES: Dict[str, Dict[str, Any]] = {
    "search": {"store": {}, "inflight": {}},
    "trending": {"store": {}, "inflight": {}},
    "lookup": {"store": {}, "inflight": {}},
}


def cache_clear() -> None:
    """Drop all cached results (song-details + list endpoints). Tests / admin."""
    _SONG_CACHE.clear()
    for _ns in _CACHES.values():
        _ns["store"].clear()
        _ns["inflight"].clear()


def _evict(store: Dict[str, Tuple[float, Any]], now: float) -> None:
    """Drop expired entries, then the oldest (LRU by insertion order), until the
    store shrinks back under settings.CACHE_MAX_ENTRIES."""
    if len(store) < settings.CACHE_MAX_ENTRIES:
        return
    for _k in [k for k, (exp, _v) in store.items() if now > exp]:
        del store[_k]
    while len(store) >= settings.CACHE_MAX_ENTRIES:
        store.pop(next(iter(store)))


async def _cached(namespace: str, key: str, ttl: int, maker) -> Any:
    """Return the cached value for ``key``, computing it via ``maker`` on miss.

    Concurrent identical requests (same namespace+key) share one upstream call
    through an in-flight asyncio.Task, so a burst of Home loads coalesces into a
    single Lyrica/JioSaavn request. Only successful results are cached; errors
    propagate and are never stored.
    """
    ns = _CACHES[namespace]
    store = ns["store"]
    inflight = ns["inflight"]
    now = time.time()

    item = store.get(key)
    if item is not None:
        expires_at, value = item
        if now <= expires_at:
            logger.info("[perf] %s cache HIT %s", namespace, key)
            store[key] = (expires_at, value)  # bump recency (LRU)
            return value
        del store[key]

    task = inflight.get(key)
    if task is not None:
        logger.info("[perf] %s cache COALESCE %s", namespace, key)
        return await task

    async def _run() -> Any:
        try:
            value = await maker()
            store[key] = (time.time() + ttl, value)
            _evict(store, time.time())
            return value
        finally:
            inflight.pop(key, None)

    task = asyncio.create_task(_run())
    inflight[key] = task
    return await task


class LyricaError(Exception):
    """Base class for Lyrica/upstream failures mapped to 5xx by the route."""


class LyricaTimeout(LyricaError):
    """Upstream timed out — route maps this to 504."""


class LyricaRateLimited(LyricaError):
    """Upstream returned HTTP 429 — route maps this to 429 with Retry-After.

    Retained for the route layer's error mapping; the pooled-client path handles
    429s internally, so this may not be raised, but keeping it defined lets
    ``app.routes.search`` import and map it uniformly.
    """

    def __init__(self, message: str, retry_after_seconds=None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


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
        async with _upstream_semaphore:
            client = get_client()
            if client is None:
                # Safety net: per-call client if the lifespan hasn't attached one.
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(
                        connect=settings.LYRICA_CONNECT_TIMEOUT,
                        read=settings.LYRICA_READ_TIMEOUT,
                        write=settings.LYRICA_READ_TIMEOUT,
                        pool=settings.LYRICA_READ_TIMEOUT,
                    ),
                    headers=_headers(),
                    follow_redirects=True,
                ) as client:
                    logger.info("[perf] upstream %s GET %s", rid, path)
                    resp = await client.get(url, params=params)
            else:
                logger.info("[perf] upstream %s GET %s", rid, path)
                resp = await client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "[perf] upstream %s %s status=%d in %.1fms",
            rid,
            path,
            resp.status_code,
            elapsed,
        )
        return payload
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

    # 1) Lyrics + metadata (can raise → 5xx). Start it now and let it overlap
    #    with stream resolution below, since the two hit independent upstreams.
    lyrics_task = asyncio.create_task(_fetch_lyrics(artist, song))

    # 2) Stream (best effort — never raises).
    stream_url: Optional[str] = None
    if url:
        stream_url = await _fetch_stream(url)
    # JioSaavn search is independent of the lyrics fetch, so it overlaps with it.
    js = (await _search_jiosaavn(f"{artist} {song}")) if not stream_url else None

    # Await lyrics last so any upstream transport error surfaces as 5xx
    # (preserving the original failure semantics exactly).
    lyrics_payload = await lyrics_task

    if not stream_url and js and js[0].get("perma_url"):
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
    """Telugu-biased typed search — routed entirely through JioSaavn.

    Typed queries and "See All" grids use the SAME JioSaavn flow as the Home
    mood shelves (``search_jiosaavn_tracks``), NOT Lyrica ``/suggestion``.
    ``/suggestion`` mixes wrong-genre compilation tracks into broad terms
    (e.g. Christian songs surfacing for "telugu romantic songs"), whereas
    JioSaavn returns real, artwork-rich, stream-ready Telugu results. One flow
    for everything — no bespoke keyword matching to go wrong.
    """
    return await search_jiosaavn_tracks(query, limit)


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
    Cached (TTL) and coalesced so the Hero + each mood shelf share one upstream
    call per distinct query.
    """
    term = normalize_query(query)
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)

    async def maker() -> Dict[str, Any]:
        js_results = await _search_jiosaavn(term)
        js_results = js_results[:limit]
        results = [
            _to_search_song(js.get("artist", ""), js.get("title", ""), js)
            for js in js_results
        ]
        return {"query": term, "count": len(results), "results": results, "source": "lyrica"}

    return await _cached("trending", f"{term}|{limit}", settings.TRENDING_CACHE_TTL, maker)


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

    async def maker() -> Dict[str, Any]:
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

    return await _cached(
        "lookup", f"artist|{name.lower()}|{limit}", settings.LOOKUP_CACHE_TTL, maker
    )


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

    async def maker() -> Dict[str, Any]:
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

    return await _cached(
        "lookup",
        f"album|{name.lower()}|{(artist or '').lower()}|{limit}",
        settings.LOOKUP_CACHE_TTL,
        maker,
    )
