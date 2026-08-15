import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClock, Check, Moon, Music3, X } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

const TIME_PRESETS = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 45, label: "45 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 90, label: "1.5 hours" },
  { minutes: 120, label: "2 hours" },
];

const SONG_PRESETS = [2, 3, 5, 10];

/** mm:ss, or h:mm:ss past an hour. */
function fmtRemaining(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Sleep Timer picker. Time-based is always available; "after N songs" only
 * shows when playback came from a real collection (playlist / album / shelf).
 * "End of current song" is always offered.
 */
export default function SleepTimerSheet({ open, onClose }) {
  const {
    sleep,
    sleepRemainingMs,
    queueIsCollection,
    startSleepTimer,
    cancelSleepTimer,
  } = usePlayer();
  const [customMin, setCustomMin] = useState("");

  const active = Boolean(sleep);

  const arm = (cfg) => {
    startSleepTimer(cfg);
    onClose();
  };

  const armCustom = () => {
    const n = Number(customMin);
    if (!Number.isFinite(n) || n <= 0) return;
    setCustomMin("");
    arm({ kind: "time", minutes: n });
  };

  let statusLine = null;
  if (sleep?.kind === "time") {
    statusLine = `Stops in ${fmtRemaining(sleepRemainingMs)}`;
  } else if (sleep?.kind === "songs") {
    statusLine = sleep.endOfSong
      ? "Stops at the end of this song"
      : `Stops after ${sleep.songsLeft} more ${sleep.songsLeft === 1 ? "song" : "songs"}`;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="glass-strong fixed inset-x-0 bottom-0 z-[96] max-h-[80vh] overflow-y-auto rounded-t-3xl p-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] shadow-glass"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2">
                <Moon size={18} className="text-accent" />
                <p className="text-base font-bold text-white">Sleep Timer</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Active timer status */}
            {active && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-accent/15 px-4 py-3">
                <div className="flex items-center gap-2 text-accent">
                  <AlarmClock size={18} />
                  <span className="text-sm font-semibold">{statusLine}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    cancelSleepTimer();
                    onClose();
                  }}
                  className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  Turn off
                </button>
              </div>
            )}

            {/* After a set time */}
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
              After a set time
            </p>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {TIME_PRESETS.map((t) => {
                const on = sleep?.kind === "time" && sleep.minutes === t.minutes;
                return (
                  <button
                    key={t.minutes}
                    type="button"
                    onClick={() => arm({ kind: "time", minutes: t.minutes })}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-sm font-semibold transition ${
                      on
                        ? "bg-accent text-white"
                        : "bg-white/10 text-white/85 hover:bg-white/15"
                    }`}
                  >
                    {on && <Check size={14} />}
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Custom minutes */}
            <div className="mb-4 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") armCustom();
                }}
                placeholder="Custom minutes"
                aria-label="Custom minutes"
                className="min-w-0 flex-1 rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white outline-none ring-1 ring-white/10 transition placeholder:text-white/40 focus:bg-white/15 focus:ring-white/25"
              />
              <button
                type="button"
                onClick={armCustom}
                disabled={!(Number(customMin) > 0)}
                className="btn-glossy shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-30"
              >
                Set
              </button>
            </div>

            {/* End of current song */}
            <button
              type="button"
              onClick={() => arm({ kind: "endOfSong" })}
              className={`mb-3 flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                sleep?.endOfSong
                  ? "bg-accent text-white"
                  : "bg-white/10 text-white/85 hover:bg-white/15"
              }`}
            >
              <span className="flex items-center gap-2">
                <Music3 size={16} />
                End of current song
              </span>
              {sleep?.endOfSong && <Check size={16} />}
            </button>

            {/* After N songs — only when playing a real collection */}
            {queueIsCollection && (
              <>
                <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
                  After a number of songs
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {SONG_PRESETS.map((n) => {
                    const on =
                      sleep?.kind === "songs" && !sleep.endOfSong && sleep.total === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => arm({ kind: "songs", songs: n })}
                        className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-sm font-semibold transition ${
                          on
                            ? "bg-accent text-white"
                            : "bg-white/10 text-white/85 hover:bg-white/15"
                        }`}
                      >
                        {on && <Check size={14} />}
                        {n}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
