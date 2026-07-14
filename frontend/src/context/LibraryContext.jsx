import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";

/**
 * Local, auth-free "library": liked songs and recently played tracks.
 * Everything is persisted to localStorage so it survives reloads. There is
 * no backend and no user account.
 */
const LibraryContext = createContext(null);

const MAX_RECENT = 25;

export function LibraryProvider({ children }) {
  // liked songs stored as { [id]: song } so toggling is O(1)
  const [likedMap, setLikedMap] = useState(() => loadJSON(STORAGE_KEYS.liked, {}));
  const [recent, setRecent] = useState(() => loadJSON(STORAGE_KEYS.recent, []));

  useEffect(() => saveJSON(STORAGE_KEYS.liked, likedMap), [likedMap]);
  useEffect(() => saveJSON(STORAGE_KEYS.recent, recent), [recent]);

  const isLiked = useCallback((id) => Boolean(id != null && likedMap[id]), [likedMap]);

  const toggleLike = useCallback((song) => {
    if (!song) return;
    setLikedMap((prev) => {
      const next = { ...prev };
      if (next[song.id]) delete next[song.id];
      else next[song.id] = song;
      return next;
    });
  }, []);

  // Most-recently-liked first.
  const likedSongs = useMemo(() => Object.values(likedMap).reverse(), [likedMap]);

  const addRecentlyPlayed = useCallback((song) => {
    if (!song) return;
    setRecent((prev) => [song, ...prev.filter((s) => s.id !== song.id)].slice(0, MAX_RECENT));
  }, []);

  const clearRecent = useCallback(() => setRecent([]), []);

  const value = {
    likedSongs,
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
