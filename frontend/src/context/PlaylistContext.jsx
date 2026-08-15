import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";
import { useAuth } from "./AuthContext";
import { getPlaylists, savePlaylists } from "../api/client";

/**
 * Custom playlists — local-first, account-synced when signed in.
 *
 * Each playlist stores its songs as full Swara Song objects (no backend to
 * re-resolve a track id), so playback works offline and instantly. Everything
 * is persisted to localStorage so it survives reloads and works logged-out.
 *
 * When a user signs in, their local playlists are union-merged with whatever is
 * stored on their account (migrating local-only playlists up), and from then on
 * every change is written through to the account (debounced). The account is the
 * source of truth once signed in; localStorage keeps mirroring it so the app
 * still works offline / after sign-out.
 *
 * Shape: [{ id, name, songs: song[], createdAt }]
 */
const PlaylistContext = createContext(null);

function uid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `pl_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Union-merge two playlist arrays by id. For a shared id, songs are unioned
 * (server order first, then any local songs not already present). Playlists
 * unique to either side are kept — nothing is dropped on first sync.
 */
function mergePlaylists(local, server) {
  const byId = new Map();
  for (const p of server || []) {
    if (p && p.id) byId.set(p.id, { ...p, songs: [...(p.songs || [])] });
  }
  for (const p of local || []) {
    if (!p || !p.id) continue;
    const existing = byId.get(p.id);
    if (!existing) {
      byId.set(p.id, { ...p, songs: [...(p.songs || [])] });
      continue;
    }
    const seen = new Set(existing.songs.map((s) => s.id));
    for (const s of p.songs || []) {
      if (s && !seen.has(s.id)) {
        existing.songs.push(s);
        seen.add(s.id);
      }
    }
  }
  return Array.from(byId.values());
}

export function PlaylistProvider({ children }) {
  const { token } = useAuth();
  const [playlists, setPlaylists] = useState(() => loadJSON(STORAGE_KEYS.playlists, []));

  // Always mirror to localStorage (offline / logged-out store + instant boot).
  useEffect(() => saveJSON(STORAGE_KEYS.playlists, playlists), [playlists]);

  // A live mirror of `playlists` so the create/rename callbacks (which are memo'd
  // with empty deps) can read the current set synchronously — needed to reject a
  // duplicate name and return the right id without going stale.
  const playlistsRef = useRef(playlists);
  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);

  // The token we've hydrated for, the last JSON we synced with the server (so
  // write-through only fires on genuine user changes), and the debounce timer.
  const syncedTokenRef = useRef(null);
  const lastSyncedRef = useRef(null);
  const saveTimerRef = useRef(null);

  // On sign-in: pull the account's playlists, union-merge with whatever is local
  // (migrating local-only playlists up), then push the merged set back so the
  // account becomes the source of truth. A network/auth hiccup leaves the local
  // playlists untouched and retries on the next mount.
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
        const { playlists: server } = await getPlaylists(token);
        if (cancelled) return;
        const merged = mergePlaylists(playlists, server || []);
        lastSyncedRef.current = JSON.stringify(merged);
        setPlaylists(merged);
        syncedTokenRef.current = token;
        try {
          const { playlists: saved } = await savePlaylists(token, merged);
          if (!cancelled && saved) lastSyncedRef.current = JSON.stringify(saved);
        } catch {
          /* keep local; the write-through effect will retry on next change */
        }
      } catch {
        /* stay on local playlists; retry on next mount */
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
    const cur = JSON.stringify(playlists);
    if (cur === lastSyncedRef.current) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const { playlists: saved } = await savePlaylists(token, playlists);
        lastSyncedRef.current = JSON.stringify(saved ?? playlists);
      } catch {
        /* leave lastSynced as-is so the next change retries */
      }
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [playlists, token]);

  /**
   * True if `name` (case-insensitively, trimmed) already belongs to a playlist.
   * Pass `exceptId` to ignore one playlist — used when renaming so a playlist can
   * keep its own name. Powers the inline "name taken" guard in PlaylistModal.
   */
  const playlistNameExists = useCallback(
    (name, exceptId = null) => {
      const t = (name || "").trim().toLowerCase();
      if (!t) return false;
      return playlists.some(
        (p) => p.id !== exceptId && (p.name || "").trim().toLowerCase() === t
      );
    },
    [playlists]
  );

  const createPlaylist = useCallback((name) => {
    const trimmed = (name || "").trim() || "My Playlist";
    // Never create two playlists with the same name — if one already exists,
    // hand back its id so callers open/append to it instead of duplicating.
    const existing = playlistsRef.current.find(
      (p) => (p.name || "").trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) return existing.id;
    const id = uid();
    setPlaylists((prev) => [...prev, { id, name: trimmed, songs: [], createdAt: Date.now() }]);
    return id;
  }, []);

  const renamePlaylist = useCallback((id, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    // Refuse a rename that would collide with another playlist's name.
    const clash = playlistsRef.current.some(
      (p) => p.id !== id && (p.name || "").trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) return;
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }, []);

  /** Set (data URL) or clear (falsy) a playlist's custom cover art. */
  const setPlaylistCover = useCallback((id, cover) => {
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (!cover) {
          const { cover: _drop, ...rest } = p;
          return rest;
        }
        return { ...p, cover };
      })
    );
  }, []);

  const deletePlaylist = useCallback((id) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /** Add a song, de-duping by id. No-op if already present. */
  const addToPlaylist = useCallback((id, song) => {
    if (!song) return;
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (p.songs.some((s) => s.id === song.id)) return p;
        return { ...p, songs: [...p.songs, song] };
      })
    );
  }, []);

  const removeFromPlaylist = useCallback((id, songId) => {
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, songs: p.songs.filter((s) => s.id !== songId) } : p
      )
    );
  }, []);

  const getPlaylist = useCallback(
    (id) => playlists.find((p) => p.id === id) || null,
    [playlists]
  );

  const isInPlaylist = useCallback(
    (id, songId) => {
      const p = playlists.find((pl) => pl.id === id);
      return Boolean(p && p.songs.some((s) => s.id === songId));
    },
    [playlists]
  );

  const value = {
    playlists,
    playlistNameExists,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    setPlaylistCover,
    addToPlaylist,
    removeFromPlaylist,
    getPlaylist,
    isInPlaylist,
  };

  return <PlaylistContext.Provider value={value}>{children}</PlaylistContext.Provider>;
}

export function usePlaylists() {
  const ctx = useContext(PlaylistContext);
  if (!ctx) throw new Error("usePlaylists must be used within a PlaylistProvider");
  return ctx;
}
