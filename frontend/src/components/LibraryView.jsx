import { useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { Heart, ListMusic, Music2, Play, Plus } from "lucide-react";
import { useLibrary } from "../context/LibraryContext";
import { usePlaylists } from "../context/PlaylistContext";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import { useAuthGate } from "../context/AuthGate";
import SongCard from "./SongCard";
import PlaylistModal from "./PlaylistModal";
import PlaylistStrip from "./PlaylistStrip";
import AddToPlaylistSheet from "./AddToPlaylistSheet";
import LocalFilesSection from "./LocalFilesSection";

const GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/**
 * A Liked SongCard you can swipe sideways to add to a playlist. A horizontal
 * drag past the threshold fires `onSwipe(song)`; anything short snaps back and a
 * tap still plays. An accent hint fades in behind the card as it slides so the
 * gesture is discoverable. Vertical scrolling stays with the page (touch-pan-y +
 * dragDirectionLock).
 */
function SwipeToAdd({ song, list, onSwipe }) {
  const x = useMotionValue(0);
  const hintOpacity = useTransform(x, [-90, -30, 0, 30, 90], [1, 0, 0, 0, 1]);

  return (
    <div className="relative">
      <motion.div
        style={{ opacity: hintOpacity }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-3xl bg-accent/15 text-accent"
      >
        <Plus size={20} />
        <span className="text-sm font-semibold">Add to playlist</span>
      </motion.div>
      <motion.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.35}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          if (Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 500) {
            onSwipe(song);
          }
        }}
        className="relative touch-pan-y"
      >
        <SongCard song={song} list={list} />
      </motion.div>
    </div>
  );
}

/** Local library: liked songs (playlist) + custom playlists + recently played. */
export default function LibraryView() {
  const { likedSongs, recentlyPlayed, clearRecent } = useLibrary();
  const { playlists, createPlaylist, playlistNameExists } = usePlaylists();
  const { current, isPlaying, play } = usePlayer();
  const { navigate } = useRouter();
  const { requireAuth } = useAuthGate();
  const [createOpen, setCreateOpen] = useState(false);
  const [sheetSong, setSheetSong] = useState(null);

  const likedPlaying =
    likedSongs.length > 0 &&
    current &&
    likedSongs.some((s) => s.id === current.id) &&
    isPlaying;

  const handleCreate = (name) => {
    const id = createPlaylist(name);
    setCreateOpen(false);
    navigate("playlist", { id, name });
  };

  return (
    <div className="pt-2">
      {/* Most-used playlists — swipeable quick-play carousel. */}
      <PlaylistStrip />

      {/* Liked Songs hero */}
      <div className="glass relative mb-8 flex items-center gap-5 overflow-hidden rounded-3xl p-5 md:gap-7 md:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-60 w-60 rounded-full bg-accent/30 blur-3xl" />
        <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-white/15 to-white/5 shadow-glow md:h-36 md:w-36">
          <Heart size={44} className="text-white" fill="white" />
        </div>
        <div className="relative min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/50">Playlist</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
            Liked Songs
          </h1>
          <p className="mt-1 text-sm text-white/60">{likedSongs.length} songs</p>
          <button
            type="button"
            disabled={likedSongs.length === 0}
            onClick={() => play(likedSongs[0], likedSongs)}
            className="mt-4 inline-flex items-center gap-2 btn-glossy rounded-full px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Play size={18} fill="white" />
            {likedPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      {/* Liked Songs grid */}
      <h2 className="mb-4 text-xl font-bold text-white">Liked Songs</h2>
      {likedSongs.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
            <Heart size={24} className="text-white/40" />
          </div>
          <p className="text-white/70">No liked songs yet.</p>
          <p className="max-w-xs text-sm text-white/30">
            Tap the heart on any song to save it here. Your likes are stored on this device.
          </p>
        </div>
      ) : (
        <div className={GRID}>
          {likedSongs.map((song) => (
            <SwipeToAdd
              key={song.id}
              song={song}
              list={likedSongs}
              onSwipe={setSheetSong}
            />
          ))}
        </div>
      )}

      {/* Your Playlists */}
      <div className="mb-4 mt-10 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Your Playlists</h2>
        <button
          type="button"
          onClick={() => requireAuth(() => setCreateOpen(true), { reason: "playlist" })}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
        >
          <Plus size={16} /> New
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
            <ListMusic size={24} className="text-white/40" />
          </div>
          <p className="text-white/70">No playlists yet.</p>
          <p className="max-w-xs text-sm text-white/30">
            Group your favorite Telugu tracks into playlists. Tap{" "}
            <span className="text-white/50">New</span> to create one.
          </p>
        </div>
      ) : (
        <div className={GRID}>
          {playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate("playlist", { id: p.id, name: p.name })}
              className="group flex flex-col gap-3 rounded-3xl p-3 text-left glass transition-colors hover:bg-white/10"
            >
              <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-white/15 to-white/5">
                {p.cover ? (
                  <img src={p.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Music2 size={40} className="text-white/90" />
                )}
              </div>
              <div className="min-w-0 px-1 pb-1">
                <h3 className="truncate text-sm font-semibold text-white" title={p.name}>
                  {p.name}
                </h3>
                <p className="truncate text-xs text-white/50">
                  {p.songs.length} {p.songs.length === 1 ? "song" : "songs"}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Local Files — import & play your own device audio (native/APK only) */}
      <LocalFilesSection />

      {/* Recently Played */}
      {recentlyPlayed.length > 0 && (
        <>
          <div className="mb-4 mt-10 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Recently Played</h2>
            <button
              type="button"
              onClick={clearRecent}
              className="text-sm font-medium text-white/40 transition hover:text-white"
            >
              Clear
            </button>
          </div>
          <div className={GRID}>
            {recentlyPlayed.map((song) => (
              <SongCard key={song.id} song={song} list={recentlyPlayed} />
            ))}
          </div>
        </>
      )}

      <PlaylistModal
        open={createOpen}
        title="New Playlist"
        submitLabel="Create"
        onSubmit={handleCreate}
        nameTaken={playlistNameExists}
        onClose={() => setCreateOpen(false)}
      />

      <AddToPlaylistSheet song={sheetSong} onClose={() => setSheetSong(null)} />
    </div>
  );
}
