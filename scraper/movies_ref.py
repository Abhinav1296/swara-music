"""Telugu-movie reference list — the trusted "universe" of Telugu films.

WHY THIS EXISTS (the big picture)
---------------------------------
A JioSaavn song's ``language`` tag is just a label someone typed — often it says
``unknown`` even for a real Telugu song. A label is not proof. So we build our
own *trusted* list of what actually IS a Telugu movie, and use it two ways:

  1. EXPAND  — for every movie in this list we can go ask JioSaavn for its songs,
     pulling in films our old LyricStape list never had.
  2. VERIFY  — when a song is tagged ``unknown`` we check: does its movie match a
     movie in THIS list (by name + year)?  If yes, that's hard evidence it's
     Telugu — because the *movie* is verified, not the song's flimsy tag.

WHERE THE TRUTH COMES FROM
--------------------------
Wikidata — Wikipedia's structured database. Instead of scraping messy HTML we
ask it a precise question and get back clean rows:

    "every item that is a FILM (Q11424), whose ORIGINAL LANGUAGE (P364) is
     TELUGU (Q8097), with its RELEASE DATE (P577)"

We ask one year at a time (small, polite queries that never time out) and store
each film as one document in the ``swara.movies`` collection:

    { _id: <wikidata id>, title, title_norm, year, language:"telugu",
      source:"wikidata", url, created_at, updated_at }

Run it:

    python -m scraper.movies_ref            # full history
    python -m scraper.movies_ref 2015 2026  # just a year range
"""
from __future__ import annotations

import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from scraper import db

# Wikidata's query endpoint. It speaks SPARQL (a query language) and returns JSON.
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

# Wikimedia BLOCKS requests without a descriptive User-Agent, so we identify
# ourselves honestly (project + contact). Ask for JSON results.
_HEADERS = {
    "User-Agent": "SwaraMusic/1.0 (personal Telugu-music project; abhi.pandu1296@gmail.com)",
    "Accept": "application/sparql-results+json",
}
_TIMEOUT = httpx.Timeout(60.0)

# The question, in SPARQL. %d is filled with the year we're asking about.
#   wdt:P31  wd:Q11424  -> "instance of : film"
#   wdt:P364 wd:Q8097   -> "original language of film : Telugu"
#   wdt:P577 ?date      -> "publication (release) date"
_QUERY_TMPL = """
SELECT DISTINCT ?film ?filmLabel ?date WHERE {
  ?film wdt:P31 wd:Q11424 ;
        wdt:P364 wd:Q8097 ;
        wdt:P577 ?date .
  FILTER(YEAR(?date) = %d)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""

# Telugu cinema began in the early 1930s; leave headroom for next year's releases.
_FIRST_YEAR = 1930


# ── helpers ──────────────────────────────────────────────────────────────────
def get_movies_collection():
    """The `swara.movies` reference collection (same DB as songs)."""
    return db.get_collection("movies")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(s: Optional[str]) -> str:
    """Fold a title down to a matchable key: lowercase, letters/digits only.

    'Baahubali: The Beginning' and 'Baahubali The Beginning' both become
    'baahubali the beginning', so later name-matching is forgiving.
    """
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _default_end_year() -> int:
    return datetime.now(timezone.utc).year + 1


# ── fetch one year from Wikidata ─────────────────────────────────────────────
def _fetch_year(client: httpx.Client, year: int, retries: int = 3) -> List[Dict[str, Any]]:
    """Return [{title, year, wikidata_id, url}] of Telugu films released in `year`."""
    query = _QUERY_TMPL % year
    for attempt in range(1, retries + 1):
        try:
            resp = client.get(WIKIDATA_SPARQL, params={"query": query, "format": "json"})
            if resp.status_code == 429:  # rate-limited — back off and retry
                time.sleep(2 * attempt)
                continue
            resp.raise_for_status()
            rows = resp.json().get("results", {}).get("bindings", [])
            break
        except Exception as exc:  # timeout / transient 5xx — retry a couple times
            if attempt == retries:
                print(f"  ! {year}: giving up ({exc})")
                return []
            time.sleep(2 * attempt)
    else:
        return []

    out: List[Dict[str, Any]] = []
    for r in rows:
        uri = r.get("film", {}).get("value", "")
        qid = uri.rsplit("/", 1)[-1]
        label = (r.get("filmLabel", {}).get("value") or "").strip()
        # If Wikidata has no English label it echoes the Q-id back — skip those.
        if not label or re.fullmatch(r"Q\d+", label):
            continue
        out.append({"title": label, "year": year, "wikidata_id": qid, "url": uri})
    return out


def _save(records: List[Dict[str, Any]], col) -> int:
    """Upsert films keyed by their stable Wikidata id. Returns count newly added.

    We process years oldest-first and pin `year` with $setOnInsert, so a film
    that lists several regional release dates keeps its EARLIEST year.
    """
    added = 0
    for m in records:
        res = col.update_one(
            {"_id": m["wikidata_id"]},
            {
                "$set": {
                    "title": m["title"],
                    "title_norm": _norm(m["title"]),
                    "language": "telugu",
                    "source": "wikidata",
                    "url": m["url"],
                    "updated_at": _now(),
                },
                "$setOnInsert": {"year": m["year"], "created_at": _now()},
            },
            upsert=True,
        )
        if res.upserted_id is not None:
            added += 1
    return added


# ── orchestration ────────────────────────────────────────────────────────────
def build(start: int = _FIRST_YEAR, end: Optional[int] = None, delay_s: float = 0.4) -> Dict[str, int]:
    """Walk every year, pull its Telugu films, upsert into `swara.movies`."""
    end = end or _default_end_year()
    col = get_movies_collection()
    col.create_index("title_norm")
    col.create_index("year")

    total_rows = total_added = 0
    for year in range(start, end + 1):
        films = _fetch_year(client=_client, year=year)
        added = _save(films, col) if films else 0
        total_rows += len(films)
        total_added += added
        if films:
            print(f"  {year}: {len(films):>3} films  (+{added} new)")
        time.sleep(delay_s)

    grand = col.count_documents({})
    print(f"\nDone. Saw {total_rows} film-rows, {total_added} newly added this run.")
    print(f"swara.movies now holds {grand} unique Telugu movies.")
    return {"rows_seen": total_rows, "added": total_added, "total_in_db": grand}


# A module-level client so _fetch_year can reuse one connection pool.
_client = httpx.Client(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True)


if __name__ == "__main__":
    try:  # Windows console: make Telugu / accented titles printable
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    a = sys.argv[1:]
    start = int(a[0]) if len(a) >= 1 else _FIRST_YEAR
    end = int(a[1]) if len(a) >= 2 else None
    build(start=start, end=end)
    _client.close()
