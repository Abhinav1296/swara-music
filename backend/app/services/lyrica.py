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
  (504 timeout, 502 upstream, 429 rate-limited, 404 not found).
* Deduplicate JioSaavn search results by (normalized title, normalized artist)
  so multi-version duplicates (male/female/reprise/cover) do not spam the UI.
"""
import asyncio
import contextvars
import email.utils
import hashlib
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from app.config import settings

logger = logging.getLogger("swara.lyrica")

_request_id_ctx = contextvars.ContextVar("swara_rid", default="")

_TELUGU_INDICATORS = ("telugu", "tollywood", "kollywood", "south", "dj", "tamil")

_SONG_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}


class LyricaError(Exception):
    pass


class LyricaTimeout(LyricaError):
    pass


class LyricaRateLimited(LyricaError):
    def __init__(self, message: str, retry_after_seconds: Optional[float] = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class SongNotFound(LyricaError):
    pass


def _looks_telugu(text: str) -> bool:
    lowered = text.lower()
    if any(indicator in lowered for indicator in _TELUGU_INDICATORS):
        return True
    return any("\u0C00" <= ch <= "\u0C7F" for ch in text)


def normalize_query(query: str) -> str:
    q = (query or "").strip()
    if not q:
        return "telugu"
    if _looks_telugu(q):
        return q
    return f"{q} telugu"


def _stable_id(artist: str, title: str, album: str = "") -> str:
    raw = f"{artist}|{title}|{album}".lower().strip()
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _js_album(js: Dict[str, Any]) -> str:
    alb = (js or {}).get("album")
    if not alb:
        return ""
    if isinstance(alb, dict):
        return alb.get("name") or alb.get("title") or ""
    return str(alb)


def _js_artist(js: Dict[str, Any]) -> str:
    a = (js or {}).get("artist")
    if isinstance(a, dict):
        return a.get("name") or a.get("title") or ""
    return a or ""


def _headers() -> Dict[str, str]:
    base = {"Accept": "application/json"}
    base.update(settings.LYRICA_EXTRA_HEADERS)
    return base


def _parse_retry_after(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    value = value.strip()
    try:
        return float(value)
    except ValueError:
        pass
    try:
        dt = email.utils.parsedate_to_datetime(value)
        if dt:
            delta = dt.timestamp() - time.time()
            return max(0.0, delta)
    except Exception:
        pass
    return None


async def _get_json(url: str, params: Dict[str, Any], *, retry_on_429: bool = True) -> Dict[str, Any]:
    rid = _request_id_ctx.get()
    path = urlparse(url).path

    async def _do_request() -> httpx.Response:
        async with httpx.AsyncClient(
            timeout=settings.lyrica_timeout,
            headers=_headers(),
            follow_redirects=True,
        ) as client:
            return await client.get(url, params=params)

    t0 = time.perf_counter()
    try:
        logger.info("[perf] upstream %s GET %s", rid, path)
        resp = await _do_request()

        if resp.status_code == 429 and retry_on_429:
            retry_after = _parse_retry_after(resp.headers.get("Retry-After"))
            wait_s = min(retry_after if retry_after is not None else 1.0, 5.0)
            logger.warning(
                "[perf] upstream %s %s 429 — retry-after=%.1fs backing off",
                rid, path, wait_s,
            )
            await asyncio.sleep(wait_s)
            resp = await _do_request()

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "[perf] upstream %s %s status=%d in %.1fms",
            rid, path, resp.status_code, elapsed,
        )

        if resp.status_code == 429:
            retry_after = _parse_retry_after(resp.headers.get("Retry-After"))
            raise LyricaRateLimited(
                f"Lyrica upstream rate-limited (retry-after={retry_after}s)",
                retry_after_seconds=retry_after,
            )

        resp.raise_for_status()
        return resp.json()

    except httpx.TimeoutException as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        logger.warning("[perf] upstream %s %s TIMEOUT in %.1fms", rid, path, elapsed)
        raise LyricaTimeout(f"Lyrica upstream timed out: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        logger.warning(
            "[perf] upstream %s %s HTTP %s in %.1fms",
            rid, path, exc.response.status_code, elapsed,
        )
        raise LyricaError(
            f"Lyrica upstream returned {exc.response.status_code}"
        ) from exc
    except httpx.HTTPError as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        logger.warning("[perf] upstream %s %s ERROR in %.1fms", rid, path, elapsed)
        raise LyricaError(f"Lyrica upstream error: {exc}") from exc


def _sanitize(params: Dict[str, Any]) -> Dict[str, Any]:
    return {k: ("***" if "key" in k.lower() or "token" in k.lower() else v)
            for k, v in params.items()}


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
        raise
    if not _lyrics_found(payload):
        logger.info("lyrics not found for %s / %s", artist, song)
        return None
    return payload


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
    _SONG_CACHE.clear()


def _build_song_details(
    artist: str,
    song: str,
    lyrics_payload: Optional[Dict[str, Any]],
    stream_url: Optional[str],
    jiosaavn_url: Optional[str] = None,
) -> Dict[str, Any]:
    data = (lyrics_payload or {}).get("data", {}) or {}
    metadata = (lyrics_payload or {}).get("metadata") or {}

    title = data.get("title") or song
    artist_r = data.get("artist") or artist
    album = metadata.get("album") or data.get("album") or ""
    artwork = metadata.get("album_art") or metadata.get("wiki_thumbnail") or ""

    duration_ms: Optional[int] = None
    md = metadata.get("duration") or {}
    if md.get("ms"):
        duration_ms = int(md["ms"])
    elif data.get("duration"):
        try:
            duration_ms = int(round(float(data["duration"]) * 1000))
        except (TypeError, ValueError):
            duration_ms = None

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
        "title": title,
        "artist": artist_r,
        "album": album,
        "artwork": artwork,
        "durationMs": duration_ms,
        "streamUrl": stream_url,
        "hasFullStream": bool(stream_url),
        "source": "lyrica",
        "lyricsAvailable": lyrics_available,
        "trackName": title,
        "artistName": artist_r,
        "collectionName": album,
        "artworkUrl100": artwork,
        "artworkUrl600": artwork,
        "previewUrl": stream_url,
        "trackTimeMillis": duration_ms,
        "artistId": None,
        "collectionId": None,
        "jiosaavnUrl": jiosaavn_url or (metadata.get("links", {}) or {}).get("external") or None,
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
    key = _cache_key(artist, song)
    cached = _cache_get(key)
    if cached is not None:
        logger.info("[perf] song-details cache HIT %s", key)
        return cached
    logger.info("[perf] song-details cache MISS %s", key)

    lyrics_payload = await _fetch_lyrics(artist, song)

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


async def get_stream_url(
    artist: str,
    song: str,
    url: Optional[str] = None,
) -> Optional[str]:
    """
    Resolve ONLY the stream URL for a track (no lyrics, no metadata).
    Never raises — failures are logged and return None.
    """
    if url:
        stream_url = await _fetch_stream(url)
        if stream_url:
            return stream_url

    js = await _search_jiosaavn(f"{artist} {song}")
    if js and js[0].get("perma_url"):
        stream_url = await _fetch_stream(js[0]["perma_url"])
        if stream_url:
            return stream_url

    logger.info("stream not resolvable for %s / %s", artist, song)
    return None


async def get_stream_details(
    artist: str,
    song: str,
    url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resolve a track into stream URL + minimal metadata (no lyrics, no mood).

    Fetches JioSaavn results ONCE, then uses that single result for both the
    stream URL and the metadata (artwork/album/duration). Previous version
    called _search_jiosaavn twice — this halves upstream calls on every
    /api/stream request.

    Raises SongNotFound / LyricaTimeout / LyricaError / LyricaRateLimited.
    """
    stream_url: Optional[str] = None
    first_js: Optional[Dict[str, Any]] = None

    # 1) If caller supplied a perma_url, use it directly (fast path).
    if url:
        stream_url = await _fetch_stream(url)

    # 2) Otherwise (or if the direct fetch failed) search JioSaavn ONCE.
    if not stream_url:
        js = await _search_jiosaavn(f"{artist} {song}")
        if js:
            first_js = js[0]
            perma = first_js.get("perma_url")
            if perma:
                stream_url = await _fetch_stream(perma)

    if not stream_url:
        logger.info("stream not found for %s / %s", artist, song)
        raise SongNotFound(f"No stream found for {artist} — {song}")

    # 3) If we didn't hit the JS search above (direct-url path), do a single
    #    lightweight search now for the artwork/album metadata.
    if first_js is None:
        js = await _search_jiosaavn(f"{artist} {song}")
        first_js = js[0] if js else None

    # 4) Extract minimal metadata from the JS result (if any).
    artwork = ""
    duration_ms: Optional[int] = None
    album = ""
    if first_js:
        artwork = first_js.get("thumbnail") or ""
        dur = first_js.get("duration")
        if dur:
            try:
                duration_ms = int(round(float(dur) * 1000))
            except (TypeError, ValueError):
                duration_ms = None
        album = _js_album(first_js)

    sid = _stable_id(artist, song)
    return {
        "status": "success",
        "stream_url": stream_url,
        "artist": artist,
        "title": song,
        "album": album or None,
        "artwork": artwork or None,
        "durationMs": duration_ms,
        "source": "lyrica",
        "id": sid,
    }


