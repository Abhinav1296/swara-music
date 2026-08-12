"""Movie-driven expansion + safe quarantine — brick 2 of the purity plan.

WHAT THIS DOES
--------------
We now own a trusted list of Telugu films (`swara.movies`, built by
``movies_ref.py``). This walks that list and, for each film, asks JioSaavn
"what songs are on this movie?" — then sorts every returned song into one of
three bins, using PROOF instead of trusting the song's flimsy language tag:

  * LIVE       -> the song is explicitly tagged ``telugu`` (or its text is in
                  Telugu script). Proven Telugu -> straight into `swara.songs`.
  * QUARANTINE -> the song is tagged ``unknown``/blank BUT its album matches a
                  verified Telugu movie by name + year (Proof P3). That's a
                  strong *candidate*, not proof — so it waits in `swara.quarantine`
                  and only gets promoted later once its fetched LYRICS are Telugu
                  script (Proof P1). Two independent proofs before it ever shows.
  * DROPPED    -> tagged as some OTHER explicit language (hindi/tamil/…). A dub on
                  a Telugu film's page is still not Telugu -> never stored.

Why this is safe: the LIVE catalog can only ever gain a song via an explicit
Telugu tag or (later) a Telugu-lyrics proof. A wrong candidate that sneaks into
quarantine simply fails the lyrics check and is never promoted. Purity of what
the app SHOWS is guaranteed by the promotion gate, not by this triage.

Run it:

    python -m scraper.expand_movies 15     # test slice: 15 newest films
    python -m scraper.expand_movies        # full run: every un-expanded film
"""
from __future__ import annotations

import asyncio
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from scraper import db
from scraper.jiosaavn import search_paged
from scraper.scrub import dedupe_records, norm_key

# Telugu Unicode block U+0C00–U+0C7F — definitive; no other language uses it.
_TELUGU_SCRIPT = re.compile(r"[ఀ-౿]")


# ── collections ──────────────────────────────────────────────────────────────
def get_quarantine_collection():
    """`swara.quarantine` — unknown-tagged candidates awaiting a lyrics proof."""
    return db.get_collection("quarantine")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── the proof logic ──────────────────────────────────────────────────────────
# Wikidata disambiguates same-named films with a trailing parenthetical:
# 'Single (film)', 'Chaurya Paatham (2025 film)', 'Devdas (2018 Telugu film)'.
# That suffix is noise for a JioSaavn search and for album-matching — strip it.
_PAREN_SUFFIX = re.compile(r"\s*\([^()]*\)\s*$")


def _clean_title_for_query(title: str) -> str:
    """Drop trailing '(... film)' / '(YYYY ...)' disambiguators from a movie title."""
    t = (title or "").strip()
    prev = None
    while t != prev:                      # peel repeated trailing parentheticals
        prev = t
        t = _PAREN_SUFFIX.sub("", t).strip()
    return t or (title or "").strip()


def _album_matches(song_album: str, movie_title: str) -> bool:
    """Does this song's album name refer to the given (verified) movie?

    Compares on an alnum-only key. Real soundtracks are named like the movie,
    sometimes with a suffix ('Arjun Reddy (Original Motion Picture Soundtrack)')
    or an abbreviation ('Baahubali 2' for 'Baahubali 2: The Conclusion'), so we
    accept a PREFIX match on either side. We deliberately do NOT accept the movie
    name buried mid-phrase — that's how a devotional 'Janani Vaibhavam' wrongly
    matched the film 'Vaibhavam'. Short keys must match exactly (so 'RRR' can't
    match 'grrrr').
    """
    a = norm_key(song_album)
    m = norm_key(movie_title)
    if not a or not m:
        return False
    if a == m:
        return True
    if len(m) >= 5 and a.startswith(m):   # 'Arjun Reddy (Soundtrack)' starts with 'Arjun Reddy'
        return True
    if len(a) >= 5 and m.startswith(a):   # album 'Baahubali 2' is a prefix of the full title
        return True
    return False


def _year_ok(song_year: Optional[int], movie_year: Optional[int]) -> bool:
    """Years must agree within a year (disambiguates same-title films across
    languages/decades). If the song has no year, we allow it — the later lyrics
    proof is the real gate."""
    if not song_year or not movie_year:
        return True
    return abs(int(song_year) - int(movie_year)) <= 1


def _has_telugu_script(rec: Dict[str, Any]) -> bool:
    return bool(_TELUGU_SCRIPT.search(f"{rec.get('title', '')} {rec.get('movie', '')}"))


def _classify(rec: Dict[str, Any], movie: Dict[str, Any], match_title: str) -> str:
    """Return 'live' | 'quarantine' | 'skip' | 'drop' for one song vs one movie.

    `match_title` = the cleaned movie title used for album-matching.
    """
    lang = (rec.get("language") or "").lower()
    # Proven Telugu by tag or by script -> live catalog.
    if lang == "telugu" or _has_telugu_script(rec):
        return "live"
    # Ambiguous -> quarantine ONLY if it belongs to this verified Telugu movie.
    if lang in ("", "unknown"):
        if _album_matches(rec.get("movie", ""), match_title) and _year_ok(rec.get("year"), movie.get("year")):
            return "quarantine"
        return "skip"  # unknown, but no evidence it's this movie -> ignore
    # Explicit other language -> not Telugu, never store.
    return "drop"


