"""Live progress for the movie-expansion run — read-only, safe to run anytime.

Shows how far `expand_movies` has gotten (movies done / total), plus how the
catalog and quarantine are growing. Refreshes in place until the run finishes.

    python -m scraper.expand_progress            # refresh every 5s
    python -m scraper.expand_progress 10          # refresh every 10s
    python -m scraper.expand_progress once        # one snapshot, then exit
"""
from __future__ import annotations

import sys
import time

from scraper import db


def _bar(frac: float, width: int = 34) -> str:
    frac = max(0.0, min(1.0, frac))
    filled = int(frac * width)
    return "[" + "#" * filled + "-" * (width - filled) + f"] {frac * 100:5.1f}%"


def snapshot() -> dict:
    movies = db.get_collection("movies")
    songs = db.get_songs_collection()
    quar = db.get_collection("quarantine")
    total = movies.count_documents({})
    done = movies.count_documents({"expanded_at": {"$exists": True, "$ne": None}})
    return {
        "total": total,
        "done": done,
        "songs": songs.count_documents({}),
        "quar": quar.count_documents({}),
    }


def _print(s: dict, newline: bool = False) -> None:
    line = (f"\r  movies {s['done']:>4}/{s['total']}  {_bar(s['done'] / s['total'] if s['total'] else 0)}"
            f"   live songs: {s['songs']:>6}   quarantine: {s['quar']:>4}")
    end = "\n" if newline else ""
    sys.stdout.write(line + end)
    sys.stdout.flush()


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    arg = sys.argv[1] if len(sys.argv) > 1 else "5"
    if arg.lower() == "once":
        _print(snapshot(), newline=True)
        return

    interval = int(arg) if arg.isdigit() else 5
    print("Watching expansion (Ctrl+C to stop the watcher — the run keeps going)\n")
    last_done = -1
    idle = 0
    while True:
        s = snapshot()
        _print(s)
        if s["done"] >= s["total"] and s["total"] > 0:
            _print(s, newline=True)
            print("\nExpansion complete.")
            break
        idle = idle + interval if s["done"] == last_done else 0
        last_done = s["done"]
        if idle >= 180:  # 3 min with no movement -> run likely finished/stopped
            _print(s, newline=True)
            print("\n(No movement for 3 min — the run has finished or stopped.)")
            break
        time.sleep(interval)


if __name__ == "__main__":
    main()
