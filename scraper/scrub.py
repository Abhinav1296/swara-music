"""Scrubber + song identity — Journey 1, step (2): clean, version, fingerprint, dedupe.

JioSaavn (and every lyrics site) hands back messy, duplicated titles:

    "Inkem Inkem Inkem Kaavaale (From \"Geetha Govindam\")"   ← junk suffix
    the same recording re-listed under 3 compilation albums    ← duplicates
    "Inkem Inkem - Lofi Mix"                                    ← a real variant
    "Inkem Inkem" by a different singer                         ← a different song

This module turns that mess into clean, de-duplicated song records, each with a
stable identity (`_id`). It answers three questions the rest of the pipeline
depends on:

  * clean_title()    what is this song actually called? (strip the junk)
  * detect_version() is this the original, or a sad/female/lofi/remix cut?
  * dedupe_records() are two records the SAME recording? (so we never store
                     the same song three times, and never merge two real cuts)

Run it directly to watch it collapse real JioSaavn results:

    python -m scraper.scrub "inkem inkem"
"""
from __future__ import annotations

import asyncio
import hashlib
import html
import re
import sys
from collections import Counter
from typing import Any, Dict, List, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Cleaning: strip the junk humans and video-uploaders leave in titles
# ─────────────────────────────────────────────────────────────────────────────

# Version tags — extracted BEFORE we strip anything, so a "(Sad Version)" cut
# stays a distinct song instead of collapsing into the original.
_VERSION_WORDS = (
    "sad", "female", "male", "duet", "reprise", "lofi", "lo-fi", "acoustic",
    "unplugged", "cover", "bit", "solo", "instrumental", "karaoke",
    "slowed", "reverb", "remix", "mashup", "revisited", "extended",
)
_VERSION_RE = re.compile(r"\b(" + "|".join(map(re.escape, _VERSION_WORDS)) + r")\b", re.I)

# Pure junk phrases that never belong in a song's real title.
_JUNK_RE = re.compile(
    r"\b(lyrical|lyric video|lyrics|full video|video song|full song|"
    r"official|hd|4k|1080p|720p|teaser|promo|audio jukebox|jukebox)\b",
    re.I,
)

# "(From \"...\")", "(From Movie)", "[Lyrical Video]" etc. — bracketed noise.
_BRACKET_RE = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")

# The film name a compilation attaches: (From "Geetha Govindam"). Strong signal —
# the compilations literally tell us which movie the recording really belongs to.
_FROM_RE = re.compile(r'[\(\[]\s*from\s*["“”\']?\s*([^"“”\'\)\]]+?)\s*["“”\']?\s*[\)\]]', re.I)

# Compilation-album hints: when the SAME recording appears under several albums,
# these words mark the ones that are NOT the original film soundtrack.
_COMPILATION_HINTS = (
    "hits", "best of", "top ", "vol", "sensation", "mashup", "jukebox",
    "nonstop", "back to back", "blockbuster", "block buster", "super hit",
    "collection", "chartbuster", "mixtape", "mix tape", "anthem",
)


def _unescape(text: Optional[str]) -> str:
    return html.unescape(str(text or "")).strip()


def detect_version(*texts: str) -> str:
    """Return a version tag ('sad', 'female', 'lofi', ...) or 'original'."""
    blob = " ".join(_unescape(t) for t in texts)
    match = _VERSION_RE.search(blob)
    return match.group(1).lower().replace("lo-fi", "lofi") if match else "original"


def clean_title(raw_title: str) -> str:
    """Human-readable title with junk, brackets, and trailing dashes removed."""
    title = _unescape(raw_title)
    title = _BRACKET_RE.sub(" ", title)          # drop (From "..."), [Lyrical] etc.
    title = _JUNK_RE.sub(" ", title)             # drop lyrical/hd/official/...
    title = re.sub(r"\s*[-–—:|]\s*$", "", title)  # trailing separators
    title = re.sub(r"\s+", " ", title).strip(" -–—:|")
    return title


def clean_movie(raw_movie: str) -> str:
    movie = _unescape(raw_movie)
    movie = _BRACKET_RE.sub(" ", movie)
    return re.sub(r"\s+", " ", movie).strip()


def extract_from_movie(raw_title: str) -> str:
    """Pull the real film out of a '(From \"X\")' suffix, else ''."""
    match = _FROM_RE.search(_unescape(raw_title))
    return match.group(1).strip() if match else ""


def _is_compilation(album: str) -> bool:
    low = album.lower()
    return any(hint in low for hint in _COMPILATION_HINTS)


# ─────────────────────────────────────────────────────────────────────────────
# Identity: a stable fingerprint, and same-recording detection
# ─────────────────────────────────────────────────────────────────────────────

