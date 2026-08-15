import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ListMusic, Plus, X } from "lucide-react";
import { usePlaylists } from "../context/PlaylistContext";
import PlaylistModal from "./PlaylistModal";

/**
 * Bottom sheet that lists every playlist so a song can be added with one tap.
 * Opened by swiping a Liked song (see LibraryView) — a fast path to the same
 * action the "•••" → Add to Playlist menu provides. Pass the `song` to add
 * (null/undefined keeps it closed) and an `onClose` handler.
 */
export default function AddToPlaylistSheet({ song, onClose }) {
  const { playlists, createPlaylist, addToPlaylist, isInPlaylist, playlistNameExists } =
    usePlaylists();
  const [modalOpen, setModalOpen] = useState(false);
  const open = Boolean(song);

  const title = song?.trackName || song?.title || "this song";

  const handleNew = (name) => {
    const id = createPlaylist(name);
    if (song) addToPlaylist(id, song);
    setModalOpen(false);
    onClose();
  };

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm"
                onClick={onClose}
              />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                className="glass-strong fixed inset-x-0 bottom-0 z-[96] max-h-[70vh] rounded-t-3xl p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] shadow-glass"
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/40">
                      Add to playlist
                    </p>
                    <p className="truncate text-sm font-semibold text-white">{title}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="shrink-0 rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="no-scrollbar max-h-[52vh] overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    <Plus size={18} className="text-accent" />
                    New Playlist…
                  </button>

                  {playlists.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                      <ListMusic size={22} className="text-white/30" />
                      <p className="text-sm text-white/40">
                        No playlists yet — create one above.
                      </p>
                    </div>
                  ) : (
                    playlists.map((p) => {
                      const inList = song && isInPlaylist(p.id, song.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            if (song && !inList) addToPlaylist(p.id, song);
                            onClose();
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                        >
                          <span className="truncate">{p.name}</span>
                          {inList ? (
                            <Check size={16} className="shrink-0 text-accent" />
                          ) : (
                            <Plus size={16} className="shrink-0 text-white/40" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      <PlaylistModal
        open={modalOpen}
        title="New Playlist"
        submitLabel="Create"
        onSubmit={handleNew}
        nameTaken={playlistNameExists}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
