// Thin fetch client for the FastAPI backend.
//
// VITE_API_BASE is normally empty, which means requests go to the relative
// "/api" path and are forwarded to the FastAPI server by Vite's dev proxy
// (see vite.config.js). Set it in .env to point at a remote backend in prod.

import { normalizeTrack } from "../utils/trackAdapter";

const BASE = import.meta.env.VITE_API_BASE || "/api";

async function getJson(path, { signal } = {}) {
  const res = await fetch(`${BASE}${path}`, signal ? { signal } : undefined);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore non-JSON error bodies */
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Search Telugu songs. Returns { query, count, results } (normalized). */
export function searchSongs(query, limit = 25) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson(`/search?${params.toString()}`).then((d) => ({
    ...d,
    results: (d.results || []).map(normalizeTrack),
  }));
}

/** Fetch the default popular Telugu list for the home page (JioSaavn-backed). */
export function getTrending(limit = 30) {
  const params = new URLSearchParams({ limit: String(limit) });
  return getJson(`/trending?${params.toString()}`).then((d) => ({
    ...d,
    results: (d.results || []).map(normalizeTrack),
  }));
}

/**
 * Home mood-shelf query (JioSaavn-backed, artwork-rich). Same envelope shape as
 * /api/search but sourced for broad vibe queries where /suggestion is weak.
 */
export function getShelf(query, limit = 20) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson(`/trending?${params.toString()}`).then((d) => ({
    ...d,
    results: (d.results || []).map(normalizeTrack),
  }));
}

/**
 * Resolve a track into a full-length stream + synced/plain lyrics + metadata.
 * Returns the raw backend SongDetails (caller normalizes lyrics/artwork).
 *
 * @param {{artist:string, song:string, url?:string, signal?:AbortSignal}} opts
 *   `signal` is forwarded to fetch so callers can abort an in-flight resolve
 *   (e.g. when the user skips before it completes). Aborting throws an
 *   `AbortError`, which the player treats as a benign cancel (not a failure).
 */
export function getSongDetails({ artist, song, url, signal } = {}) {
  const params = new URLSearchParams();
  if (artist) params.set("artist", artist);
  if (song) params.set("song", song);
  if (url) params.set("url", url);
  return getJson(`/song-details?${params.toString()}`, { signal });
}

/**
 * Resolve an artist or album page by name. Lyrica/JioSaavn have no id lookup,
 * so we resolve by `name` (and, for albums, an optional `artist` hint).
 *
 * @param {{ name:string, type?:'artist'|'album', artist?:string, limit?:number }} opts
 */
export function lookup({ name, type = "artist", artist, limit = 50 } = {}) {
  const params = new URLSearchParams({ type, limit: String(limit) });
  if (name) params.set("name", name);
  if (artist) params.set("artist", artist);
  return getJson(`/lookup?${params.toString()}`).then((d) => ({
    ...d,
    results: (d.results || []).map(normalizeTrack),
  }));
}
