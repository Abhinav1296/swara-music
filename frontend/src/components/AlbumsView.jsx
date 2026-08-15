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
  const [albums, setAlbums] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

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
  }, []);

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

  // Albums is a live grid from the backend; offline there's nothing to fetch, so
  // send the user to their offline Downloads / Local Files.
  const online = useOnlineStatus();
  if (!online) return <OfflineNotice />;

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

      {error ? (
        <div className="glass rounded-2xl p-8 text-center">
          <p className="font-medium text-white/80">Couldn’t load albums.</p>
          <p className="mt-1 text-sm text-white/40">{error}</p>
        </div>
      ) : loading ? (
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
