import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";

/**
 * Local, auth-free custom playlists.
 *
 * Each playlist stores its songs as full Swara Song objects (no backend to
 * re-resolve a track id), so playback works offline and instantly. Everything
 * is persisted to localStorage so it survives reloads.
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

export function PlaylistProvider({ children }) {
  const [playlists, setPlaylists] = useState(() => loadJSON(STORAGE_KEYS.playlists, []));

  useEffect(() => saveJSON(STORAGE_KEYS.playlists, playlists), [playlists]);

  const createPlaylist = useCallback((name) => {
    const id = uid();
    const trimmed = (name || "").trim() || "My Playlist";
    setPlaylists((prev) => [...prev, { id, name: trimmed, songs: [], createdAt: Date.now() }]);
    return id;
  }, []);

  const renamePlaylist = useCallback((id, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
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
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
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
