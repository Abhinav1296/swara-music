import { useEffect, useState } from "react";
import { ChevronLeft, Pause, Play, Shuffle } from "lucide-react";
import { motion } from "framer-motion";
import { lookup } from "../api/client";
import { usePlayer } from "../context/PlayerContext";
import TrackRow from "./TrackRow";

/**
 * Shared Artist / Album detail page. Resolves a name via /api/lookup (Lyrica/
 * JioSaavn have no ids, so we look up by `name`; albums may also pass an
 * `artist` hint), then renders a large frosted header (artwork + title +
 * play-all) followed by the track list. `kind` is "artist" or "album".
 */
export default function DetailView({ name, kind, artist }) {
  const { current, isPlaying, play, shuffle, toggleShuffle } = usePlayer();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    if (!name) {
      // No name to resolve → render the empty state instead of a doomed fetch.
      setLoading(false);
      setData({ type: kind, title: "", results: [] });
      return undefined;
    }
    lookup({ name, type: kind, artist, limit: 60 })
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message || "Failed to load."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [name, kind, artist]);

  const tracks = data?.results || [];
  const listPlaying =
    tracks.length > 0 && current && tracks.some((t) => t.id === current.id) && isPlaying;
  const subtitle =
    kind === "album"
      ? tracks[0]?.artistName || name
      : `${tracks.length} songs`;

  return (
    <div className="pt-2">
      {/* Back affordance (browser back also works) */}
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
        <div className="pointer-events-none absolute -bottom-28 left-12 h-72 w-72 rounded-full bg-fuchsia-600/15 blur-3xl" />
        <div className="glass relative flex flex-col items-center gap-6 p-6 md:flex-row md:gap-8 md:p-8">
          <img
            src={data?.artworkUrl600 || ""}
            alt={data?.title || name}
            className="h-40 w-40 shrink-0 rounded-2xl object-cover shadow-2xl ring-1 ring-white/10 md:h-52 md:w-52"
          />
          <div className="min-w-0 text-center md:text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/50">
              {kind === "album" ? "Album" : "Artist"}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white md:text-5xl">
              {data?.title || name || "Loading…"}
            </h1>
            <p className="mt-2 text-white/60">{subtitle}</p>
            <div className="mt-5 flex items-center justify-center gap-3 md:justify-start">
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => play(tracks[0], tracks)}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-30"
              >
                {listPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
                {listPlaying ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={toggleShuffle}
                aria-label="Shuffle"
                aria-pressed={shuffle}
                className={`rounded-full p-3 transition disabled:opacity-30 ${
                  shuffle ? "bg-white/15 text-accent" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Shuffle size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Track list */}
      {error ? (
        <div className="glass rounded-2xl p-8 text-center">
          <p className="font-medium text-white/80">Couldn’t load this {kind}.</p>
          <p className="mt-1 text-sm text-white/40">{error}</p>
        </div>
      ) : loading ? (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <div className="glass rounded-2xl py-16 text-center text-white/50">
          No tracks found.
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-2">
          {tracks.map((song, i) => (
            <TrackRow key={song.id} song={song} index={i} list={tracks} />
          ))}
        </motion.div>
      )}
    </div>
  );
}
