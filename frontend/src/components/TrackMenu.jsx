import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  Disc3,
  Heart,
  ListMusic,
  Mic2,
  MoreHorizontal,
  Plus,
  PlayCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePlayer } from "../context/PlayerContext";
import { useLibrary } from "../context/LibraryContext";
import { usePlaylists } from "../context/PlaylistContext";
import { useRouter } from "../context/RouterContext";
import PlaylistModal from "./PlaylistModal";

/**
 * "More" menu for a track: Play Next, Add to Queue, Like, Add to Playlist,
 * Open In (external full-song links), and Go to Album/Artist.
 *
 * The popover is rendered through a portal to <body> and positioned with
 * `position: fixed`, so it is never clipped by scroll containers (important
 * for cards living inside horizontal scrollers). "Add to Playlist" and
 * "Open In" open second panes (submenus) within the same popover.
 */
export default function TrackMenu({ song }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("main"); // "main" | "playlists" | "openin"
  const [coords, setCoords] = useState({ top: 0, left: 0, above: false });
  const [modalOpen, setModalOpen] = useState(false);
  const btnRef = useRef(null);

  const { playNext, addToQueue } = usePlayer();
  const { isLiked, toggleLike } = useLibrary();
  const { playlists, createPlaylist, addToPlaylist, isInPlaylist } = usePlaylists();
  const { navigate } = useRouter();

  const toggle = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const placeAbove = r.bottom + 260 > window.innerHeight;
      setCoords({ top: r.bottom, left: r.right, above: placeAbove });
      setView("main");
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!song) return null;
  const liked = isLiked(song.id);

  const baseItems = [
    { label: "Play Next", icon: PlayCircle, onClick: () => { playNext(song); setOpen(false); } },
    { label: "Add to Queue", icon: ListMusic, onClick: () => { addToQueue(song); setOpen(false); } },
    {
      label: "Add to Playlist",
      icon: Plus,
      onClick: () => { setView("playlists"); },
    },
    {
      label: liked ? "Remove from Liked" : "Add to Liked",
      icon: Heart,
      onClick: () => { toggleLike(song); setOpen(false); },
    },
    ...(song.collectionName
      ? [
          {
            label: "Go to Album",
            icon: Disc3,
            onClick: () => {
              navigate("album", {
                name: song.collectionName,
                artist: song.artistName,
                year: song.year ?? undefined,
              });
              setOpen(false);
            },
          },
        ]
      : []),
    ...(song.artistName
      ? [
          {
            label: "Go to Artist",
            icon: Mic2,
            onClick: () => {
              navigate("artist", { name: song.artistName });
              setOpen(false);
            },
          },
        ]
      : []),
  ];

  const handleNewPlaylist = (name) => {
    const id = createPlaylist(name);
    addToPlaylist(id, song);
    setModalOpen(false);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="More options"
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
      >
        <MoreHorizontal size={18} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  left: coords.left,
                  transform: "translateX(-100%)",
                  top: coords.above ? undefined : coords.top,
                  bottom: coords.above ? window.innerHeight - coords.top : undefined,
                }}
                className="glass-strong z-[61] max-h-[60vh] w-52 overflow-hidden rounded-xl p-1 shadow-glass"
              >
                {view === "main" ? (
                  <div className="max-h-[58vh] overflow-y-auto no-scrollbar">
                    {baseItems.map((it) => (
                      <button
                        key={it.label}
                        type="button"
                        onClick={it.onClick}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                      >
                        <it.icon size={16} className="text-white/60" />
                        {it.label}
                      </button>
                    ))}
                  </div>
                ) : view === "playlists" ? (
                  <div className="flex max-h-[58vh] flex-col">
                    <button
                      type="button"
                      onClick={() => setView("main")}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white/40 transition hover:bg-white/10 hover:text-white"
                    >
                      <ChevronLeft size={14} /> Add to Playlist
                    </button>
                    <div className="no-scrollbar flex-1 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                      >
                        <Plus size={16} className="text-accent" />
                        New Playlist…
                      </button>
                      {playlists.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-white/30">No playlists yet.</p>
                      ) : (
                        playlists.map((p) => {
                          const inList = isInPlaylist(p.id, song.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                if (!inList) addToPlaylist(p.id, song);
                                setOpen(false);
                              }}
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                            >
                              <span className="truncate">{p.name}</span>
                              {inList && <Check size={15} className="shrink-0 text-accent" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}
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
        onSubmit={handleNewPlaylist}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
