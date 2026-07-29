import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";
import { useLibrary } from "./LibraryContext";
import { getSongDetails, getStream } from "../api/client";
import { normalizeLyrics, normalizeTrack } from "../utils/trackAdapter";

/**
 * Global audio player + queue.
 *
 * Model:
 *   - `current`   : the track playing now
 *   - `upcoming`  : tracks queued after `current` (Play Next inserts here)
 *   - `played`    : history before `current` (for Previous / shuffle pool)
 *
 * STREAM-FIRST ARCHITECTURE:
 *   - A single shared <audio> element plays FULL-LENGTH streams from JioSaavn.
 *   - On play, we IMMEDIATELY set `current` to the user-picked track metadata
 *     AND update `currentTrackIdRef` synchronously (optimistic UI).
 *   - Then we fire `/api/stream` FIRST (fast) with AbortController.
 *   - When `stream_url` arrives: set `audio.src`, call `audio.play()`,
 *     merge ONLY safe fields (streamUrl, durationMs) into `current` —
 *     NEVER overwrite title/artist/artwork from the user's selection.
 *   - IMMEDIATELY after starting stream, fire `/api/song-details` in background
 *     for lyrics/mood/metadata. Stale-check uses currentTrackIdRef (live) not
 *     the closure-captured `current` (fixes lyrics randomly missing bug).
 *   - `isPlaying` state STRICTLY mirrors the <audio> element via event listeners.
 *   - Prefetch planned-next uses ONLY `/api/stream`; never mutates `current`.
 *   - Retry/auto-skip scoped to `/api/stream`.
 *
 * REF-DRIVEN INVARIANTS (fixes stale-closure bugs):
 *   - `currentTrackIdRef` : live id of the current track for async stale checks.
 *   - `transportRef`      : { current, upcoming, played, shuffle, repeat } — read
 *                            inside useCallback([]) bodies to avoid stale state.
 *   - Context `value` is wrapped in useMemo so purely-presentational consumers
 *     (SongCard shelves, etc.) do not re-render on every progress tick.
 */
const PlayerContext = createContext(null);

