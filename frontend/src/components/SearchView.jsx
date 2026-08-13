import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Disc3, Library, SearchX, X } from "lucide-react";
import { searchSongs } from "../api/client";
import { useRouter } from "../context/RouterContext";
import { useRecentSearches } from "../hooks/useRecentSearches";
import SongCard from "./SongCard";
import SkeletonCard from "./SkeletonCard";

const GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

// Quick vibe entries for the search landing — each runs a mood search.
const EXPLORE = [
  { label: "Romantic", query: "telugu romantic songs" },
  { label: "Mass & Energy", query: "telugu mass songs" },
  { label: "Melodies", query: "telugu melody songs" },
  { label: "Devotional", query: "telugu devotional songs" },
  { label: "90s Classics", query: "telugu 90s hits" },
  { label: "Folk", query: "telugu folk songs" },
  { label: "Sad", query: "telugu sad songs" },
  { label: "Party", query: "telugu party songs" },
  { label: "Latest", query: "latest telugu songs" },
];

const TOP_ARTISTS = [
  "Sid Sriram",
  "Anirudh Ravichander",
  "Devi Sri Prasad",
  "S. Thaman",
  "Shreya Ghoshal",
  "Anurag Kulkarni",
  "S. P. Balasubrahmanyam",
];

/**
 * Search view. With a query it self-fetches and renders a results grid (premium
 * loading / empty / error states). With NO query it shows a rich glossy landing:
 * recent searches, browse shortcuts, mood chips, and top artists — so the page
 * is never just a lonely icon.
 */
export default function SearchView({ query }) {
  const { navigate } = useRouter();
  const { items: recent, remove: removeRecent, clear: clearRecent } = useRecentSearches();

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const hasQuery = Boolean(query && query.trim());
  const go = (q) => navigate("search", { q });

  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    searchSongs(query, 40)
      .then((d) => active && setResults(d.results))
      .catch((e) => active && setError(e.message || "Something went wrong."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [query, hasQuery]);

  // ── Results view ───────────────────────────────────────────────────────────
  if (hasQuery) {
    return (
      <div className="pt-2">
        <div className="mb-6">
          <p className="text-sm text-white/40">Search results</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">{query}</h1>
          {!loading && !error && results.length > 0 && (
            <p className="mt-1 text-sm text-white/40">
              {results.length} {results.length === 1 ? "song" : "songs"}
            </p>
          )}
        </div>

        {error && (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="font-medium text-white/80">Couldn’t load results.</p>
            <p className="mt-1 text-sm text-white/40">{error}</p>
          </div>
        )}

        {loading && (
          <div className={GRID}>
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!loading && !error && results.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
              <SearchX size={28} className="text-white/40" />
            </div>
            <p className="text-white/60">No Telugu songs found for “{query}”.</p>
            <p className="text-sm text-white/30">Try a different artist, movie, or mood.</p>
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={GRID}>
            {results.map((song, i) => (
              <motion.div
                key={song.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.4) }}
              >
                <SongCard song={song} list={results} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    );
  }

  // ── Landing (no query) ─────────────────────────────────────────────────────
  return (
    <div className="space-y-9 pt-2">
      <div className="px-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">Search</h1>
        <p className="mt-0.5 text-sm text-white/45">
          Find songs, artists, albums — or a lyric you remember.
        </p>
      </div>

      {/* Recent searches */}
      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white/45">Recent</h2>
            <button
              type="button"
              onClick={clearRecent}
              className="text-xs text-white/40 transition hover:text-white"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <div
                key={r}
                className="glass-glossy flex items-center gap-1 rounded-full py-1.5 pl-3 pr-1.5 text-sm text-white/80"
              >
                <button
                  type="button"
                  onClick={() => go(r)}
                  className="flex items-center gap-1.5 transition hover:text-white"
                >
                  <Clock size={14} className="text-white/40" />
                  <span className="max-w-[11rem] truncate">{r}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeRecent(r)}
                  aria-label={`Remove ${r}`}
                  className="rounded-full p-1 text-white/30 transition hover:bg-white/10 hover:text-white"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Browse shortcuts */}
      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-white/45">
          Browse
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => navigate("albums")}
            className="glass group relative overflow-hidden rounded-2xl p-5 text-left transition hover:ring-1 hover:ring-accent/40"
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/25 blur-2xl" />
            <Disc3 size={26} className="text-accent" />
            <p className="mt-3 text-lg font-bold text-white">Albums</p>
            <p className="text-xs text-white/50">Telugu movie soundtracks</p>
          </button>
          <button
            type="button"
            onClick={() => navigate("library")}
            className="glass group relative overflow-hidden rounded-2xl p-5 text-left transition hover:ring-1 hover:ring-accent/40"
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15 blur-2xl" />
            <Library size={26} className="text-white/80" />
            <p className="mt-3 text-lg font-bold text-white">Your Library</p>
            <p className="text-xs text-white/50">Liked songs & playlists</p>
          </button>
        </div>
      </section>

      {/* Explore moods */}
      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-white/45">
          Explore moods
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {EXPLORE.map((c) => (
            <button
              key={c.query}
              type="button"
              onClick={() => go(c.query)}
              className="glass-glossy rounded-full px-4 py-2 text-sm font-semibold text-white/75 transition hover:text-white"
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {/* Top artists */}
      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-white/45">
          Top artists
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {TOP_ARTISTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => navigate("artist", { name: a })}
              className="glass-glossy rounded-full px-4 py-2 text-sm font-semibold text-white/75 transition hover:text-white"
            >
              {a}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
