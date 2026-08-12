"""Overnight 'all Telugu' crawler — hands-off, resumable, Telugu-fenced.

Goal: load as much of JioSaavn's TELUGU catalog as text-search can reach, with
zero manual intervention. JioSaavn has no "give me every Telugu song" endpoint,
so we enumerate a huge query set and let the database dedupe for free:

  * every real Telugu MOVIE we already indexed on LyricStape (~1,117 films) —
    searching a film name pulls that whole soundtrack;
  * big DIRECTOR / SINGER / HERO lists — to reach anything LyricStape missed;
  * the original curated seed queries.

For each query we paginate (scraper.jiosaavn.search_paged), keep ONLY
`language == "telugu"` (purity is the #1 rule — no Tamil/Hindi bleed), dedupe,
and upsert. Built to run unattended:

  * every query is isolated in try/except — one failure never stops the run;
  * progress is written to Mongo `crawl_progress`, keyed by query, so a restart
    resumes exactly where it left off (skips finished queries);
  * a second pass auto-retries anything that failed the first time.

    python -m scraper.crawl_all
"""
from __future__ import annotations

import asyncio
import re
import sys

from scraper import db
from scraper.jiosaavn import search_paged
from scraper.scrub import dedupe_records
from scraper.seed import SEED_QUERIES

# ─────────────────────────────────────────────────────────────────────────────
# Query universe
# ─────────────────────────────────────────────────────────────────────────────

# Telugu music directors — their names anchor cleanly to soundtrack metadata.
DIRECTORS = [
    "Devi Sri Prasad", "Thaman S", "S Thaman", "MM Keeravani", "Keeravani",
    "Ilaiyaraaja", "Anirudh Ravichander", "Gopi Sundar", "Gopi Sunder",
    "Mani Sharma", "Koti", "Mickey J Meyer", "Radhan", "Vishal Chandrashekhar",
    "GV Prakash Kumar", "Chakri", "RP Patnaik", "Kalyani Malik", "Kalyan Koduri",
    "Sunil Kashyap", "Sricharan Pakala", "Anup Rubens", "Bheems Ceciroleo",
    "Achu Rajamani", "Sam CS", "Harris Jayaraj", "Yuvan Shankar Raja",
    "Hip Hop Tamizha", "Jakes Bejoy", "Justin Prabhakaran", "Leon James",
    "Vivek Sagar", "AR Rahman", "Amit Trivedi", "Shakthikanth Karthick",
    "Praveen Lakkaraju", "Suresh Bobbili", "Judah Sandhy", "Hesham Abdul Wahab",
]

# Telugu playback singers.
SINGERS = [
    "Sid Sriram", "SP Balasubrahmanyam", "SP Balu", "Shreya Ghoshal", "Karthik",
    "Chinmayi", "Armaan Malik", "Kaala Bhairava", "Sunitha", "Hemachandra",
    "Geetha Madhuri", "Anurag Kulkarni", "KS Chithra", "S Janaki", "Mano",
    "Shankar Mahadevan", "Rahul Sipligunj", "Mangli", "Ramya Behara",
    "Yazin Nizar", "Haricharan", "Nakash Aziz", "Sunidhi Chauhan",
    "Sameera Bharadwaj", "Malavika", "Sahiti Chaganti", "Damini Bhatla",
    "Revanth", "Deepthi Sunaina", "Anurag Kulkarni", "Sravana Bhargavi",
]

# Heroes — their films' songs (JioSaavn surfaces them via album/featured text).
HEROES = [
    "Mahesh Babu", "Allu Arjun", "Prabhas", "Jr NTR", "Ram Charan",
    "Pawan Kalyan", "Chiranjeevi", "Nani", "Vijay Deverakonda", "Ravi Teja",
    "Nithiin", "Sharwanand", "Naga Chaitanya", "Nagarjuna", "Venkatesh",
    "Sai Dharam Tej", "Bellamkonda Sreenivas", "Balakrishna", "Sudheer Babu",
    "Vishwak Sen", "Kiran Abbavaram", "Teja Sajja", "Ram Pothineni",
    "Sundeep Kishan", "Adivi Sesh", "Naga Shaurya", "Varun Tej", "Raj Tarun",
]


# Telugu Unicode block. This script is used by NO other language, so its
# presence is a definitive "this is Telugu" — it can never cause foreign bleed.
_TELUGU_SCRIPT = re.compile(r"[ఀ-౿]")


