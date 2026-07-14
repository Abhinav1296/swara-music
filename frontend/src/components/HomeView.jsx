import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import { getShelf, getTrending, searchSongs } from "../api/client";
import Section from "./Section";
import ArtistCard from "./ArtistCard";
import SkeletonCard from "./SkeletonCard";

// Curated Telugu moods → search queries. Each becomes a horizontal shelf.
const MOOD_SECTIONS = [
  { title: "New Releases", query: "latest telugu songs" },
  { title: "Romantic Telugu", query: "telugu romantic songs" },
  { title: "Mass & Energetic", query: "telugu mass songs" },
  { title: "Melodies", query: "telugu melody songs" },
];

// Artists surfaced as tappable circular cards.
const ARTIST_NAMES = [
  "Sid Sriram",
  "Anirudh Ravichander",
  "Anurag Kulkarni",
  "Devi Sri Prasad",
  "S. Thaman",
  "Shreya Ghoshal",
  "S. P. Balasubrahmanyam",
];

/**
 * Home: a premium gradient hero (featured track) followed by several
 * horizontal shelves — Trending, mood-based sections, and Popular Artists.
 */
export default function HomeView() {
  const { current, isPlaying, play } = usePlayer();
  const { navigate } = useRouter();

  const [trending, setTrending] = useState([]);
  const [artists, setArtists] = useState([]);
  const [artistsLoading, setArtistsLoading] = useState(true);

  // Trending powers both the hero and the first shelf.
  useEffect(() => {
    let active = true;
    getTrending(20)
      .then((d) => active && setTrending(d.results))
      .catch(() => active && setTrending([]));
    return () => {
      active = false;
    };
  }, []);

  // Resolve featured artists into cards (grab each artist's top song for art/id).
  useEffect(() => {
    let active = true;
    setArtistsLoading(true);
    Promise.all(
      ARTIST_NAMES.map((name) =>
        searchSongs(name, 1)
          .then((d) => d.results[0])
          .catch(() => null)
      )
    )
      .then((songs) => {
        if (!active) return;
        const resolved = songs
          .filter(Boolean)
          .map((s) => ({
            id: s.id,
            name: s.artistName,
            artwork: s.artworkUrl600 || s.artworkUrl100,
          }));
        setArtists(resolved);
      })
      .finally(() => active && setArtistsLoading(false));
    return () => {
      active = false;
    };
  }, []);

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

      {/* Mood / vibe shelves */}
      {MOOD_SECTIONS.map((s) => (
        <Section
          key={s.query}
          title={s.title}
          fetch={() => getShelf(s.query, 20)}
          onSeeAll={() => navigate("search", { q: s.query })}
        />
      ))}

      {/* Popular Artists */}
      <section className="mb-8">
        <div className="mb-3 px-1">
          <h2 className="text-xl font-bold tracking-tight text-white">Popular Artists</h2>
        </div>
        <div className="no-scrollbar flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2">
          {artistsLoading
            ? ARTIST_NAMES.map((_, i) => (
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
