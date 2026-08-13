"""Brick 3: the quarantine promoter — fetch lyrics, promote only Telugu-proven songs.

The waiting room (`swara.quarantine`) holds songs that a verified Telugu movie
vouched for (Proof P3) but that JioSaavn tagged ``unknown``. This is the gate
that decides, with HARD evidence, whether each one is really Telugu:

    for each candidate:
        fetch its lyrics (same adapters the main catalog uses)
        if the fetched lyrics are TELUGU SCRIPT (Proof P1):
            PROMOTE  -> move it into swara.songs (now proven, with lyrics)
        else:
            keep it PARKED  -> never shown; retried when new sources arrive

Why we never delete a parked song: "no Telugu-script lyrics found" is NOT proof
it's foreign — a real Telugu song might only have ROMANIZED lyrics available yet,
or none online at all. So we only ever *promote* on proof; we *park*, never
reject. Instrumentals / background scores (no lyrics anywhere) stay parked
forever — exactly what we want them to do.

Run:
    python -m scraper.promote_quarantine          # check every parked candidate
    python -m scraper.promote_quarantine 50        # cap the batch size
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from scraper import db
from scraper.expand_movies import get_quarantine_collection
from scraper.lyrics import SOURCES, build_lyrics_update, is_telugu


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _p1_telugu_lyrics(versions: List[Dict[str, Any]]) -> bool:
    """Proof P1: do ANY fetched lyrics actually contain Telugu script?

    Passes if a version's Telugu text clears the Telugu-script bar, or its synced
    (karaoke) lines are Telugu. Romanized-only text does NOT pass — that stays
    ambiguous and keeps the song parked.
    """
    for v in versions or []:
        if is_telugu(v.get("text_telugu")):
            return True
        synced = v.get("synced") or []
        if synced and is_telugu(" ".join(l.get("text", "") for l in synced)):
            return True
    return False


def _promote(doc: Dict[str, Any], lyrics_update: Dict[str, Any], songs_col, quar_col) -> None:
    """Move a proven candidate from quarantine into the live `swara.songs`.

    Keeps the full audio handle + metadata + the freshly-fetched lyrics, stamps
    the proof trail, and asserts ``language="telugu"`` (now earned, not guessed).
    The P3 movie trail (p3_movie/p3_movie_qid/p3_year) is preserved for audit.
    """
    promoted = dict(doc)
    promoted.pop("quarantine_reason", None)
    promoted.update(lyrics_update)              # lyrics_versions, chosen_source, status="has_lyrics", ...
    promoted["language"] = "telugu"             # proven by Telugu-script lyrics
    promoted["language_jiosaavn"] = doc.get("language", "")  # remember the original tag
    promoted["telugu_proof"] = "P1_lyrics_script"
    promoted["promoted_from_quarantine"] = True
    promoted["updated_at"] = _now()
    promoted.setdefault("created_at", _now())
    promoted["_id"] = doc["_id"]

    songs_col.replace_one({"_id": doc["_id"]}, promoted, upsert=True)
    quar_col.delete_one({"_id": doc["_id"]})


def run(limit: Optional[int] = None, delay_s: float = 0.3) -> Dict[str, int]:
    quar_col = get_quarantine_collection()
    songs_col = db.get_songs_collection()

    # Candidates that haven't yet been resolved (fresh, or checked before a new
    # source existed). We retry parked ones too, but only hit not-yet-tried sources.
    query = {"status": {"$in": ["quarantine", "quarantine_unproven"]}}
    cursor = quar_col.find(query)
    if limit:
        cursor = cursor.limit(limit)
    docs = list(cursor)

    if not docs:
        print("Quarantine is empty (or fully resolved). Nothing to promote.")
        return {"checked": 0, "promoted": 0, "parked": 0}

    enabled = [s.name for s in SOURCES]
    print(f"Checking {len(docs)} parked candidate(s) for Telugu-lyrics proof")
    print(f"(sources: {enabled})\n")

    promoted = parked = 0
    for i, doc in enumerate(docs, 1):
        already = set(doc.get("lyrics_tried") or [])
        todo = [s for s in SOURCES if s.name not in already]
        try:
            fetched = [v for s in todo if (v := s.fetch(doc))]
        except Exception as exc:  # one bad fetch never stops the batch
            print(f"  [{i:>3}] {doc.get('title', '?')[:30]:<30} ERROR {str(exc)[:26]}")
            continue

        update = build_lyrics_update(doc, fetched, [s.name for s in todo])

        if _p1_telugu_lyrics(update.get("lyrics_versions", [])):
            _promote(doc, update, songs_col, quar_col)
            promoted += 1
            src = update.get("chosen_source", "?")
            print(f"  [{i:>3}] {doc.get('title', '?')[:30]:<30} ✓ PROMOTED  (Telugu lyrics via {src})")
        else:
            # Stay parked. Record what we found + that we've now checked it, so a
            # re-run only tries genuinely-new sources.
            parked_update = dict(update)
            parked_update["status"] = "quarantine_unproven"
            quar_col.update_one({"_id": doc["_id"]}, {"$set": parked_update})
            parked += 1
            found = ", ".join(v["source"] for v in fetched) or "no lyrics found"
            print(f"  [{i:>3}] {doc.get('title', '?')[:30]:<30} · parked      ({found})")
        time.sleep(delay_s)

    songs_total = songs_col.count_documents({})
    quar_total = quar_col.count_documents({})
    print(f"\nDone. Checked {len(docs)} · promoted {promoted} · parked {parked}.")
    print(f"  live catalog: {songs_total} songs")
    print(f"  still parked: {quar_total} candidates")
    return {"checked": len(docs), "promoted": promoted, "parked": parked}


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    n = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None
    run(limit=n)
