import { useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { Heart, ListMusic, Music2, Pause, Play, Plus } from "lucide-react";
import { useLibrary } from "../context/LibraryContext";
import { usePlaylists } from "../context/PlaylistContext";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import { useAuthGate } from "../context/AuthGate";
import SongCard from "./SongCard";
import PlaylistModal from "./PlaylistModal";
import AddToPlaylistSheet from "./AddToPlaylistSheet";
import DownloadsSection from "./DownloadsSection";
import LocalFilesSection from "./LocalFilesSection";

const GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/**
 * A Liked SongCard you can swipe sideways to add to a playlist. A horizontal
 * drag past the threshold fires `onSwipe(song)`; anything short snaps back and a
 * tap reveals the card's controls. An accent hint fades in behind the card as it slides so the
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
  const { playlists, createPlaylist, playlistNameExists, notePlaylistUsed } = usePlaylists();
  const { current, isPlaying, play, toggle } = usePlayer();
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
        // Side-scrolling row (same tile + in-place play as the old "Jump back in").
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {playlists.map((p) => {
            const songs = p.songs || [];
            const isThis = current && songs.some((s) => s.id === current.id);
            const playingThis = isThis && isPlaying;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate("playlist", { id: p.id, name: p.name })}
                className="group w-32 shrink-0 snap-start text-left sm:w-36"
              >
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-white/15 to-white/5 ring-1 ring-white/10 shadow-glow">
                  {p.cover ? (
                    <img src={p.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Music2 size={38} className="text-white/90" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <button
                    type="button"
                    disabled={songs.length === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (playingThis || isThis) {
                        toggle();
                      } else {
                        notePlaylistUsed(p.id);
                        play(songs[0], songs);
                      }
                    }}
                    aria-label={playingThis ? `Pause ${p.name}` : `Play ${p.name}`}
                    className="btn-glossy absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg transition hover:opacity-90 disabled:opacity-0"
                  >
                    {playingThis ? (
                      <Pause size={16} fill="white" />
                    ) : (
                      <Play size={16} fill="white" className="ml-0.5" />
                    )}
                  </button>
                </div>
                <p className="mt-2 truncate px-0.5 text-sm font-semibold text-white" title={p.name}>
                  {p.name}
                </p>
                <p className="truncate px-0.5 text-xs text-white/50">
                  {songs.length} {songs.length === 1 ? "song" : "songs"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Downloads — songs saved for offline playback (native/APK only) */}
      <DownloadsSection />

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
