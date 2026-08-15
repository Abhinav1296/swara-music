import { createContext, useCallback, useContext, useState } from "react";
import {
  importAudioFile,
  listLocalSongs,
  localCapable,
  removeLocalSong,
} from "../local/localSongs";

/**
 * Local device songs — a thin React mirror over the localStorage-backed store in
 * `local/localSongs.js`. Components read `songs` (newest first) to render the
 * "Local Files" list, and `importing` (count of files still copying) for a
 * spinner.
 *
 * The store itself is the source of truth (the player's resolve path reads it
 * synchronously without this context); this provider just keeps the UI in sync.
 *
 * Off native (`capable === false`), every action is a no-op and the import UI
 * should hide itself behind `capable`.
 */
const LocalSongsContext = createContext(null);

const AUDIO_NAME_RE = /\.(mp3|m4a|aac|wav|flac|ogg|opus|weba|webm|3gp|amr)$/i;

export function LocalSongsProvider({ children }) {
  const capable = localCapable();
  const [songs, setSongs] = useState(() => listLocalSongs());
  const [importing, setImporting] = useState(0); // # of files still copying

  const importFiles = useCallback(
    async (fileList) => {
      if (!capable || !fileList) return;
      const files = Array.from(fileList).filter(
        (f) => f && (String(f.type || "").startsWith("audio") || AUDIO_NAME_RE.test(f.name || ""))
      );
      if (!files.length) return;
      setImporting((n) => n + files.length);
      for (const f of files) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await importAudioFile(f);
          setSongs(listLocalSongs());
        } catch {
          /* skip a file we couldn't read/copy; the rest still import */
        } finally {
          setImporting((n) => Math.max(0, n - 1));
        }
      }
    },
    [capable]
  );

  const remove = useCallback(async (id) => {
    await removeLocalSong(id);
    setSongs(listLocalSongs());
  }, []);

  const value = { capable, songs, importing, importFiles, remove };
  return <LocalSongsContext.Provider value={value}>{children}</LocalSongsContext.Provider>;
}

export function useLocalSongs() {
  const ctx = useContext(LocalSongsContext);
  if (!ctx) throw new Error("useLocalSongs must be used within a LocalSongsProvider");
  return ctx;
}
