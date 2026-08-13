import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Music2 } from "lucide-react";

/**
 * Cold-load splash — "Turntable Ignition" (Brick A: the spectacle).
 *
 * Over a living backdrop (flowing aurora, drifting bokeh motes, film grain +
 * vignette), a CSS-3D vinyl record drops in from depth and tilts into
 * perspective; a tonearm swings down and the needle-drop ignites the spin while
 * sound-wave rings pulse to a beat and a specular glint rides the grooves. The
 * SWARA wordmark then flips up in 3D with a one-shot light sweep.
 *
 * Pure CSS 3D + framer-motion — no WebGL, no assets, transforms/opacity only,
 * so it never blocks first paint. (Brick B — the iris-into-app reveal — will
 * replace the plain fade-out.)
 *
 * Scripted on real timers; onComplete fires exactly once (never from an
 * animation callback). Reduced motion: static tilted record + wordmark, short
 * hold. Skip button finishes immediately.
 */
const LETTERS = ["S", "W", "A", "R", "A"];

const BG_STYLE = { background: "#06060a" };

// Fine film grain (inline SVG turbulence) — laid over everything at low opacity.
const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Vinyl surface: fine grooves over a near-black disc.
const VINYL_STYLE = {
  background:
    "repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05) 0 1px, transparent 1px 4px), " +
    "radial-gradient(circle at 50% 50%, #17171d 0 30%, #0b0b0f 31%)",
  boxShadow:
    "0 34px 70px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,255,255,0.05), inset 0 0 44px rgba(0,0,0,0.7)",
};

// A bright arc that sweeps as the disc spins — the specular glint on the grooves.
const SHEEN_STYLE = {
  background:
    "conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.20) 26deg, transparent 70deg, " +
    "transparent 200deg, rgba(255,255,255,0.08) 236deg, transparent 288deg)",
};

// Bokeh motes — fixed set so it's deterministic; each drifts + twinkles.
const MOTES = [
  { l: 14, t: 26, s: 6, d: 0.2, dur: 6.5 },
  { l: 80, t: 20, s: 4, d: 1.2, dur: 7.5 },
  { l: 68, t: 72, s: 7, d: 0.6, dur: 8.0 },
  { l: 26, t: 68, s: 5, d: 1.8, dur: 6.8 },
  { l: 46, t: 14, s: 3, d: 0.9, dur: 7.2 },
  { l: 90, t: 54, s: 5, d: 2.2, dur: 8.4 },
  { l: 8, t: 48, s: 4, d: 1.5, dur: 7.0 },
  { l: 58, t: 86, s: 6, d: 0.3, dur: 8.8 },
  { l: 36, t: 40, s: 3, d: 2.6, dur: 6.4 },
  { l: 74, t: 38, s: 4, d: 1.0, dur: 7.6 },
];

