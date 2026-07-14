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
import { getSongDetails } from "../api/client";
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
 */
const PlayerContext = createContext(null);

// repeat cycles: off -> all -> one -> off
const REPEAT_CYCLE = ["off", "all", "one"];

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

  // Resolve a track's full stream + synced lyrics from /api/song-details.
  // Deduplicates identical in-flight resolves, ignores stale responses when
  // the user skips quickly, and never corrupts the queue on failure.
  const resolveAndPlay = useCallback(async (track, autoplay) => {
    if (!track) return;
    // eslint-disable-next-line no-console
    console.log("[Swara] resolveAndPlay entry", {
      track: track?.trackName,
      autoplay,
      currentToken: resolveTokenRef.current,
    });
    const key = `${(track.artistName || "").toLowerCase()}|${(track.trackName || "").toLowerCase()}`;
    const token = (resolveTokenRef.current += 1);
    // eslint-disable-next-line no-console
    console.log("[Swara] resolveAndPlay new token", { token, key });

    // Dedupe: if an identical resolve is already in flight, reuse it.
    const existing = inflightRef.current.get(key);
    if (existing) {
      // eslint-disable-next-line no-console
      console.log("[Swara] resolveAndPlay dedupe hit, reusing in-flight", { key, token });
      return existing;
    }

    setIsResolvingStream(true);
    setStreamError(null);
    setLyricsStatus("loading");
    setLyrics(null);

    const run = (async () => {
      try {
        const details = await getSongDetails({
          artist: track.artistName,
          song: track.trackName,
          url: track.jiosaavnUrl || undefined,
        });
        // eslint-disable-next-line no-console
        console.log("[Swara] resolveAndPlay post-resolve token check", {
          track: track?.trackName,
          token,
          currentToken: resolveTokenRef.current,
          stale: token !== resolveTokenRef.current,
        });
        // Token guard (1 of 2): a newer resolve started while we awaited the
        // network → throw this stale response away BEFORE mutating any state.
        if (token !== resolveTokenRef.current) return;

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
          if (audio) {
            // Token guard (2 of 2): re-check RIGHT BEFORE mutating the audio
            // element. If the user skipped again during resolution we must NOT
            // clobber the now-current track's src with a stale stream URL.
            if (token !== resolveTokenRef.current) {
              // eslint-disable-next-line no-console
              console.log(
                "[Swara] resolveAndPlay bailing before src assign (stale token)",
                { token, currentToken: resolveTokenRef.current }
              );
              return;
            }
            // eslint-disable-next-line no-console
            console.log("[Swara] resolveAndPlay assigning src", {
              token,
              streamUrl: resolved.streamUrl,
            });
            audio.src = resolved.streamUrl;
            audio.load();
            if (autoplay && wantPlayRef.current) {
              // eslint-disable-next-line no-console
              console.log("[Swara] resolveAndPlay PLAY", {
                token,
                autoplay,
                wantPlay: wantPlayRef.current,
              });
              audio.play().catch(() => setIsPlaying(false));
              setIsPlaying(true);
            } else {
              // eslint-disable-next-line no-console
              console.log("[Swara] resolveAndPlay NOT playing", {
                token,
                autoplay,
                wantPlay: wantPlayRef.current,
              });
              setIsPlaying(false);
            }
          }
        } else {
          // Track resolved but no playable stream → graceful state.
          setStreamError("no_stream");
          setIsPlaying(false);
        }
      } catch (err) {
        if (token !== resolveTokenRef.current) return;
        // eslint-disable-next-line no-console
        console.warn("[Swara] stream resolve failed:", err);
        setStreamError(err?.status === 404 ? "not_found" : "upstream");
        setLyricsStatus("unavailable");
        setLyrics(null);
        setIsPlaying(false);
      } finally {
        if (token === resolveTokenRef.current) setIsResolvingStream(false);
        inflightRef.current.delete(key);
      }
    })();

    inflightRef.current.set(key, run);
    return run;
  }, []);

  // Restore queue + current track from a previous session (best effort).
  // We load stream + lyrics for the restored track but do NOT autoplay
  // (browsers block it; the user resumes by pressing play).
  useEffect(() => {
    const saved = loadJSON(STORAGE_KEYS.queue, null);
    if (saved && saved.current) {
      pendingSeekRef.current = Number.isFinite(saved.progress) ? saved.progress : null;
      setCurrent(saved.current);
      setUpcoming(Array.isArray(saved.upcoming) ? saved.upcoming : []);
      setPlayed(Array.isArray(saved.played) ? saved.played : []);
      wantPlayRef.current = false;
      resolveAndPlay(saved.current, false);
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
      setCurrent(song);
      setUpcoming(contextList.slice(i + 1));
      setPlayed(contextList.slice(0, i));
      // Sync synchronously so a rapid next/prev fired before re-render reads
      // the freshly-started queue instead of the previous snapshot.
      transportRef.current = {
        ...transportRef.current,
        current: song,
        upcoming: contextList.slice(i + 1),
        played: contextList.slice(0, i),
      };
      setIsPlaying(true);
      wantPlayRef.current = true;
      addRecentlyPlayed(song);
      resolveAndPlay(song, true);
    },
    [current, toggle, addRecentlyPlayed, resolveAndPlay]
  );

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

    // eslint-disable-next-line no-console
    console.log("[Swara] goNext entry", {
      current: current?.trackName,
      upcoming: upcoming.map((t) => t.trackName),
      played: played.map((t) => t.trackName),
      shuffle,
      repeat,
    });

    // Commit a new queue snapshot into transportRef synchronously so the very
    // next goNext/goPrev call (fired before React re-renders) reads it fresh.
    const commitQueue = (next) => {
      transportRef.current = { ...transportRef.current, ...next };
    };

    if (repeat === "one") {
      // eslint-disable-next-line no-console
      console.log("[Swara] goNext repeat=one, restarting current");
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
      // eslint-disable-next-line no-console
      console.log("[Swara] goNext shuffle pick", pick?.trackName);
      commitQueue({ current: pick, upcoming: newUpcoming, played: newPlayed });
      setCurrent(pick);
      setPlayed(newPlayed);
      setUpcoming(newUpcoming);
      addRecentlyPlayed(pick);
      setIsPlaying(true);
      resolveAndPlay(pick, true);
      return;
    }

    // Sequential
    if (upcoming.length > 0) {
      const [next, ...rest] = upcoming;
      // eslint-disable-next-line no-console
      console.log("[Swara] goNext sequential pick", next?.trackName);
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
      // eslint-disable-next-line no-console
      console.log("[Swara] goNext repeat=all wrap to", first?.trackName);
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
  }, [addRecentlyPlayed, resolveAndPlay]);

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

    // eslint-disable-next-line no-console
    console.log("[Swara] goPrev entry", {
      current: current?.trackName,
      upcoming: upcoming.map((t) => t.trackName),
      played: played.map((t) => t.trackName),
    });

    if (audio && audio.currentTime > 3) {
      // eslint-disable-next-line no-console
      console.log("[Swara] goPrev restarting current (>3s in)");
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    if (played.length > 0) {
      const prevTrack = played[played.length - 1];
      const newPlayed = played.slice(0, -1);
      const newUpcoming = [current, ...upcoming];
      // eslint-disable-next-line no-console
      console.log("[Swara] goPrev pick", prevTrack?.trackName);
      // Sync immediately so a rapid next/prev sees the fresh queue.
      transportRef.current = { ...st, current: prevTrack, upcoming: newUpcoming, played: newPlayed };
      setPlayed(newPlayed);
      setUpcoming(newUpcoming);
      setCurrent(prevTrack);
      addRecentlyPlayed(prevTrack);
      setIsPlaying(true);
      resolveAndPlay(prevTrack, true);
    } else if (audio) {
      // eslint-disable-next-line no-console
      console.log("[Swara] goPrev no history, restarting current");
      audio.currentTime = 0;
      setProgress(0);
    }
  }, [addRecentlyPlayed, resolveAndPlay]);

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
    openFullscreen: () => setFullscreen(true),
    closeFullscreen: () => setFullscreen(false),
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
