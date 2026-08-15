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

/**
 * A square scroll-row tile shared by the top quick-access strip: playlists and
 * the Liked Songs collection use the same shape (cover + in-place play button +
 * title/subtitle). `onOpen` fires on a body tap; the round button plays without
 * navigating.
 */
function Tile({ onOpen, cover, title, subtitle, playing, canPlay, onPlay, playLabel }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-32 shrink-0 snap-start text-left sm:w-36"
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-white/15 to-white/5 ring-1 ring-white/10 shadow-glow">
        {cover}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <button
          type="button"
          disabled={!canPlay}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          aria-label={playLabel}
          className="btn-glossy absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg transition hover:opacity-90 disabled:opacity-0"
        >
          {playing ? (
            <Pause size={16} fill="white" />
          ) : (
            <Play size={16} fill="white" className="ml-0.5" />
          )}
        </button>
      </div>
      <p className="mt-2 truncate px-0.5 text-sm font-semibold text-white" title={title}>
        {title}
      </p>
      <p className="truncate px-0.5 text-xs text-white/50">{subtitle}</p>
    </button>
  );
}

/** Local library: a usage-ranked quick strip (playlists + Liked Songs) over the
 * full "Your Playlists" section, the liked-songs grid, downloads, local files
 * and recently played. */
export default function LibraryView() {
  const { likedSongs, recentlyPlayed, clearRecent } = useLibrary();
  const { playlists, playlistsByUsage, createPlaylist, playlistNameExists, notePlaylistUsed } =
    usePlaylists();
  const { current, isPlaying, play, toggle } = usePlayer();
  const { navigate } = useRouter();
  const { requireAuth } = useAuthGate();
  const [createOpen, setCreateOpen] = useState(false);
  const [sheetSong, setSheetSong] = useState(null);

  const likedIsCurrent =
    likedSongs.length > 0 && current && likedSongs.some((s) => s.id === current.id);
  const likedPlaying = likedIsCurrent && isPlaying;

  const handleCreate = (name) => {
    const id = createPlaylist(name);
    setCreateOpen(false);
    navigate("playlist", { id, name });
  };

  const goToLikedList = () =>
    document
      .getElementById("liked-songs")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="pt-2">
      {/* Quick-access strip — most-used playlists first, then Liked Songs.
          Liked Songs only appears once you've liked at least one track. */}
      {(playlistsByUsage.length > 0 || likedSongs.length > 0) && (
        <div className="no-scrollbar -mx-4 mb-10 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {playlistsByUsage.map((p) => {
            const songs = p.songs || [];
            const isThis = current && songs.some((s) => s.id === current.id);
            const playingThis = isThis && isPlaying;
            return (
              <Tile
                key={p.id}
                onOpen={() => navigate("playlist", { id: p.id, name: p.name })}
                cover={
                  p.cover ? (
                    <img src={p.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Music2 size={38} className="text-white/90" />
                    </div>
                  )
                }
                title={p.name}
                subtitle={`${songs.length} ${songs.length === 1 ? "song" : "songs"}`}
                playing={playingThis}
                canPlay={songs.length > 0}
                onPlay={() => {
                  if (isThis) {
                    toggle();
                  } else {
                    notePlaylistUsed(p.id);
                    play(songs[0], songs);
                  }
                }}
                playLabel={playingThis ? `Pause ${p.name}` : `Play ${p.name}`}
              />
            );
          })}

          {likedSongs.length > 0 && (
            <Tile
              onOpen={goToLikedList}
              cover={
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/50 to-accent/10">
                  <Heart size={40} className="text-white" fill="white" />
                </div>
              }
              title="Liked Songs"
              subtitle={`${likedSongs.length} ${likedSongs.length === 1 ? "song" : "songs"}`}
              playing={likedPlaying}
              canPlay
              onPlay={() => {
                if (likedIsCurrent) {
                  toggle();
                } else {
                  play(likedSongs[0], likedSongs);
                }
              }}
              playLabel={likedPlaying ? "Pause Liked Songs" : "Play Liked Songs"}
            />
          )}
        </div>
      )}

      {/* Your Playlists */}
      <div className="mb-4 flex items-center justify-between">
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
        // Side-scrolling row (same tile + in-place play as the top strip).
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {playlists.map((p) => {
            const songs = p.songs || [];
            const isThis = current && songs.some((s) => s.id === current.id);
            const playingThis = isThis && isPlaying;
            return (
              <Tile
                key={p.id}
                onOpen={() => navigate("playlist", { id: p.id, name: p.name })}
                cover={
                  p.cover ? (
                    <img src={p.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Music2 size={38} className="text-white/90" />
                    </div>
                  )
                }
                title={p.name}
                subtitle={`${songs.length} ${songs.length === 1 ? "song" : "songs"}`}
                playing={playingThis}
                canPlay={songs.length > 0}
                onPlay={() => {
                  if (isThis) {
                    toggle();
                  } else {
                    notePlaylistUsed(p.id);
                    play(songs[0], songs);
                  }
                }}
                playLabel={playingThis ? `Pause ${p.name}` : `Play ${p.name}`}
              />
            );
          })}
        </div>
      )}

      {/* Liked Songs — only shown once there's something liked. */}
      {likedSongs.length > 0 && (
        <>
          <h2 id="liked-songs" className="mb-4 mt-10 scroll-mt-24 text-xl font-bold text-white">
            Liked Songs
          </h2>
          <div className={GRID}>
            {likedSongs.map((song) => (
              <SwipeToAdd key={song.id} song={song} list={likedSongs} onSwipe={setSheetSong} />
            ))}
          </div>
        </>
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
