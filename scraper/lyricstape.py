"""LyricStape full-catalog crawler + index — the "hard way", done thoroughly.

LyricStape has no working search for older movies (its live search endpoint
returns empty), but EVERY album is reachable by its sequential integer id at
`/album/x/<id>` (the slug is ignored). This crawler walks ids 1..MAX_ALBUM_ID
once and stores a movie -> album -> songs index in the Mongo collection
`lyricstape_index`, so `LyricStapeSource` (in lyrics.py) can then look up any
song instantly by movie name + title — no live search needed, ever.

Resumable: already-crawled ids are skipped, so it's safe to stop/restart and to
re-run later to pick up newly added albums (just raise MAX_ALBUM_ID).

    python -m scraper.lyricstape              # crawl everything (skips done)
    python -m scraper.lyricstape 1 50         # crawl a specific id range
"""
from __future__ import annotations

import re
import sys
import time
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from curl_cffi import requests as cffi

from scraper import db

BASE = "https://www.lyricstape.com"
MAX_ALBUM_ID = 1117          # newest album id today; bump to pick up new releases
_TELUGU = re.compile(r"[ఀ-౿]")
_SESSION = cffi.Session(impersonate="chrome")


def _movie_name(soup: BeautifulSoup):
    t = soup.title.get_text(strip=True) if soup.title else ""
    t = re.sub(r"\s*Song Lyrics.*$", "", t, flags=re.I).strip()
    return t or None


def _latin(text: str) -> str:
    """Drop the Telugu run from a mixed 'తెలుగుRoman' anchor, keep the roman part."""
    return re.sub(r"[ఀ-౿]+", " ", text or "").strip()


def crawl_album(aid: int) -> dict:
    """Fetch one album page and return {_id, movie, songs:[{song_id,url,title}]}."""
    try:
        r = _SESSION.get(f"{BASE}/album/x/{aid}", timeout=20)
    except Exception as exc:
        return {"_id": aid, "movie": None, "songs": [], "error": str(exc)[:60]}
    if r.status_code != 200:
        return {"_id": aid, "movie": None, "songs": [], "http": r.status_code}

    soup = BeautifulSoup(r.text, "html.parser")
    songs, seen = [], set()
    for a in soup.select("a[href]"):
        h = a.get("href", "")
        # only this album's songs: URL must contain /<aid>/ and 'song-lyrics'
        if f"/{aid}/" not in h or "song-lyrics" not in h.lower():
            continue
        full = urljoin(BASE, h)
        if full in seen:
            continue
        seen.add(full)
        raw = a.get_text(" ", strip=True)
        songs.append({
            "song_id": h.rstrip("/").split("/")[-1],
            "url": full,
            "title": _latin(raw) or raw,
        })
    return {"_id": aid, "movie": _movie_name(soup), "songs": songs}


def crawl(start: int = 1, end: int = MAX_ALBUM_ID, delay: float = 0.15) -> None:
    col = db.get_collection("lyricstape_index")
    done = set(col.distinct("_id"))
    todo = [a for a in range(start, end + 1) if a not in done]
    print(f"crawling {len(todo)} albums (skipping {len(done)} already indexed)")

    songs_this_run = 0
    for i, aid in enumerate(todo, 1):
        doc = crawl_album(aid)
        col.replace_one({"_id": aid}, doc, upsert=True)
        songs_this_run += len(doc.get("songs") or [])
        if i % 50 == 0 or i == len(todo):
            print(f"  {i}/{len(todo)} | id {aid}: {doc.get('movie')} "
                  f"({len(doc.get('songs') or [])} songs) | songs indexed this run: {songs_this_run}")
        time.sleep(delay)

    albums = col.count_documents({})
    total_songs = sum(len(d.get("songs") or []) for d in col.find({}, {"songs": 1}))
    print(f"\ndone. index now holds {albums} albums and {total_songs} songs")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    nums = [int(x) for x in sys.argv[1:] if x.isdigit()]
    if len(nums) == 2:
        crawl(nums[0], nums[1])
    else:
        crawl()
