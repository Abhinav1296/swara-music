import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Disc3 } from "lucide-react";
import { getAlbums } from "../api/client";
import AlbumCard from "./AlbumCard";
import SkeletonCard from "./SkeletonCard";
import OfflineNotice from "./OfflineNotice";
import useOnlineStatus from "../hooks/useOnlineStatus";

const PAGE = 48;
const GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/**
 * Albums browse page — a paginated grid of real Telugu movie-albums (deduped
 * by canonical name+year, singletons/compilations filtered out by the backend).
 * "Load more" pages through the ~5k albums instead of dumping them all at once.
 */
export default function AlbumsView() {
  const online = useOnlineStatus();
  const [albums, setAlbums] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  // Cached page-0 paints instantly (cold/slow start, or fully offline); swrGet
  // still refreshes the cache in the background for the next launch. A genuine
  // failure with no cache leaves `error` set and the page yields to the
  // OfflineNotice below. Keyed on `online` so reconnecting re-runs.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAlbums({ limit: PAGE, offset: 0 })
      .then((d) => {
        if (!active) return;
        setAlbums(d.results);
        setTotal(d.count);
      })
      .catch((e) => active && setError(e.message || "Failed to load albums."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    getAlbums({ limit: PAGE, offset: albums.length })
      .then((d) =>
        setAlbums((prev) => {
          const seen = new Set(prev.map((a) => `${a.key}:${a.year}`));
          return [...prev, ...d.results.filter((a) => !seen.has(`${a.key}:${a.year}`))];
        })
      )
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [albums.length]);

  const hasMore = albums.length < total;

  // Only bail to the offline notice when there's genuinely nothing to show — the
  // fetch failed AND no cached page rendered. With a cached copy (even fully
  // offline) we render the grid; the notice still points to Downloads / Local
  // Files when the cache is empty (e.g. a first launch with no connection).
  if (!loading && error && albums.length === 0) return <OfflineNotice />;

  return (
    <div className="pt-2">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Disc3 size={22} />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Albums</h1>
          <p className="text-sm text-white/40">
            {total ? `${total.toLocaleString()} Telugu movie albums` : "Browse Telugu movie albums"}
          </p>
        </div>
      </div>

      {loading ? (
        <div className={GRID}>
          {Array.from({ length: 18 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : albums.length === 0 ? (
        <div className="glass rounded-2xl py-16 text-center text-white/50">No albums found.</div>
      ) : (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={GRID}>
            {albums.map((a) => (
              <AlbumCard key={`${a.key}:${a.year}`} album={a} />
            ))}
          </motion.div>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-full bg-white/10 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-40"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
