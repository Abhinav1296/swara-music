import { CircleArrowDown, Pause, Play } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useOffline } from "../context/OfflineContext";
import { useRouter } from "../context/RouterContext";
import LikeButton from "./LikeButton";
import TrackMenu from "./TrackMenu";
import CachedImage from "./CachedImage";
import { formatTime } from "../utils/format";

/**
 * A single row in an artist/album track list. Shows index (or an animated
 * equalizer while playing), small artwork, title/artist (artist links out),
 * duration, like, and a "more" menu. Clicking the row plays within `list`.
 */
export default function TrackRow({ song, index, list }) {
  const { current, isPlaying, play } = usePlayer();
  const { isDownloaded } = useOffline();
  const { navigate } = useRouter();

  const isActive = current?.id === song.id;
  const isPlayingThis = isActive && isPlaying;
  const downloaded = isDownloaded(song.id);
  const context = list || [song];

  return (
    <div
      onClick={() => play(song, context)}
      className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
        isActive ? "bg-white/10" : "hover:bg-white/5"
      }`}
    >
      {/* index / equalizer / play */}
      <div className="flex w-6 shrink-0 items-center justify-center">
        {isPlayingThis ? (
          <span className="flex items-end gap-0.5" aria-hidden="true">
            <span className="h-3 w-0.5 animate-equalizer rounded-full bg-accent" />
            <span
              className="h-3 w-0.5 animate-equalizer rounded-full bg-accent"
              style={{ animationDelay: "0.2s" }}
            />
            <span
              className="h-3 w-0.5 animate-equalizer rounded-full bg-accent"
              style={{ animationDelay: "0.4s" }}
            />
          </span>
        ) : (
          <>
            <span
              className={`text-sm tabular-nums group-hover:hidden ${
                isActive ? "text-accent" : "text-white/40"
              }`}
            >
              {index + 1}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                play(song, context);
              }}
              aria-label="Play"
              className="hidden text-white group-hover:block"
            >
              <Play size={16} fill="white" className="ml-0.5" />
            </button>
          </>
        )}
      </div>

      <CachedImage src={song.artworkUrl100} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />

      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium ${isActive ? "text-accent" : "text-white"}`}
          title={song.trackName}
        >
          {song.trackName}
        </p>
        <p
          onClick={(e) => {
            e.stopPropagation();
            if (song.artistName) navigate("artist", { name: song.artistName });
          }}
          className="truncate text-xs text-white/50 transition hover:text-white/80 hover:underline"
          title={song.artistName}
        >
          {song.artistName}
        </p>
      </div>

      {downloaded && (
        <CircleArrowDown
          size={15}
          className="shrink-0 text-accent"
          aria-label="Downloaded"
        />
      )}

      <span className="hidden shrink-0 text-xs tabular-nums text-white/40 sm:block">
        {formatTime((song.trackTimeMillis || 0) / 1000)}
      </span>

      <LikeButton song={song} className="h-8 w-8" />
      <TrackMenu song={song} />
    </div>
  );
}
