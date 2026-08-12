import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Music2 } from "lucide-react";

/**
 * Cold-load splash screen.
 * Runs a scripted animation on a real timer, then calls onComplete once.
 * Never triggers unmount from animation callbacks (Nemotron's original bug).
 *
 * Timing:
 *   t=0.0s  overlay + backdrop glow fade in
 *   t=0.2s  letters S W A R A stagger in from below
 *   t=1.0s  music note appears and starts pulsing
 *   t=1.8s  card scales up subtly to 1.05
 *   t=2.3s  overlay fade out begins
 *   t=2.7s  onComplete fires, parent unmounts
 *
 * Reduced motion: static logo held for 600ms, then fade out.
 * Skip button: fires onComplete immediately at any time.
 */
const LETTERS = ["S", "W", "A", "R", "A"];

const BG_STYLE = {
  background:
    "radial-gradient(1200px 600px at 80% -10%, rgba(250, 35, 59, 0.18), transparent 60%), " +
    "radial-gradient(900px 500px at 0% 10%, rgba(120, 40, 200, 0.14), transparent 55%), " +
    "#08080c",
};

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

  // Scripted timeline — real timers, not animation callbacks
  useEffect(() => {
    const holdMs = reduced.current ? 600 : 2300; // when to begin fade-out
    const totalMs = reduced.current ? 900 : 2700; // when to actually unmount

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
    // give the fade-out ~250ms then finish
    setTimeout(finish, 250);
  };

  const isReduced = reduced.current;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: phase === "out" ? 0 : 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
      style={BG_STYLE}
      aria-hidden={phase === "out"}
    >
      {/* Backdrop glow — soft radial layers behind the card */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === "out" ? 0 : 1 }}
        transition={{ duration: 0.6, delay: 0.1 }}
      >
        <div
          className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, #fa233b 0%, transparent 65%)" }}
        />
        <div
          className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #a020e8 0%, transparent 65%)" }}
        />
      </motion.div>

      {/* Skip button */}
      <button
        type="button"
        onClick={handleSkip}
        className="fixed right-6 top-6 z-[110] rounded-full px-3 py-1.5 text-xs font-medium text-white/50 transition hover:bg-white/5 hover:text-white"
        aria-label="Skip intro"
      >
        Skip
      </button>

      {/* Glass card */}
      <motion.div
        className="glass-strong relative z-[105] flex flex-col items-center justify-center rounded-3xl px-10 py-8 sm:px-12 sm:py-10"
        style={{ minWidth: 260 }}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={
          isReduced
            ? { opacity: 1, scale: 1 }
            : {
                opacity: 1,
                scale: [0.94, 1, 1, 1.05],
                transition: {
                  duration: 2.0,
                  times: [0, 0.15, 0.85, 1],
                  ease: "easeOut",
                },
              }
        }
      >
        {/* Letters */}
        <div className="flex items-center gap-[3px] sm:gap-[4px]">
          {LETTERS.map((ch, i) => (
            <motion.span
              key={`${ch}-${i}`}
              className="font-black tracking-widest text-white text-4xl sm:text-5xl"
              style={{
                textShadow:
                  "0 0 24px rgba(250,35,59,0.55), 0 0 60px rgba(250,35,59,0.25)",
              }}
              initial={{ opacity: 0, y: 22 }}
              animate={
                isReduced
                  ? { opacity: 1, y: 0 }
                  : {
                      opacity: 1,
                      y: 0,
                      transition: {
                        duration: 0.5,
                        delay: 0.2 + i * 0.09,
                        ease: [0.2, 0.7, 0.3, 1],
                      },
                    }
              }
            >
              {ch}
            </motion.span>
          ))}
        </div>

        {/* Music note pulse */}
        <motion.div
          className="mt-5 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: isReduced ? 0.1 : 1.0, duration: 0.4 }}
        >
          <motion.div
            animate={
              isReduced
                ? {}
                : {
                    scale: [1, 1.25, 1],
                    opacity: [0.7, 1, 0.7],
                  }
            }
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <Music2 className="text-accent" size={22} />
          </motion.div>
        </motion.div>

        {/* Tagline */}
        <motion.p
          className="mt-4 text-[11px] font-medium uppercase tracking-[0.3em] text-white/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: isReduced ? 0.2 : 1.3, duration: 0.5 }}
        >
          Telugu Music
        </motion.p>
      </motion.div>
    </motion.div>
  );
}