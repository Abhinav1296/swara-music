import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";
import { useLibrary } from "./LibraryContext";
import { getRelated, getSongDetails } from "../api/client";
import { normalizeLyrics, normalizeTrack } from "../utils/trackAdapter";

/**
 * Global audio player + queue.
 *
 * Model:
 *   - `current`   : the track playing now
 *   - `upcoming`  : tracks queued after `current` (Play Next inserts here)
 *   - `played`    : history before `current` (for Previous / shuffle pool)
 *
 * Streaming model (post-Lyrica migration):
 *   - A single shared <audio> element plays FULL-LENGTH streams resolved from
 *     Lyrica/JioSaavn (no more 30s iTunes previews).
 *   - On play, we optimistically show the track metadata, then asynchronously
 *     resolve the stream + synced lyrics via GET /api/song-details. The player
 *     shows a resolving state and only begins playback once the stream URL is
 *     in hand. No auth, no full-track server storage — queue/likes/prefs live
 *     in localStorage. Shuffle / repeat / volume persist.
 *
 * Robustness layer (this phase):
 *   - In-flight /api/song-details resolves are cancellable via AbortController,
 *     so a fast skip never lets a stale stream clobber the new track.
 *   - 504/timeout is retried once, then auto-skips to the next track (if any).
 *   - 404 / not-found auto-skips to the next track (if any).
 *   - The planned-next track is prefetched (separate low-priority requests) so
 *     auto-advance is instant most of the time; in shuffle mode the planned-next
 *     pick is decided ONCE and reused (no reroll at the end of a track).
 */
const PlayerContext = createContext(null);

// repeat cycles: off -> all -> one -> off
const REPEAT_CYCLE = ["off", "all", "one"];

/** Stable identity key for a track (lowercased artist|title). */
function trackKey(track) {
  return `${(track?.artistName || "").toLowerCase()}|${(track?.trackName || "").toLowerCase()}`;
}

