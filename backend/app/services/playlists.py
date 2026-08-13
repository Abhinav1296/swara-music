"""Per-user custom playlists — account-backed, in the SAME MongoDB Atlas.

Each user gets ONE document in the `playlists` collection, keyed by the Google
subject id (`sub`, the same key as `users`), holding their whole playlist array.
The frontend keeps a local (localStorage) copy for logged-out use and syncs the
whole array up on change, so a single whole-document replace mirrors that model
exactly and keeps the two in lockstep.

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

# Bounds so a malformed / hostile payload can't bloat a user's document.
MAX_PLAYLISTS = 100
MAX_SONGS_PER_PLAYLIST = 500
MAX_NAME_LEN = 100


def _playlists_col():
    return scraper_db.get_collection("playlists")


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


def _clean_playlist(pl: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(pl, dict):
        return None
    pid = pl.get("id")
    if not isinstance(pid, str) or not pid:
        return None
    name = (str(pl.get("name") or "").strip()[:MAX_NAME_LEN]) or "My Playlist"
    songs: List[Dict[str, Any]] = []
    seen: set = set()
    raw_songs = pl.get("songs")
    if isinstance(raw_songs, list):
        for s in raw_songs:
            cs = _clean_song(s)
            if cs is None:
                continue
            sid = cs.get("id")
            if sid in seen:
                continue
            seen.add(sid)
            songs.append(cs)
            if len(songs) >= MAX_SONGS_PER_PLAYLIST:
                break
    created = pl.get("createdAt")
    if not isinstance(created, (int, float)):
        created = _now_ms()
    return {"id": pid, "name": name, "songs": songs, "createdAt": created}


def _sanitize(playlists: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen_ids: set = set()
    if isinstance(playlists, list):
        for pl in playlists:
            cp = _clean_playlist(pl)
            if cp is None or cp["id"] in seen_ids:
                continue
            seen_ids.add(cp["id"])
            out.append(cp)
            if len(out) >= MAX_PLAYLISTS:
                break
    return out


def get_playlists(uid: str) -> List[Dict[str, Any]]:
    doc = _playlists_col().find_one({"_id": uid})
    if not doc:
        return []
    return doc.get("playlists", []) or []


def save_playlists(uid: str, playlists: Any) -> List[Dict[str, Any]]:
    """Replace the user's whole playlist array (sanitized). Returns what was saved."""
    cleaned = _sanitize(playlists)
    now = _now_ms()
    _playlists_col().update_one(
        {"_id": uid},
        {
            "$set": {"playlists": cleaned, "updatedMs": now},
            "$setOnInsert": {"createdMs": now},
        },
        upsert=True,
    )
    return cleaned
