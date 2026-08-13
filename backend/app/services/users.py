"""User storage — the account layer, in the SAME MongoDB Atlas as the catalog.

Users live in a `users` collection keyed by the Google subject id (`sub`), which
is stable and unique per Google account. Per-user playlists get their own
collection later. Kept deliberately separate from `swara.songs` so nothing here
touches the scraper-owned catalog.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Make the repo-root `scraper` package importable (same bootstrap as catalog.py) —
# this module can be imported before catalog.py has set the path.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Reuse the scraper's single Mongo connection (same `swara` database).
from scraper import db as scraper_db  # noqa: E402


def _users():
    return scraper_db.get_collection("users")


def _now_ms() -> int:
    return int(time.time() * 1000)


def upsert_user_from_google(claims: Dict[str, Any]) -> Dict[str, Any]:
    """Create or refresh a user from verified Google ID-token claims."""
    uid = claims.get("sub")
    if not uid:
        raise ValueError("Google claims missing 'sub'")
    now = _now_ms()
    col = _users()
    col.update_one(
        {"_id": uid},
        {
            "$set": {
                "email": claims.get("email"),
                "emailVerified": bool(claims.get("email_verified")),
                "name": claims.get("name") or claims.get("email") or "Listener",
                "picture": claims.get("picture"),
                "lastLoginMs": now,
            },
            "$setOnInsert": {"createdMs": now, "favoriteSingers": []},
        },
        upsert=True,
    )
    return col.find_one({"_id": uid})


def get_user(uid: str) -> Optional[Dict[str, Any]]:
    return _users().find_one({"_id": uid})


def update_profile(
    uid: str, name: Optional[str] = None, favorite_singers: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    updates: Dict[str, Any] = {}
    if name is not None:
        cleaned = name.strip()[:80]
        if cleaned:
            updates["name"] = cleaned
    if favorite_singers is not None:
        seen, cleaned_list = set(), []
        for s in favorite_singers:
            v = str(s).strip()[:80]
            key = v.lower()
            if v and key not in seen:
                seen.add(key)
                cleaned_list.append(v)
        updates["favoriteSingers"] = cleaned_list[:50]
    if updates:
        _users().update_one({"_id": uid}, {"$set": updates})
    return get_user(uid)


def public_user(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The safe, client-facing shape of a user (no internal fields)."""
    if not doc:
        return None
    return {
        "id": doc.get("_id"),
        "email": doc.get("email"),
        "name": doc.get("name"),
        "picture": doc.get("picture"),
        "favoriteSingers": doc.get("favoriteSingers", []),
        "createdMs": doc.get("createdMs"),
    }
