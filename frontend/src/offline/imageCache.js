import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { isNativePlatform } from "../auth/nativeGoogleSignIn";
import { loadJSON, saveJSON } from "../utils/storage";

/**
 * Native offline artwork cache (APK only).
 *
 * The feed/data cache (see api/cache.js) makes the app paint instantly with no
 * connection — but the cover art still pointed at JioSaavn's CDN, so an offline
 * launch showed a wall of broken images. This mirrors each cover we render to
 * app-private storage the first time it's seen online, keyed by its remote URL,
 * so a later offline launch (or a downloaded song's art) shows real covers.
 *
 * The url -> local-file-uri index lives in localStorage as the single source of
 * truth: it's a synchronous read, so `cachedSrcFor` can hand the <img> a local
 * src with no await. The bytes live in Directory.Data (app-private, survives
 * reloads, invisible in the gallery), exactly like downloaded audio.
 *
 * Everything here NO-OPS off native — the web build serves the remote URL
 * unchanged and never touches Filesystem.
 */

const ART_DIR = "swara/art";
const INDEX_KEY = "swara:img_cache";

// url -> absolute file:// uri. Loaded once at module init for synchronous
// reads; every successful download updates both this Map and localStorage.
const index = loadJSON(INDEX_KEY, {}) || {};

// URLs whose download is in flight, so a grid that mounts 40 cards at once
// fires at most one download per distinct cover.
const inflight = new Set();

function persist() {
  saveJSON(INDEX_KEY, index);
}

// Deterministic filename for a URL: two covers can share the CDN basename
// (500x500.jpg), so hash the whole URL. djb2 -> base36, no Date/Math.random.
function hashUrl(url) {
  let h = 5381;
  for (let i = 0; i < url.length; i += 1) {
    h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// Best-effort image extension from the URL (cosmetic — the WebView sniffs by
// content). Defaults to jpg, which is what JioSaavn serves.
function extFromUrl(url) {
  const m = String(url || "").split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i);
  return (m?.[1] || "jpg").toLowerCase();
}

// Only real remote covers are worth caching. data:/blob:/file: srcs (custom
// playlist covers, already-local files) pass through untouched — trying to
// downloadFile them just fails.
function isRemote(url) {
  return /^https?:\/\//i.test(url || "");
}

function localSrc(uri) {
  try {
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}

/**
 * The best src we can serve synchronously: the cached local file when we've
 * saved this cover, otherwise the remote URL unchanged. Pure — never triggers
 * a download (that's `primeArt`). Off native it always returns the URL.
 */
export function cachedSrcFor(url) {
  if (!url || !isNativePlatform() || !isRemote(url)) return url;
  const uri = index[url];
  if (!uri) return url;
  return localSrc(uri) || url;
}

/**
 * Ensure this cover is on disk for offline use. Idempotent and safe to call on
 * every render. Resolves to a webview-playable local src when the art is (now)
 * cached, or null when it isn't (off native, offline, already-remote-only, or a
 * failed download) — the caller keeps showing the remote URL in that case.
 */
export async function primeArt(url) {
  if (!url || !isNativePlatform() || !isRemote(url)) return null;

  const existing = index[url];
  if (existing) return localSrc(existing);

  // Don't bother trying while offline — downloadFile would just throw. The
  // remote URL is unreachable too, so there's nothing to cache yet.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  if (inflight.has(url)) return null;
  inflight.add(url);

  try {
    const path = `${ART_DIR}/${hashUrl(url)}.${extFromUrl(url)}`;

    // downloadFile ignores `recursive` and won't create nested parents, so
    // pre-create the folder ourselves (same gotcha as offline/downloads.js).
    try {
      await Filesystem.mkdir({ path: ART_DIR, directory: Directory.Data, recursive: true });
    } catch {
      /* already exists — the common case */
    }

    await Filesystem.downloadFile({ url, path, directory: Directory.Data, recursive: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });

    index[url] = uri;
    persist();
    return localSrc(uri);
  } catch {
    return null; // leave uncached; the remote URL still renders while online
  } finally {
    inflight.delete(url);
  }
}