def norm_key(text: str) -> str:
    """Aggressive normalize for matching: lowercase, alphanumerics only."""
    return re.sub(r"[^a-z0-9]", "", _unescape(text).lower())


def fingerprint(clean_title_: str, movie: str, version: str) -> str:
    """Stable song id = SHA1(clean title | movie | version)[:16].

    Deliberately does NOT include duration — duration varies slightly across
    sources, so it's a matching *signal*, never part of identity.
    """
    raw = f"{norm_key(clean_title_)}|{norm_key(movie)}|{version}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _primary_singer(singers: str) -> str:
    return norm_key(singers.split(",")[0]) if singers else ""


def _same_recording(a: Dict[str, Any], b: Dict[str, Any], dur_tol: int = 5) -> bool:
    """True if a and b are the same recording under (possibly) different albums."""
    if norm_key(a["clean_title"]) != norm_key(b["clean_title"]):
        return False
    if a["version"] != b["version"]:
        return False
    if _primary_singer(a["singers"]) != _primary_singer(b["singers"]):
        return False
    da, db = a.get("duration_sec"), b.get("duration_sec")
    if da and db and abs(da - db) > dur_tol:
        return False
    return True


def _canonical_score(rec: Dict[str, Any]) -> tuple:
    """Higher is better: prefer the real film album, earliest year, 320kbps."""
    return (
        0 if _is_compilation(rec["movie"]) else 1,   # real soundtrack wins
        -(rec.get("year") or 9999),                  # earliest year wins
        1 if rec.get("has_320") else 0,
        -len(rec["movie"]),                          # shorter/cleaner album name
    )


def build_record(song: Dict[str, Any]) -> Dict[str, Any]:
    """Attach clean_title + version to a normalized JioSaavn song (no _id yet)."""
    rec = dict(song)
    rec["clean_title"] = clean_title(song.get("title", ""))
    rec["movie"] = clean_movie(song.get("movie", ""))
    rec["version"] = detect_version(song.get("title", ""), song.get("singers", ""))
    return rec


def dedupe_records(songs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collapse same-recording duplicates; keep one canonical record each.

    Returns one record per real song, with the canonical album chosen, a
    `_id` fingerprint assigned, and a `dupe_count` of how many raw results
    folded into it.
    """
    records = [build_record(s) for s in songs]
    groups: List[List[Dict[str, Any]]] = []
    for rec in records:
        for group in groups:
            if _same_recording(rec, group[0]):
                group.append(rec)
                break
        else:
            groups.append([rec])

    canonical: List[Dict[str, Any]] = []
    for group in groups:
        # Strongest signal first: if the compilations say (From "X"), X is the film.
        film = _film_from_hints(group)
        if film:
            # Prefer a listing already tagged with that film; else adopt the name.
            matches = [r for r in group if norm_key(r["movie"]) == norm_key(film)]
            best = max(matches or group, key=_canonical_score)
            best["movie"] = film
        else:
            best = max(group, key=_canonical_score)
        best["_id"] = fingerprint(best["clean_title"], best["movie"], best["version"])
        best["dupe_count"] = len(group)
        canonical.append(best)
    return canonical


def _film_from_hints(group: List[Dict[str, Any]]) -> str:
    """Most common '(From \"X\")' film name across a group of duplicates, or ''."""
    hints = [h for r in group if (h := extract_from_movie(r.get("title", "")))]
    if not hints:
        return ""
    top_key, _ = Counter(norm_key(h) for h in hints).most_common(1)[0]
    return next(h for h in hints if norm_key(h) == top_key)


# ─────────────────────────────────────────────────────────────────────────────
# Demo — `python -m scraper.scrub "your query"`
# ─────────────────────────────────────────────────────────────────────────────
def _demo(query: str) -> None:
    from scraper.jiosaavn import search_songs

    raw = asyncio.run(search_songs(query, limit=8))
    if not raw:
        print(f"No results for {query!r}. (Network blocked, or query too obscure.)")
        return

    print(f"\nRAW from JioSaavn: {len(raw)} results")
    for s in raw:
        print(f"   - {s['title']}  |  {s['movie']} ({s['year']})  |  {s['duration_sec']}s")

    songs = dedupe_records(raw)
    print(f"\nAFTER scrub + dedupe: {len(songs)} real song(s)\n")
    for s in songs:
        folded = f"  (folded {s['dupe_count']} listings)" if s["dupe_count"] > 1 else ""
        print(f"   [{s['_id']}]  {s['clean_title']}  ({s['version']})")
        print(f"       {s['singers']}  |  {s['movie']} ({s['year']})  |  {s['duration_sec']}s{folded}")
    print()


if __name__ == "__main__":
    _demo(" ".join(sys.argv[1:]) or "inkem inkem")