export default function SplashScreen({ onComplete }) {
  const [phase, setPhase] = useState("in"); // "in" | "out"
  const fired = useRef(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const finish = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    onComplete?.();
  }, [onComplete]);

  // Scripted timeline — real timers, not animation callbacks.
  useEffect(() => {
    const holdMs = reduced.current ? 600 : 2950; // when to begin fade-out
    const totalMs = reduced.current ? 900 : 3350; // when to actually unmount

    const t1 = setTimeout(() => setPhase("out"), holdMs);
    const t2 = setTimeout(finish, totalMs);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [finish]);

  const handleSkip = (e) => {
    e?.stopPropagation();
    setPhase("out");
    setTimeout(finish, 250);
  };

  const r = reduced.current;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: phase === "out" ? 0 : 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
      style={BG_STYLE}
      aria-hidden={phase === "out"}
    >
      {/* ── Flowing aurora backdrop ── */}
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute h-[70vmax] w-[70vmax] rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, rgba(250,35,59,0.5), transparent 62%)", top: "-20%", left: "-10%" }}
          animate={r ? {} : { x: ["0%", "18%", "0%"], y: ["0%", "12%", "0%"], scale: [1, 1.15, 1] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute h-[60vmax] w-[60vmax] rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, rgba(255,55,95,0.4), transparent 62%)", bottom: "-25%", right: "-12%" }}
          animate={r ? {} : { x: ["0%", "-16%", "0%"], y: ["0%", "-10%", "0%"], scale: [1.1, 1, 1.1] }}
          transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute left-1/2 top-1/2 h-[45vmax] w-[45vmax] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, rgba(255,120,60,0.22), transparent 60%)" }}
          animate={r ? {} : { scale: [1, 1.2, 1], opacity: [0.5, 0.75, 0.5] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* ── Bokeh motes ── */}
      {!r && (
        <div className="pointer-events-none absolute inset-0">
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full bg-white"
              style={{ left: `${m.l}%`, top: `${m.t}%`, width: m.s, height: m.s, filter: "blur(1px)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.5, 0], y: [8, -22, 8] }}
              transition={{ duration: m.dur, delay: m.d, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </div>
      )}

      {/* ── Bloom flash (reveals the scene) ── */}
      {!r && (
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,240,230,0.95), transparent 70%)" }}
          initial={{ scale: 0.2, opacity: 0.9 }}
          animate={{ scale: 9, opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      )}

      {/* ── Vignette + film grain ── */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.55) 100%)" }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{ backgroundImage: GRAIN_URL }}
      />

      {/* Skip button */}
      <button
        type="button"
        onClick={handleSkip}
        className="fixed right-6 top-6 z-[110] rounded-full px-3 py-1.5 text-xs font-medium text-white/50 transition hover:bg-white/5 hover:text-white"
        aria-label="Skip intro"
      >
        Skip
      </button>

      {/* ── Stage ── */}
      <div className="relative z-[105] flex flex-col items-center">
        {/* Deck: record + tonearm + rings + floor sheen */}
        <div className="relative flex h-64 w-64 items-center justify-center sm:h-72 sm:w-72">
          {/* Floor contact glow (reads as a glossy deck under the record) */}
          <div
            className="absolute bottom-4 left-1/2 h-8 w-52 -translate-x-1/2 rounded-[100%] blur-xl"
            style={{ background: "radial-gradient(ellipse, rgba(250,35,59,0.34), transparent 70%)" }}
          />

          {/* Sound-wave rings (beat-paced) */}
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{ width: 200, height: 200, border: "1px solid rgba(250,35,59,0.42)" }}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={r ? { opacity: 0 } : { scale: [0.6, 1.9], opacity: [0.55, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 1.4 + i * 0.5, ease: "easeOut" }}
            />
          ))}

          {/* Record — drops from depth, tilts into perspective, ignites into spin */}
          <motion.div
            className="relative"
            style={{ transformPerspective: 900 }}
            initial={{ rotateX: 66, scale: 0.4, y: 30, opacity: 0 }}
            animate={
              r
                ? { rotateX: 18, scale: 1, y: 0, opacity: 1 }
                : { rotateX: [66, 18, 18], scale: [0.4, 1.06, 1], y: [30, 0, 0], opacity: [0, 1, 1] }
            }
            transition={{ duration: 1.0, delay: 0.3, times: [0, 0.75, 1], ease: [0.2, 0.7, 0.2, 1] }}
          >
            <motion.div
              className="relative h-44 w-44 rounded-full sm:h-52 sm:w-52"
              style={VINYL_STYLE}
              initial={{ rotate: 0 }}
              animate={r ? {} : { rotate: 720 }}
              transition={{ duration: 1.6, delay: 1.35, ease: "linear" }}
            >
              <div className="absolute inset-0 rounded-full" style={SHEEN_STYLE} />
              {/* Red center label + spindle hole */}
              <div
                className="absolute left-1/2 top-1/2 h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  background: "radial-gradient(circle at 38% 32%, #ff4d63, #d11330 70%)",
                  boxShadow: "inset 0 1px 3px rgba(255,255,255,0.35), 0 2px 6px rgba(0,0,0,0.4)",
                }}
              >
                <div className="absolute left-1/2 top-1/2 h-[14%] w-[14%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#06060a]" />
              </div>
            </motion.div>

            {/* Static note pinned over the spindle */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Music2 className="text-white/90 drop-shadow" size={18} />
            </div>
          </motion.div>

          {/* Tonearm — swings in and drops the needle (~1.4s) */}
          <motion.div
            className="absolute"
            style={{ top: "12%", right: "12%", transformOrigin: "top right" }}
            initial={{ rotate: -34, opacity: 0 }}
            animate={r ? { rotate: -8, opacity: 1 } : { rotate: [-34, -34, -8], opacity: [0, 1, 1] }}
            transition={{ duration: 0.7, delay: 0.9, times: [0, 0.25, 1], ease: "easeInOut" }}
          >
            {/* pivot hub */}
            <div className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-gradient-to-br from-neutral-200 to-neutral-500 shadow-md" />
            {/* arm */}
            <div className="h-[6px] w-32 origin-right rounded-full bg-gradient-to-l from-neutral-300 via-neutral-400 to-neutral-200 shadow" />
            {/* headshell + needle at the far (left) tip */}
            <div className="absolute -bottom-2 left-0 h-3 w-4 -rotate-12 rounded-sm bg-neutral-200 shadow" />
          </motion.div>
        </div>

        {/* Wordmark — 3D letter reveal + one-shot light sweep */}
        <div className="relative mt-10" style={{ transformPerspective: 700 }}>
          <div className="flex items-center gap-[3px] sm:gap-[5px]">
            {LETTERS.map((ch, i) => (
              <motion.span
                key={`${ch}-${i}`}
                className="text-4xl font-black tracking-widest text-white sm:text-5xl"
                style={{ textShadow: "0 0 24px rgba(250,35,59,0.6), 0 0 60px rgba(255,55,95,0.3)" }}
                initial={{ opacity: 0, rotateX: -90, y: 14 }}
                animate={{ opacity: 1, rotateX: 0, y: 0 }}
                transition={{ duration: 0.55, delay: r ? 0 : 1.55 + i * 0.1, ease: [0.2, 0.7, 0.3, 1] }}
              >
                {ch}
              </motion.span>
            ))}
          </div>

          {!r && (
            <motion.div
              className="pointer-events-none absolute inset-y-0 w-16 -skew-x-12"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
                mixBlendMode: "overlay",
              }}
              initial={{ left: "-20%", opacity: 0 }}
              animate={{ left: ["-20%", "120%"], opacity: [0, 1, 0] }}
              transition={{ duration: 0.9, delay: 2.3, ease: "easeInOut" }}
            />
          )}
        </div>

        {/* Tagline */}
        <motion.p
          className="mt-5 text-[11px] font-medium uppercase tracking-[0.35em] text-white/40"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: r ? 0.2 : 2.5, duration: 0.5 }}
        >
          Telugu Music
        </motion.p>
      </div>
    </motion.div>
  );
}
