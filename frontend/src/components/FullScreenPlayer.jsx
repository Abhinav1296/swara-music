import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Layers,
  ListMusic,
  Loader2,
  MessageSquareQuote,
  Mic2,
  Music2,
  Pause,
  Play,
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
import { useRouter } from "../context/RouterContext";
import LikeButton from "./LikeButton";
import { formatTime } from "../utils/format";
import { resolveActiveLine } from "../lyrics/lyrics";
import SyncedLyrics from "./SyncedLyrics";
import TrackMenu from "./TrackMenu";
import LyricVersions from "./LyricVersions";
import { pushBackHandler } from "../utils/backStack";

/**
 * Immersive full-screen "Now Playing" view. Opens from the mini bar with a
 * smooth slide-up. Large blurred-artwork backdrop, big cover, glass transport
 * controls, seek + volume, shuffle/repeat, and a tabbed right panel with
 * "Up Next" and a "Lyrics" view. Closing slides back down to the mini bar.
 * Rendered via portal so it covers the app.
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
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    closeFullscreen,
    play,
    retry,
    pendingTabRef,
  } = usePlayer();
  const { route, navigate } = useRouter();

  const [rightPanel, setRightPanel] = useState("none"); // "none" | "lyrics" | "upnext"
  const togglePanel = (p) => setRightPanel((cur) => (cur === p ? "none" : p));
  const [lyricScript, setLyricScript] = useState("telugu"); // "telugu" | "roman"
  const [versionsOpen, setVersionsOpen] = useState(false);
  // A version the listener picked to view instead of the default (normalized
  // lyrics + its label). Null = show the backend's default lyrics.
  const [overrideLyrics, setOverrideLyrics] = useState(null);
  const [overrideLabel, setOverrideLabel] = useState(null);

  // Swipe the cover art left/right to move to the next / previous track (the
  // Apple-Music gesture). Anchored to the artwork only, so the seek and volume
  // sliders — also horizontal drags — are never mistaken for a track swipe.
  const coverTouch = useRef(null);
  const onCoverTouchStart = (e) => {
    const t = e.touches[0];
    coverTouch.current = { x: t.clientX, y: t.clientY };
  };
  const onCoverTouchEnd = (e) => {
    const start = coverTouch.current;
    coverTouch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
  };

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => e.key === "Escape" && closeFullscreen();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, closeFullscreen]);

  // Navigating to another page while the player is open (e.g. "Go to Album /
  // Artist" from the ••• menu, or tapping the artist name) must dismiss the
  // player — otherwise you land on that page hidden BEHIND the full-screen
  // overlay and think nothing happened. `navigate` makes a fresh route object
  // each call, so a reference change means a real navigation just occurred.
  const lastRouteRef = useRef(route);
  useEffect(() => {
    if (lastRouteRef.current === route) return undefined;
    lastRouteRef.current = route;
    if (fullscreen) closeFullscreen();
    return undefined;
  }, [route, fullscreen, closeFullscreen]);

  // C3 — auto-hide the transport (Apple-style). While a track is PLAYING on the
  // pure artwork view, the top bar + controls fade after a few seconds of
  // stillness; any tap brings them back (and restarts the countdown). When
  // paused or with a lyrics/up-next panel open, controls always stay put.
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef(null);
  const canAutoHide = fullscreen && isPlaying && rightPanel === "none";
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (canAutoHide) hideTimer.current = setTimeout(() => setControlsVisible(false), 3800);
  }, [canAutoHide]);
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!canAutoHide) {
      setControlsVisible(true);
      return undefined;
    }
    setControlsVisible(true);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3800);
    return () => hideTimer.current && clearTimeout(hideTimer.current);
  }, [canAutoHide, current?.id]);
  const controlsFadeCls = `transition-opacity duration-500 ${
    controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  // Every time the player opens, land on the artwork/player view — unless a
  // specific panel was requested via openFullscreen(tab). This also clears a
  // panel left open from a previous session so reopening never starts on lyrics.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const t = pendingTabRef?.current;
    setRightPanel(t || "none");
    pendingTabRef.current = null;
    return undefined;
  }, [fullscreen, pendingTabRef]);

  // Reset per-track lyric UI state (script, chosen version, open picker).
  useEffect(() => {
    setLyricScript("telugu");
    setOverrideLyrics(null);
    setOverrideLabel(null);
    setVersionsOpen(false);
  }, [current?.id]);

  // Android BACK: peel inner overlays before the player closes. The versions
  // picker (topmost) closes first, then the mobile lyrics/up-next sheet — so on
  // a phone, BACK from the lyrics sheet reveals the player instead of exiting
  // the whole "Now Playing" view. No-op on web (nothing runs the stack there).
  useEffect(() => {
    if (!fullscreen || !versionsOpen) return undefined;
    return pushBackHandler(() => {
      setVersionsOpen(false);
      return true;
    });
  }, [fullscreen, versionsOpen]);

  useEffect(() => {
    if (!fullscreen || rightPanel === "none") return undefined;
    return pushBackHandler(() => {
      setRightPanel("none");
      return true;
    });
  }, [fullscreen, rightPanel]);

  // What the lyrics panel actually shows: a picked version if any, else default.
  const shownLyrics = overrideLyrics || lyrics;
  const shownStatus = overrideLyrics ? "available" : lyricsStatus;

  const useVersion = (norm, label) => {
    if (!norm) return;
    setOverrideLyrics(norm);
    setOverrideLabel(label || null);
    setLyricScript("telugu");
    setVersionsOpen(false);
  };
  const resetVersion = () => {
    setOverrideLyrics(null);
    setOverrideLabel(null);
  };

  const activeIndex =
    shownLyrics && shownLyrics.kind === "timed"
      ? resolveActiveLine(shownLyrics.lines, progress)
      : -1;

  const pct = duration ? Math.min(100, (progress / duration) * 100) : 0;
  const volPct = Math.round((volume ?? 0) * 100);
  const art = current?.artworkUrl600 || current?.artworkUrl100;
  const panelBtn = (active) =>
    `flex flex-1 items-center justify-center gap-1.5 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
      active
        ? "glass-glossy text-white ring-1 ring-accent/60 shadow-glow"
        : "glass-glossy text-white/60 hover:text-white"
    }`;

  // Romanized lyrics toggle — only when the backend supplied a distinct roman
  // version. Roman has no karaoke timing, so it always renders as plain lines.
  const hasRoman = !!(shownLyrics && Array.isArray(shownLyrics.roman) && shownLyrics.roman.length);
  const showRoman = hasRoman && lyricScript === "roman";
  const scriptBtn = (active) =>
    `rounded-full px-3 py-1 text-xs font-semibold transition ${
      active ? "bg-white/15 text-white ring-1 ring-accent/50" : "text-white/50 hover:text-white/85"
    }`;

  const playFromUpNext = (song) => {
    const context = [current, ...upcoming].filter(Boolean);
    play(song, context);
  };

  // The Up Next / Lyrics body — written once, reused by the desktop side column
  // and the mobile full-screen sheet so the two never drift apart.
  const renderPanel = () =>
    rightPanel === "upnext" ? (
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
      <div className="relative flex min-h-[55vh] flex-1 flex-col md:min-h-0">
        {/* Header: Telugu/Romanized switch (left) + Versions picker (right). */}
        {shownStatus === "available" && (
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {hasRoman && (
                <>
                  <button
                    type="button"
                    onClick={() => setLyricScript("telugu")}
                    aria-pressed={!showRoman}
                    className={scriptBtn(!showRoman)}
                  >
                    తెలుగు
                  </button>
                  <button
                    type="button"
                    onClick={() => setLyricScript("roman")}
                    aria-pressed={showRoman}
                    className={scriptBtn(showRoman)}
                  >
                    Romanized
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setVersionsOpen(true)}
              className="glass-glossy flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white/70 transition hover:text-white"
            >
              <Layers size={14} /> Versions
            </button>
          </div>
        )}

        {/* Which version is showing, when it isn't the default. */}
        {overrideLabel && (
          <div className="mb-2 flex shrink-0 items-center gap-2 text-[11px] text-white/50">
            <span>
              Showing <span className="text-white/80">{overrideLabel}</span>
            </span>
            <button
              type="button"
              onClick={resetVersion}
              className="font-semibold text-accent transition hover:underline"
            >
              Reset to default
            </button>
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          {shownStatus === "loading" && (
            <div className="space-y-5 py-8">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="h-8 animate-pulse rounded-lg bg-white/10"
                  style={{ width: `${55 + ((i * 7) % 40)}%` }}
                />
              ))}
            </div>
          )}

          {/* Romanized view is always plain (no karaoke timing for roman). */}
          {shownStatus === "available" && showRoman && (
            <div className="no-scrollbar h-full space-y-4 overflow-y-auto py-6">
              {shownLyrics.roman.map((l, i) => (
                <p key={i} className="text-2xl font-semibold leading-snug text-white/80">
                  {l.text}
                </p>
              ))}
            </div>
          )}

          {shownStatus === "available" && !showRoman && shownLyrics?.kind === "timed" && (
            <SyncedLyrics
              lines={shownLyrics.lines}
              activeIndex={activeIndex}
              progress={progress}
              duration={duration}
              onSeek={seek}
            />
          )}

          {shownStatus === "available" && !showRoman && shownLyrics?.kind === "plain" && (
            <div className="no-scrollbar h-full space-y-4 overflow-y-auto py-6">
              {shownLyrics.lines.map((l, i) => (
                <p key={i} className="text-2xl font-semibold leading-snug text-white/80">
                  {l.text}
                </p>
              ))}
            </div>
          )}

          {shownStatus === "unavailable" && (
            <div className="glass flex h-full flex-col items-center justify-center gap-2 rounded-2xl py-12 text-center">
              <Mic2 size={24} className="text-white/40" />
              <p className="text-sm text-white/60">Lyrics not available</p>
              <p className="max-w-[15rem] text-xs text-white/30">
                No synced or plain lyrics were found for this track.
              </p>
            </div>
          )}
          {shownStatus === "idle" && (
            <div className="flex h-full items-center justify-center py-12 text-center">
              <p className="text-xs text-white/30">No track loaded.</p>
            </div>
          )}
        </div>
      </div>
    );

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
          onClick={revealControls}
        >
          {/* Ambient color-wash backdrop — saturated bleed from the artwork,
              darkened toward the corners (Apple's lyrics ambiance). */}
          <div className="absolute inset-0 -z-10 bg-black">
            {art && (
              <img
                src={art}
                alt=""
                className="h-full w-full scale-150 object-cover opacity-70 blur-[120px] saturate-150"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-black/55 to-black/80" />
          </div>

          {/* Top bar — fades with the transport controls (C3). */}
          <div className={`flex items-center justify-between px-4 pb-4 pt-[calc(1rem_+_env(safe-area-inset-top))] md:px-8 md:pb-6 md:pt-[calc(1.5rem_+_env(safe-area-inset-top))] ${controlsFadeCls}`}>
            <button
              type="button"
              onClick={closeFullscreen}
              aria-label="Minimize player"
              className="glass-glossy rounded-full p-2.5 text-white/80 transition hover:text-white"
            >
              <ChevronDown size={22} />
            </button>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
              Now Playing
            </p>
            <TrackMenu
              song={current}
              elevated
              iconSize={20}
              triggerClassName="glass-glossy rounded-full p-2.5 text-white/80 transition hover:text-white"
            />
          </div>

          {/* Content: art + controls (left), up next / lyrics (right on lg) */}
          <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-6 pb-10 md:flex-row md:items-center md:justify-center md:gap-14 md:px-12">
            {/* Left: artwork + transport. `my-auto` vertically centers the column
                on mobile so the controls fill the screen instead of piling at the
                top (collapses to top-aligned if a small phone ever overflows). */}
            <div className="mx-auto my-auto flex w-full max-w-md flex-col items-center md:mx-0">
              <div
                className="relative w-full max-w-[min(76vw,22rem)] touch-pan-y select-none"
                onTouchStart={onCoverTouchStart}
                onTouchEnd={onCoverTouchEnd}
              >
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

              {/* Title + like — tight title/artist pair (C4). */}
              <div className="mt-6 flex w-full items-center justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-extrabold leading-tight tracking-tight md:text-3xl" title={current.trackName}>
                    {current.trackName}
                  </h1>
                  {current.artistName ? (
                    <button
                      type="button"
                      onClick={() => navigate("artist", { name: current.artistName })}
                      className="mt-1 block w-full truncate text-left text-[0.95rem] font-medium text-white/55 transition hover:text-white active:text-white"
                      title={`Go to ${current.artistName}`}
                    >
                      {current.artistName}
                    </button>
                  ) : null}
                </div>
                <LikeButton song={current} className="h-11 w-11 shrink-0 bg-white/10" size={22} />
              </div>

              {/* Transport cluster — seek / play / volume / panel toggles. This
                  whole group auto-hides together (C3); the artwork + title above
                  stay visible so the view never looks empty. */}
              <div className={`w-full ${controlsFadeCls}`}>
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
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
                    style={{
                      background: `linear-gradient(to right, #fa233b ${pct}%, rgba(255,255,255,0.2) ${pct}%)`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-white/50">
                  <span>{formatTime(progress)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Transport */}
              <div className="mt-5 flex w-full items-center justify-between">
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
                    className="btn-glossy flex h-16 w-16 items-center justify-center rounded-full transition hover:scale-105"
                  >
                    {isPlaying ? (
                      <Pause size={28} fill="currentColor" />
                    ) : (
                      <Play size={28} fill="currentColor" className="ml-1" />
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
              <div className="mt-5 flex w-full items-center gap-3">
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
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-full"
                  style={{
                    background: `linear-gradient(to right, #fff ${volPct}%, rgba(255,255,255,0.18) ${volPct}%)`,
                  }}
                />
              </div>

              {/* Lyrics / Up Next toggles — separate buttons, mobile + desktop.
                  Toggling the active one off returns to the album-only view. */}
              <div className="mt-5 flex w-full items-center gap-2">
                <button
                  type="button"
                  onClick={() => togglePanel("lyrics")}
                  aria-pressed={rightPanel === "lyrics"}
                  className={panelBtn(rightPanel === "lyrics")}
                >
                  <MessageSquareQuote size={17} /> Lyrics
                </button>
                <button
                  type="button"
                  onClick={() => togglePanel("upnext")}
                  aria-pressed={rightPanel === "upnext"}
                  className={panelBtn(rightPanel === "upnext")}
                >
                  <ListMusic size={17} /> Up Next
                </button>
              </div>
              </div>
              {/* end transport cluster (C3 auto-hide group) */}

              {/* Stream resolution status (glass error / resolving states) */}
              {streamError && (
                <div className="mt-3 flex items-center justify-center gap-3 rounded-full bg-white/10 px-4 py-1.5 text-xs text-white/70">
                  <span>
                    {streamError === "no_stream"
                      ? "Full song unavailable"
                      : streamError === "not_found"
                      ? "Track not found"
                      : "Couldn’t reach the music service"}
                  </span>
                  {retry && streamError !== "not_found" && (
                    <button
                      type="button"
                      onClick={() => retry()}
                      className="font-semibold text-accent transition hover:underline"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right: Lyrics / Up Next — desktop inline column.
                On mobile this is hidden; the slide-up sheet below takes over. */}
            {rightPanel !== "none" && (
              <div className="hidden w-full max-w-md flex-col md:mx-0 md:flex md:h-[74vh] lg:max-w-2xl">
                {renderPanel()}
              </div>
            )}
          </div>

          {/* Mobile: Lyrics / Up Next as a full-screen slide-up sheet (Apple-style).
              Same body as the desktop column, but presented as an overlay so you
              never have to scroll the player to reach it. */}
          <AnimatePresence>
            {rightPanel !== "none" && (
              <motion.div
                key="mobile-panel"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 300, damping: 34 }}
                className="absolute inset-0 z-[85] flex flex-col md:hidden"
              >
                <div className="absolute inset-0 -z-10 overflow-hidden bg-black">
                  {art && (
                    <img
                      src={art}
                      alt=""
                      className="h-full w-full scale-150 object-cover opacity-60 blur-[120px] saturate-150"
                    />
                  )}
                  <div className="absolute inset-0 bg-black/55" />
                </div>

                <div className="flex items-center gap-2 px-5 pb-3 pt-[calc(1.25rem_+_env(safe-area-inset-top))]">
                  <div className="flex flex-1 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRightPanel("lyrics")}
                      aria-pressed={rightPanel === "lyrics"}
                      className={panelBtn(rightPanel === "lyrics")}
                    >
                      <MessageSquareQuote size={17} /> Lyrics
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightPanel("upnext")}
                      aria-pressed={rightPanel === "upnext"}
                      className={panelBtn(rightPanel === "upnext")}
                    >
                      <ListMusic size={17} /> Up Next
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRightPanel("none")}
                    aria-label="Close"
                    className="glass-glossy shrink-0 rounded-full p-2.5 text-white/80 transition hover:text-white"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="flex flex-1 flex-col overflow-hidden px-5 pb-8">
                  {renderPanel()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Lyrics version picker (portals to <body> above the player) */}
          {versionsOpen && current && (
            <LyricVersions
              song={current}
              currentSource={shownLyrics?.source || null}
              onUse={useVersion}
              onClose={() => setVersionsOpen(false)}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
