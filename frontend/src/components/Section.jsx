import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import SongCard from "./SongCard";
import SkeletonCard from "./SkeletonCard";
import { getTrending, getShelf } from "../api/client";

/**
 * A horizontally-scrolling, snap-based shelf of song cards with an Apple
 * Music–style header ("Title" + See All + scroll arrows). Fetches its own
 * data when a `fetchKey` string is provided; otherwise renders `songs` directly
 * (useful to share data already loaded by the parent).
 *
 * fetchKey values (stable strings, never inline functions):
 * - "trending-preloaded"  -> uses preloaded data from parent (provided prop)
 * - "latest telugu songs" -> getTrending
 * - "telugu romantic songs" -> getShelf
 * - "telugu mass songs" -> getShelf
 * - "telugu melody songs" -> getShelf
 */
export default function Section({ title, fetchKey, songs: provided, onSeeAll, onFetched }) {
  const [songs, setSongs] = useState(provided || []);
  const [loading, setLoading] = useState(!provided && !!fetchKey);
  const scrollerRef = useRef(null);

  // Internal fetch logic keyed by stable fetchKey string
  const doFetch = useRef(async () => {
    if (!fetchKey) return [];
    if (fetchKey === "trending-preloaded") return []; // parent provides data
    if (fetchKey === "latest telugu songs") return getTrending(20);
    // Mood shelves
    return getShelf(fetchKey, 20);
  }).current;

  useEffect(() => {
    if (provided) {
      setSongs(provided);
      setLoading(false);
      return undefined;
    }
    if (!fetchKey) return undefined;
    let active = true;
    setLoading(true);
    doFetch()
      .then((d) => {
        const results = d?.results || [];
        if (active) {
          setSongs(results);
          if (onFetched) onFetched(results);
        }
      })
      .catch(() => active && setSongs([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [fetchKey, provided, onFetched]);

  const scroll = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
        <div className="flex items-center gap-2">
          {onSeeAll && (
            <button
              type="button"
              onClick={onSeeAll}
              className="text-sm font-medium text-white/50 transition hover:text-white"
            >
              See All
            </button>
          )}
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label="Scroll left"
            className="hidden h-8 w-8 items-center justify-center rounded-full glass transition hover:bg-white/10 md:flex"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label="Scroll right"
            className="hidden h-8 w-8 items-center justify-center rounded-full glass transition hover:bg-white/10 md:flex"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-2 md:mx-0 md:px-0"
      >
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-36 shrink-0 snap-start sm:w-40">
                <SkeletonCard />
              </div>
            ))
          : songs.map((s) => (
              <div key={s.id} className="w-36 shrink-0 snap-start sm:w-40">
                <SongCard song={s} list={songs} />
              </div>
            ))}
      </div>
    </section>
  );
}
