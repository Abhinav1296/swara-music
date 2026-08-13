"""Per-user liked songs — account-backed, in the SAME MongoDB Atlas.

Each user gets ONE document in the `likes` collection, keyed by the Google
subject id (`sub`, the same key as `users`/`playlists`), holding their whole
liked-songs array (full Song objects, newest-liked first). The frontend keeps a
local (localStorage) copy for logged-out use and syncs the whole array up on
change, so a single whole-document replace mirrors that model exactly and keeps
the two in lockstep.

Kept deliberately separate from `swara.songs` so nothing here touches the
scraper-owned catalog. See [[swara-reengineering]] for the decoupled layout.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Make the repo-root `scraper` package importable (same bootstrap as users.py) —
# this module can be imported before catalog.py has set the path.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Reuse the scraper's single Mongo connection (same `swara` database).
from scraper import db as scraper_db  # noqa: E402

# Bound so a malformed / hostile payload can't bloat a user's document.
MAX_LIKES = 2000


def _likes_col():
    return scraper_db.get_collection("likes")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _clean_song(song: Any) -> Optional[Dict[str, Any]]:
    """Keep a song only if it's a dict carrying an id. Stored verbatim otherwise:
    the frontend owns the Song shape and needs it intact for offline playback."""
    if not isinstance(song, dict):
        return None
    if not song.get("id"):
        return None
    return song


def _sanitize(songs: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set = set()
    if isinstance(songs, list):
        for s in songs:
            cs = _clean_song(s)
            if cs is None:
                continue
            sid = cs.get("id")
            if sid in seen:
                continue
            seen.add(sid)
            out.append(cs)
            if len(out) >= MAX_LIKES:
                break
    return out


def get_likes(uid: str) -> List[Dict[str, Any]]:
    doc = _likes_col().find_one({"_id": uid})
    if not doc:
        return []
    return doc.get("songs", []) or []


def save_likes(uid: str, songs: Any) -> List[Dict[str, Any]]:
    """Replace the user's whole liked-songs array (sanitized). Returns what was saved."""
    cleaned = _sanitize(songs)
    now = _now_ms()
    _likes_col().update_one(
        {"_id": uid},
        {
            "$set": {"songs": cleaned, "updatedMs": now},
            "$setOnInsert": {"createdMs": now},
        },
        upsert=True,
    )
    return cleaned
