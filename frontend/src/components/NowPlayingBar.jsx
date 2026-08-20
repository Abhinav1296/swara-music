import { useRef } from "react";
import {
  ListMusic,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import LikeButton from "./LikeButton";
import CachedImage from "./CachedImage";
import { formatTime } from "../utils/format";

/**
 * Bottom "Now Playing" bar (frosted glass). Shows the active track, transport
 * controls, a seekable progress bar, plus shuffle / repeat / volume / queue.
 * Condenses gracefully on mobile (thin progress line + essential controls).
 */
export default function NowPlayingBar() {
  const {
    current,
    isPlaying,
    progress,
    duration,
    isResolvingStream,
    streamError,
    toggle,
    next,
    prev,
    volume,
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
    setVolume,
    toggleQueue,
    seek,
    openFullscreen,
    stop,
  } = usePlayer();
  const prevVolume = useRef(0.8);
  const touchStart = useRef(null);

  // Cold open: no track chosen yet → don't render the bar at all. It appears
  // only once a song is actually loaded/playing.
  if (!current) return null;

  const pct = duration ? Math.min(100, (progress / duration) * 100) : 0;

  // Swipe gestures on the mini bar (mobile). A deliberate drag (>60px) in the
  // dominant axis fires exactly one action, so taps on the transport buttons and
  // small motions never trigger one:
  //   ← / →  next / previous track
  //   ↓      stop playback and dismiss the bar
  //   ↑      open the full-screen player
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const THRESH = 60;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx <= -THRESH) next();
      else if (dx >= THRESH) prev();
    } else {
      if (dy >= THRESH) stop();
      else if (dy <= -THRESH) openFullscreen();
    }
  };

  const onVolumeClick = () => {
    if (volume > 0) {
      prevVolume.current = volume;
      setVolume(0);
    } else {
      setVolume(prevVolume.current || 0.8);
    }
  };

  // Only show "Resolving full song..." when we are ACTIVELY resolving AND
  // audio hasn't started yet. Once isPlaying flips true (or streamUrl exists
  // and progress > 0), audio is live so the message is misleading.
  const showResolving =
    isResolvingStream && !isPlaying && !(current?.streamUrl && progress > 0);

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="glass fixed bottom-[calc(4rem_+_env(safe-area-inset-bottom))] left-0 right-0 z-30 flex items-center gap-3 border-t px-3 py-2 md:bottom-0 md:gap-4 md:px-6 md:py-3"
    >
      {/* Mobile thin progress line */}
      <div className="absolute left-0 right-0 top-0 h-0.5 bg-white/10 md:hidden">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>

      {/* Track info */}
      <div className="flex min-w-0 flex-1 items-center gap-3 md:w-72 md:flex-none">
        <button
          type="button"
          onClick={() => openFullscreen()}
          aria-label="Open full-screen player"
          className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-lg md:h-14 md:w-14"
        >
          <CachedImage
            src={current.artworkUrl100}
            alt=""
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 size={16} className="text-white" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => openFullscreen()}
          className="min-w-0 flex-1 text-left"
          aria-label="Open full-screen player"
        >
          <p className="truncate text-sm font-semibold text-white" title={current.trackName}>
            {current.trackName}
          </p>
          <p className="truncate text-xs text-white/50" title={current.artistName}>
            {current.artistName}
          </p>
          {showResolving && (
            <p className="truncate text-[11px] text-accent/90">Resolving full song…</p>
          )}
          {!showResolving && streamError && !isPlaying && (
            <p className="truncate text-[11px] text-white/40">
              {streamError === "no_stream" || streamError === "not_found"
                ? "Stream unavailable"
                : streamError === "rate_limited"
                ? "Rate limited — retrying…"
                : "Playback error"}
            </p>
          )}
        </button>
        <LikeButton song={current} className="ml-1 h-8 w-8 md:hidden" />
      </div>

      {/* Transport + progress */}
      <div className="flex flex-none flex-col items-center gap-1.5 md:flex-[2]">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={prev}
            disabled={!current}
            aria-label="Previous"
            className="text-white/70 transition hover:text-white disabled:opacity-30"
          >
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={!current}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="btn-glossy flex h-10 w-10 items-center justify-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!current}
            aria-label="Next"
            className="text-white/70 transition hover:text-white disabled:opacity-30"
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>

        {/* Progress (desktop) */}
        <div className="hidden w-full max-w-xl items-center gap-2 md:flex">
          <span className="w-10 text-right text-[11px] tabular-nums text-white/40">
            {formatTime(progress)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(progress, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!current}
            aria-label="Seek preview"
            className="h-1 w-full flex-1 cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: `linear-gradient(to right, #fa233b ${pct}%, rgba(255,255,255,0.18) ${pct}%)`,
            }}
          />
          <span className="w-10 text-[11px] tabular-nums text-white/40">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right controls (md+) */}
      <div className="hidden flex-1 items-center justify-end gap-2 md:flex">
        <button
          type="button"
          onClick={toggleShuffle}
          aria-label="Shuffle"
          aria-pressed={shuffle}
          className={`rounded-full p-2 transition hover:bg-white/10 ${
            shuffle ? "text-accent" : "text-white/60 hover:text-white"
          }`}
        >
          <Shuffle size={17} />
        </button>
        <button
          type="button"
          onClick={cycleRepeat}
          aria-label={`Repeat: ${repeat}`}
          className={`rounded-full p-2 transition hover:bg-white/10 ${
            repeat !== "off" ? "text-accent" : "text-white/60 hover:text-white"
          }`}
        >
          {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onVolumeClick}
            aria-label={volume > 0 ? "Mute" : "Unmute"}
            className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            {volume > 0 ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            className="h-1 w-20 cursor-pointer appearance-none rounded-full"
            style={{
              background: `linear-gradient(to right, #fff ${Math.round((volume ?? 0) * 100)}%, rgba(255,255,255,0.18) ${Math.round((volume ?? 0) * 100)}%)`,
            }}
          />
        </div>

        <button
          type="button"
          onClick={toggleQueue}
          aria-label="Queue"
          className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <ListMusic size={17} />
        </button>

        <button
          type="button"
          onClick={() => openFullscreen()}
          aria-label="Open full-screen player"
          className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <Maximize2 size={17} />
        </button>
      </div>
    </div>
  );
}