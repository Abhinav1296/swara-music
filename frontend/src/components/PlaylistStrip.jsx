import { Music2, Pause, Play } from "lucide-react";
import { usePlaylists } from "../context/PlaylistContext";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import CachedImage from "./CachedImage";

/**
 * A sideways, swipeable carousel of the user's playlists at the top of Library,
 * ordered "most-used first" (recency-weighted play count, see PlaylistContext).
 * Each tile is playable in place — the round button starts the playlist without
 * leaving Library — while tapping the tile itself opens the playlist page.
 */
export default function PlaylistStrip() {
  const { playlistsByUsage, notePlaylistUsed } = usePlaylists();
  const { current, isPlaying, play, toggle } = usePlayer();
  const { navigate } = useRouter();

  const items = playlistsByUsage;
  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xl font-bold text-white">Jump back in</h2>
      {/* Bleed to the screen edges on mobile so the row scrolls edge-to-edge. */}
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {items.map((p) => {
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
                  <CachedImage src={p.cover} alt="" className="h-full w-full object-cover" />
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
                    if (playingThis) {
                      toggle();
                    } else if (isThis) {
                      toggle(); // resume the already-loaded playlist
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
    </section>
  );
}
