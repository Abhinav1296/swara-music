// Thin fetch client for the FastAPI backend.
//
// VITE_API_BASE is normally empty, which means requests go to the relative
// "/api" path and are forwarded to the FastAPI server by Vite's dev proxy
// (see vite.config.js). Set it in .env to point at a remote backend in prod.
//
// Home shelves (trending / mood queries) are cached in-memory for 5 minutes
// so navigating away and back does not re-fetch. Search / song-details are
// NOT cached here — those have their own semantics (fresh per query, backend
// TTL cache for details).

import { normalizeTrack } from "../utils/trackAdapter";

const BASE = import.meta.env.VITE_API_BASE || "/api";

// ---- Simple in-memory TTL cache for Home shelves ------------------------- //
const SHELF_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _shelfCache = new Map(); // key -> { expiresAt, data }

function _shelfGet(key) {
  const hit = _shelfCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _shelfCache.delete(key);
    return null;
  }
  return hit.data;
}

function _shelfSet(key, data) {
  _shelfCache.set(key, { expiresAt: Date.now() + SHELF_TTL_MS, data });
}

// ---- Error helper -------------------------------------------------------- //
function _makeError(res, detail) {
  const err = new Error(
    typeof detail === "string" ? detail : `Request failed (${res.status})`
  );
  err.status = res.status;
  const ra = res.headers.get("Retry-After");
  if (ra) {
    const n = Number(ra);
    err.retryAfter = Number.isFinite(n) ? n : undefined;
  }
  return err;
}

async function getJson(path, { signal } = {}) {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw _makeError(res, detail);
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

/**
 * Fetch the default popular Telugu list for the home page (JioSaavn-backed).
 * Cached in-memory for 5 minutes.
 */
export function getTrending(limit = 30) {
  const key = `trending:${limit}`;
  const cached = _shelfGet(key);
  if (cached) return Promise.resolve(cached);

  const params = new URLSearchParams({ limit: String(limit) });
  return getJson(`/trending?${params.toString()}`).then((d) => {
    const out = { ...d, results: (d.results || []).map(normalizeTrack) };
    _shelfSet(key, out);
    return out;
  });
}

/**
 * Home mood-shelf query (JioSaavn-backed, artwork-rich). Same envelope shape
 * as /api/search but sourced for broad vibe queries where /suggestion is weak.
 * Cached in-memory for 5 minutes (per query string).
 */
export function getShelf(query, limit = 20) {
  const key = `shelf:${query}:${limit}`;
  const cached = _shelfGet(key);
  if (cached) return Promise.resolve(cached);

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson(`/trending?${params.toString()}`).then((d) => {
    const out = { ...d, results: (d.results || []).map(normalizeTrack) };
    _shelfSet(key, out);
    return out;
  });
}

/**
 * Resolve a track into a full-length stream + synced/plain lyrics + metadata.
 * Returns the raw backend SongDetails (caller normalizes lyrics/artwork).
 *
 * @param {{artist:string, song:string, url?:string, signal?:AbortSignal}} opts
 */
export function getSongDetails({ artist, song, url, signal } = {}) {
  const params = new URLSearchParams();
  if (artist) params.set("artist", artist);
  if (song) params.set("song", song);
  if (url) params.set("url", url);
  return getJson(`/song-details?${params.toString()}`, { signal });
}

/**
 * Fast stream-only resolution for immediate playback start.
 * Returns { status, stream_url, artist, title, album, artwork, durationMs, source }
 *
 * On 404, the backend now returns a proper JSON body (not stuffed into "detail"),
 * so we can read status="not_found" directly.
 *
 * @param {{artist:string, song:string, url?:string, signal?:AbortSignal}} opts
 */
export async function getStream({ artist, song, url, signal } = {}) {
  const params = new URLSearchParams();
  if (artist) params.set("artist", artist);
  if (song) params.set("song", song);
  if (url) params.set("url", url);

  const res = await fetch(`${BASE}/stream?${params.toString()}`, { signal });

  if (res.status === 404) {
    try {
      const body = await res.json();
      if (body?.status === "not_found") return body;
    } catch {
      /* fall through */
    }
    throw _makeError(res, `Stream not found (${res.status})`);
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw _makeError(res, detail);
  }

  return res.json();
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