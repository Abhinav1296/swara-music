import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { isNativePlatform } from "../auth/nativeGoogleSignIn";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";

/**
 * Local device songs (APK only) — the user's OWN audio files, imported from the
 * phone and played with no network at all (B3).
 *
 * This deliberately mirrors the offline-download store (`offline/downloads.js`):
 * a localStorage index (`swara:local_songs`) is the synchronous source of truth
 * so the player's resolve path can prefer a local file with no await, and the
 * actual audio bytes live in Directory.Data (app-private, survive reloads).
 *
 * The difference from a download: these songs are NOT in the JioSaavn catalog,
 * so there is no stream to resolve and no vetted lyrics to snapshot — a local
 * song simply carries its own playable file URI and reports lyrics as
 * unavailable (purity: we never fabricate lyrics for an unknown file).
 *
 * Everything here NO-OPS off native — the web build never touches Filesystem,
 * and callers should gate the import UI behind `localCapable()`.
 *
 * LocalSong: {
 *   id,            // "local-<ts>-<rand>" — unique, never collides with catalog ids
 *   trackName, artistName, collectionName,
 *   artworkUrl100, artworkUrl600,  // placeholder tile (self-contained data URI)
 *   trackTimeMillis,               // best-effort duration, or null
 *   path,          // relative path inside Directory.Data
 *   uri,           // absolute file:// uri (for Capacitor.convertFileSrc at play time)
 *   isLocal: true, // marks the track so prefetch/resolve skip the network
 *   addedAt,       // ms epoch
 * }
 */

const LOCAL_DIR = "swara/local";

// A self-contained placeholder cover (music note on a dark tile). Inline data
// URI so it needs no network and shows in lists, the full-screen player, and
// the media-session notification.
const LOCAL_ART = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'>" +
    "<rect width='600' height='600' fill='#17171d'/>" +
    "<text x='50%' y='52%' font-family='sans-serif' font-size='300' " +
    "text-anchor='middle' dominant-baseline='central' fill='#fa233b'>♪</text>" +
    "</svg>"
)}`;

/** True only inside the Capacitor APK — the web app can't import local files. */
export function localCapable() {
  return isNativePlatform();
}

/** The whole { [id]: record } map (sync). */
export function getLocalIndex() {
  return loadJSON(STORAGE_KEYS.localSongs, {}) || {};
}

/** One record, or null (sync — safe to call in the play path). */
export function getLocalSongRecord(id) {
  if (!id) return null;
  return getLocalIndex()[id] || null;
}

/** Whether this id is an imported local device song (sync). */
export function isLocalSong(id) {
  return Boolean(getLocalSongRecord(id));
}

/** All imported local songs, newest first. */
export function listLocalSongs() {
  return Object.values(getLocalIndex()).sort(
    (a, b) => (b.addedAt || 0) - (a.addedAt || 0)
  );
}

/**
 * A webview-playable src for a local record. Capacitor rewrites the file:// uri
 * into the app's local http origin so <audio> can load it. Returns null off
 * native or without a stored uri.
 */
export function getLocalPlayableSrc(record) {
  if (!record?.uri || !isNativePlatform()) return null;
  try {
    return Capacitor.convertFileSrc(record.uri);
  } catch {
    return null;
  }
}

// Read-fresh-then-write so concurrent imports can't clobber each other's index
// entry — the localStorage read+write is synchronous and JS is single-threaded,
// so each upsert runs to completion atomically.
function upsertRecord(record) {
  const idx = getLocalIndex();
  idx[record.id] = record;
  saveJSON(STORAGE_KEYS.localSongs, idx);
}

function dropRecord(id) {
  const idx = getLocalIndex();
  if (!idx[id]) return;
  delete idx[id];
  saveJSON(STORAGE_KEYS.localSongs, idx);
}

function extOf(fileName) {
  const m = String(fileName || "").match(/\.([a-z0-9]{2,5})$/i);
  return (m?.[1] || "mp3").toLowerCase();
}

// Turn "Artist - Title.mp3" into { trackName, artistName } when the common
// "artist - title" convention is present; otherwise use the whole name as the
// title. Never guesses beyond that split.
function parseName(fileName) {
  const base = String(fileName || "Untitled").replace(/\.[^./\\]+$/, "").trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(" - ").trim();
    if (artist && title) return { trackName: title, artistName: artist };
  }
  return { trackName: base || "Untitled", artistName: "Local file" };
}

// Best-effort duration via a throwaway <audio> + object URL. Resolves to ms, or
// null if the browser can't read it (some containers) within the timeout.
function readDuration(file) {
  return new Promise((resolve) => {
    let url;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const done = (val) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      resolve(val);
    };
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    audio.src = url;
  });
}

// Read a File as base64 (no data-URI prefix) for Filesystem.writeFile. Native
// Filesystem decodes base64 → raw bytes when no `encoding` is given.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || "");
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error || new Error("Couldn't read file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Import one audio File into app-private storage and index it. Returns the new
 * record. Rejects off native. The bytes are copied (base64 → Filesystem) so the
 * song survives even if the original is moved/deleted from the device.
 */
export async function importAudioFile(file) {
  if (!file) throw new Error("No file.");
  if (!localCapable()) {
    throw new Error("Importing local songs is only available in the Swara app.");
  }

  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = extOf(file.name);
  const { trackName, artistName } = parseName(file.name);
  const trackTimeMillis = await readDuration(file);
  const base64 = await fileToBase64(file);

  const path = `${LOCAL_DIR}/${id}.${ext}`;
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });

  const record = {
    id,
    trackName,
    artistName,
    collectionName: "",
    artworkUrl100: LOCAL_ART,
    artworkUrl600: LOCAL_ART,
    trackTimeMillis,
    path,
    uri,
    isLocal: true,
    addedAt: Date.now(),
  };
  upsertRecord(record);
  return record;
}

/** Delete a local song's audio file and drop its index entry. Never throws. */
export async function removeLocalSong(id) {
  const record = getLocalSongRecord(id);
  if (!record) return;
  if (isNativePlatform() && record.path) {
    try {
      await Filesystem.deleteFile({ path: record.path, directory: Directory.Data });
    } catch {
      /* file already gone / unwritable — drop the index entry regardless */
    }
  }
  dropRecord(id);
}
