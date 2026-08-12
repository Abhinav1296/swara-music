"""Seed ingest — bulk-load a starter catalog of top Telugu songs.

Runs a curated list of queries through the pipeline. Built to be RESILIENT:
if JioSaavn fails on one query (timeout, rate-limit, block), that query is
logged and skipped — the run keeps going and finishes. Because saves are
idempotent (fingerprint = _id), you can re-run this anytime to retry the
failures and refresh existing songs, without ever creating duplicates.

Run:
    python -m scraper.seed
    python -m scraper.seed 25        # songs per query (default 20)
"""
from __future__ import annotations

import asyncio
import sys

from scraper import db
from scraper.jiosaavn import search_songs
from scraper.scrub import dedupe_records

# Curated Telugu seed queries: music directors + singers + heroes' films +
# eras/moods + recent blockbusters. Broad on purpose — dedupe collapses overlap.
SEED_QUERIES = [
    # music directors (map cleanly to song metadata)
    "Devi Sri Prasad telugu", "Thaman S telugu", "MM Keeravani telugu",
    "Ilaiyaraaja telugu", "Anirudh telugu", "Gopi Sundar telugu",
    "Mani Sharma telugu", "Koti telugu",
    # singers
    "Sid Sriram telugu", "SP Balasubrahmanyam telugu", "Shreya Ghoshal telugu",
    "Karthik telugu", "Chinmayi telugu", "Armaan Malik telugu",
    "Kaala Bhairava telugu", "Sunitha telugu",
    # popular film soundtracks (recent + classic)
    "Pushpa telugu", "RRR telugu", "Ala Vaikunthapurramuloo telugu",
    "Arjun Reddy telugu", "Sita Ramam telugu", "Kushi telugu",
    "Geetha Govindam telugu", "Baahubali telugu", "Fidaa telugu",
    "Jersey telugu", "Rangasthalam telugu", "DJ Duvvada Jagannadham telugu",
    # eras / moods
    "latest telugu hits", "telugu love songs", "telugu melody songs",
    "90s telugu hits", "2000s telugu hits", "telugu folk songs",
    "telugu mass songs", "telugu sad songs", "telugu dance hits",
]


async def run_seed(per_query: int = 20, delay_s: float = 0.6) -> None:
    ok = failed = 0
    failures: list[tuple[str, str]] = []

    for i, q in enumerate(SEED_QUERIES, 1):
        try:
            raw = await search_songs(q, limit=per_query)
            songs = dedupe_records(raw)
            stats = db.save_songs(songs)
            ok += 1
            print(f"  [{i:>2}/{len(SEED_QUERIES)}] {q:<34} +{stats['inserted']} new "
                  f"({len(songs)} unique)")
        except Exception as exc:                 # one bad query never kills the run
            failed += 1
            failures.append((q, str(exc)[:80]))
            print(f"  [{i:>2}/{len(SEED_QUERIES)}] {q:<34} FAILED - skipped, will retry next run")
        await asyncio.sleep(delay_s)             # be polite to JioSaavn

    print(f"\nseed complete: {ok} queries ok, {failed} failed")
    if failures:
        print("failed (retried automatically on next run):")
        for q, _ in failures:
            print(f"   - {q}")
    print(f"database now holds {db.count_songs()} unique song(s), all status=pending_lyrics")


if __name__ == "__main__":
    per = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 20
    asyncio.run(run_seed(per))