const REPEAT_CYCLE = ["off", "all", "one"];

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const { addRecentlyPlayed } = useLibrary();

  // --- Queue state ---
  const [current, setCurrentState] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [played, setPlayed] = useState([]);

  // --- Playback state (mirrors <audio> element) ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  // --- Persisted preferences ---
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

  // --- Async resolution state ---
  const [isResolvingStream, setIsResolvingStream] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [lyrics, setLyrics] = useState(null);
  const [lyricsStatus, setLyricsStatus] = useState("idle");

  // --- Refs for stale-closure guards & coordination ---
  const transportRef = useRef({});
  transportRef.current = { current, upcoming, played, shuffle, repeat };

  const progressRef = useRef(0);
  const pendingSeekRef = useRef(null);
  const restoredRef = useRef(false);
  const resolveTokenRef = useRef(0);
  const wantPlayRef = useRef(false);

  // CRITICAL: currentTrackIdRef mirrors the LIVE current track id.
  // Updated synchronously by setCurrent() so async callbacks (especially
  // resolveLyrics) can check the true current id instead of a stale closure.
  const currentTrackIdRef = useRef(null);

  // AbortControllers for in-flight requests (per track resolution)
  const streamAbortRef = useRef(null);
  const lyricsAbortRef = useRef(null);

  // Prefetch cache for planned-next (stream-only, keyed by artist|title)
  const prefetchCacheRef = useRef(new Map());

  // Forward refs for functions defined later (avoid circular deps in useCallback)
  const goNextRef = useRef(null);
  const toggleRef = useRef(null);

  // Wrapper: always keep currentTrackIdRef in sync with setCurrent
  const setCurrent = useCallback((next) => {
    if (typeof next === "function") {
      setCurrentState((prev) => {
        const val = next(prev);
        currentTrackIdRef.current = val?.id ?? null;
        return val;
      });
    } else {
      currentTrackIdRef.current = next?.id ?? null;
      setCurrentState(next);
    }
  }, []);

  // ========================================================================
  // STREAM-FIRST: Fast stream resolution via /api/stream
  // Reads upcoming.length via transportRef (LIVE) — never stale closure.
  // ========================================================================
  const resolveStream = useCallback(async (track, autoplay) => {
    if (!track) return;
    console.log("[Swara] resolveStream entry", {
      track: track?.trackName,
      autoplay,
      currentToken: resolveTokenRef.current,
    });

    const token = (resolveTokenRef.current += 1);
    console.log("[Swara] resolveStream new token", { token });

    if (streamAbortRef.current) streamAbortRef.current.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    setIsResolvingStream(true);
    setStreamError(null);

    try {
      const streamData = await getStream({
        artist: track.artistName,
        song: track.trackName,
        url: track.jiosaavnUrl,
        signal: abortController.signal,
      });

      if (token !== resolveTokenRef.current) {
        console.log("[Swara] resolveStream stale token, aborting");
        return;
      }

      if (streamData?.status === "not_found" || !streamData?.stream_url) {
        setStreamError("not_found");
        setIsResolvingStream(false);
        // LIVE read from transportRef — auto-skip fires correctly now
        if ((transportRef.current.upcoming?.length ?? 0) > 0) {
          console.log("[Swara] stream not found, auto-skipping to next");
          goNextRef.current?.();
        }
        return;
      }

      const audio = audioRef.current;
      if (audio && streamData.stream_url) {
        if (token !== resolveTokenRef.current) {
          console.log("[Swara] resolveStream bailing before src assign (stale)");
          return;
        }

        console.log("[Swara] resolveStream assigning src", { token });

        setCurrent((prev) =>
          prev
            ? {
                ...prev,
                streamUrl: streamData.stream_url,
                durationMs: streamData.durationMs ?? prev.durationMs,
                hasFullStream: true,
              }
            : null
        );

        audio.src = streamData.stream_url;
        audio.load();

        if (autoplay && wantPlayRef.current) {
          console.log("[Swara] resolveStream PLAY", { token });
          try {
            await audio.play();
          } catch (e) {
            console.warn("[Swara] audio.play() rejected:", e);
            setIsPlaying(false);
          }
        } else {
          console.log("[Swara] resolveStream NOT playing (waiting for user)");
          setIsPlaying(false);
        }
      } else {
        setStreamError("no_stream");
        setIsPlaying(false);
      }

      setIsResolvingStream(false);
    } catch (err) {
      if (token !== resolveTokenRef.current) return;
      if (err?.name === "AbortError") {
        console.log("[Swara] resolveStream aborted");
        return;
      }
      console.warn("[Swara] stream resolve failed:", err);
      const status = err?.status;
      if (status === 429) {
        const retryAfter = Number(err?.retryAfter) || 2;
        setStreamError("rate_limited");
        setTimeout(() => {
          if (resolveTokenRef.current === token && wantPlayRef.current) {
            resolveStream(track, autoplay);
          }
        }, Math.min(retryAfter * 1000, 5000));
      } else if (status === 504 || status === 502) {
        setStreamError("upstream");
        setTimeout(() => {
          if (resolveTokenRef.current === token && wantPlayRef.current) {
            console.log("[Swara] resolveStream retry after timeout");
            resolveStream(track, autoplay);
          }
        }, 1500 + Math.random() * 1000);
      } else if (status === 404) {
        setStreamError("not_found");
        setIsResolvingStream(false);
        // LIVE read from transportRef — auto-skip fires correctly now
        if ((transportRef.current.upcoming?.length ?? 0) > 0) {
          console.log("[Swara] 404 on stream, auto-skipping");
          goNextRef.current?.();
        }
      } else {
        setStreamError("upstream");
        setIsResolvingStream(false);
      }
    }
  }, [setCurrent]);

  // ========================================================================
  // BACKGROUND: Full metadata + lyrics via /api/song-details
  // Uses currentTrackIdRef (live) NOT closure `current` to avoid stale discards.
  // ========================================================================
  const resolveLyrics = useCallback(async (track) => {
    if (!track) return;

    if (lyricsAbortRef.current) lyricsAbortRef.current.abort();
    const abortController = new AbortController();
    lyricsAbortRef.current = abortController;

    setLyricsStatus("loading");
    setLyrics(null);

    try {
      const details = await getSongDetails({
        artist: track.artistName,
        song: track.trackName,
        url: track.jiosaavnUrl,
        signal: abortController.signal,
      });

      // LIVE stale check — reads currentTrackIdRef, not stale closure
      if (currentTrackIdRef.current !== track.id) {
        console.log("[Swara] resolveLyrics stale track, discarding", {
          liveId: currentTrackIdRef.current,
          reqId: track.id,
        });
        return;
      }

      const norm = normalizeLyrics(details.lyrics);
      if (norm.kind === "unavailable") {
        setLyrics(null);
        setLyricsStatus("unavailable");
      } else {
        setLyrics(norm);
        setLyricsStatus("available");
      }

      // Merge additional metadata (but NEVER title/artist from user selection)
      setCurrent((prev) =>
        prev && prev.id === track.id
          ? {
              ...prev,
              album: details.album || prev.album,
              artwork: details.artwork || prev.artwork,
              durationMs: details.durationMs ?? prev.durationMs,
              lyricsAvailable: norm.kind !== "unavailable",
              jiosaavnUrl: details.jiosaavnUrl || prev.jiosaavnUrl,
              mood: details.mood || prev.mood,
              metadata: details.metadata || prev.metadata,
            }
          : prev
      );
    } catch (err) {
      if (err?.name === "AbortError") {
        console.log("[Swara] resolveLyrics aborted");
        return;
      }
      console.warn("[Swara] lyrics resolve failed:", err);
      if (currentTrackIdRef.current === track.id) {
        setLyricsStatus("unavailable");
        setLyrics(null);
      }
    }
  }, [setCurrent]);

  // ========================================================================
  // PREFETCH: Stream-only for planned-next track
  // ========================================================================
  const prefetchNext = useCallback((track) => {
    if (!track) return;
    const key = `${(track.artistName || "").toLowerCase()}|${(track.trackName || "").toLowerCase()}`;
    if (prefetchCacheRef.current.has(key)) return;

    console.log("[Swara] prefetchNext for", track.trackName);

    const abortController = new AbortController();
    getStream({
      artist: track.artistName,
      song: track.trackName,
      url: track.jiosaavnUrl,
      signal: abortController.signal,
    })
      .then((streamData) => {
        if (streamData?.stream_url) {
          prefetchCacheRef.current.set(key, {
            streamUrl: streamData.stream_url,
            durationMs: streamData.durationMs,
          });
          console.log("[Swara] prefetchNext cached", key);
        }
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          console.warn("[Swara] prefetchNext failed:", err);
        }
      });
  }, []);

  // ========================================================================
  // COMBINED: Main entry point for playing a track
  // Reads upcoming via transportRef (live) — never stale.
  // ========================================================================
  const resolveAndPlay = useCallback(
    (track, autoplay) => {
      if (!track) return;

      console.log("[Swara] resolveAndPlay entry", {
        track: track?.trackName,
        autoplay,
      });

      // 1. IMMEDIATELY set current (also updates currentTrackIdRef synchronously)
      setCurrent(track);

      // 2. Fire stream resolution FIRST (fast path)
      resolveStream(track, autoplay);

      // 3. Fire lyrics resolution in BACKGROUND (non-blocking)
      resolveLyrics(track);

      // 4. Prefetch planned-next if we have upcoming tracks (LIVE read)
      const nextTrack = transportRef.current.upcoming?.[0];
      if (nextTrack) {
        prefetchNext(nextTrack);
      }
    },
    [resolveStream, resolveLyrics, prefetchNext, setCurrent]
  );

  // ========================================================================
  // RESTORE: Load queue from localStorage on mount
  // ========================================================================
  useEffect(() => {
    const saved = loadJSON(STORAGE_KEYS.queue, null);
    if (saved && saved.current) {
      pendingSeekRef.current = Number.isFinite(saved.progress)
        ? saved.progress
        : null;
      setCurrent(saved.current);
      setUpcoming(Array.isArray(saved.upcoming) ? saved.upcoming : []);
      setPlayed(Array.isArray(saved.played) ? saved.played : []);
      wantPlayRef.current = false;
      // Restore triggers stream resolution but NO autoplay (browser policy)
      resolveStream(saved.current, false);
      resolveLyrics(saved.current);
    }
    restoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========================================================================
  // TRANSPORT PRIMITIVES
  // ========================================================================
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (isPlaying) {
      audio.pause();
      wantPlayRef.current = false;
    } else {
      if (!audio.src && current.streamUrl) audio.src = current.streamUrl;
      if (!audio.src) {
        resolveAndPlay(current, true);
        return;
      }
      audio.play().catch(() => {});
    }
  }, [isPlaying, current, resolveAndPlay]);
  toggleRef.current = toggle;

  const play = useCallback(
    (song, contextList = [song]) => {
      if (!song) return;
      if (current && current.id === song.id) {
        toggle();
        return;
      }
      const idx = contextList.findIndex((s) => s.id === song.id);
      const i = idx === -1 ? 0 : idx;

      if (streamAbortRef.current) streamAbortRef.current.abort();
      if (lyricsAbortRef.current) lyricsAbortRef.current.abort();

      setCurrent(song);
      setUpcoming(contextList.slice(i + 1));
      setPlayed(contextList.slice(0, i));

      transportRef.current = {
        ...transportRef.current,
        current: song,
        upcoming: contextList.slice(i + 1),
        played: contextList.slice(0, i),
      };

      wantPlayRef.current = true;
      addRecentlyPlayed(song);
      resolveAndPlay(song, true);
    },
    [current, toggle, addRecentlyPlayed, resolveAndPlay, setCurrent]
  );

  const goNext = useCallback(() => {
    const st = transportRef.current;
    const { current, upcoming, played, shuffle, repeat } = st;
    const audio = audioRef.current;
    if (!current) return;
    wantPlayRef.current = true;

    console.log("[Swara] goNext entry", { current: current?.trackName, shuffle, repeat });

    const commitQueue = (next) => {
      transportRef.current = { ...transportRef.current, ...next };
    };

    if (streamAbortRef.current) streamAbortRef.current.abort();
    if (lyricsAbortRef.current) lyricsAbortRef.current.abort();

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
      const idx = Math.floor(Math.random() * pool.length);
      const pick = pool[idx];
      const fromPlayed = idx < played.length;
      const newPlayed = fromPlayed
        ? [...played.slice(0, idx), ...played.slice(idx + 1)]
        : played;
      const newUpcoming = fromPlayed
        ? upcoming
        : [
            ...upcoming.slice(0, idx - played.length),
            ...upcoming.slice(idx - played.length + 1),
          ];
      commitQueue({ current: pick, upcoming: newUpcoming, played: newPlayed });
      setCurrent(pick);
      setPlayed(newPlayed);
      setUpcoming(newUpcoming);
      addRecentlyPlayed(pick);
      setIsPlaying(true);
      resolveAndPlay(pick, true);
      return;
    }

    if (upcoming.length > 0) {
      const [next, ...rest] = upcoming;
      commitQueue({ current: next, upcoming: rest, played: [...played, current] });
      setCurrent(next);
      setUpcoming(rest);
      setPlayed([...played, current]);
      addRecentlyPlayed(next);
      setIsPlaying(true);
      resolveAndPlay(next, true);
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
      resolveAndPlay(first, true);
    } else {
      setIsPlaying(false);
    }
  }, [addRecentlyPlayed, resolveAndPlay, setCurrent]);
  goNextRef.current = goNext;

  const goPrev = useCallback(() => {
    const st = transportRef.current;
    const { current, played, upcoming } = st;
    const audio = audioRef.current;
    if (!current) return;
    wantPlayRef.current = true;

    if (streamAbortRef.current) streamAbortRef.current.abort();
    if (lyricsAbortRef.current) lyricsAbortRef.current.abort();

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    if (played.length > 0) {
      const prevTrack = played[played.length - 1];
      const newPlayed = played.slice(0, -1);
      const newUpcoming = [current, ...upcoming];
      transportRef.current = {
        ...st,
        current: prevTrack,
        upcoming: newUpcoming,
        played: newPlayed,
      };
      setPlayed(newPlayed);
      setUpcoming(newUpcoming);
      setCurrent(prevTrack);
      addRecentlyPlayed(prevTrack);
      setIsPlaying(true);
      resolveAndPlay(prevTrack, true);
    } else if (audio) {
      audio.currentTime = 0;
      setProgress(0);
    }
  }, [addRecentlyPlayed, resolveAndPlay, setCurrent]);

  const playNext = useCallback((song) => {
    if (!song) return;
    setUpcoming((u) => [song, ...u]);
  }, []);

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
    () =>
      setRepeatState(
        (r) => REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(r) + 1) % REPEAT_CYCLE.length]
      ),
    []
  );
  const setVolume = useCallback((v) => setVolumeState(Math.min(1, Math.max(0, v))), []);
  const seek = useCallback((value) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setProgress(value);
  }, []);

  const openQueue = useCallback(() => setQueueOpen(true), []);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const toggleQueue = useCallback(() => setQueueOpen((o) => !o), []);
  const openFullscreen = useCallback(() => setFullscreen(true), []);
  const closeFullscreen = useCallback(() => setFullscreen(false), []);

  // ========================================================================
  // AUDIO ELEMENT EVENT BINDINGS — isPlaying MIRRORS <audio> STATE
  // ========================================================================
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onPlay = () => { setIsPlaying(true); setIsBuffering(false); };
    const onPlaying = () => { setIsPlaying(true); setIsBuffering(false); };
    const onPause = () => { setIsPlaying(false); setIsBuffering(false); };
    const onEnded = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      goNextRef.current?.();
    };
    const onWaiting = () => { setIsBuffering(true); };
    const onError = (e) => {
      console.error("[Swara] audio error:", e);
      setIsPlaying(false);
      setIsBuffering(false);
      setStreamError("upstream");
    };
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

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMeta);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => saveJSON(STORAGE_KEYS.volume, volume), [volume]);
  useEffect(() => saveJSON(STORAGE_KEYS.shuffle, String(shuffle)), [shuffle]);
  useEffect(() => saveJSON(STORAGE_KEYS.repeat, repeat), [repeat]);

  useEffect(() => {
    if (!restoredRef.current) return;
    saveJSON(STORAGE_KEYS.queue, {
      current,
      upcoming,
      played,
      progress: progressRef.current,
    });
  }, [current, upcoming, played]);

  useEffect(() => {
    const onUnload = () =>
      saveJSON(STORAGE_KEYS.queue, {
        current,
        upcoming,
        played,
        progress: progressRef.current,
      });
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [current, upcoming, played]);

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
      toggleRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ========================================================================
  // MEMOIZED CONTEXT VALUE — prevents tree-wide re-renders on progress ticks.
  // Only rebuilds when a listed dependency actually changes reference.
  // ========================================================================
  const value = useMemo(
    () => ({
      current,
      upcoming,
      played,
      isPlaying,
      isBuffering,
      progress,
      duration,
      volume,
      shuffle,
      repeat,
      queueOpen,
      fullscreen,
      isResolvingStream,
      streamError,
      lyrics,
      lyricsStatus,
      play,
      toggle,
      next: goNext,
      prev: goPrev,
      playNext,
      addToQueue,
      removeFromQueue,
      clearQueue,
      toggleShuffle,
      cycleRepeat,
      setVolume,
      seek,
      openQueue,
      closeQueue,
      toggleQueue,
      openFullscreen,
      closeFullscreen,
    }),
    [
      current, upcoming, played,
      isPlaying, isBuffering, progress, duration,
      volume, shuffle, repeat,
      queueOpen, fullscreen,
      isResolvingStream, streamError,
      lyrics, lyricsStatus,
      play, toggle, goNext, goPrev,
      playNext, addToQueue, removeFromQueue, clearQueue,
      toggleShuffle, cycleRepeat,
      setVolume, seek,
      openQueue, closeQueue, toggleQueue,
      openFullscreen, closeFullscreen,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="none" crossOrigin="anonymous" />
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}