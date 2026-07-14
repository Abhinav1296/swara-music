import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  ListMusic,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import LikeButton from "./LikeButton";
import { formatTime } from "../utils/format";
import { buildExternalLinks, EXTERNAL_LINKS } from "../utils/externalLinks";
import { resolveActiveLine } from "../lyrics/lyrics";

/**
 * Immersive full-screen "Now Playing" view. Opens from the mini bar with a
 * smooth slide-up. Large blurred-artwork backdrop, big cover, glass transport
 * controls, seek + volume, shuffle/repeat, external "listen full song" links,
 * and a tabbed right panel with "Up Next" and a "Lyrics" view. Closing slides
 * back down to the mini bar. Rendered via portal so it covers the app.
 */
export default function FullScreenPlayer() {
  const {
    current,
    upcoming,
    isPlaying,
    progress,
    duration,
    volume,
    shuffle,
    repeat,
    fullscreen,
    isResolvingStream,
    streamError,
    lyrics,
    lyricsStatus,
    retry,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    closeFullscreen,
    play,
  } = usePlayer();

  const [rightTab, setRightTab] = useState("upnext"); // "upnext" | "lyrics"
  const containerRef = useRef(null);
  const lineRefs = useRef([]);
  // Throttle/avoid scroll spam: remember the last line we scrolled to and the
  // last time we did a smooth scroll (so we don't fire constant animations).
  const lastScrollIndexRef = useRef(-2);
  const lastScrollTimeRef = useRef(0);

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => e.key === "Escape" && closeFullscreen();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, closeFullscreen]);

  const activeIndex =
    lyrics && lyrics.kind === "timed" ? resolveActiveLine(lyrics.lines, progress) : -1;

  // Smoothly scroll the active lyric line into the vertical center. We only
  // scroll when the active line actually changes (jitter-free), and throttle
  // to at most one smooth scroll per ~250ms — rapid line changes within that
  // window get a non-animated jump so we never fall far behind or stack
  // animations. Re-runs when the lyrics tab opens so we land on the right line.
  useEffect(() => {
    if (activeIndex < 0 || !containerRef.current) return;
    const el = lineRefs.current[activeIndex];
    if (!el) return;
    if (activeIndex === lastScrollIndexRef.current) return; // no re-scroll
    const now = Date.now();
    const since = now - lastScrollTimeRef.current;
    if (since < 250) {
      el.scrollIntoView({ behavior: "auto", block: "center" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    lastScrollIndexRef.current = activeIndex;
    lastScrollTimeRef.current = now;
  }, [activeIndex, lyrics, rightTab]);

  const pct = duration ? Math.min(100, (progress / duration) * 100) : 0;
  const art = current?.artworkUrl600 || current?.artworkUrl100;
  const external = buildExternalLinks(current);
  const tabCls = (active) =>
    `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white/15 text-white" : "text-white/55 hover:text-white"
    }`;

  const playFromUpNext = (song) => {
    const context = [current, ...upcoming].filter(Boolean);
    play(song, context);
  };

  return createPortal(
    <AnimatePresence>
      {fullscreen && current && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 260, damping: 32 }}
          className="fixed inset-0 z-[80] flex flex-col overflow-hidden text-white"
          role="dialog"
          aria-modal="true"
        >
          {/* Blurred artwork backdrop */}
          <div className="absolute inset-0 -z-10">
            {art && (
              <img src={art} alt="" className="h-full w-full scale-125 object-cover blur-3xl" />
            )}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-2xl" />
          </div>

          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-4 md:px-8 md:py-6">
            <button
              type="button"
              onClick={closeFullscreen}
              aria-label="Minimize player"
              className="rounded-full bg-white/10 p-2.5 text-white/80 transition hover:bg-white/20 hover:text-white"
            >
              <ChevronDown size={22} />
            </button>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
              Now Playing
            </p>
            <button
              type="button"
              onClick={closeFullscreen}
              aria-label="Close player"
              className="rounded-full bg-white/10 p-2.5 text-white/80 transition hover:bg-white/20 hover:text-white md:hidden"
            >
              <X size={20} />
            </button>
            <span className="hidden w-10 md:block" />
          </div>

          {/* Content: art + controls (left), up next / lyrics (right on lg) */}
          <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-6 pb-10 md:flex-row md:items-center md:justify-center md:gap-14 md:px-12">
            {/* Left: artwork + transport */}
            <div className="mx-auto flex w-full max-w-md flex-col items-center">
              <div className="relative w-full max-w-[min(70vw,22rem)]">
                <motion.img
                  key={current.id}
                  initial={{ scale: 0.92, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 24 }}
                  src={art}
                  alt={current.trackName}
                  className="aspect-square w-full rounded-3xl object-cover shadow-2xl ring-1 ring-white/10"
                />
                {isResolvingStream && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-3xl bg-black/45 backdrop-blur-sm">
                    <Loader2 size={34} className="animate-spin text-white/85" />
                    <span className="text-xs font-medium text-white/80">Resolving full song…</span>
                  </div>
                )}
              </div>

              {/* Title + like */}
              <div className="mt-8 flex w-full items-center justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-extrabold tracking-tight md:text-3xl" title={current.trackName}>
                    {current.trackName}
                  </h1>
                  <p className="truncate text-base text-white/60" title={current.artistName}>
                    {current.artistName}
                  </p>
                </div>
                <LikeButton song={current} className="h-11 w-11 shrink-0 bg-white/10" size={22} />
              </div>

              {/* Seek */}
              <div className="mt-6 w-full">
                <div className="relative">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={Math.min(progress, duration || 0)}
                    onChange={(e) => seek(Number(e.target.value))}
                    aria-label="Seek preview"
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-accent"
                    style={{
                      background: `linear-gradient(to right, #fa233b ${pct}%, rgba(255,255,255,0.15) ${pct}%)`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-white/50">
                  <span>{formatTime(progress)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Transport */}
              <div className="mt-4 flex w-full items-center justify-between">
                <button
                  type="button"
                  onClick={toggleShuffle}
                  aria-label="Shuffle"
                  aria-pressed={shuffle}
                  className={`rounded-full p-2.5 transition hover:bg-white/10 ${
                    shuffle ? "text-accent" : "text-white/60 hover:text-white"
                  }`}
                >
                  <Shuffle size={20} />
                </button>
                <div className="flex items-center gap-6">
                  <button
                    type="button"
                    onClick={prev}
                    aria-label="Previous"
                    className="text-white/80 transition hover:text-white"
                  >
                    <SkipBack size={28} fill="currentColor" />
                  </button>
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-glow transition hover:scale-105"
                  >
                    {isPlaying ? (
                      <Pause size={28} fill="black" />
                    ) : (
                      <Play size={28} fill="black" className="ml-1" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    aria-label="Next"
                    className="text-white/80 transition hover:text-white"
                  >
                    <SkipForward size={28} fill="currentColor" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={cycleRepeat}
                  aria-label={`Repeat: ${repeat}`}
                  className={`rounded-full p-2.5 transition hover:bg-white/10 ${
                    repeat !== "off" ? "text-accent" : "text-white/60 hover:text-white"
                  }`}
                >
                  {repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
                </button>
              </div>

              {/* Volume */}
              <div className="mt-6 flex w-full items-center gap-3">
                <button
                  type="button"
                  onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
                  aria-label={volume > 0 ? "Mute" : "Unmute"}
                  className="text-white/60 transition hover:text-white"
                >
                  {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-accent"
                />
              </div>

              {/* External "listen full song" links (legal bridge) */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {EXTERNAL_LINKS.map(({ key, label }) => (
                  <a
                    key={key}
                    href={external[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
                  >
                    <ExternalLink size={13} /> {label}
                  </a>
                ))}
              </div>

              {/* Stream resolution status (glass error / resolving states) */}
              {streamError && upcoming.length > 0 && (
                <div className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-center text-xs text-white/70">
                  {streamError === "no_stream"
                    ? "Full song unavailable — try a link above"
                    : streamError === "not_found"
                    ? "Track not found — skipping"
                    : "Couldn’t reach the music service — skipping"}
                </div>
              )}
              {streamError && upcoming.length === 0 && (
                <div className="glass mt-3 flex flex-col items-center gap-2 rounded-2xl px-5 py-3 text-center">
                  <p className="text-sm text-white/80">
                    {streamError === "no_stream"
                      ? "Full song unavailable"
                      : streamError === "not_found"
                      ? "Track not found"
                      : "Couldn’t reach the music service"}
                  </p>
                  <p className="max-w-[16rem] text-xs text-white/40">
                    Nothing queued next — retry, or listen via a link above.
                  </p>
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-1 flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-white/25"
                  >
                    <RefreshCw size={14} /> Retry
                  </button>
                </div>
              )}
            </div>

            {/* Right: Up Next / Lyrics */}
            <div className="mx-auto flex w-full max-w-md flex-col md:h-[70vh]">
              <div className="mb-3 flex items-center gap-1 self-start rounded-full bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setRightTab("upnext")}
                  className={tabCls(rightTab === "upnext")}
                >
                  <ListMusic size={15} /> Up Next
                </button>
                <button
                  type="button"
                  onClick={() => setRightTab("lyrics")}
                  className={tabCls(rightTab === "lyrics")}
                >
                  <Mic2 size={15} /> Lyrics
                </button>
              </div>

              {rightTab === "upnext" ? (
                <div className="no-scrollbar flex-1 space-y-1 overflow-y-auto rounded-2xl">
                  {upcoming.length === 0 ? (
                    <div className="glass flex flex-col items-center gap-2 rounded-2xl py-12 text-center">
                      <Music2 size={22} className="text-white/40" />
                      <p className="text-sm text-white/50">Nothing queued next.</p>
                      <p className="max-w-[15rem] text-xs text-white/30">
                        Use “Add to Queue” on any song to line it up here.
                      </p>
                    </div>
                  ) : (
                    upcoming.map((s, i) => (
                      <button
                        key={`${s.id}-${i}`}
                        type="button"
                        onClick={() => playFromUpNext(s)}
                        className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-white/10"
                      >
                        <img
                          src={s.artworkUrl100}
                          alt=""
                          className="h-11 w-11 shrink-0 rounded-lg object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{s.trackName}</p>
                          <p className="truncate text-xs text-white/50">{s.artistName}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div ref={containerRef} className="no-scrollbar relative flex-1 overflow-y-auto rounded-2xl px-1">
                  {lyricsStatus === "loading" && (
                    <div className="space-y-3 py-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-4 animate-pulse rounded bg-white/10"
                          style={{ width: `${55 + ((i * 7) % 40)}%` }}
                        />
                      ))}
                    </div>
                  )}

                  {lyricsStatus === "available" && lyrics?.kind === "timed" && (
                    <div className="space-y-3 py-2">
                      {lyrics.lines.map((l, i) => (
                        <button
                          key={i}
                          type="button"
                          ref={(el) => (lineRefs.current[i] = el)}
                          onClick={() => seek(Math.max(0, l.time))}
                          className={`block w-full text-left text-lg leading-relaxed transition ${
                            i === activeIndex
                              ? "font-semibold text-white"
                              : "text-white/40 hover:text-white/70"
                          }`}
                        >
                          {l.text || "♪"}
                        </button>
                      ))}
                    </div>
                  )}

                  {lyricsStatus === "available" && lyrics?.kind === "plain" && (
                    <div className="space-y-3 py-2">
                      {lyrics.lines.map((l, i) => (
                        <p key={i} className="text-lg leading-relaxed text-white/70">
                          {l.text}
                        </p>
                      ))}
                    </div>
                  )}

                  {lyricsStatus === "unavailable" && (
                    <div className="glass flex h-full flex-col items-center justify-center gap-2 rounded-2xl py-12 text-center">
                      <Mic2 size={24} className="text-white/40" />
                      <p className="text-sm text-white/60">Lyrics not available</p>
                      <p className="max-w-[15rem] text-xs text-white/30">
                        No synced or plain lyrics were found for this track.
                      </p>
                    </div>
                  )}
                  {lyricsStatus === "idle" && (
                    <div className="flex h-full items-center justify-center py-12 text-center">
                      <p className="text-xs text-white/30">No track loaded.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
