import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

/**
 * Apple-Music-style karaoke lyrics.
 *
 * Every line sits at a readable base brightness; the CURRENT line fills
 * word-by-word from that base up to pure white as you sing it — a smooth
 * left-to-right "wipe" (Apple's syllable highlight, approximated at word level
 * from the line's start/end timestamps). Already-sung lines fade back a little,
 * upcoming lines wait at the base level. The block is masked to fade at the top
 * and bottom edges, and the active line parks in the upper third so the lines
 * you're about to hear stay on screen. Tapping any line seeks to it.
 *
 * Purely presentational + self-contained, so it drops into both the full-screen
 * player and (later) an inline panel unchanged. Feed it:
 *   - lines        : [{ time:seconds, text }]
 *   - activeIndex  : index from resolveActiveLine(lines, progress), or -1
 *   - progress     : live playback seconds (drives the intro dots + word wipe)
 *   - duration     : track length in seconds (used to time the LAST line's wipe)
 *   - onSeek(time) : seek callback
 *
 * Tuning knobs (opacity of white, 0–1) live right here — nudge to taste:
 */
const REST_UPCOMING = 0.22; // lines not yet reached — kept dim so the current line pops
const REST_SUNG = 0.14; // lines already passed — dimmer still ("you are here" reads clearly)
const WORD_UNSUNG = 0.35; // active line, words not yet sung — brighter than neighbours
const WORD_SUNG = 1; // words already sung glow full white
const LAST_LINE_SECS = 6; // fallback duration for the final line's wipe

// Smooth 0→1 ramp so the wipe front feathers across a word instead of snapping.
function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export default function SyncedLyrics({
  lines,
  activeIndex,
  progress = 0,
  duration = 0,
  onSeek,
  className = "",
}) {
  const containerRef = useRef(null);
  const lineRefs = useRef([]);
  const dotsRef = useRef(null);

  // Park the active line at ~40% from the top (upper third) so the lines you're
  // about to hear stay on screen — matches Apple's resting position.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const el = activeIndex >= 0 ? lineRefs.current[activeIndex] : dotsRef.current;
    if (!el) return;
    const top = el.offsetTop - c.clientHeight * 0.4 + el.clientHeight / 2;
    c.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeIndex, lines]);

  if (!lines || lines.length === 0) return null;

  const firstTime = lines[0]?.time ?? 0;
  const showIntroDots = activeIndex < 0 && firstTime > 3;
  const introFrac = showIntroDots ? Math.min(1, Math.max(0, progress / firstTime)) : 0;

  // How far the wipe has moved through the active line, as a fraction 0–1.
  let activeFrac = 0;
  if (activeIndex >= 0) {
    const t0 = lines[activeIndex].time;
    const next = lines[activeIndex + 1]?.time;
    const end = next ?? (duration ? Math.min(duration, t0 + LAST_LINE_SECS) : t0 + LAST_LINE_SECS);
    const span = Math.max(0.4, end - t0);
    activeFrac = Math.min(1, Math.max(0, (progress - t0) / span));
  }

  return (
    <div
      ref={containerRef}
      className={`no-scrollbar h-full overflow-y-auto ${className}`}
      style={{
        // Fade lyrics into/out of the top and bottom edges (Apple's soft mask).
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, #000 12%, #000 78%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, transparent 0%, #000 12%, #000 78%, transparent 100%)",
      }}
    >
      <div className="space-y-1.5 py-8">
        {showIntroDots && (
          <div ref={dotsRef} className="flex items-center gap-2.5 pb-6 pl-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="block h-3 w-3 rounded-full bg-white"
                style={{ opacity: 0.28 + 0.72 * Math.max(0, Math.min(1, introFrac * 3 - i)) }}
                animate={{ scale: [1, 1.25, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }}
              />
            ))}
          </div>
        )}

        {lines.map((l, i) => {
          const active = i === activeIndex;
          const sung = activeIndex >= 0 && i < activeIndex;
          const restOpacity = sung ? REST_SUNG : REST_UPCOMING;

          return (
            <button
              key={i}
              type="button"
              ref={(el) => (lineRefs.current[i] = el)}
              onClick={() => onSeek?.(l.time)}
              className="block w-full py-1.5 text-left font-bold leading-[1.3] tracking-tight
                text-[1.3rem] sm:text-[1.5rem] lg:text-[1.7rem]"
              style={active ? { textShadow: "0 0 26px rgba(255,255,255,0.18)" } : undefined}
            >
              {active ? (
                <ActiveLine text={l.text} frac={activeFrac} />
              ) : (
                <span
                  className="transition-colors duration-500"
                  style={{ color: `rgba(255,255,255,${restOpacity})` }}
                >
                  {l.text || "♪"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The current line, filled word-by-word. `frac` (0–1) is how far playback has
 * moved through the line; each word crosses from WORD_UNSUNG to WORD_SUNG as the
 * wipe front reaches it, with a CSS colour transition smoothing the steps.
 */
function ActiveLine({ text, frac }) {
  const words = (text || "♪").split(/(\s+)/); // keep whitespace tokens for spacing
  const wordCount = words.filter((w) => w.trim()).length || 1;
  const head = frac * wordCount; // fractional index of the wipe front
  let wi = -1;
  return (
    <>
      {words.map((w, i) => {
        if (!w.trim()) return <span key={i}>{w}</span>;
        wi += 1;
        const op = WORD_UNSUNG + (WORD_SUNG - WORD_UNSUNG) * smoothstep(head - wi);
        return (
          <span
            key={i}
            className="transition-colors duration-300 ease-linear"
            style={{ color: `rgba(255,255,255,${op})` }}
          >
            {w}
          </span>
        );
      })}
    </>
  );
}
