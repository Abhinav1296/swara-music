import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  Disc3,
  Download,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  MoreHorizontal,
  Plus,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePlayer } from "../context/PlayerContext";
import { useLibrary } from "../context/LibraryContext";
import { usePlaylists } from "../context/PlaylistContext";
import { useOffline } from "../context/OfflineContext";
import { useRouter } from "../context/RouterContext";
import { useAuthGate } from "../context/AuthGate";
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
export default function TrackMenu({ song, triggerClassName, iconSize = 18, elevated = false }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("main"); // "main" | "playlists" | "openin"
  const [coords, setCoords] = useState({ top: 0, right: 0, above: false });
  const [modalOpen, setModalOpen] = useState(false);
  const btnRef = useRef(null);

  const { playNext, addToQueue } = usePlayer();
  const { isLiked, toggleLike } = useLibrary();
  const { playlists, createPlaylist, addToPlaylist, isInPlaylist, playlistNameExists } =
    usePlaylists();
  const { capable: offlineCapable, isDownloaded, statusOf, download, remove } = useOffline();
  const { navigate } = useRouter();
  const { requireAuth } = useAuthGate();

  const toggle = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const placeAbove = r.bottom + 260 > window.innerHeight;
      // Anchor the popover's right edge to the trigger, but clamp so the 208px-wide
      // (w-52) menu never spills off the left or right edge. Triggers on left-column
      // cards were pushing the right anchor so far that the menu's left edge went
      // negative and the labels clipped off-screen.
      const MENU_W = 208;
      const MARGIN = 8;
      const maxRight = Math.max(window.innerWidth - MENU_W - MARGIN, MARGIN);
      const right = Math.min(Math.max(window.innerWidth - r.right, MARGIN), maxRight);
      setCoords({ top: r.bottom, right, above: placeAbove });
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

  // Offline download — native (APK) only. Reflects live status: idle → downloading
  // (spinner, disabled) → downloaded (offer Remove). Error auto-resets to idle.
  const dlStatus = statusOf(song.id);
  const downloaded = isDownloaded(song.id);
  const downloadItem = !offlineCapable
    ? null
    : dlStatus === "downloading"
      ? {
          label: "Downloading…",
          icon: Loader2,
          iconClassName: "animate-spin text-accent",
          disabled: true,
          onClick: () => {},
        }
      : downloaded
        ? {
            label: "Remove Download",
            icon: Trash2,
            onClick: () => { remove(song.id); },
          }
        : {
            label: dlStatus === "error" ? "Retry Download" : "Download",
            icon: Download,
            onClick: () => { download(song); },
          };

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
    ...(downloadItem ? [downloadItem] : []),
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
        className={
          triggerClassName ||
          "flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
        }
      >
        <MoreHorizontal size={iconSize} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div
                className={`fixed inset-0 ${elevated ? "z-[99]" : "z-[60]"}`}
                onClick={() => setOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  right: coords.right,
                  top: coords.above ? undefined : coords.top,
                  bottom: coords.above ? window.innerHeight - coords.top : undefined,
                }}
                className={`glass-strong ${
                  elevated ? "z-[100]" : "z-[61]"
                } max-h-[60vh] w-52 overflow-hidden rounded-xl p-1 shadow-glass`}
              >
                {view === "main" ? (
                  <div className="max-h-[58vh] overflow-y-auto no-scrollbar">
                    {baseItems.map((it) => (
                      <button
                        key={it.label}
                        type="button"
                        onClick={it.onClick}
                        disabled={it.disabled}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent disabled:hover:text-white/80"
                      >
                        <it.icon size={16} className={it.iconClassName || "text-white/60"} />
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
                        onClick={() => {
                          setOpen(false);
                          requireAuth(() => setModalOpen(true), { reason: "playlist" });
                        }}
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
        nameTaken={playlistNameExists}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