/** Promise-based delay helper. */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pick a random element from a list, or null if empty. */
function pickFromPool(pool) {
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const { addRecentlyPlayed } = useLibrary();

  const [current, setCurrent] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [played, setPlayed] = useState([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // seconds
  const [duration, setDuration] = useState(0); // seconds

  const [volume, setVolumeState] = useState(() =>
    Number(loadJSON(STORAGE_KEYS.volume, 0.8))
  );
  const [shuffle, setShuffleState] = useState(() =>
    Boolean(loadJSON(STORAGE_KEYS.shuffle, false))
  );
  const [repeat, setRepeatState] = useState(() =>
    loadJSON(STORAGE_KEYS.repeat, "off")
  );
  const [queueOpen, setQueueOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // --- Async stream resolution state ---
  const [isResolvingStream, setIsResolvingStream] = useState(false);
  // streamError: null | "no_stream" | "not_found" | "upstream"
  const [streamError, setStreamError] = useState(null);
  const [lyrics, setLyrics] = useState(null);
  // lyricsStatus: "idle" | "loading" | "available" | "unavailable"
  const [lyricsStatus, setLyricsStatus] = useState("idle");

  // Ref mirroring the latest transport state so the (stable) `ended`
  // handler never reads stale closures.
  const transportRef = useRef({});
  transportRef.current = { current, upcoming, played, shuffle, repeat };

  // --- Queue persistence -------------------------------------------------
  const progressRef = useRef(0);
  const pendingSeekRef = useRef(null);
  const restoredRef = useRef(false);
  const resolveTokenRef = useRef(0);
  const inflightRef = useRef(new Map());
  // Desired play state, so a quick pause during async resolve is respected.
  const wantPlayRef = useRef(false);

  // --- Robustness primitives ---------------------------------------------
  // AbortController for the ACTIVE *play* resolve. A new resolve (skip/next)
  // aborts the previous one so a stale stream URL can never clobber the new
  // track. Prefetch requests use their OWN controllers (see prefetchTrack).
  const abortControllerRef = useRef(null);
  // In-memory prefetch cache: key -> { song, lyrics } ready to apply.
  const prefetchCacheRef = useRef(new Map());
  // Count of in-flight prefetches (capped so we never hog the network).
  const prefetchInflightRef = useRef(0);
  const prefetchControllersRef = useRef(new Set());
  // In shuffle mode, the pre-decided next track (reused on ended/next so the
  // shuffle pointer never rerolls mid-list).
  const plannedNextRef = useRef(null);
  // When a caller asks to open the full-screen player on a specific tab
  // (e.g. "lyrics" | "upnext"), stash the requested tab here so
  // FullScreenPlayer can honor it on open without forcing a re-render.
  const pendingTabRef = useRef(null);

  // Resolve a track's full stream + synced lyrics from /api/song-details.
  // Deduplicates identical in-flight resolves, ignores stale responses when
  // the user skips quickly, aborts the previous resolve on a new one, retries
  // a 504 once, and auto-skips on 404 / failed-timeout when a next track
  // exists. Never corrupts the queue on failure.
  const resolveAndPlay = useCallback(async (track, autoplay) => {
    if (!track) return;
    const key = trackKey(track);
    const existing = inflightRef.current.get(key);
    if (existing) return existing; // reuse identical in-flight resolve

    const token = (resolveTokenRef.current += 1);

    // Cancel any in-flight *play* resolve (a skip/next supersedes it) and start
    // a fresh controller for THIS track. Prefetch controllers are separate.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsResolvingStream(true);
    setStreamError(null);
    setLyricsStatus("loading");
    setLyrics(null);

    const applySuccess = (details) => {
      const resolved = normalizeTrack(details);
      // Preserve the originally-clicked track's id so likes/queue identity
      // stays stable (e.g. old iTunes-era numeric ids vs new Lyrica slugs).
      setCurrent({ ...resolved, id: track.id });

      const norm = normalizeLyrics(details.lyrics);
      if (norm.kind === "unavailable") {
        setLyrics(null);
        setLyricsStatus("unavailable");
      } else {
        setLyrics(norm);
        setLyricsStatus("available");
      }

      if (resolved.streamUrl) {
        const audio = audioRef.current;
        if (!audio) return;
        // Token guard: a newer resolve started while we awaited the network
        // (or a retry delay elapsed) → don't clobber the current track's src.
        if (token !== resolveTokenRef.current) return;
        audio.src = resolved.streamUrl;
        audio.load();
        if (autoplay && wantPlayRef.current) {
          audio.play().catch(() => setIsPlaying(false));
          setIsPlaying(true);
        } else {
          setIsPlaying(false);
        }
      } else {
        // Track resolved but no playable stream → graceful state.
        setStreamError("no_stream");
        setIsPlaying(false);
      }
    };

    const run = (async () => {
      const attempt = async (n) => {
        try {
          const details = await getSongDetails({
            artist: track.artistName,
            song: track.trackName,
            url: track.jiosaavnUrl || undefined,
            signal: controller.signal,
          });
          // Token guard: a newer resolve started while we awaited the
          // network → throw this stale response away BEFORE mutating state.
          if (token !== resolveTokenRef.current) return;
          applySuccess(details);
        } catch (err) {
          if (token !== resolveTokenRef.current) return;
          if (err?.name === "AbortError") {
            // Benign cancel (user skipped before resolve finished). Never show
            // an error for this — just bail.
            // eslint-disable-next-line no-console
            console.log("[Swara] resolve aborted");
            return;
          }
          const status = err?.status;
          const msg = err?.message || "";
          const isTimeout = status === 504 || /timed out/i.test(msg);
          const isNotFound = status === 404 || /not found/i.test(msg);

          if (isTimeout && n === 0) {
            // Retry a 504 / upstream timeout ONCE after a short backoff,
            // respecting the same token guard (a newer resolve aborts us).
            // eslint-disable-next-line no-console
            console.log("[Swara] 504/timeout — retrying once", {
              track: track?.trackName,
              token,
            });
            await delay(1500 + Math.random() * 1000);
            if (token !== resolveTokenRef.current) return;
            return attempt(1);
          }

          // Definitive failure → graceful error state.
          setStreamError(isNotFound ? "not_found" : "upstream");
          setLyricsStatus("unavailable");
          setLyrics(null);
          setIsPlaying(false);

          const hasUpcoming = (transportRef.current.upcoming || []).length > 0;
          if (hasUpcoming) {
            // Auto-advance: don't strand the user on a dead track.
            // eslint-disable-next-line no-console
            console.log("[Swara] resolve failed with upcoming → auto-skip", {
              track: track?.trackName,
              reason: isNotFound ? "not_found" : "upstream",
            });
            goNextRef.current();
          }
        }
      };
      await attempt(0);
    })();

    inflightRef.current.set(key, run);
    run.finally(() => {
      if (token === resolveTokenRef.current) setIsResolvingStream(false);
      inflightRef.current.delete(key);
    });
    return run;
  }, []);

  // Apply a prefetched track immediately (no network wait). Returns true if a
  // prefetch was found and applied. Cancels any in-flight play resolve first.
  const applyPrefetched = useCallback((track, autoplay) => {
    const key = trackKey(track);
    const cached = prefetchCacheRef.current.get(key);
    if (!cached) return false;

    // Switching tracks: cancel any in-flight *play* resolve so a stale stream
    // URL can't clobber this one. Prefetch requests use their own controllers.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    // Bump the token so any late resolve for the previous track is ignored.
    resolveTokenRef.current += 1;

    setCurrent({ ...cached.song, id: track.id });
    if (cached.lyrics.kind === "unavailable") {
      setLyrics(null);
      setLyricsStatus("unavailable");
    } else {
      setLyrics(cached.lyrics);
      setLyricsStatus("available");
    }
    setStreamError(null);
    setIsResolvingStream(false);

    const audio = audioRef.current;
    if (audio && cached.song.streamUrl) {
      audio.src = cached.song.streamUrl;
      audio.load();
      if (autoplay) {
        audio.play().catch(() => setIsPlaying(false));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    } else {
      setStreamError("no_stream");
      setIsPlaying(false);
    }
    return true;
  }, []);

  // Low-priority prefetch of a single track (own controller, capped in-flight).
  const prefetchTrack = useCallback((track) => {
    const key = trackKey(track);
    if (prefetchCacheRef.current.has(key)) return;
    if (prefetchInflightRef.current >= 2) return;
    prefetchInflightRef.current += 1;

    const controller = new AbortController();
    prefetchControllersRef.current.add(controller);

    const start = async () => {
      try {
        const details = await getSongDetails({
          artist: track.artistName,
          song: track.trackName,
          url: track.jiosaavnUrl || undefined,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          // Cache the normalized shape so applyPrefetched can use it directly.
          prefetchCacheRef.current.set(key, {
            song: normalizeTrack(details),
            lyrics: normalizeLyrics(details.lyrics),
          });
        }
      } catch {
        // Prefetch failures are silent — the track will resolve on demand.
      } finally {
        prefetchInflightRef.current -= 1;
        prefetchControllersRef.current.delete(controller);
      }
    };
    start();
  }, []);

  // Schedule a prefetch for the next planned track (low priority). Uses
  // `plannedNextRef` in shuffle mode so we prefetch the SAME track we'll play.
  const schedulePrefetch = useCallback(() => {
    const st = transportRef.current;
    let nextTrack = null;
    if (st.shuffle) {
      nextTrack = plannedNextRef.current;
    } else if (st.upcoming && st.upcoming.length > 0) {
      nextTrack = st.upcoming[0];
    }
    if (!nextTrack) return;
    // Capture the current track id so we can skip the prefetch if the user has
    // since skipped/advanced (don't prefetch for a stale plan).
    const currentIdAtPlan = st.current?.id;
    // Delay so the prefetch doesn't compete with the current track's resolve.
    const d = 600 + Math.random() * 400; // 600–1000ms
    setTimeout(() => {
      const live = transportRef.current;
      // Queue advanced past this plan → don't fire a pointless prefetch.
      if (currentIdAtPlan != null && live.current?.id !== currentIdAtPlan) return;
      if (!prefetchCacheRef.current.has(trackKey(nextTrack))) {
        prefetchTrack(nextTrack);
      }
    }, d);
  }, [prefetchTrack]);

  // --- Autoplay-continuation ("radio") -----------------------------------
  // A short list (e.g. a 4-5 song "Featured Today") used to dead-end: once
  // `upcoming` drained, goNext hit setIsPlaying(false) and playback just
  // stopped. Now, when the queue runs low AND the user hasn't asked to loop
  // (repeat "off"), we fetch songs related to the current track and append
  // them — an endless catalog "radio" so playback never dead-stops.
  //
  // Guards: at most ONE fetch per current song (lastExtendSeedRef), no
  // concurrent fetches (extendInflightRef), and every result is de-duped
  // against the whole session (current + upcoming + played) so we never queue
  // a song already heard or waiting. Best-effort — a failure just lets the
  // queue end as before.
  const LOW_WATER = 2; // top up once the pool is down to ≤2 songs of runway
  const RADIO_BATCH = 20;
  const extendInflightRef = useRef(false);
  const lastExtendSeedRef = useRef(null);

  const extendQueueIfLow = useCallback(async () => {
    const st = transportRef.current;
    const { current, upcoming, played, shuffle, repeat } = st;
    if (!current) return;
    if (repeat !== "off") return; // "all"/"one" loop by design — no radio
    // The pool goNext will draw from: shuffle can revisit `played` too.
    const poolCount = shuffle ? played.length + upcoming.length : upcoming.length;
    if (poolCount > LOW_WATER) return;
    if (extendInflightRef.current) return;
    if (lastExtendSeedRef.current === current.id) return; // one attempt / song
    lastExtendSeedRef.current = current.id;
    extendInflightRef.current = true;
    try {
      const { results } = await getRelated({
        id: current.id,
        artist: current.artistName,
        movie: current.collectionName,
        url: current.jiosaavnUrl,
        limit: RADIO_BATCH,
      });
      // De-dupe against everything already in the session (by id AND by
      // artist|title key) so the radio never repeats what's already queued.
      const live = transportRef.current;
      const known = [live.current, ...live.upcoming, ...live.played].filter(Boolean);
      const seenIds = new Set(known.map((t) => t.id));
      const seenKeys = new Set(known.map(trackKey));
      const fresh = (results || []).filter(
        (t) => t && !seenIds.has(t.id) && !seenKeys.has(trackKey(t))
      );
      if (fresh.length) setUpcoming((u) => [...u, ...fresh]);
    } catch {
      // Radio is best-effort; on failure the queue simply ends as before.
    } finally {
      extendInflightRef.current = false;
    }
  }, []);

  // Watch the queue and top it up just before it runs dry. Fires on song
  // change and whenever the pool shrinks; the guards above keep it to one
  // effective fetch per low-water crossing.
  useEffect(() => {
    extendQueueIfLow();
  }, [current, upcoming.length, played.length, shuffle, repeat, extendQueueIfLow]);

  // Restore queue + current track from a previous session (best effort).
  // We load stream + lyrics for the restored track but do NOT autoplay
  // (browsers block it; the user resumes by pressing play).
  useEffect(() => {
    const saved = loadJSON(STORAGE_KEYS.queue, null);
    if (saved && saved.current) {
      const newUp = Array.isArray(saved.upcoming) ? saved.upcoming : [];
      const newPlayed = Array.isArray(saved.played) ? saved.played : [];
      pendingSeekRef.current = Number.isFinite(saved.progress) ? saved.progress : null;
      setCurrent(saved.current);
      setUpcoming(newUp);
      setPlayed(newPlayed);
      // Sync the transport mirror NOW so schedulePrefetch sees the restored
      // queue (not the empty initial state).
      transportRef.current = {
        ...transportRef.current,
        current: saved.current,
        upcoming: newUp,
        played: newPlayed,
      };
      wantPlayRef.current = false;
      if (shuffle) plannedNextRef.current = pickFromPool([...newPlayed, ...newUp]);
      else plannedNextRef.current = null;
      resolveAndPlay(saved.current, false);
      schedulePrefetch();
    }
    restoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Transport primitives ------------------------------------------------

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (isPlaying) {
      audio.pause();
      wantPlayRef.current = false;
      setIsPlaying(false);
    } else {
      // Ensure the audio element has a source, then play.
      if (!audio.src && current.streamUrl) audio.src = current.streamUrl;
      if (!audio.src) {
        // No source yet (still resolving) — kick off resolution + play.
        resolveAndPlay(current, true);
        return;
      }
      audio.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [isPlaying, current, resolveAndPlay]);

  /** Play a track, treating `contextList` as the active playlist order. */
  const play = useCallback(
    (song, contextList = [song]) => {
      if (!song) return;
      if (current && current.id === song.id) {
        toggle();
        return;
      }
      const idx = contextList.findIndex((s) => s.id === song.id);
      const i = idx === -1 ? 0 : idx;
      const newUpcoming = contextList.slice(i + 1);
      const newPlayed = contextList.slice(0, i);
      setCurrent(song);
      setUpcoming(newUpcoming);
      setPlayed(newPlayed);
      // Sync synchronously so a rapid next/prev fired before re-render reads
      // the freshly-started queue instead of the previous snapshot.
      transportRef.current = {
        ...transportRef.current,
        current: song,
        upcoming: newUpcoming,
        played: newPlayed,
      };
      setIsPlaying(true);
      wantPlayRef.current = true;
      addRecentlyPlayed(song);
      // Plan the shuffle pointer (decided once, reused until this track ends).
      plannedNextRef.current = shuffle ? pickFromPool([...newPlayed, ...newUpcoming]) : null;
      // Apply a prefetched copy instantly if we have one; else resolve.
      if (!applyPrefetched(song, true)) resolveAndPlay(song, true);
      schedulePrefetch();
    },
    [current, toggle, addRecentlyPlayed, resolveAndPlay, applyPrefetched, schedulePrefetch, shuffle]
  );

  /** Re-resolve the current track after a definitive failure (Retry button). */
  const retry = useCallback(() => {
    if (!current) return;
    setStreamError(null);
    resolveAndPlay(current, true);
  }, [current, resolveAndPlay]);

  /** Advance to the next track, honoring repeat / shuffle. */
  const goNext = useCallback(() => {
    // Read the freshest queue from transportRef (mirrored every render). We also
    // re-sync transportRef synchronously below whenever we mutate the queue, so
    // two rapid skips fired before a re-render still see fresh state instead of
    // the same stale snapshot (which previously caused "plays previous song").
    const st = transportRef.current;
    const { current, upcoming, played, shuffle, repeat } = st;
    const audio = audioRef.current;
    if (!current) return;
    wantPlayRef.current = true;

    // Commit a new queue snapshot into transportRef synchronously so the very
    // next goNext/goPrev call (fired before React re-renders) reads it fresh.
    const commitQueue = (next) => {
      transportRef.current = { ...transportRef.current, ...next };
    };

    if (repeat === "one") {
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      setIsPlaying(true);
      return;
    }

    if (shuffle) {
      const pool = [...played, ...upcoming];
      if (pool.length === 0) {
        if (repeat === "all" && audio) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
          setIsPlaying(true);
        } else {
          setIsPlaying(false);
        }
        return;
      }
      // Use the pre-decided planned-next (shuffle-safe), falling back to a fresh
      // roll only if it's gone from the pool (e.g. user edited the queue).
      let pick = plannedNextRef.current || pickFromPool(pool);
      if (!pick || pool.indexOf(pick) === -1) pick = pickFromPool(pool);
      const pIdx = pool.indexOf(pick);
      const fromPlayed = pIdx < played.length;
      const newPlayed = fromPlayed
        ? [...played.slice(0, pIdx), ...played.slice(pIdx + 1)]
        : played;
      const newUpcoming = fromPlayed
        ? upcoming
        : [
            ...upcoming.slice(0, pIdx - played.length),
            ...upcoming.slice(pIdx - played.length + 1),
          ];
      commitQueue({ current: pick, upcoming: newUpcoming, played: newPlayed });
      setCurrent(pick);
      setPlayed(newPlayed);
      setUpcoming(newUpcoming);
      addRecentlyPlayed(pick);
      setIsPlaying(true);
      // Decide the NEXT planned track now (so ended/next reuses it, no reroll).
      plannedNextRef.current = pickFromPool([...newPlayed, ...newUpcoming]);
      if (!applyPrefetched(pick, true)) resolveAndPlay(pick, true);
      schedulePrefetch();
      return;
    }

    // Sequential
    if (upcoming.length > 0) {
      const [next, ...rest] = upcoming;
      commitQueue({ current: next, upcoming: rest, played: [...played, current] });
      setCurrent(next);
      setUpcoming(rest);
      setPlayed([...played, current]);
      addRecentlyPlayed(next);
      setIsPlaying(true);
      if (!applyPrefetched(next, true)) resolveAndPlay(next, true);
      schedulePrefetch();
    } else if (repeat === "all") {
      const all = [...played, current];
      if (all.length <= 1) {
        setIsPlaying(false);
        return;
      }
      const [first, ...rest] = all;
      commitQueue({ current: first, upcoming: rest, played: [] });
      setCurrent(first);
      setUpcoming(rest);
      setPlayed([]);
      addRecentlyPlayed(first);
      setIsPlaying(true);
      if (!applyPrefetched(first, true)) resolveAndPlay(first, true);
      schedulePrefetch();
    } else {
      setIsPlaying(false);
    }
  }, [addRecentlyPlayed, resolveAndPlay, applyPrefetched, schedulePrefetch]);

  // Refs for the (stable) ended handler and keyboard shortcut.
  const toggleRef = useRef(null);
  toggleRef.current = toggle;
  const goNextRef = useRef(null);
  goNextRef.current = goNext;

  /** Go back (restart current if >3s in, else previous track). */
  const goPrev = useCallback(() => {
    // Read freshest queue; re-sync synchronously below on mutation (see goNext).
    const st = transportRef.current;
    const { current, played, upcoming } = st;
    const audio = audioRef.current;
    if (!current) return;
    wantPlayRef.current = true;

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    if (played.length > 0) {
      const prevTrack = played[played.length - 1];
      const newPlayed = played.slice(0, -1);
      const newUpcoming = [current, ...upcoming];
      // Sync immediately so a rapid next/prev sees the fresh queue.
      transportRef.current = { ...st, current: prevTrack, upcoming: newUpcoming, played: newPlayed };
      setPlayed(newPlayed);
      setUpcoming(newUpcoming);
      setCurrent(prevTrack);
      addRecentlyPlayed(prevTrack);
      setIsPlaying(true);
      if (!applyPrefetched(prevTrack, true)) resolveAndPlay(prevTrack, true);
      schedulePrefetch();
    } else if (audio) {
      audio.currentTime = 0;
      setProgress(0);
    }
  }, [addRecentlyPlayed, resolveAndPlay, applyPrefetched, schedulePrefetch]);

  /** Insert a track right after the current one. */
  const playNext = useCallback((song) => {
    if (!song) return;
    setUpcoming((u) => [song, ...u]);
  }, []);

  /** Append a track to the end of the queue. */
  const addToQueue = useCallback((song) => {
    if (!song) return;
    setUpcoming((u) => [...u, song]);
  }, []);

  const removeFromQueue = useCallback((index) => {
    setUpcoming((u) => u.filter((_, i) => i !== index));
  }, []);

  const clearQueue = useCallback(() => setUpcoming([]), []);

  const toggleShuffle = useCallback(() => setShuffleState((s) => !s), []);
  const cycleRepeat = useCallback(
    () => setRepeatState((r) => REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(r) + 1) % REPEAT_CYCLE.length]),
    []
  );
  const setVolume = useCallback((v) => setVolumeState(Math.min(1, Math.max(0, v))), []);
  const seek = useCallback((value) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setProgress(value);
  }, []);

  // --- Audio element wiring ------------------------------------------------

  // Wire up transport events once.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTimeUpdate = () => {
      progressRef.current = audio.currentTime;
      setProgress(audio.currentTime);
    };
    const onLoadedMeta = () => {
      setDuration(audio.duration || 0);
      if (pendingSeekRef.current != null) {
        try {
          audio.currentTime = pendingSeekRef.current;
          setProgress(pendingSeekRef.current);
        } catch {
          /* seek before ready — ignore */
        }
        pendingSeekRef.current = null;
      }
    };
    const onEnded = () => {
      // eslint-disable-next-line no-console
      console.log("[Swara] onEnded fired → goNext (via goNextRef)");
      goNextRef.current();
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMeta);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  // Keep the audio element's volume in sync.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Persist player preferences.
  useEffect(() => saveJSON(STORAGE_KEYS.volume, volume), [volume]);
  useEffect(() => saveJSON(STORAGE_KEYS.shuffle, String(shuffle)), [shuffle]);
  useEffect(() => saveJSON(STORAGE_KEYS.repeat, repeat), [repeat]);

  // Persist the queue (best effort) whenever it changes — gated until the
  // initial restore has run so we never overwrite storage with an empty queue.
  useEffect(() => {
    if (!restoredRef.current) return;
    saveJSON(STORAGE_KEYS.queue, { current, upcoming, played, progress: progressRef.current });
  }, [current, upcoming, played]);

  // Capture the latest position on unload (progress ticks are too frequent to
  // persist on every change).
  useEffect(() => {
    const onUnload = () =>
      saveJSON(STORAGE_KEYS.queue, { current, upcoming, played, progress: progressRef.current });
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [current, upcoming, played]);

  // Space = play/pause, but skip when a field/control is focused so its
  // native Space activation wins (avoids double-toggling).
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Space") return;
      const t = e.target;
      const tag = t?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "BUTTON" ||
        tag === "A" ||
        t?.isContentEditable
      )
        return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = {
    current,
    upcoming,
    played,
    isPlaying,
    progress,
    duration,
    volume,
    shuffle,
    repeat,
    queueOpen,
    fullscreen,
    // async stream resolution
    isResolvingStream,
    streamError,
    lyrics,
    lyricsStatus,
    play,
    toggle,
    next: goNext,
    prev: goPrev,
    retry,
    playNext,
    addToQueue,
    removeFromQueue,
    clearQueue,
    toggleShuffle,
    cycleRepeat,
    setVolume,
    seek,
    openQueue: () => setQueueOpen(true),
    closeQueue: () => setQueueOpen(false),
    toggleQueue: () => setQueueOpen((o) => !o),
    // Open the full-screen player, optionally on a specific right-panel tab
    // ("upnext" | "lyrics"). The tab request is read once on open.
    openFullscreen: (tab) => {
      if (tab) pendingTabRef.current = tab;
      setFullscreen(true);
    },
    closeFullscreen: () => setFullscreen(false),
    // Read by FullScreenPlayer on open to honor a requested initial tab.
    pendingTabRef,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {/* The single shared audio element for full-length streams. */}
      <audio ref={audioRef} preload="none" crossOrigin="anonymous" />
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
