import { useState } from "react";
import { Heart, ListMusic, Music2, Play, Plus } from "lucide-react";
import { useLibrary } from "../context/LibraryContext";
import { usePlaylists } from "../context/PlaylistContext";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import SongCard from "./SongCard";
import PlaylistModal from "./PlaylistModal";

const GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/** Local library: liked songs (playlist) + custom playlists + recently played. */
export default function LibraryView() {
  const { likedSongs, recentlyPlayed, clearRecent } = useLibrary();
  const { playlists, createPlaylist } = usePlaylists();
  const { current, isPlaying, play } = usePlayer();
  const { navigate } = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

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
            <SongCard key={song.id} song={song} list={likedSongs} />
          ))}
        </div>
      )}

      {/* Your Playlists */}
      <div className="mb-4 mt-10 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Your Playlists</h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
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
                <Music2 size={40} className="text-white/90" />
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
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
