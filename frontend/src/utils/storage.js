/** Tiny, crash-safe localStorage helpers (SSR/no-storage safe). */
export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

/** Centralized localStorage keys for Swara. */
export const STORAGE_KEYS = {
  liked: "swara:liked", // { [id]: song }
  recent: "swara:recent", // song[] (most recent first)
  recentSearches: "swara:recentSearches", // string[] (most recent first)
  volume: "swara:volume", // number 0..1
  shuffle: "swara:shuffle", // "true" / "false"
  repeat: "swara:repeat", // "off" | "all" | "one"
  playlists: "swara:playlists", // { id, name, songs: song[], createdAt }[]
  playlistUsage: "swara:playlistUsage", // { [id]: { count, lastUsedAt } } — local-only, per-device
  queue: "swara:queue", // { current, upcoming, played, progress }
  downloads: "swara:downloads", // { [id]: DownloadRecord } — native offline audio+lyrics (APK only)
  localSongs: "swara:local_songs", // { [id]: LocalSong } — user's own imported device audio (APK only)
};
