"""Make search LYRICS-AWARE.

Two offline steps, both idempotent and resumable, so a query that is a *line of
lyrics* resolves to its song — everywhere the app searches (one endpoint).

1. Denormalize every song's lyrics into a single top-level string `lyrics_text`
   (all versions' Telugu + romanized text, LRC timestamps stripped, whitespace
   collapsed, lowercased). One flat field is cheap to index and lets us weight
   it well BELOW the title/movie/singers so ordinary searches don't change.

2. (Re)build the Mongo text index as a weighted compound index over
   title / movie / singers / lyrics_text. Only ONE text index is allowed per
   collection, so we drop whatever text index exists first.

Usage (from repo root, with the backend venv so pymongo + scraper/.env load):
    backend/.venv/Scripts/python.exe -m scraper.build_search_index sample   # dry run, prints samples
    backend/.venv/Scripts/python.exe -m scraper.build_search_index apply     # writes lyrics_text + index
    backend/.venv/Scripts/python.exe -m scraper.build_search_index index     # only (re)build the index

Reversible: `unset` drops the field; the index is rebuilt from the code below.
"""
from __future__ import annotations

import re
import sys
import time
from typing import Any, Dict, List

from pymongo import UpdateOne

from scraper import db

try:  # keep Telugu readable in the Windows console
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

INDEX_NAME = "swara_text"
# Title/artist matches must always outrank a lyric-body hit, so weight the
# lyrics field far lower. (Mongo textScore = sum of weight * term-frequency.)
INDEX_SPEC = [("title", "text"), ("movie", "text"), ("singers", "text"), ("lyrics_text", "text")]
INDEX_WEIGHTS = {"title": 10, "movie": 6, "singers": 4, "lyrics_text": 1}

_STAMP = re.compile(r"\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]")  # LRC [mm:ss.xx]
_WS = re.compile(r"\s+")


def build_lyrics_text(doc: Dict[str, Any]) -> str:
    """Flatten all lyric versions (Telugu + roman) into one search string.

    Multiple sources often carry near-identical text; we keep only distinct,
    normalized blocks so the field stays small (M0 storage) without losing any
    searchable term.
    """
    seen: set[str] = set()
    parts: List[str] = []
    for v in doc.get("lyrics_versions") or []:
        for key in ("text_telugu", "text_roman"):
            t = v.get(key)
            if not t:
                continue
            block = _WS.sub(" ", _STAMP.sub(" ", t)).strip().lower()
            if block and block not in seen:
                seen.add(block)
                parts.append(block)
    return " ".join(parts)


def build_index(col) -> None:
    """Drop any existing text index and create the weighted lyrics-aware one."""
    for name, info in col.index_information().items():
        # A text index shows up as a key containing ('_fts', 'text').
        if any(field == "_fts" for field, _ in info.get("key", [])):
            print(f"  dropping existing text index: {name}")
            col.drop_index(name)
    col.create_index(
        INDEX_SPEC,
        name=INDEX_NAME,
        weights=INDEX_WEIGHTS,
        default_language="none",   # no stemming — safe for Telugu + mixed script
        # Docs carry language:"telugu", which Mongo's text index would try to use
        # as a per-doc stemming override and reject. Point the override at a field
        # that doesn't exist so the per-doc language is ignored entirely.
        language_override="__txt_lang__",
    )
    print(f"  created weighted text index '{INDEX_NAME}' {INDEX_WEIGHTS}")


def run(apply: bool, sample: bool) -> None:
    col = db.get_songs_collection()

    if sample:
        n = 0
        for doc in col.find({"lyrics_versions": {"$exists": True, "$ne": []}}).limit(2000):
            lt = build_lyrics_text(doc)
            if not lt:
                continue
            print(f"\n▶ {doc.get('title')} — {doc.get('movie')}")
            print(f"  lyrics_text[{len(lt)} chars]: {lt[:160]}…")
            n += 1
            if n >= 5:
                break
        print(f"\n(sample only — no writes, no index change) shown {n}")
        return

    # Full pass: compute lyrics_text for every song that has lyrics; clear it on
    # songs that don't (so stale values never linger). Batched bulk writes.
    total = col.count_documents({})
    print(f"scanning {total} songs…")
    ops: List[UpdateOne] = []
    written = filled = cleared = 0
    t0 = time.time()
    for i, doc in enumerate(col.find({}, {"lyrics_versions": 1, "lyrics_text": 1}), 1):
        lt = build_lyrics_text(doc)
        if lt == (doc.get("lyrics_text") or ""):
            continue  # already correct — resumable / cheap re-runs
        ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": {"lyrics_text": lt}}))
        if lt:
            filled += 1
        else:
            cleared += 1
        if len(ops) >= 1000:
            col.bulk_write(ops, ordered=False)
            written += len(ops)
            ops = []
            print(f"  {i}/{total} scanned, {written} updated ({time.time() - t0:.0f}s)")
    if ops:
        col.bulk_write(ops, ordered=False)
        written += len(ops)
    print(f"done: {written} updated (filled={filled}, cleared={cleared}) in {time.time() - t0:.0f}s")

    print("rebuilding text index…")
    build_index(col)
    print("✅ search is now lyrics-aware")


def unset(col) -> None:
    res = col.update_many({"lyrics_text": {"$exists": True}}, {"$unset": {"lyrics_text": ""}})
    print(f"unset lyrics_text on {res.modified_count} docs")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sample"
    if mode == "sample":
        run(apply=False, sample=True)
    elif mode == "apply":
        run(apply=True, sample=False)
    elif mode == "index":
        build_index(db.get_songs_collection())
    elif mode == "unset":
        unset(db.get_songs_collection())
    else:
        print(f"unknown mode: {mode!r} (use sample | apply | index | unset)")
