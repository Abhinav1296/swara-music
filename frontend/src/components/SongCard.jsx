import { useState } from "react";
import { CircleArrowDown, Pause, Play } from "lucide-react";
import { motion } from "framer-motion";
import { usePlayer } from "../context/PlayerContext";
import { useOffline } from "../context/OfflineContext";
import { useRouter } from "../context/RouterContext";
import LikeButton from "./LikeButton";
import TrackMenu from "./TrackMenu";

/**
 * A single song tile: frosted card with artwork, hover lift, a play/pause
 * button overlay, a like toggle, a "more" menu, and clickable artist/album
 * links. The whole card plays the track (within its section list).
 */
export default function SongCard({ song, list }) {
  const { current, isPlaying, play } = usePlayer();
  const { isDownloaded } = useOffline();
  const { navigate } = useRouter();
  // Tap-to-reveal: on touch the hover-only controls never show, so a first tap
  // surfaces Play / ♥ / ⋮ instead of playing instantly; the Play button plays.
  const [revealed, setRevealed] = useState(false);

  const isActive = current?.id === song.id;
  const isPlayingThis = isActive && isPlaying;
  const downloaded = isDownloaded(song.id);
  const context = list || [song];

  const goArtist = (e) => {
    e.stopPropagation();
    if (song.artistName) navigate("artist", { name: song.artistName });
  };
  const goAlbum = (e) => {
    e.stopPropagation();
    if (song.collectionName)
      navigate("album", {
        name: song.collectionName,
        artist: song.artistName,
        year: song.year ?? undefined,
      });
  };

  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      onClick={() => setRevealed((v) => !v)}
      className={`group relative flex cursor-pointer flex-col gap-3 rounded-3xl p-3 transition-colors ${
        isActive ? "bg-white/10 ring-1 ring-accent/50" : "glass hover:bg-white/10"
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-white/5">
        <img
          src={song.artworkUrl600 || song.artworkUrl100}
          alt={song.trackName}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div
          className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent transition-opacity duration-300 group-hover:opacity-100 ${
            revealed ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Like (top-left) */}
        <div
          className={`absolute left-2 top-2 transition-all group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto ${
            revealed
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-1 opacity-0"
          }`}
        >
          <LikeButton song={song} className="h-8 w-8 bg-black/40 backdrop-blur-md" />
        </div>

        {/* More menu (top-right) */}
        <div
          className={`absolute right-2 top-2 transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto ${
            revealed ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <TrackMenu song={song} />
        </div>

        {/* Downloaded badge (bottom-left) — always visible so shelves are scannable */}
        {downloaded && (
          <div className="absolute bottom-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 backdrop-blur-md ring-1 ring-white/10">
            <CircleArrowDown size={14} className="text-accent" aria-label="Downloaded" />
          </div>
        )}

        {/* Play / pause (bottom-right) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            play(song, context);
          }}
          aria-label={isPlayingThis ? "Pause" : "Play"}
          className={`absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center btn-glossy rounded-full text-white transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto hover:scale-105 ${
            revealed
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-3 opacity-0"
          }`}
        >
          {isPlayingThis ? (
            <Pause size={20} fill="white" />
          ) : (
            <Play size={20} fill="white" className="ml-0.5" />
          )}
        </button>
      </div>

      <div className="min-w-0 px-1 pb-1">
        <h3 className="truncate text-sm font-semibold text-white" title={song.trackName}>
          {song.trackName}
        </h3>
        <p
          onClick={goArtist}
          className="truncate text-xs text-white/50 transition hover:text-white/80 hover:underline"
          title={song.artistName}
        >
          {song.artistName}
        </p>
        {song.collectionName && (
          <p
            onClick={goAlbum}
            className="truncate text-xs text-white/35 transition hover:text-white/60 hover:underline"
            title={song.collectionName}
          >
            {song.collectionName}
          </p>
        )}
      </div>
    </motion.div>
  );
}
