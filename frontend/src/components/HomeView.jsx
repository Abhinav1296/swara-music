import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useRouter } from "../context/RouterContext";
import { getTrending, getNewReleases } from "../api/client";
import Section from "./Section";
import ArtistCard from "./ArtistCard";
import AlbumCard from "./AlbumCard";
import RecommendationsShelf from "./RecommendationsShelf";
import Marquee from "./Marquee";
import OfflineNotice from "./OfflineNotice";
import useOnlineStatus from "../hooks/useOnlineStatus";

// Curated Telugu moods → JioSaavn search queries. Each becomes a horizontal
// shelf, fetched live from JioSaavn (daily-cached) via /api/trending?q=…
// (New Releases is NOT here — it's a real fresh-albums row, see below.)
const MOOD_SECTIONS = [
  { title: "Romantic Telugu", query: "telugu romantic songs" },
  { title: "Mass & Energetic", query: "telugu mass songs" },
  { title: "Melodies", query: "telugu melody songs" },
];

// Quick-tap vibe chips under the hero — a fast way into a mood/search without
// typing. Each just navigates to the search view with its query.
const MOOD_CHIPS = [
  { label: "Romantic", query: "telugu romantic songs" },
  { label: "Mass & Energy", query: "telugu mass songs" },
  { label: "Melodies", query: "telugu melody songs" },
  { label: "Devotional", query: "telugu devotional songs" },
  { label: "90s Classics", query: "telugu 90s hits" },
  { label: "Folk", query: "telugu folk songs" },
  { label: "Sad", query: "telugu sad songs" },
  { label: "Party", query: "telugu party songs" },
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

const HERO_ROTATE_MS = 6500;

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Late night vibes";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Winding down";
}

/**
 * Home: time-aware greeting + a cinematic auto-rotating hero (top trending,
 * ambient blurred-art backdrop) + quick mood chips + horizontal shelves.
 * Popular Artists are derived from the tracks already fetched by the shelves
 * (no extra fanout).
 */
