import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import { getShelf, getTrending } from "../api/client";
import { placeholderArtwork } from "../utils/trackAdapter";
import Section from "./Section";
import ArtistCard from "./ArtistCard";

// Curated Telugu moods → search queries. Each becomes a horizontal shelf.
const MOOD_SECTIONS = [
  { title: "New Releases", query: "latest telugu songs" },
  { title: "Romantic Telugu", query: "telugu romantic songs" },
  { title: "Mass & Energetic", query: "telugu mass songs" },
  { title: "Melodies", query: "telugu melody songs" },
];

// How many artist tiles to surface in the Popular Artists rail.
const MAX_ARTISTS = 12;
// Skeleton count while the first artist batch is resolving.
const ARTIST_SKELETONS = 8;

/**
 * Home: a premium gradient hero (featured track) followed by several
 * horizontal shelves — Trending, mood-based sections, and Popular Artists.
 *
 * Popular Artists is derived from the tracks we already fetch for the hero and
 * the mood shelves (unique artist names + reused track artwork), so it costs no
 * extra backend calls — previously Home fired 7 × /api/search?limit=1 just to
 * resolve artist avatars.
 */
export default function HomeView() {
  const { current, isPlaying, play } = usePlayer();
  const { navigate } = useRouter();

  const [trending, setTrending] = useState([]);
  const [artists, setArtists] = useState([]);
  const [artistsLoading, setArtistsLoading] = useState(true);

  // Unique artists accumulated from tracks already fetched for the hero/shelves.
  const artistMapRef = useRef(new Map());

  const addTracks = useCallback((tracks) => {
    let changed = false;
    for (const t of tracks || []) {
      const name = t?.artistName;
      if (!name) continue;
      const key = name.toLowerCase();
      if (artistMapRef.current.has(key)) continue;
      const artwork = t?.artworkUrl600 || t?.artworkUrl100;
      artistMapRef.current.set(key, {
        id: t.id,
        name,
        // Fall back to a deterministic gradient tile when a track has no art.
        artwork: artwork || placeholderArtwork(name),
      });
      changed = true;
    }
    if (changed) {
      setArtists(Array.from(artistMapRef.current.values()).slice(0, MAX_ARTISTS));
    }
  }, []);

  // Trending powers both the hero and the first shelf, and seeds Popular Artists.
  useEffect(() => {
    let active = true;
    getTrending(20)
      .then((d) => {
        if (!active) return;
        setTrending(d.results);
        addTracks(d.results);
        setArtistsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setTrending([]);
        setArtistsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addTracks]);

  const featured = trending[0];
  const featuredPlaying = featured && current?.id === featured.id && isPlaying;

  return (
    <div className="pt-2">
      {/* Hero */}
      {featured ? (
        <div className="glass relative mb-10 overflow-hidden rounded-3xl p-6 md:p-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-12 h-72 w-72 rounded-full bg-fuchsia-600/20 blur-3xl" />
          <div className="relative flex flex-col items-center gap-6 md:flex-row md:gap-8">
            <img
              src={featured.artworkUrl600 || featured.artworkUrl100}
              alt={featured.trackName}
              className="h-40 w-40 shrink-0 rounded-2xl object-cover shadow-2xl md:h-52 md:w-52"
            />
            <div className="min-w-0 text-center md:text-left">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/50">
                Featured
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white md:text-5xl">
                {featured.trackName}
              </h1>
              <p className="mt-2 text-white/60">{featured.artistName}</p>
              <button
                type="button"
                onClick={() => play(featured, trending)}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
              >
                {featuredPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
                {featuredPlaying ? "Pause" : "Play"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass mb-10 h-56 animate-pulse rounded-3xl" />
      )}

      {/* Trending (reuses the fetched list) */}
      <Section
        title="Trending Telugu"
        songs={trending}
        onSeeAll={() => navigate("search", { q: "telugu hits" })}
      />

      {/* Mood / vibe shelves.
          `fetchKey` is the stable dependency for Section's effect, so passing a
          fresh `fetch` arrow each render no longer triggers a refetch loop.
          `onFetched` feeds the shelf tracks into the Popular Artists rail. */}
      {MOOD_SECTIONS.map((s) => (
        <Section
          key={s.query}
          title={s.title}
          fetch={() => getShelf(s.query, 20)}
          fetchKey={s.query}
          onFetched={addTracks}
          onSeeAll={() => navigate("search", { q: s.query })}
        />
      ))}

      {/* Popular Artists — derived from trending + shelf tracks, no extra calls */}
      <section className="mb-8">
        <div className="mb-3 px-1">
          <h2 className="text-xl font-bold tracking-tight text-white">Popular Artists</h2>
        </div>
        <div className="no-scrollbar flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2">
          {artistsLoading
            ? Array.from({ length: ARTIST_SKELETONS }).map((_, i) => (
                <div key={i} className="flex w-40 shrink-0 flex-col items-center gap-3">
                  <div className="h-40 w-40 animate-pulse rounded-full bg-white/5" />
                  <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
                </div>
              ))
            : artists.map((a) => <ArtistCard key={a.id} artist={a} />)}
        </div>
      </section>
    </div>
  );
}