def _match_jiosaavn(
    suggestions: List[Dict[str, str]],
    js_results: List[Dict[str, Any]],
) -> Dict[str, Optional[Dict[str, Any]]]:
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
        "hasFullStream": bool(jurl),
        "source": "lyrica",
        "lyricsAvailable": False,
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


def _dedupe_js_results(js_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deduplicate JioSaavn results by (normalized title, normalized artist).
    JioSaavn returns many near-duplicate versions of the same song (male/female,
    reprise, cover, karaoke, etc.) — collapse them to the first hit per pair.
    Preserves original ordering (relevance from JioSaavn).
    """
    seen: set = set()
    unique: List[Dict[str, Any]] = []
    for js in js_results:
        key = (_norm(js.get("title")), _norm(js.get("artist")))
        if not key[0]:
            continue
        if key in seen:
            continue
        seen.add(key)
        unique.append(js)
    return unique


async def search_songs(query: str, limit: Optional[int] = None) -> Dict[str, Any]:
    term = normalize_query(query)
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)

    suggestion_task = _get_json(
        f"{settings.LYRICA_URL}/suggestion", {"q": term, "limit": limit}
    )

    try:
        suggestion = await suggestion_task
    except LyricaError:
        raise

    raw_results: List[Dict[str, str]] = (suggestion.get("results") or [])
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
    return await search_jiosaavn_tracks("latest telugu songs", limit)


async def search_jiosaavn_tracks(
    query: str, limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Telugu-biased JioSaavn search. Deduplicates by (title, artist) so multi-
    version duplicates (male/female/reprise/cover/karaoke) do not repeat.
    """
    term = normalize_query(query)
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)
    js_results = await _search_jiosaavn(term)
    js_unique = _dedupe_js_results(js_results)
    js_unique = js_unique[:limit]
    results = [
        _to_search_song(js.get("artist", ""), js.get("title", ""), js)
        for js in js_unique
    ]
    return {"query": term, "count": len(results), "results": results, "source": "lyrica"}


def _fuzzy_contains(haystack: str, needle: str) -> bool:
    if not needle:
        return False
    return haystack == needle or needle in haystack


async def lookup_artist(name: str, limit: Optional[int] = None) -> Dict[str, Any]:
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)
    js_results = await _search_jiosaavn(f"{name} telugu")
    js_results = _dedupe_js_results(js_results)
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
    limit = min(max(limit or settings.DEFAULT_LIMIT, 1), settings.MAX_LIMIT)
    query = f"{name} {artist}".strip() if artist else name
    js_results = await _search_jiosaavn(query)
    js_results = _dedupe_js_results(js_results)
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