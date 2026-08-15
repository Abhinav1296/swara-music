import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { getSongDetails } from "../api/client";
import { normalizeLyrics, normalizeTrack } from "../utils/trackAdapter";
import { isNativePlatform } from "../auth/nativeGoogleSignIn";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";

/**
 * Native offline downloads (APK only).
 *
 * A download resolves a song ONCE (same /api/song-details path the player uses),
 * streams the audio bytes to app-private storage via Capacitor Filesystem, and
 * snapshots the vetted lyrics JSON (Telugu + romanized + synced LRC) alongside
 * it — a few KB next to the multi-MB audio, so lyrics purity travels offline.
 *
 * The index of what's downloaded lives in localStorage (`swara:downloads`) as
 * the single source of truth: it's a synchronous read, so the player's resolve
 * path can prefer a local file with no await. The actual audio bytes live in
 * Directory.Data (app-private, survives reloads, invisible in the gallery).
 *
 * Everything here NO-OPS off native — the web build never touches Filesystem,
 * and callers should gate download UI behind `offlineCapable()`.
 *
 * DownloadRecord: {
 *   id, trackName, artistName, collectionName, artworkUrl600, trackTimeMillis,
 *   jiosaavnUrl, source,
 *   path,  // relative path inside Directory.Data
 *   uri,   // absolute file:// uri (for Capacitor.convertFileSrc at play time)
 *   lyrics,       // normalizeLyrics() snapshot ({ kind, lines, plain, roman, source })
 *   downloadedAt, // ms epoch
 * }
 */

const AUDIO_DIR = "swara/audio";

/** True only inside the Capacitor APK — the web app can't store offline audio. */
export function offlineCapable() {
  return isNativePlatform();
}

/** The whole { [id]: record } map (sync). */
export function getDownloadIndex() {
  return loadJSON(STORAGE_KEYS.downloads, {}) || {};
}

/** One record, or null (sync — safe to call in the play path). */
export function getDownloadRecord(id) {
  if (!id) return null;
  return getDownloadIndex()[id] || null;
}

/** Whether this song has a completed local download (sync). */
export function isDownloaded(id) {
  return Boolean(getDownloadRecord(id));
}

/**
 * A webview-playable src for a downloaded record. Capacitor rewrites the
 * file:// uri into the app's local http origin so <audio> can load it. Returns
 * null off native or without a stored uri.
 */
export function getPlayableSrc(record) {
  if (!record?.uri || !isNativePlatform()) return null;
  try {
    return Capacitor.convertFileSrc(record.uri);
  } catch {
    return null;
  }
}

// Read-fresh-then-write so two concurrent downloads (Promise.all) can't clobber
// each other's index entry — the localStorage read+write is synchronous and JS
// is single-threaded, so each upsert runs to completion atomically.
function upsertRecord(record) {
  const idx = getDownloadIndex();
  idx[record.id] = record;
  saveJSON(STORAGE_KEYS.downloads, idx);
}

function dropRecord(id) {
  const idx = getDownloadIndex();
  if (!idx[id]) return;
  delete idx[id];
  saveJSON(STORAGE_KEYS.downloads, idx);
}

// Filenames must survive arbitrary song ids (Lyrica slugs, old numeric ids).
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Best-effort audio extension from the stream URL (cosmetic — <audio> sniffs by
// content, but a real extension keeps the local file honest). Defaults to mp3.
function extFromUrl(url) {
  const m = String(url || "").split("?")[0].match(/\.(\w{2,4})$/);
  return (m?.[1] || "mp3").toLowerCase();
}

/**
 * Download one song's audio + lyrics to the device. Idempotent: returns the
 * existing record if already downloaded. Rejects off native, or when the song
 * has no resolvable stream. `signal` (optional AbortSignal) cancels the resolve.
 */
export async function downloadSong(song, { signal } = {}) {
  if (!song?.id) throw new Error("Missing song.");
  if (!offlineCapable()) {
    throw new Error("Offline download is only available in the Swara app.");
  }
  const existing = getDownloadRecord(song.id);
  if (existing) return existing;

  // Resolve the full stream + synced lyrics (same source as playback).
  const details = await getSongDetails({
    artist: song.artistName,
    song: song.trackName,
    url: song.jiosaavnUrl || undefined,
    signal,
  });
  const resolved = normalizeTrack(details);
  const streamUrl = resolved?.streamUrl;
  if (!streamUrl) throw new Error("No downloadable stream for this song.");

  const path = `${AUDIO_DIR}/${safeId(song.id)}.${extFromUrl(streamUrl)}`;

  // Stream the bytes natively (no CORS, no base64 round-trip). `recursive`
  // creates the swara/audio folders on first use.
  await Filesystem.downloadFile({
    url: streamUrl,
    path,
    directory: Directory.Data,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });

  const lyrics = normalizeLyrics(details.lyrics);
  const record = {
    id: song.id,
    trackName: resolved.trackName,
    artistName: resolved.artistName,
    collectionName: resolved.collectionName,
    artworkUrl600: song.artworkUrl600 || resolved.artworkUrl600 || "",
    trackTimeMillis: resolved.trackTimeMillis ?? song.trackTimeMillis ?? null,
    jiosaavnUrl: resolved.jiosaavnUrl || song.jiosaavnUrl || null,
    source: resolved.source || song.source || null,
    path,
    uri,
    lyrics,
    downloadedAt: Date.now(),
  };
  upsertRecord(record);
  return record;
}

/** Delete a download's audio file and drop its index entry. Never throws. */
export async function removeDownload(id) {
  const record = getDownloadRecord(id);
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
