// Persistent stale-while-revalidate cache for the read-only feed endpoints.
//
// The old in-memory shelf cache lived for exactly one app run, so every cold
// start (very common on the APK) had to reach the backend before ANYTHING
// rendered — painful on a slow connection, and worst of all during a Render
// cold-start where the backend can take 30-50s to wake. This mirrors each
// successful feed response to localStorage so the next launch paints the
// last-known content INSTANTLY and refreshes in the background.
//
// Only broad, non-personalized feeds go through here (trending / mood shelves /
// albums / new releases). Search, song-details and stream stay uncached.
import { loadJSON, saveJSON } from "../utils/storage";

const PREFIX = "swara:cache:";

/** Read a cached entry → { data, savedAt } or null if absent/corrupt. */
export function readCache(key) {
  const e = loadJSON(PREFIX + key, null);
  return e && typeof e === "object" && "data" in e ? e : null;
}

/** Persist a fresh response under `key`, stamped with the save time. */
export function writeCache(key, data) {
  saveJSON(PREFIX + key, { data, savedAt: Date.now() });
}
