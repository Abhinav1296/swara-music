import { useEffect, useRef, useState } from "react";
import { useLibrary } from "../context/LibraryContext";
import { searchSongs } from "../api/client";
import Section from "./Section";

/**
 * "Because You Liked" — a fully local, account-free recommendations shelf.
 *
 * Seeds are derived from the user's liked songs + recently played (weighted by
 * recency + like count). For each seed artist we fetch a few related tracks via
 * the existing /api/search endpoint and render them under a
 * "Because you liked <Artist>" heading. Results are:
 *   - deduped against liked tracks and against tracks already shown on Home,
 *   - hidden silently when there are no likes/recents,
 *   - hidden per-seed (not crashed) when the backend call fails,
 *   - cached in-memory for the session so navigating away/back from Home never
 *     re-fires the requests.
 *
 * The fetch is deferred (short delay + idle callback) so it never competes with
 * the Home cold-load (trending + mood shelves).
 */

// Session cache: seed artist (lowercased) -> { expires, songs }. Persists across
// Home mounts within a session so we don't refetch on every render.
const recCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_SEEDS = 3;

const LIKE_WEIGHT = 3; // a liked track strongly signals taste
const RECENT_WEIGHT = 2; // a recently played track is a weaker signal

/**
 * Score each artist by how much the user likes/recently played them, then
 * return the top `maxSeeds` artist display names (most-liked/recent first).
 */
function deriveSeeds(likedSongs, recentlyPlayed, maxSeeds = MAX_SEEDS) {
  const scores = new Map(); // lowerName -> { score, display }
  const bump = (name, delta) => {
    if (!name) return;
    const key = name.toLowerCase();
    const cur = scores.get(key) || { score: 0, display: name };
    cur.score += delta;
    scores.set(key, cur);
  };
  for (const song of likedSongs || []) bump(song?.artistName, LIKE_WEIGHT);
  (recentlyPlayed || []).forEach((song, i) => bump(song?.artistName, RECENT_WEIGHT / (1 + i)));

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSeeds)
    .map((s) => s.display);
}

/**
 * @param {{ current: object }} ref — a ref whose `.current` is a Set of song ids
 *   already displayed on Home (trending + mood shelves), so we don't recommend
 *   tracks the user is already looking at. Read at fetch time (after Home loads).
 */
export default function RecommendationsShelf({ displayedIdsRef }) {
  const { likedSongs, recentlyPlayed } = useLibrary();
  const [shelves, setShelves] = useState([]); // [{ artist, songs }]

  useEffect(() => {
    const seeds = deriveSeeds(likedSongs, recentlyPlayed, MAX_SEEDS);
    if (seeds.length === 0) return undefined; // no likes/recents → hide silently

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const likedIds = new Set((likedSongs || []).map((s) => s.id));
      const displayed = displayedIdsRef?.current;
      const seen = new Set();
      const collected = [];
      let pending = seeds.length;
      if (pending === 0) {
        setShelves([]);
        return;
      }
      const finish = () => {
        if (cancelled) return;
        setShelves(collected.filter((s) => s.songs && s.songs.length > 0));
      };
      seeds.forEach((artist) => {
        const cacheKey = artist.toLowerCase();
        const cached = recCache.get(cacheKey);
        const now = Date.now();
        if (cached && cached.expires > now) {
          collected.push({ artist, songs: cached.songs });
          pending -= 1;
          if (pending === 0) finish();
          return;
        }
        searchSongs(`${artist} telugu`, 15)
          .then((d) => {
            const results = (d?.results || []).filter((s) => {
              if (!s?.id) return false;
              if (likedIds.has(s.id)) return false; // dedupe vs liked
              if (displayed && displayed.has(s.id)) return false; // dedupe vs shelves
              if (seen.has(s.id)) return false; // dedupe across seeds
              seen.add(s.id);
              return true;
            });
            recCache.set(cacheKey, { expires: Date.now() + CACHE_TTL, songs: results });
            collected.push({ artist, songs: results });
          })
          .catch(() => {
            // Backend failed for this seed → drop it silently (don't crash Home).
          })
          .finally(() => {
            pending -= 1;
            if (pending === 0) finish();
          });
      });
    };

    // Defer so the Home cold-load isn't blocked. Prefer requestIdleCallback, with
    // a timeout fallback to a plain setTimeout.
    let timer = null;
    if (typeof window !== "undefined" && window.requestIdleCallback) {
      const idle = window.requestIdleCallback(() => {
        timer = setTimeout(run, 300);
      }, { timeout: 3000 });
      return () => {
        cancelled = true;
        if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
        if (timer) clearTimeout(timer);
      };
    }
    timer = setTimeout(run, 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Run once on mount; seeds are derived from the library snapshot at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (shelves.length === 0) return null; // hidden when empty / no data / no likes

  return (
    <>
      {shelves.map((s) => (
        <Section key={s.artist} title={`Because you liked ${s.artist}`} songs={s.songs} />
      ))}
    </>
  );
}