export default function HomeView() {
  const { current, isPlaying, play } = usePlayer();
  const { navigate } = useRouter();
  const online = useOnlineStatus();

  const [trending, setTrending] = useState([]);
  const [shelfSongs, setShelfSongs] = useState([]); // accumulated tracks from mood shelves
  const [newReleases, setNewReleases] = useState([]); // fresh Telugu album cards
  const [failed, setFailed] = useState(false); // primary feed (trending) couldn't load
  // Track ids already shown on Home so the recommendations shelf can dedupe.
  const displayedIdsRef = useRef(new Set());

  // Trending powers both hero and the first shelf. Refetches when connectivity
  // returns; a failure (offline OR an unreachable backend, which navigator.onLine
  // can't see) flips `failed` so the whole page yields to the OfflineNotice.
  useEffect(() => {
    let active = true;
    // Serve the persistently-cached feed first (instant on a cold/slow start, or
    // fully offline); a background revalidation swaps in fresh data when it lands.
    // Keyed on `online` so reconnecting re-runs and refreshes.
    const apply = (d) => {
      if (!active) return;
      const results = d?.results || [];
      setTrending(results);
      results.forEach((t) => t?.id && displayedIdsRef.current.add(t.id));
      setFailed(false);
    };
    getTrending(20, { onRevalidate: apply })
      .then(apply)
      .catch(() => {
        if (!active) return;
        setTrending([]);
        setFailed(true);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // New Releases: real fresh Telugu albums (cards), live from JioSaavn.
  useEffect(() => {
    let active = true;
    const apply = (d) => active && setNewReleases(d?.results || []);
    getNewReleases({ limit: 20 }, { onRevalidate: apply })
      .then(apply)
      .catch(() => active && setNewReleases([]));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Stable callback for Section to report its fetched songs (avoids refetch loops)
  const addTracks = useCallback((tracks) => {
    if (!Array.isArray(tracks) || tracks.length === 0) return;
    for (const t of tracks) if (t?.id) displayedIdsRef.current.add(t.id);
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

  // ── Rotating hero ──────────────────────────────────────────────────────────
  // Freshness: JioSaavn's trending feed is cached ~12h server-side, so without
  // this the hero would show the SAME top-5 in the SAME order on every open. We
  // pick a random start offset ONCE per app-open (heroSeed) and rotate a wider
  // slice of the feed to begin there — so each open surfaces a different Featured
  // song while still drawing only from real trending tracks.
  const [heroSeed] = useState(() => Math.random());
  const heroItems = useMemo(() => {
    const pool = trending.slice(0, 10);
    if (pool.length <= 1) return pool;
    const start = Math.floor(heroSeed * pool.length) % pool.length;
    return [...pool.slice(start), ...pool.slice(0, start)];
  }, [trending, heroSeed]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const heroTouch = useRef(null);

  // Swipe the hero left/right to move to the next / previous featured song.
  // Mirrors the now-playing-bar gesture: only a deliberate horizontal drag
  // (>50px, horizontal-dominant) counts, so vertical page scrolling is untouched.
  const swipeHero = (dir) => {
    const n = heroItems.length;
    if (n <= 1) return;
    setHeroIdx((i) => (i + dir + n) % n);
  };
  const onHeroTouchStart = (e) => {
    const t = e.touches[0];
    heroTouch.current = { x: t.clientX, y: t.clientY };
    setHeroPaused(true); // hold auto-rotate while the finger is down
  };
  const onHeroTouchEnd = (e) => {
    const start = heroTouch.current;
    heroTouch.current = null;
    setHeroPaused(false); // resume with a fresh timer after the gesture
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) swipeHero(dx < 0 ? 1 : -1);
  };

  // Keep the index valid as the list loads/changes.
  useEffect(() => {
    if (heroIdx >= heroItems.length) setHeroIdx(0);
  }, [heroItems.length, heroIdx]);

  // Auto-advance (paused on hover / when only one item).
  useEffect(() => {
    if (heroPaused || heroItems.length <= 1) return undefined;
    const t = setInterval(
      () => setHeroIdx((i) => (i + 1) % heroItems.length),
      HERO_ROTATE_MS
    );
    return () => clearInterval(t);
  }, [heroPaused, heroItems.length]);

  const featured = heroItems[heroIdx];
  const featuredPlaying = featured && current?.id === featured.id && isPlaying;

  // Only bail to the offline notice when there's genuinely nothing to show — no
  // cached feed AND the live fetch failed. With a cached copy (even fully
  // offline) we render it instead; the notice still points to Downloads / Local
  // Files when the cache is empty (e.g. a first launch with no connection).
  if (failed && trending.length === 0) return <OfflineNotice />;

  return (
    <div className="pt-2">
      {/* Greeting */}
      <div className="mb-5 px-1">
        <p className="text-sm text-white/45">{greeting()}</p>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
          Discover Telugu music
        </h1>
      </div>

      {/* Cinematic rotating hero */}
      {featured ? (
        <div
          className="glass relative mb-6 touch-pan-y overflow-hidden rounded-3xl"
          onMouseEnter={() => setHeroPaused(true)}
          onMouseLeave={() => setHeroPaused(false)}
          onTouchStart={onHeroTouchStart}
          onTouchEnd={onHeroTouchEnd}
        >
          {/* Ambient blurred-art backdrop (crossfades as the hero rotates) */}
          <div className="absolute inset-0 -z-10 overflow-hidden bg-black">
            <AnimatePresence>
              <motion.img
                key={featured.id}
                src={featured.artworkUrl600 || featured.artworkUrl100}
                alt=""
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.55 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9 }}
                className="absolute inset-0 h-full w-full scale-125 object-cover blur-3xl saturate-150"
              />
            </AnimatePresence>
            <div className="absolute inset-0 bg-gradient-to-tr from-black/75 via-black/50 to-black/25" />
          </div>

          <div className="relative flex flex-col items-center gap-6 p-6 md:flex-row md:gap-8 md:p-9">
            <motion.img
              key={`${featured.id}-cover`}
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 24 }}
              src={featured.artworkUrl600 || featured.artworkUrl100}
              alt={featured.trackName}
              className="h-44 w-44 shrink-0 rounded-2xl object-cover shadow-2xl ring-1 ring-white/15 md:h-56 md:w-56"
            />
            <div className="w-full min-w-0 flex-1 text-center md:text-left">
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">
                Featured today
              </p>
              <Marquee className="mt-1 text-3xl font-extrabold tracking-tight text-white md:text-5xl">
                {featured.trackName}
              </Marquee>
              <Marquee className="mt-2 text-white/70">{featured.artistName}</Marquee>
              <div className="mt-5 flex items-center justify-center gap-4 md:justify-start">
                <button
                  type="button"
                  onClick={() => play(featured, heroItems)}
                  className="btn-glossy inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  {featuredPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
                  {featuredPlaying ? "Pause" : "Play"}
                </button>
                {/* Rotation dots */}
                {heroItems.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    {heroItems.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setHeroIdx(i)}
                        aria-label={`Featured ${i + 1}`}
                        className={`h-1.5 rounded-full transition-all ${
                          i === heroIdx ? "w-6 bg-accent" : "w-1.5 bg-white/30 hover:bg-white/55"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass mb-6 h-56 animate-pulse rounded-3xl" />
      )}

      {/* Quick mood chips */}
      <div className="no-scrollbar -mx-4 mb-9 flex gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {MOOD_CHIPS.map((c) => (
          <button
            key={c.query}
            type="button"
            onClick={() => navigate("search", { q: c.query })}
            className="glass-glossy shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-white/75 transition hover:text-white"
          >
            {c.label}
          </button>
        ))}
      </div>

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
          <div className="mb-3">
            <h2 className="text-xl font-bold tracking-tight text-white">New Releases</h2>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-2 md:mx-0 md:px-0">
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

      {/* Because You Liked — local, account-free recommendations (hidden if no likes) */}
      <RecommendationsShelf displayedIdsRef={displayedIdsRef} />

      {/* Popular Artists (derived from shelves) */}
      <section className="mb-8">
        <div className="mb-3">
          <h2 className="text-xl font-bold tracking-tight text-white">Popular Artists</h2>
        </div>
        <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto scroll-smooth px-4 pb-2 md:mx-0 md:px-0">
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
