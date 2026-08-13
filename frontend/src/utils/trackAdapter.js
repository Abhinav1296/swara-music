/**
 * Single mapping helper between Lyrica's backend shape and the Swara UI.
 *
 * The backend returns each track as a `Song` with both canonical fields
 * (title/artist/album/artwork/durationMs/streamUrl/hasFullStream/source/
 * lyricsAvailable) and legacy iTunes-era aliases (trackName/artistName/
 * artworkUrl600/...). This module is the ONE place that guarantees the shape
 * the presentational components expect, isolates Lyrica quirks, and provides a
 * deterministic placeholder when artwork is missing — so older localStorage
 * records (which may only have iTunes-like fields) still render.
 */

/** Deterministic gradient placeholder artwork (data URI) for missing art. */
export function placeholderArtwork(title) {
  const letter = (title || "?").trim().charAt(0).toUpperCase() || "♪";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='#1c0a10'/>` +
    `<stop offset='1' stop-color='#5a0f1f'/></linearGradient></defs>` +
    `<rect width='300' height='300' fill='url(#g)'/>` +
    `<text x='50%' y='54%' font-family='sans-serif' font-size='150' ` +
    `font-weight='700' fill='#fa233b' text-anchor='middle' ` +
    `dominant-baseline='middle' opacity='0.92'>${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Small, stable string id for fallback when the backend omits `id`. */
function fallbackId(artist, title, album) {
  const raw = `${artist}|${title}|${album}`.toLowerCase().trim();
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `t_${h.toString(36)}`;
}

/**
 * Map a backend `Song` (canonical + aliases) into the shape the components read.
 * Always guarantees `artworkUrl100`/`artworkUrl600` (placeholder if missing) and
 * the legacy `trackName`/`artistName`/`collectionName`/`previewUrl` fields.
 */
export function normalizeTrack(t) {
  if (!t) return t;
  const title = t.title ?? t.trackName ?? "Unknown Track";
  const artist = t.artist ?? t.artistName ?? "Unknown Artist";
  const album = t.album ?? t.collectionName ?? "";
  const artwork = t.artwork || t.artworkUrl600 || t.artworkUrl100 || "";
  const durationMs = t.durationMs ?? t.trackTimeMillis ?? null;
  const streamUrl = t.streamUrl ?? t.previewUrl ?? null;
  const id = t.id || fallbackId(artist, title, album);
  const art = artwork || placeholderArtwork(title);
  return {
    id,
    trackName: title,
    artistName: artist,
    collectionName: album,
    year: t.year ?? null,
    artworkUrl100: art,
    artworkUrl600: art,
    previewUrl: streamUrl,
    trackTimeMillis: durationMs,
    streamUrl,
    hasFullStream: Boolean(t.hasFullStream) || Boolean(streamUrl),
    source: t.source ?? "lyrica",
    lyricsAvailable: Boolean(t.lyricsAvailable),
    artistId: t.artistId ?? null,
    collectionId: t.collectionId ?? null,
    jiosaavnUrl: t.jiosaavnUrl ?? null,
  };
}

/**
 * Normalize a backend lyrics payload ({ synced:[{timeMs,text}], plain, source,
 * available }) into the UI-friendly shape the lyrics panel consumes:
 *   { kind: 'timed'|'plain'|'unavailable', lines: [{time, text}], plain, source }
 * `time` is in SECONDS so the existing `resolveActiveLine(lines, progress)`
 * works unchanged.
 */
function plainToLines(text) {
  if (!text) return [];
  return String(text)
    .split(/\r?\n/)
    .map((t) => ({ time: -1, text: t }))
    .filter((l) => l.text.trim());
}

export function normalizeLyrics(payload) {
  if (!payload || !payload.available) {
    return { kind: "unavailable", lines: [], plain: null, roman: null, source: payload?.source ?? null };
  }
  // Romanized alternate (plain, no karaoke timing) — non-null ONLY when the
  // backend flagged this song as having a distinct Latin-script version. The
  // player shows a Telugu/Romanized toggle exactly when `roman` is present.
  const romanLines = plainToLines(payload.plainRoman);
  const roman = romanLines.length ? romanLines : null;

  const synced = (payload.synced || []).map((l) => ({
    time: (l.timeMs ?? 0) / 1000,
    text: l.text || "",
  }));
  if (synced.length) {
    return { kind: "timed", lines: synced, plain: payload.plain || null, roman, source: payload.source };
  }
  const plain = payload.plain || "";
  const lines = plainToLines(plain);
  return { kind: "plain", lines, plain, roman, source: payload.source };
}

/**
 * Normalize one lyric VERSION (from /api/lyrics/versions) into the same shape the
 * lyrics panel renders, so switching versions reuses the existing UI unchanged.
 */
export function normalizeVersion(v) {
  if (!v) return null;
  const romanLines = plainToLines(v.plainRoman);
  const roman = romanLines.length ? romanLines : null;
  const synced = (v.synced || []).map((l) => ({
    time: (l.timeMs ?? 0) / 1000,
    text: l.text || "",
  }));
  if (synced.length) {
    return { kind: "timed", lines: synced, plain: v.plain || null, roman, source: v.source };
  }
  const plain = v.plain || "";
  return { kind: "plain", lines: plainToLines(plain), plain, roman, source: v.source };
}
