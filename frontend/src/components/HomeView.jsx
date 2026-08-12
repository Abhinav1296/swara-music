import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import { getTrending, getNewReleases } from "../api/client";
import Section from "./Section";
import ArtistCard from "./ArtistCard";
import AlbumCard from "./AlbumCard";

// Curated Telugu moods → JioSaavn search queries. Each becomes a horizontal
// shelf, fetched live from JioSaavn (daily-cached) via /api/trending?q=…
// (New Releases is NOT here — it's a real fresh-albums row, see below.)
const MOOD_SECTIONS = [
  { title: "Romantic Telugu", query: "telugu romantic songs" },
  { title: "Mass & Energetic", query: "telugu mass songs" },
  { title: "Melodies", query: "telugu melody songs" },
];

// Preferred order of artists to surface when derivable from shelves.
const PREFERRED_ARTISTS = [
  "Sid Sriram",
  "Anirudh Ravichander",
  "Anurag Kulkarni",
  "Devi Sri Prasad",
  "S. Thaman",
  "Shreya Ghoshal",
  "S. P. Balasubrahmanyam",
];

/**
 * Home: gradient hero (featured track) + horizontal shelves.
 * NOTE: We no longer fanout /api/search for each artist. Popular Artists
 * are derived from the tracks already fetched by shelves.
 */
export default function HomeView() {
  const { current, isPlaying, play } = usePlayer();
  const { navigate } = useRouter();

  const [trending, setTrending] = useState([]);
  const [shelfSongs, setShelfSongs] = useState([]); // accumulated tracks from mood shelves
  const [newReleases, setNewReleases] = useState([]); // fresh Telugu album cards

  // Trending powers both hero and the first shelf
  useEffect(() => {
    let active = true;
    getTrending(20)
      .then((d) => active && setTrending(d?.results || []))
      .catch(() => active && setTrending([]));
    return () => { active = false; };
  }, []);

  // New Releases: real fresh Telugu albums (cards), live from JioSaavn.
  useEffect(() => {
    let active = true;
    getNewReleases({ limit: 20 })
      .then((d) => active && setNewReleases(d?.results || []))
      .catch(() => active && setNewReleases([]));
    return () => { active = false; };
  }, []);

  // Stable callback for Section to report its fetched songs (avoids refetch loops)
  const addTracks = useCallback((tracks) => {
    if (!Array.isArray(tracks) || tracks.length === 0) return;
    setShelfSongs((prev) => {
      // dedupe by id
      const seen = new Set(prev.map((t) => t?.id).filter(Boolean));
      const merged = [...prev];
      for (const t of tracks) {
        if (t && t.id && !seen.has(t.id)) {
          seen.add(t.id);
          merged.push(t);
        }
      }
      return merged;
    });
  }, []);

  // Derive Popular Artists from all fetched tracks
  const derivedArtists = useMemo(() => {
    const pool = [...trending, ...shelfSongs].filter(Boolean);
    if (pool.length === 0) return [];

    // group by artistName -> pick best artwork
    const byArtist = new Map();
    for (const s of pool) {
      const name = (s?.artistName || "").trim();
      if (!name) continue;
      const artwork = s?.artworkUrl600 || s?.artworkUrl100 || "";
      const prev = byArtist.get(name);
      if (!prev) {
        byArtist.set(name, { id: `artist:${name}`, name, artwork });
      } else if (!prev.artwork && artwork) {
        prev.artwork = artwork;
      }
    }

    // sort: preferred order first, others after
    const order = new Map(PREFERRED_ARTISTS.map((n, i) => [n, i]));
    const arr = Array.from(byArtist.values());
    arr.sort((a, b) => {
      const ai = order.has(a.name) ? order.get(a.name) : 999;
      const bi = order.has(b.name) ? order.get(b.name) : 999;
      return ai - bi;
    });

    return arr.slice(0, 12);
  }, [trending, shelfSongs]);

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
        onFetched={addTracks}
        fetchKey="trending-preloaded"
      />

      {/* New Releases — real fresh Telugu albums (cards → album detail) */}
      {newReleases.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 px-1">
            <h2 className="text-xl font-bold tracking-tight text-white">New Releases</h2>
          </div>
          <div className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2">
            {newReleases.map((a) => (
              <div key={a.key || a.albumId} className="w-36 shrink-0 snap-start sm:w-40">
                <AlbumCard album={a} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mood / vibe shelves */}
      {MOOD_SECTIONS.map((s) => (
        <Section
          key={s.query}
          title={s.title}
          fetchKey={s.query}
          onSeeAll={() => navigate("search", { q: s.query })}
          onFetched={addTracks}
        />
      ))}

      {/* Popular Artists (derived from shelves) */}
      <section className="mb-8">
        <div className="mb-3 px-1">
          <h2 className="text-xl font-bold tracking-tight text-white">Popular Artists</h2>
        </div>
        <div className="no-scrollbar flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2">
          {derivedArtists.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex w-40 shrink-0 flex-col items-center gap-3">
                  <div className="h-40 w-40 animate-pulse rounded-full bg-white/5" />
                  <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
                </div>
              ))
            : derivedArtists.map((a) => <ArtistCard key={a.id} artist={a} />)}
        </div>
      </section>
    </div>
  );
}