def _keep(rec: dict) -> bool:
    """STRICT Telugu purity. Only two ways a song gets in:

      * language == 'telugu'                        (JioSaavn labels it Telugu)
      * language unknown/blank AND Telugu script    (the metadata itself proves
        it — Telugu letters can't belong to any other language)

    Every other explicit language is rejected. We deliberately do NOT trust a
    song just because it surfaced under a Telugu-movie search: a Telugu search
    still returns foreign 'unknown'-tagged junk, and purity comes first. Songs
    that are really Telugu but tagged 'unknown' with a romanized title (e.g.
    'Inkem Inkem') are left OUT here — they'll be recovered SAFELY later by
    checking their actual lyrics language, never by guessing.
    """
    lang = (rec.get("language") or "").lower()
    if lang == "telugu":
        return True
    if lang and lang != "unknown":
        return False
    return bool(_TELUGU_SCRIPT.search(f"{rec.get('title','')} {rec.get('movie','')}"))


def _clean_movie_query(name: str) -> str:
    """Turn a LyricStape movie label into a lean JioSaavn search query."""
    name = re.sub(r"\(.*?\)", " ", name or "")                      # drop (2015) etc.
    name = re.sub(r"\b(19|20)\d{2}\b", " ", name)                   # stray years
    name = re.sub(r"\b(songs?|lyrics?|mp3|movie|audio|jukebox|album)\b",
                  " ", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip()


def build_queries() -> list[tuple[str, str, int, int]]:
    """Return (key, query, pages, per_page). `key` is the resume id."""
    queries: list[tuple[str, str, int, int]] = []
    seen: set[str] = set()

    # Movies from the LyricStape index — real Telugu films, best signal.
    idx = db.get_collection("lyricstape_index")
    for d in idx.find({}, {"movie": 1}):
        m = _clean_movie_query(d.get("movie") or "")
        if len(m) < 2:
            continue
        k = m.lower()
        if k in seen:
            continue
        seen.add(k)
        queries.append((f"movie::{k}", m, 2, 20))

    # Artists — bias toward Telugu with the suffix; go deeper for prolific ones.
    for a in DIRECTORS + SINGERS:
        queries.append((f"artist::{a.lower()}", f"{a} telugu", 4, 30))
    for h in HEROES:
        queries.append((f"hero::{h.lower()}", f"{h} telugu songs", 2, 30))

    # The original curated seed queries (moods/eras/blockbusters).
    for q in SEED_QUERIES:
        queries.append((f"seed::{q.lower()}", q, 2, 30))

    return queries


# ─────────────────────────────────────────────────────────────────────────────
# Crawl
# ─────────────────────────────────────────────────────────────────────────────

async def _process_one(q: str, pages: int, per_page: int) -> dict:
    """Search -> strict Telugu fence -> dedupe -> save. Returns per-query stats."""
    raw = await search_paged(q, pages=pages, per_page=per_page)
    telugu = [r for r in raw if _keep(r)]
    songs = dedupe_records(telugu)
    stats = db.save_songs(songs)
    return {"raw": len(raw), "telugu": len(telugu),
            "unique": len(songs), "inserted": stats["inserted"]}


async def run(delay_s: float = 0.5) -> None:
    songs_col = db.get_songs_collection()
    prog = db.get_collection("crawl_progress")

    done = set(prog.distinct("_id"))
    queries = build_queries()
    todo = [q for q in queries if q[0] not in done]
    start_count = songs_col.count_documents({})
    print(f"queries: {len(queries)} total | {len(done)} already done | "
          f"{len(todo)} to crawl | catalog starts at {start_count}", flush=True)

    run_new = 0
    failures: list[tuple[str, str, int, int]] = []

    for i, (key, q, pages, per_page) in enumerate(todo, 1):
        try:
            s = await _process_one(q, pages, per_page)
            run_new += s["inserted"]
            prog.replace_one({"_id": key},
                             {"_id": key, "query": q, "done": True, **s}, upsert=True)
            if i % 25 == 0 or i == len(todo):
                total = songs_col.count_documents({})
                print(f"  [{i:>4}/{len(todo)}] {q[:38]:<38} +{s['inserted']:<3} "
                      f"| catalog={total} | new_this_run={run_new}", flush=True)
        except Exception as exc:  # one bad query never stops the night
            failures.append((key, q, pages, per_page))
            print(f"  [{i:>4}/{len(todo)}] {q[:38]:<38} FAILED: {str(exc)[:45]}", flush=True)
        await asyncio.sleep(delay_s)

    # Hands-off resilience: one automatic retry pass over the failures.
    if failures:
        print(f"\nretrying {len(failures)} failed queries (slower)...", flush=True)
        for key, q, pages, per_page in failures:
            try:
                s = await _process_one(q, pages, per_page)
                run_new += s["inserted"]
                prog.replace_one({"_id": key},
                                 {"_id": key, "query": q, "done": True, **s}, upsert=True)
            except Exception as exc:
                print(f"   still failing: {q[:38]} ({str(exc)[:40]})", flush=True)
            await asyncio.sleep(delay_s * 2)

    total = songs_col.count_documents({})
    print(f"\nCRAWL DONE. catalog now holds {total} Telugu songs "
          f"(+{run_new} new this run, started at {start_count})", flush=True)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    asyncio.run(run())
