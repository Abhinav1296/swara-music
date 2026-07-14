import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SearchX } from "lucide-react";
import { searchSongs } from "../api/client";
import SongCard from "./SongCard";
import SkeletonCard from "./SkeletonCard";

const GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/**
 * Search results view. Self-fetches whenever `query` changes (so it works
 * both for the live TopBar search and "See All" navigation). Shows premium
 * loading / empty / error states.
 */
export default function SearchView({ query }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const hasQuery = Boolean(query && query.trim());

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

  return (
    <div className="pt-2">
      {hasQuery && (
        <div className="mb-6">
          <p className="text-sm text-white/40">Search results</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">{query}</h1>
        </div>
      )}

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

      {!loading && !error && hasQuery && results.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
            <SearchX size={28} className="text-white/40" />
          </div>
          <p className="text-white/60">No Telugu songs found for “{query}”.</p>
          <p className="text-sm text-white/30">Try a different artist, movie, or mood.</p>
        </div>
      )}

      {!loading && !error && !hasQuery && (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
            <SearchX size={28} className="text-white/40" />
          </div>
          <p className="text-white/60">Start typing to search Telugu songs.</p>
          <p className="text-sm text-white/30">Try an artist, movie, or vibe.</p>
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
