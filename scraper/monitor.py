"""Live crawl monitor — a terminal progress bar for the Telugu crawl.

Reads MongoDB directly (crawl_progress + songs counts) and redraws a progress
bar every few seconds. 100% READ-ONLY: safe to run in its own PowerShell window
while the crawl runs in the background — it never touches your data.

    python -m scraper.monitor          # refresh every 3s
    python -m scraper.monitor 5        # refresh every 5s

Ctrl+C stops watching; the crawl itself keeps running.
"""
from __future__ import annotations

import sys
import time

from scraper import db
from scraper.crawl_all import build_queries


def _bar(frac: float, width: int = 32) -> str:
    frac = 0.0 if frac < 0 else 1.0 if frac > 1 else frac
    filled = int(frac * width)
    return "[" + "#" * filled + "-" * (width - filled) + "]"


def _fmt(seconds: float) -> str:
    if seconds <= 0 or seconds == float("inf") or seconds != seconds:
        return "--:--"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def run(interval: float = 3.0) -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    songs = db.get_songs_collection()
    prog = db.get_collection("crawl_progress")
    total_q = len(build_queries())

    t0 = time.time()
    q0 = prog.count_documents({})
    s0 = songs.count_documents({})
    print(f"Telugu crawl monitor  |  {total_q} queries total")
    print(f"starting from: {q0} queries done, {s0} songs")
    print("(Ctrl+C to stop watching — the crawl keeps running)\n")

    last_change = time.time()
    prev = (q0, s0)
    try:
        while True:
            done = prog.count_documents({})
            n = songs.count_documents({})
            if (done, n) != prev:
                prev = (done, n)
                last_change = time.time()

            frac = done / total_q if total_q else 0.0
            elapsed = max(1e-6, time.time() - t0)
            rate = (done - q0) / elapsed
            eta = (total_q - done) / rate if rate > 0 else float("inf")
            idle = time.time() - last_change
            tag = f"  idle {int(idle)}s" if idle > 8 else ""

            sys.stdout.write(
                f"\r{_bar(frac)} {frac*100:5.1f}%  "
                f"q {done:>4}/{total_q}  "
                f"songs {n:>5} (+{n - s0})  "
                f"ETA {_fmt(eta)}{tag}   "
            )
            sys.stdout.flush()

            if done >= total_q:
                print(f"\n\nCRAWL COMPLETE — {n} Telugu songs in the database.")
                return
            if idle > 45:  # nothing changed for 45s: finished (minus a few fails) or paused
                print(f"\n\nno activity for {int(idle)}s — crawl looks finished or paused. "
                      f"{n} songs, {done}/{total_q} queries.")
                return
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n\nstopped watching. The crawl is still running in the background.")


if __name__ == "__main__":
    iv = 3.0
    if len(sys.argv) > 1:
        try:
            iv = float(sys.argv[1])
        except ValueError:
            pass
    run(iv)
