import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  downloadSong,
  getDownloadIndex,
  offlineCapable,
  removeDownload,
} from "../offline/downloads";

/**
 * Offline downloads — a thin React mirror over the localStorage-backed store in
 * `offline/downloads.js`. Components read `downloads` (the { [id]: record } map)
 * for reactive "downloaded" badges, and per-id `status` for spinners/errors.
 *
 * The store itself is the source of truth (the player's resolve path reads it
 * synchronously without this context); this provider just keeps the UI in sync
 * and serializes batch ("Download all") downloads so they don't stampede.
 *
 * Off native (`capable === false`), every action is a no-op — download UI
 * should hide itself behind `capable`.
 */
const OfflineContext = createContext(null);

export function OfflineProvider({ children }) {
  const capable = offlineCapable();
  const [downloads, setDownloads] = useState(() => getDownloadIndex());
  // Transient per-id UI state: "downloading" | "error". Cleared on success.
  const [status, setStatus] = useState({});
  const errorTimers = useRef({});

  const isDownloaded = useCallback((id) => Boolean(downloads[id]), [downloads]);
  const statusOf = useCallback((id) => status[id] || null, [status]);

  const setId = useCallback((id, next) => {
    setStatus((prev) => {
      if (next === null) {
        if (!(id in prev)) return prev;
        const { [id]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: next };
    });
  }, []);

  const download = useCallback(
    async (song) => {
      if (!song?.id || !capable) return false;
      if (getDownloadIndex()[song.id]) {
        setDownloads(getDownloadIndex());
        return true;
      }
      if (errorTimers.current[song.id]) {
        clearTimeout(errorTimers.current[song.id]);
        delete errorTimers.current[song.id];
      }
      setId(song.id, "downloading");
      try {
        await downloadSong(song);
        setDownloads(getDownloadIndex());
        setId(song.id, null);
        return true;
      } catch {
        setId(song.id, "error");
        // Auto-clear the error so the button returns to its idle "download"
        // affordance and the user can retry.
        errorTimers.current[song.id] = setTimeout(() => setId(song.id, null), 4000);
        return false;
      }
    },
    [capable, setId]
  );

  /** Download a list in sequence (per-playlist "Download all"). */
  const downloadMany = useCallback(
    async (songs) => {
      for (const s of songs || []) {
        // eslint-disable-next-line no-await-in-loop
        await download(s);
      }
    },
    [download]
  );

  const remove = useCallback(async (id) => {
    await removeDownload(id);
    setDownloads(getDownloadIndex());
  }, []);

  const value = {
    capable,
    downloads,
    isDownloaded,
    statusOf,
    download,
    downloadMany,
    remove,
  };
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used within an OfflineProvider");
  return ctx;
}
