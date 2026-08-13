"""Classify clearly NON-LYRICAL tracks (BGM / OST / themes / teasers / score cues)
and segregate them from real songs.

Why: ~60% of the catalog has no lyrics, but a slice of that is instrumental/promo
content that was NEVER meant to have lyrics. Tagging it (a) gives an honest
"missing lyrics" number over REAL songs, (b) lets the app show an "Instrumental"
badge instead of a sad "lyrics unavailable", and (c) stops the lyric fill from
wasting fetches on them.

Design principles:
  * CONSERVATIVE — only strong title/album signals tag a track. Ambiguous stays a
    real song (better to under-tag than hide a real song from lyrics/search).
  * REVERSIBLE — only sets flags (`no_lyrics_expected`, `content_type`); never
    deletes. `untag()` clears them.
  * Idempotent — safe to re-run.

Run:
    python -m scraper.classify            # dry-run: counts + samples, no writes
    python -m scraper.classify apply      # apply the tags
    python -m scraper.classify untag      # revert
"""
from __future__ import annotations

import re
import sys
from typing import Optional

from scraper import db

# The TRACK itself is clearly non-lyrical (word appears in the song title).
_TITLE_RE = re.compile(
    r"\b(theme|themes|bgm|background\s*score|instrumental|prelude|interlude|"
    r"motif|overture|end\s*credits|title\s*music|opening\s*music|underscore|"
    r"\bost\b|making|teaser|trailer|promo|glimpse|first\s*look|announcement|"
    r"motion\s*poster|snippet|title\s*card)\b",
    re.I,
)
# The whole RELEASE is instrumental/promo (word appears in the album/movie name).
_MOVIE_RE = re.compile(
    r"(\bbgm\b|\bost\b|background\s*score|original\s*score|original\s*background|"
    r"\binstrumental\b|\bscore\b|teaser|trailer|glimpse|motion\s*poster|"
    r"first\s*look|title\s*music)",
    re.I,
)


def classify(title: Optional[str], movie: Optional[str]) -> Optional[str]:
    """Return 'instrumental' if the track is clearly non-lyrical, else None.

    Two independent signals; either fires. Kept deliberately narrow so a real song
    with an ordinary Telugu title in an ordinary album is never tagged.
    """
    if _TITLE_RE.search(str(title or "")):
        return "instrumental"
    if _MOVIE_RE.search(str(movie or "")):
        return "instrumental"
    return None


def _candidates(col):
    """Songs not yet tagged that look non-lyrical."""
    cur = col.find({"no_lyrics_expected": {"$ne": True}}, {"title": 1, "movie": 1})
    for d in cur:
        if classify(d.get("title"), d.get("movie")):
            yield d


def run(apply: bool = False, sample: int = 16) -> None:
    col = db.get_songs_collection()
    hits = list(_candidates(col))
    total = col.count_documents({})
    print(f"catalog={total}  candidates(non-lyrical, untagged)={len(hits)}\n", flush=True)

    for d in hits[:sample]:
        print(f"    {str(d.get('title',''))[:40]:40} | {str(d.get('movie',''))[:28]:28}", flush=True)
    if len(hits) > sample:
        print(f"    … +{len(hits)-sample} more", flush=True)

    if not apply:
        print("\n(dry-run — no writes. Run `python -m scraper.classify apply` to tag.)", flush=True)
        return

    n = 0
    for d in hits:
        col.update_one(
            {"_id": d["_id"]},
            {"$set": {"no_lyrics_expected": True, "content_type": "instrumental"}},
        )
        n += 1
    print(f"\ntagged {n} tracks as instrumental (no_lyrics_expected=True, content_type='instrumental')", flush=True)


def untag() -> None:
    col = db.get_songs_collection()
    res = col.update_many(
        {"no_lyrics_expected": True},
        {"$unset": {"no_lyrics_expected": "", "content_type": ""}},
    )
    print(f"reverted {res.modified_count} tracks", flush=True)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "apply":
        run(apply=True)
    elif arg == "untag":
        untag()
    else:
        run(apply=False)
