import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ListMusic,
  MoreVertical,
  Music2,
  Pause,
  Pencil,
  Play,
  Shuffle,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePlayer } from "../context/PlayerContext";
import { usePlaylists } from "../context/PlaylistContext";
import { useRouter } from "../context/RouterContext";
import TrackRow from "./TrackRow";
import PlaylistModal from "./PlaylistModal";

/**
 * Custom playlist detail page. Reads the id from the router (so it deep-links
 * via /playlist?id=…), renders a frosted header with Play All / Shuffle, and a
 * track list. Rename / delete live in a kebab menu with a confirm step.
 */
export default function PlaylistView() {
  const { route, navigate } = useRouter();
  const { current, isPlaying, play, shuffle, toggleShuffle } = usePlayer();
  const { getPlaylist, renamePlaylist, deletePlaylist } = usePlaylists();

  const id = route.params.id;
  const playlist = getPlaylist(id);

  const [menuOpen, setMenuOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0, above: false });
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const kebabRef = useRef(null);

  // Keep the resolved name in sync (deep links may supply a name param).
  const name = playlist?.name || route.params.name || "Playlist";

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (!playlist) {
    return (
      <div className="flex flex-col items-center gap-4 pt-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
          <ListMusic size={28} className="text-white/40" />
        </div>
        <p className="text-lg font-semibold text-white">Playlist not found</p>
        <p className="max-w-xs text-sm text-white/40">
          It may have been deleted, or this link is out of date.
        </p>
        <button
          type="button"
          onClick={() => navigate("library")}
          className="btn-glossy mt-2 rounded-full px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Go to Library
        </button>
      </div>
    );
  }

  const songs = playlist.songs || [];
  const listPlaying =
    songs.length > 0 && current && songs.some((t) => t.id === current.id) && isPlaying;

  const openMenu = (e) => {
    e.stopPropagation();
    if (!menuOpen && kebabRef.current) {
      const r = kebabRef.current.getBoundingClientRect();
      const placeAbove = r.bottom + 160 > window.innerHeight;
      setCoords({ top: r.bottom, right: window.innerWidth - r.right, above: placeAbove });
      setMenuOpen(true);
    } else {
      setMenuOpen(false);
    }
  };

  const handleRename = (newName) => {
    renamePlaylist(id, newName);
    setRenameOpen(false);
  };

  const handleDelete = () => {
    deletePlaylist(id);
    navigate("library");
  };

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => window.history.back()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-white/60 transition hover:text-white"
      >
        <ChevronLeft size={16} /> Back
      </button>

      {/* Header */}
      <div className="relative mb-8 overflow-hidden rounded-3xl">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-12 h-72 w-72 rounded-full bg-accent/12 blur-3xl" />
        <div className="glass relative flex flex-col items-center gap-6 p-6 md:flex-row md:gap-8 md:p-8">
          <div className="relative flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-white/15 to-white/5 shadow-2xl ring-1 ring-white/10 md:h-52 md:w-52">
            <Music2 size={56} className="text-white/90" />
          </div>
          <div className="relative min-w-0 flex-1 text-center md:text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/50">
              Playlist
            </p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white md:text-5xl">
              {name}
            </h1>
            <p className="mt-2 text-white/60">
              {songs.length} {songs.length === 1 ? "song" : "songs"}
            </p>
            <div className="mt-5 flex items-center justify-center gap-3 md:justify-start">
              <button
                type="button"
                disabled={songs.length === 0}
                onClick={() => play(songs[0], songs)}
                className="inline-flex items-center gap-2 btn-glossy rounded-full px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-30"
              >
                {listPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
                {listPlaying ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                disabled={songs.length === 0}
                onClick={toggleShuffle}
                aria-label="Shuffle"
                aria-pressed={shuffle}
                className={`rounded-full p-3 transition disabled:opacity-30 ${
                  shuffle
                    ? "bg-white/15 text-accent"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Shuffle size={18} />
              </button>
            </div>
          </div>

          {/* Kebab (rename / delete) */}
          <div className="relative">
            <button
              ref={kebabRef}
              type="button"
              onClick={openMenu}
              aria-label="Playlist options"
              className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <MoreVertical size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Track list */}
      {songs.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
            <ListMusic size={24} className="text-white/40" />
          </div>
          <p className="text-white/70">This playlist is empty.</p>
          <p className="max-w-xs text-sm text-white/30">
            Open the “•••” menu on any song and choose{" "}
            <span className="text-white/50">Add to Playlist</span> to start building it.
          </p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-2">
          {songs.map((song, i) => (
            <TrackRow key={song.id} song={song} index={i} list={songs} />
          ))}
        </motion.div>
      )}

      {/* Kebab dropdown (portal) */}
      {createPortal(
        <AnimatePresence>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: "fixed",
                  right: coords.right,
                  top: coords.above ? undefined : coords.top,
                  bottom: coords.above ? window.innerHeight - coords.top : undefined,
                }}
                className="glass-strong z-[61] w-44 overflow-hidden rounded-xl p-1 shadow-glass"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenameOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                >
                  <Pencil size={16} className="text-white/60" /> Rename
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDelete(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-400 transition hover:bg-red-500/10"
                >
                  <Trash2 size={16} /> Delete
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      <PlaylistModal
        open={renameOpen}
        title="Rename Playlist"
        submitLabel="Save"
        initialName={name}
        onSubmit={handleRename}
        onClose={() => setRenameOpen(false)}
      />

      {/* Delete confirmation */}
      {createPortal(
        <AnimatePresence>
          {confirmDelete && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm"
                onClick={() => setConfirmDelete(false)}
              />
              <div
                className="fixed inset-0 z-[91] flex items-center justify-center p-4"
                onClick={() => setConfirmDelete(false)}
              >
              <motion.div
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                className="glass-strong w-full max-w-sm rounded-3xl border border-white/10 p-6 shadow-glass"
              >
                <h2 className="text-lg font-bold text-white">Delete playlist?</h2>
                <p className="mt-2 text-sm text-white/60">
                  “{name}” will be removed from this device. This can’t be undone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-full px-4 py-2 text-sm font-medium text-white/60 transition hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
