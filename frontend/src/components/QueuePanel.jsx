import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Play, X } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

/**
 * Slide-in "Up Next" panel. Shows the currently playing track pinned at the
 * top and the upcoming queue below, with per-track remove + a Clear action.
 * Rendered through a portal so it layers above everything.
 */
export default function QueuePanel() {
  const {
    queueOpen,
    closeQueue,
    current,
    upcoming,
    removeFromQueue,
    clearQueue,
    play,
  } = usePlayer();

  const playFromQueue = (song) => {
    // Play this queued track: it becomes current and is dropped from the queue.
    // `play` slices [current, ...upcoming] around `song`, so the rest stay queued.
    const context = [current, ...upcoming].filter(Boolean);
    play(song, context);
  };

  return createPortal(
    <AnimatePresence>
      {queueOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={closeQueue}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="glass-strong fixed right-0 top-0 z-50 flex h-full w-80 max-w-[85vw] flex-col border-l border-white/10 p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Queue</h2>
              <button
                type="button"
                onClick={closeQueue}
                aria-label="Close queue"
                className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
              Now Playing
            </div>
            {current ? (
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-white/5 p-2">
                <img
                  src={current.artworkUrl100}
                  alt=""
                  className="h-12 w-12 rounded-md object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{current.trackName}</p>
                  <p className="truncate text-xs text-white/50">{current.artistName}</p>
                </div>
              </div>
            ) : (
              <p className="mb-4 text-sm text-white/40">Nothing playing.</p>
            )}

            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/40">
                Next Up
              </span>
              {upcoming.length > 0 && (
                <button
                  type="button"
                  onClick={clearQueue}
                  className="text-xs text-white/50 transition hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="no-scrollbar flex-1 space-y-1 overflow-y-auto">
              {upcoming.length === 0 ? (
                <p className="text-sm text-white/30">Your queue is empty.</p>
              ) : (
                upcoming.map((s, i) => (
                  <div
                    key={`${s.id}-${i}`}
                    className="group flex items-center gap-3 rounded-lg p-2 transition hover:bg-white/5"
                  >
                    <button
                      type="button"
                      onClick={() => playFromQueue(s, i)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <img
                        src={s.artworkUrl100}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">{s.trackName}</p>
                        <p className="truncate text-xs text-white/50">{s.artistName}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromQueue(i)}
                      aria-label="Remove from queue"
                      className="text-white/40 opacity-0 transition hover:text-white group-hover:opacity-100"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
