"""End-to-end ingest — Journey 1, all steps wired together.

    search JioSaavn  ->  scrub + version + fingerprint + dedupe  ->  save to MongoDB

Run it:
    python -m scraper.pipeline "inkem inkem"
    python -m scraper.pipeline "sid sriram" 20     # last number = how many to pull
"""
from __future__ import annotations

import asyncio
import sys

from scraper import db
from scraper.jiosaavn import search_songs
from scraper.scrub import dedupe_records


def ingest(query: str, limit: int = 15) -> None:
    raw = asyncio.run(search_songs(query, limit=limit))
    songs = dedupe_records(raw)
    print(f"\n{query!r}:  {len(raw)} raw listings  ->  {len(songs)} unique song(s)")

    stats = db.save_songs(songs)
    print(f"saved:  +{stats['inserted']} new,  {stats['updated']} refreshed")
    print(f"database now holds {db.count_songs()} song(s) total\n")

    for s in db.sample_songs(8):
        print(f"   [{s['_id']}]  {s['title']}  ({s.get('version','?')})  "
              f"| {s.get('movie','')} ({s.get('year','')})  | status={s.get('status')}")
    print()


if __name__ == "__main__":
    args = sys.argv[1:]
    limit = 15
    if args and args[-1].isdigit():
        limit = int(args[-1])
        args = args[:-1]
    ingest(" ".join(args) or "inkem inkem", limit)