# ── quarantine persistence ───────────────────────────────────────────────────
def _save_quarantine(records: List[Dict[str, Any]], movie: Dict[str, Any], col) -> int:
    """Upsert candidates into `swara.quarantine`. Returns count newly added.

    Stores the full audio handle + metadata (so a later lyrics pass can fetch
    lyrics and promote it) plus WHICH verified movie vouched for it (P3 trail).
    Lyrics scaffold is written only on first insert, mirroring `db.save_songs`.
    """
    added = 0
    for r in records:
        if not r.get("_id"):
            continue
        res = col.update_one(
            {"_id": r["_id"]},
            {
                "$set": {
                    "title": r.get("clean_title") or r.get("title", ""),
                    "movie": r.get("movie", ""),
                    "year": r.get("year"),
                    "singers": r.get("singers", ""),
                    "version": r.get("version", "original"),
                    "language": r.get("language", ""),
                    "jiosaavn_id": r.get("jiosaavn_id"),
                    "perma_url": r.get("perma_url", ""),
                    "encrypted_media_url": r.get("encrypted_media_url", ""),
                    "artwork": r.get("artwork", ""),
                    "duration_sec": r.get("duration_sec"),
                    "has_320": r.get("has_320", False),
                    "status": "quarantine",            # awaiting Proof P1 (lyrics)
                    "quarantine_reason": "unknown_lang",
                    # the verified movie that makes this a Telugu candidate:
                    "p3_movie": movie.get("title"),
                    "p3_movie_qid": movie.get("_id"),
                    "p3_year": movie.get("year"),
                    "updated_at": _now(),
                },
                "$setOnInsert": {
                    "lyrics_versions": [],
                    "lyrics_tried": [],
                    "lyrics_missing": True,
                    "created_at": _now(),
                },
            },
            upsert=True,
        )
        if res.upserted_id is not None:
            added += 1
    return added


# ── per-movie processing ─────────────────────────────────────────────────────
async def _fetch_movie_songs(title: str, pages: int, per_page: int) -> List[Dict[str, Any]]:
    return await search_paged(title, pages=pages, per_page=per_page)


def _triage(deduped: List[Dict[str, Any]], movie: Dict[str, Any], match_title: str):
    live, quar, dropped = [], [], 0
    for r in deduped:
        verdict = _classify(r, movie, match_title)
        if verdict == "live":
            live.append(r)
        elif verdict == "quarantine":
            quar.append(r)
        elif verdict == "drop":
            dropped += 1
        # "skip" -> ignore silently (search noise)
    return live, quar, dropped


# ── orchestration ────────────────────────────────────────────────────────────
def run(max_movies: Optional[int] = None, pages: int = 2, per_page: int = 30, delay_s: float = 0.6) -> Dict[str, int]:
    movies_col = db.get_collection("movies")
    songs_col = db.get_songs_collection()
    quar_col = get_quarantine_collection()
    quar_col.create_index("status")
    quar_col.create_index("p3_movie_qid")

    # Newest films first (richest JioSaavn catalogs, most valuable coverage).
    query = {"$or": [{"expanded_at": {"$exists": False}}, {"expanded_at": None}]}
    cur = movies_col.find(query).sort("year", -1)
    if max_movies:
        cur = cur.limit(max_movies)
    movies = list(cur)

    if not movies:
        print("No un-expanded movies left. (Everything is already done.)")
        return {"movies": 0, "live": 0, "quarantined": 0, "dropped": 0}

    print(f"Expanding {len(movies)} movies (pages={pages}, per_page={per_page})...\n")
    t_live = t_quar = t_drop = t_hits = 0
    for i, m in enumerate(movies, 1):
        search_title = _clean_title_for_query(m["title"])
        try:
            raw = asyncio.run(_fetch_movie_songs(search_title, pages, per_page))
        except Exception as exc:  # one bad movie never stops the run
            print(f"  ! {m['title']!r}: fetch failed ({exc})")
            continue

        deduped = dedupe_records(raw) if raw else []
        live, quar, dropped = _triage(deduped, m, search_title)

        if live:
            db.save_songs(live, collection=songs_col)
            # If any of these were previously parked, they're proven now — unpark.
            quar_col.delete_many({"_id": {"$in": [r["_id"] for r in live]}})

        if quar:
            # Never re-quarantine a song already proven live in swara.songs.
            ids = [r["_id"] for r in quar]
            live_already = {d["_id"] for d in songs_col.find({"_id": {"$in": ids}}, {"_id": 1})}
            quar = [r for r in quar if r["_id"] not in live_already]
            if quar:
                _save_quarantine(quar, m, quar_col)

        movies_col.update_one({"_id": m["_id"]}, {"$set": {"expanded_at": _now()}})

        t_live += len(live)
        t_quar += len(quar)
        t_drop += dropped
        if live or quar or dropped:
            t_hits += 1
            print(
                f"  [{i:>4}/{len(movies)}] {m['title'][:32]:<32} ({m.get('year')})"
                f"  live +{len(live):<2}  quar +{len(quar):<2}  drop {dropped}"
            )
        time.sleep(delay_s)

    songs_total = songs_col.count_documents({})
    quar_total = quar_col.count_documents({})
    print(f"\nDone. {t_hits}/{len(movies)} movies returned songs.")
    print(f"  live catalog += {t_live}   (now {songs_total} songs)")
    print(f"  quarantined  += {t_quar}   (now {quar_total} candidates awaiting lyrics proof)")
    print(f"  dropped (foreign-tagged): {t_drop}")
    return {"movies": len(movies), "live": t_live, "quarantined": t_quar, "dropped": t_drop}


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    n = int(sys.argv[1]) if len(sys.argv) > 1 else None
    run(max_movies=n)
