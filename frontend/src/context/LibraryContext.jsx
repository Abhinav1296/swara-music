import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";
import { useAuth } from "./AuthContext";
import { getLikes, saveLikes } from "../api/client";

/**
 * The listener's "library": liked songs (local-first, account-synced when
 * signed in) and recently played tracks (local-only, ephemeral per device).
 *
 * Liked songs mirror the playlist model: stored as full Swara Song objects so
 * playback works offline, persisted to localStorage for logged-out use, and —
 * once signed in — union-merged with the account copy and written through on
 * every change (debounced). The account is the source of truth when signed in;
 * localStorage keeps mirroring it so the app still works offline / signed out.
 * See PlaylistContext for the same pattern applied to playlists.
 */
const LibraryContext = createContext(null);

const MAX_RECENT = 25;

/** Load liked songs as a newest-first array, migrating the legacy `{id: song}` map. */
function loadLiked() {
  const raw = loadJSON(STORAGE_KEYS.liked, []);
  if (Array.isArray(raw)) return raw;
  // Legacy shape: a map keyed by id, oldest-first insertion — newest-first is reversed.
  if (raw && typeof raw === "object") return Object.values(raw).reverse();
  return [];
}

/**
 * Union-merge two liked-song arrays by id (server first, then any local-only
 * likes). Nothing is dropped on first sync.
 */
function mergeLiked(local, server) {
  const seen = new Set();
  const out = [];
  for (const s of server || []) {
    if (s && s.id != null && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  for (const s of local || []) {
    if (s && s.id != null && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

export function LibraryProvider({ children }) {
  const { token } = useAuth();
  // Liked songs as a newest-first array; a derived Set gives O(1) isLiked.
  const [liked, setLiked] = useState(loadLiked);
  const [recent, setRecent] = useState(() => loadJSON(STORAGE_KEYS.recent, []));

  // Always mirror to localStorage (offline / logged-out store + instant boot).
  useEffect(() => saveJSON(STORAGE_KEYS.liked, liked), [liked]);
  useEffect(() => saveJSON(STORAGE_KEYS.recent, recent), [recent]);

  const likedIds = useMemo(() => new Set(liked.map((s) => s.id)), [liked]);
  const isLiked = useCallback((id) => id != null && likedIds.has(id), [likedIds]);

  const toggleLike = useCallback((song) => {
    if (!song || song.id == null) return;
    setLiked((prev) =>
      prev.some((s) => s.id === song.id)
        ? prev.filter((s) => s.id !== song.id)
        : [song, ...prev]
    );
  }, []);

  // --- Account sync (mirrors PlaylistContext) ---------------------------------
  // The token we've hydrated for, the last JSON we synced with the server (so
  // write-through only fires on genuine user changes), and the debounce timer.
  const syncedTokenRef = useRef(null);
  const lastSyncedRef = useRef(null);
  const saveTimerRef = useRef(null);

  // On sign-in: pull the account's likes, union-merge with whatever is local
  // (migrating local-only likes up), then push the merged set back so the
  // account becomes the source of truth. A network/auth hiccup leaves the local
  // likes untouched and retries on the next mount.
  useEffect(() => {
    if (!token) {
      syncedTokenRef.current = null;
      lastSyncedRef.current = null;
      return undefined;
    }
    if (syncedTokenRef.current === token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { likes: server } = await getLikes(token);
        if (cancelled) return;
        const merged = mergeLiked(liked, server || []);
        lastSyncedRef.current = JSON.stringify(merged);
        setLiked(merged);
        syncedTokenRef.current = token;
        try {
          const { likes: saved } = await saveLikes(token, merged);
          if (!cancelled && saved) lastSyncedRef.current = JSON.stringify(saved);
        } catch {
          /* keep local; the write-through effect will retry on next change */
        }
      } catch {
        /* stay on local likes; retry on next mount */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Write-through: when signed in and the set actually changed vs the server,
  // debounce-save the whole array up.
  useEffect(() => {
    if (!token || syncedTokenRef.current !== token) return undefined;
    const cur = JSON.stringify(liked);
    if (cur === lastSyncedRef.current) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const { likes: saved } = await saveLikes(token, liked);
        lastSyncedRef.current = JSON.stringify(saved ?? liked);
      } catch {
        /* leave lastSynced as-is so the next change retries */
      }
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [liked, token]);

  const addRecentlyPlayed = useCallback((song) => {
    if (!song) return;
    setRecent((prev) => [song, ...prev.filter((s) => s.id !== song.id)].slice(0, MAX_RECENT));
  }, []);

  const clearRecent = useCallback(() => setRecent([]), []);

  const value = {
    likedSongs: liked, // already newest-first
    recentlyPlayed: recent,
    isLiked,
    toggleLike,
    addRecentlyPlayed,
    clearRecent,
  };

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within a LibraryProvider");
  return ctx;
}
