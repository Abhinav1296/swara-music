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
 * Browse real movie-albums (deduped by canonical name+year, junk filtered).
 * Returns { count, results:[{ key, name, year, artworkUrl600, count, singers }] }.
 * These are album CARDS (not tracks), so we don't run normalizeTrack. Cached
 * per page for 5 minutes — the album list is effectively static.
 */
export function getAlbums({ limit = 48, offset = 0 } = {}) {
  const key = `albums:${limit}:${offset}`;
  const cached = _shelfGet(key);
  if (cached) return Promise.resolve(cached);

  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return getJson(`/albums?${params.toString()}`).then((d) => {
    const out = { count: d.count || 0, results: d.results || [] };
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
 * Fresh Telugu album cards (true New Releases, live from JioSaavn, daily-cached).
 * Returns { count, results:[{ albumId, name, year, artworkUrl600, count }] }.
 * These are album CARDS (not tracks), so we don't run normalizeTrack.
 */
export function getNewReleases({ limit = 20, offset = 0 } = {}) {
  const key = `newreleases:${limit}:${offset}`;
  const cached = _shelfGet(key);
  if (cached) return Promise.resolve(cached);

  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return getJson(`/new-releases?${params.toString()}`).then((d) => {
    const out = { count: d.count || 0, results: d.results || [] };
    _shelfSet(key, out);
    return out;
  });
}

/**
 * Resolve an artist or album page. Lyrica/JioSaavn have no id lookup for our own
 * catalog, so we resolve by `name` (+ optional `artist`/`year` for albums). A
 * JioSaavn album card instead resolves by `saavnId` (expanded into its tracks).
 *
 * @param {{ name?:string, type?:'artist'|'album', artist?:string, year?:number, saavnId?:string, limit?:number }} opts
 */
export function lookup({ name, type = "artist", artist, year, saavnId, limit = 50 } = {}) {
  const params = new URLSearchParams({ type, limit: String(limit) });
  if (name) params.set("name", name);
  if (artist) params.set("artist", artist);
  // Only forward a real, finite year — never the strings "undefined"/"null"/"NaN"
  // that a stale URL or a null-ish param can produce, which make the backend's
  // `year: int` query validation fail with a 422 ("Couldn't load this album").
  const yearNum = Number(year);
  if (year !== undefined && year !== null && year !== "" && Number.isFinite(yearNum)) {
    params.set("year", String(yearNum));
  }
  if (saavnId) params.set("saavnId", String(saavnId));
  return getJson(`/lookup?${params.toString()}`).then((d) => ({
    ...d,
    results: (d.results || []).map(normalizeTrack),
  }));
}

/**
 * Fetch every stored lyric version for a song (for the version picker).
 * Prefer the exact `id` (song _id); artist/song/url are fallbacks.
 * Returns { songId, chosen, versions:[{ source, label, hasSynced, hasTelugu,
 * hasRoman, synced, plain, plainRoman, votes, isChosen }] }.
 */
export function getLyricVersions({ id, artist, song, url, signal } = {}) {
  const params = new URLSearchParams();
  if (id) params.set("id", id);
  if (artist) params.set("artist", artist);
  if (song) params.set("song", song);
  if (url) params.set("url", url);
  return getJson(`/lyrics/versions?${params.toString()}`, { signal });
}

/**
 * Record a listener's vote for the lyric version that matches best.
 * Returns { ok, songId, votes:{ [source]: count } }.
 */
// ---- Auth ---------------------------------------------------------------- //
const _authHeader = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

async function _readErr(res) {
  let detail = `Request failed (${res.status})`;
  try {
    const b = await res.json();
    if (b?.detail) detail = b.detail;
  } catch {
    /* ignore non-JSON error bodies */
  }
  return _makeError(res, detail);
}

/** Exchange a Google ID token for a Swara session. Returns { token, user }. */
export async function googleLogin(idToken) {
  const res = await fetch(`${BASE}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw await _readErr(res);
  return res.json();
}

/** Fetch the current user for a session token. Returns { user }. */
export async function fetchMe(token) {
  const res = await fetch(`${BASE}/auth/me`, { headers: _authHeader(token) });
  if (!res.ok) throw await _readErr(res);
  return res.json();
}

/** Update the current user's profile (name / favoriteSingers). Returns { user }. */
export async function updateProfile(token, patch) {
  const res = await fetch(`${BASE}/auth/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ..._authHeader(token) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await _readErr(res);
  return res.json();
}

export async function sendLyricFeedback({ songId, source }) {
  const res = await fetch(`${BASE}/lyrics/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songId, source }),
  });
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