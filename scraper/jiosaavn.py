"""Independent JioSaavn client — Journey 1, step (1): "ask JioSaavn about a song".

Talks DIRECTLY to JioSaavn's own public API (``www.jiosaavn.com/api.php``).
No personal Lyrica instance, no ``saavnapi-nine.vercel.app`` wrapper — this is
the layer that makes Swara independent. Given a search query it returns clean,
normalized records that map straight onto the Swara song form:

    title / movie / year / singers / artwork / duration_sec / language
    + jiosaavn_id + perma_url + encrypted_media_url   (the permanent handle)

It also turns a song into a real, playable audio URL by decrypting JioSaavn's
``encrypted_media_url`` locally (DES in ECB mode, key ``38346591`` — the same
technique every open JioSaavn client uses). Because the decrypt is pure local
math, a *stored* ``encrypted_media_url`` becomes a stream link with **no network
call** at play time.

Run it directly to see it work:

    python -m scraper.jiosaavn "inkem inkem"
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import sys
from base64 import b64decode
from typing import Any, Dict, List, Optional

import httpx
from Crypto.Cipher import DES

logger = logging.getLogger("swara.jiosaavn")

# JioSaavn's internal web API. These params make it return clean JSON.
API_BASE = "https://www.jiosaavn.com/api.php"
_COMMON_PARAMS = {
    "_format": "json",
    "_marker": "0",
    "api_version": "4",
    "ctx": "web6dot0",
}
_HEADERS = {
    "Accept": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

# DES key JioSaavn uses to encrypt its media URLs (public knowledge).
_DES_KEY = b"38346591"
_TIMEOUT = httpx.Timeout(15.0)


# ─────────────────────────────────────────────────────────────────────────────
# Small helpers
# ─────────────────────────────────────────────────────────────────────────────
def _clean_text(text: Optional[str]) -> str:
    """Unescape HTML entities (JioSaavn returns &quot; &amp; etc.) and trim."""
    if not text:
        return ""
    return html.unescape(str(text)).strip()


def _to_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _hi_res_image(url: Optional[str]) -> str:
    """JioSaavn serves 150x150 thumbnails; bump them to 500x500."""
    if not url:
        return ""
    return re.sub(r"\d+x\d+", "500x500", url, count=1)


def _primary_artists(raw: Dict[str, Any], more: Dict[str, Any]) -> str:
    """Best-effort 'singers' string, preferring the structured artist map."""
    artist_map = more.get("artistMap") or {}
    for key in ("primary_artists", "artists", "singers"):
        people = artist_map.get(key) or []
        names = [_clean_text(p.get("name")) for p in people if isinstance(p, dict) and p.get("name")]
        if names:
            return ", ".join(dict.fromkeys(names))  # de-dupe, keep order
    # Fallbacks when the structured map is absent.
    return _clean_text(more.get("music")) or _clean_text(raw.get("subtitle"))


def _normalize(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Turn one raw JioSaavn result into a Swara-shaped song record."""
    more = raw.get("more_info") or {}
    duration = more.get("duration") or raw.get("duration")
    return {
        # ── identity / metadata (fills the "WHO" part of the form) ──
        "title": _clean_text(raw.get("title") or raw.get("song")),
        "movie": _clean_text(more.get("album") or raw.get("album")),
        "year": _to_int(raw.get("year") or more.get("year")),
        "singers": _primary_artists(raw, more),
        "language": (raw.get("language") or more.get("language") or "").lower(),
        "duration_sec": _to_int(duration),
        "artwork": _hi_res_image(raw.get("image")),
        # ── the permanent handle (fills the "HOW DO WE PLAY IT" part) ──
        "jiosaavn_id": raw.get("id"),
        "perma_url": raw.get("perma_url") or "",
        "encrypted_media_url": more.get("encrypted_media_url") or "",
        "has_320": str(more.get("320kbps") or "").lower() == "true",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
async def search_songs(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Search JioSaavn for songs; return normalized, Swara-shaped records."""
    params = {
        **_COMMON_PARAMS,
        "__call": "search.getResults",
        "q": query,
        "p": "1",
        "n": str(limit),
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        resp = await client.get(API_BASE, params=params)
        resp.raise_for_status()
        data: Any = resp.json()

    # JioSaavn occasionally double-encodes the body as a JSON string.
    if isinstance(data, str):
        data = json.loads(data)

    results = data.get("results") if isinstance(data, dict) else None
    if not results:
        logger.info("no JioSaavn results for %r", query)
        return []

    songs = [_normalize(r) for r in results if r.get("id")]
    logger.info("JioSaavn returned %d songs for %r", len(songs), query)
    return songs


async def search_artists(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Search JioSaavn for ARTISTS (people, not songs) and return light records:

        {name, image (500x500), perma_url, jiosaavn_id, is_photo}

    ``is_photo`` is True only when JioSaavn has a real artist PORTRAIT — an image
    served under ``/artists/`` — as opposed to a default placeholder
    (``/_i/3.0/artist-default-*.png``) or a song-poster stand-in. That single
    flag is what lets a caller show the singer's face and never a movie poster
    dressed up as the singer.
    """
    params = {
        **_COMMON_PARAMS,
        "__call": "search.getArtistResults",
        "q": query,
        "p": "1",
        "n": str(limit),
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        resp = await client.get(API_BASE, params=params)
        resp.raise_for_status()
        data: Any = resp.json()

    if isinstance(data, str):
        data = json.loads(data)

    results = data.get("results") if isinstance(data, dict) else data
    out: List[Dict[str, Any]] = []
    for a in (results or []):
        if not isinstance(a, dict):
            continue
        img = _hi_res_image(a.get("image"))
        out.append({
            "name": _clean_text(a.get("name") or a.get("title")),
            "image": img,
            "perma_url": a.get("perma_url") or "",
            "jiosaavn_id": a.get("id"),
            "is_photo": "/artists/" in (img or ""),
        })
    return out


async def trending_songs(language: str = "telugu", limit: int = 24) -> List[Dict[str, Any]]:
    """JioSaavn's *trending now* SONGS for one language, normalized Swara-shape.

    This is the real homepage feed JioSaavn serves (``content.getTrending``),
    scoped to a language via both the param and the ``L`` cookie. Every row
    carries an ``encrypted_media_url``, so the caller can decrypt a playable
    link locally with no extra request.
    """
    params = {
        **_COMMON_PARAMS,
        "__call": "content.getTrending",
        "entity_type": "song",
        "entity_language": language,
    }
    headers = {**_HEADERS, "Cookie": f"L={language}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=headers, follow_redirects=True) as client:
        resp = await client.get(API_BASE, params=params)
        resp.raise_for_status()
        data: Any = resp.json()

    if isinstance(data, str):
        data = json.loads(data)

    # The endpoint returns a bare list; older shapes nest it under "data".
    rows = data if isinstance(data, list) else (data.get("data") if isinstance(data, dict) else None)
    songs = [_normalize(r) for r in (rows or []) if isinstance(r, dict) and r.get("id")]
    return songs[:limit]


async def new_release_albums(language: str = "telugu", limit: int = 20) -> List[Dict[str, Any]]:
    """JioSaavn's newest ALBUMS for one language, as light cards:

        {album_id, name, year, image (500x500), perma_url, song_count}

    Pair with :func:`album_tracks` to expand any card into playable songs.
    """
    params = {
        **_COMMON_PARAMS,
        "__call": "content.getTrending",
        "entity_type": "album",
        "entity_language": language,
    }
    headers = {**_HEADERS, "Cookie": f"L={language}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=headers, follow_redirects=True) as client:
        resp = await client.get(API_BASE, params=params)
        resp.raise_for_status()
        data: Any = resp.json()
    if isinstance(data, str):
        data = json.loads(data)
    rows = data if isinstance(data, list) else (data.get("data") if isinstance(data, dict) else None)
    out: List[Dict[str, Any]] = []
    for a in (rows or []):
        if not isinstance(a, dict) or not a.get("id"):
            continue
        more = a.get("more_info") or {}
        out.append({
            "album_id": str(a.get("id")),
            "name": _clean_text(a.get("title")),
            "year": _to_int(more.get("year") or a.get("year")),
            "image": _hi_res_image(a.get("image")),
            "perma_url": a.get("perma_url") or "",
            "song_count": _to_int(more.get("song_count")),
        })
    return out[:limit]


async def album_tracks(album_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Expand a JioSaavn album id into its normalized, Swara-shaped SONGS (each
    with an ``encrypted_media_url`` for local-decrypt playback)."""
    params = {**_COMMON_PARAMS, "__call": "content.getAlbumDetails", "albumid": str(album_id)}
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        resp = await client.get(API_BASE, params=params)
        resp.raise_for_status()
        data: Any = resp.json()
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        return []
    raw = data.get("songs") or data.get("list") or data.get("tracks") or []
    songs = [_normalize(s) for s in raw if isinstance(s, dict) and s.get("id")]
    return songs[:limit]


async def search_paged(query: str, pages: int = 3, per_page: int = 30) -> List[Dict[str, Any]]:
    """Search JioSaavn across several result pages; return normalized records.

    For a broad crawl one page isn't enough. This walks pages p=1..`pages`,
    de-duplicating by JioSaavn id as it goes, and STOPS EARLY when a page adds
    nothing new (either the API returned fewer than `per_page` rows, or every
    row was already seen — which also covers the case where JioSaavn ignores the
    `p` param and just replays page 1). One reused client, never raises for a
    single bad page.
    """
    out: List[Dict[str, Any]] = []
    seen_ids: set = set()
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        for p in range(1, pages + 1):
            params = {
                **_COMMON_PARAMS,
                "__call": "search.getResults",
                "q": query,
                "p": str(p),
                "n": str(per_page),
            }
            try:
                resp = await client.get(API_BASE, params=params)
                resp.raise_for_status()
                data: Any = resp.json()
            except Exception as exc:  # noqa: BLE001 - one bad page shouldn't kill the crawl
                logger.warning("search_paged %r page %d failed: %s", query, p, exc)
                break
            if isinstance(data, str):
                data = json.loads(data)
            results = data.get("results") if isinstance(data, dict) else None
            if not results:
                break
            new = 0
            for r in results:
                rid = r.get("id")
                if not rid or rid in seen_ids:
                    continue
                seen_ids.add(rid)
                out.append(_normalize(r))
                new += 1
            if len(results) < per_page or new == 0:
                break
    return out


def resolve_stream(encrypted_media_url: str, prefer_320: bool = True) -> Optional[str]:
    """Decrypt JioSaavn's encrypted_media_url into a real, playable CDN URL.

    Pure local computation (DES/ECB) — no network call. Returns None if the
    input is empty or cannot be decrypted.
    """
    if not encrypted_media_url:
        return None
    try:
        cipher = DES.new(_DES_KEY, DES.MODE_ECB)
        decrypted = cipher.decrypt(b64decode(encrypted_media_url))
        # Strip PKCS5/PKCS7 padding (last byte = pad length, 1..8).
        pad = decrypted[-1]
        if 1 <= pad <= 8:
            decrypted = decrypted[:-pad]
        url = decrypted.decode("utf-8", errors="ignore").strip()
    except Exception as exc:  # noqa: BLE001 - never crash the caller over one URL
        logger.warning("could not decrypt media url: %s", exc)
        return None

    if prefer_320:
        url = url.replace("_96.mp4", "_320.mp4")
    return url or None


# ─────────────────────────────────────────────────────────────────────────────
# Demo — `python -m scraper.jiosaavn "your query"`
# ─────────────────────────────────────────────────────────────────────────────
def _demo(query: str) -> None:
    songs = asyncio.run(search_songs(query, limit=5))
    if not songs:
        print(f"No results for {query!r}. (Network blocked, or query too obscure.)")
        return

    print(f"\nTop {len(songs)} JioSaavn results for {query!r}:\n")
    for i, s in enumerate(songs, 1):
        yr = s["year"] or "----"
        print(f"  {i}. {s['title']}  -  {s['singers']}")
        print(f"       movie: {s['movie']} ({yr})   {s['duration_sec']}s   lang={s['language']}   320kbps={s['has_320']}")
        print(f"       id: {s['jiosaavn_id']}   art: {s['artwork']}")

    stream = resolve_stream(songs[0]["encrypted_media_url"])
    print("\n  Playable audio link for #1 (decrypted locally, no extra call):")
    print(f"       {stream}\n")


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    _demo(" ".join(sys.argv[1:]) or "inkem inkem")
