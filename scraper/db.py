"""MongoDB persistence — Journey 1, step (5): save the filled song-form.

Mental model (for an ML person): MongoDB is a searchable list of Python dicts
living on a server. Each of our song "forms" is one dict = one *document*. You
hand it a dict, it stores it. No SQL, no table schema.

Two robustness tricks live here, and they matter:

  1. Our fingerprint IS MongoDB's primary key (`_id`). MongoDB guarantees `_id`
     is unique, so the database itself physically refuses to store the same song
     twice — dedupe for free, even across separate scraper runs.

  2. Re-running the scraper must NEVER wipe lyrics we already found. So audio +
     metadata are refreshed every run ($set), but the lyrics fields are only
     written the FIRST time a song is inserted ($setOnInsert).

The connection string lives in scraper/.env (never committed). See .env.example.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

from dotenv import load_dotenv
from pymongo import MongoClient

# Load scraper/.env so MONGODB_URI is available. This file is git-ignored.
load_dotenv(Path(__file__).with_name(".env"))

DB_NAME = "swara"
COLLECTION_NAME = "songs"

_collection = None  # cached connection (lazy)


def get_songs_collection():
    """Connect to MongoDB (once) and return the `swara.songs` collection."""
    global _collection
    if _collection is not None:
        return _collection
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError(
            "MONGODB_URI is not set.\n"
            "Create scraper/.env from scraper/.env.example and paste your "
            "MongoDB Atlas connection string into it."
        )
    client = MongoClient(uri, serverSelectionTimeoutMS=8000)
    _collection = client[DB_NAME][COLLECTION_NAME]
    return _collection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audio_and_meta(record: Dict[str, Any]) -> Dict[str, Any]:
    """Fields refreshed on EVERY run (audio handle + metadata)."""
    return {
        "title": record["clean_title"],
        "movie": record.get("movie", ""),
        "year": record.get("year"),
        "singers": record.get("singers", ""),
        "version": record.get("version", "original"),
        "language": record.get("language", ""),
        # The permanent audio handle — never the ephemeral CDN link.
        "jiosaavn_id": record.get("jiosaavn_id"),
        "perma_url": record.get("perma_url", ""),
        "encrypted_media_url": record.get("encrypted_media_url", ""),
        "artwork": record.get("artwork", ""),
        "duration_sec": record.get("duration_sec"),
        "updated_at": _now(),
    }


def _initial_lyrics() -> Dict[str, Any]:
    """Fields written ONLY on first insert, so found lyrics are never wiped."""
    return {
        "lyricist": "",
        "lyrics_plain": "",
        "lyrics_synced": [],
        "lyrics_source": "",
        "lyrics_missing": True,
        "needs_sync": True,
        "raw_lyrics": "",
        "status": "pending_lyrics",  # audio is in; lyrics step comes next
        "created_at": _now(),
    }


def save_songs(records: Iterable[Dict[str, Any]], collection=None) -> Dict[str, int]:
    """Upsert scrubbed records one by one. Returns {inserted, updated, total_seen}.

    Uses the fingerprint as `_id`, so a re-run updates the same document instead
    of creating a duplicate. `$set` refreshes audio/metadata; `$setOnInsert`
    seeds the lyrics fields only the first time.
    """
    col = collection if collection is not None else get_songs_collection()
    inserted = updated = seen = 0
    for r in records:
        if not r.get("_id"):
            continue
        seen += 1
        result = col.update_one(
            {"_id": r["_id"]},
            {"$set": _audio_and_meta(r), "$setOnInsert": _initial_lyrics()},
            upsert=True,
        )
        if result.upserted_id is not None:
            inserted += 1
        elif result.modified_count:
            updated += 1
    return {"inserted": inserted, "updated": updated, "total_seen": seen}


def count_songs(collection=None) -> int:
    col = collection if collection is not None else get_songs_collection()
    return col.count_documents({})


def sample_songs(n: int = 5, collection=None) -> List[Dict[str, Any]]:
    col = collection if collection is not None else get_songs_collection()
    return list(col.find({}, limit=n))


def get_collection(name: str):
    """Return another collection in the same `swara` DB (e.g. lyricstape_index)."""
    return get_songs_collection().database[name]
