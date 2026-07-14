/**
 * Lyrics foundation for Swara.
 *
 * Two flavors are supported:
 *  - timed : LRC-style lines with timestamps (seconds) → karaoke highlight
 *  - plain : free text, no timestamps
 *
 * Lyrics are resolved LOCALLY from a demo dataset (see demoLyrics.js) keyed by
 * track id or normalized title. `loadLyrics` is async so a future provider
 * proxy (e.g. `GET /api/lyrics`) can be dropped in here without touching the
 * UI. No scraping, no copyrighted fetching.
 */

/**
 * @typedef {Object} TimedLine
 * @property {number} time   seconds
 * @property {string} text
 */

/**
 * @typedef {Object} Lyrics
 * @property {'timed'|'plain'} kind
 * @property {TimedLine[]} lines
 * @property {string} [plain]
 * @property {'demo'} [source]
 */

/**
 * @typedef {Object} LyricsState
 * @property {'loading'|'available'|'unavailable'} status
 * @property {Lyrics|null} lyrics
 */

// Matches [mm:ss], [mm:ss.xx], [mm:ss.xxx]; allows multiple tags per line.
const LRC_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parse LRC text into sorted TimedLine[]. Handles multiple tags per line. */
export function parseLRC(text) {
  const lines = [];
  const raw = (text || "").split(/\r?\n/);
  for (const line of raw) {
    LRC_TAG.lastIndex = 0;
    const stamps = [];
    let m;
    let lastIndex = 0;
    while ((m = LRC_TAG.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
      stamps.push(min * 60 + sec + frac);
      lastIndex = LRC_TAG.lastIndex;
    }
    const body = line.slice(lastIndex).trim();
    if (!body) continue;
    for (const t of stamps) lines.push({ time: t, text: body });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Normalize a title for key matching (lowercase, strip punctuation/diacritics). */
export function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse arbitrary lyrics text: LRC if it has tags, else plain. */
export function parseLyrics(input) {
  if (input == null) return { kind: "plain", lines: [] };
  const hasTags = /\[(\d{1,2}):(\d{1,2})/.test(input);
  if (hasTags) {
    return { kind: "timed", lines: parseLRC(input), source: "demo" };
  }
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ time: -1, text }));
  return { kind: "plain", lines, plain: input, source: "demo" };
}

/** Index of the active timed line for a given currentTime, or -1. */
export function resolveActiveLine(lines, currentTime) {
  if (!lines || lines.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) idx = i;
    else break;
  }
  return idx;
}

/**
 * Resolve lyrics for a song (async, foundation-ready).
 * Currently reads from the local demo dataset only. A real provider proxy can
 * be added here later without UI changes.
 *
 * @param {{id?:number|string, trackName?:string}} song
 * @returns {Promise<LyricsState>}
 */
export async function loadLyrics(song) {
  const { demoLyrics } = await import("./demoLyrics");
  const idKey = String(song?.id ?? "");
  const titleKey = normalizeTitle(song?.trackName);
  const raw = demoLyrics[idKey] ?? demoLyrics[titleKey];
  // Brief async so the loading state is exercised; swap for a real fetch later.
  await new Promise((r) => setTimeout(r, 200));
  if (!raw) return { status: "unavailable", lyrics: null };
  return { status: "available", lyrics: parseLyrics(raw) };
}
