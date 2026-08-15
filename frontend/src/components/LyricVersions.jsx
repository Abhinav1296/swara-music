import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, ThumbsUp, X } from "lucide-react";
import { getLyricVersions, sendLyricFeedback } from "../api/client";
import { normalizeVersion } from "../utils/trackAdapter";
import { useAuthGate } from "../context/AuthGate";

/**
 * Lyrics version picker. Songs in our catalog carry several lyric versions
 * (Musixmatch, LyricsTape, …); the app shows one by default. This modal lets a
 * listener browse every version, preview it, switch the player to it, and vote
 * for the one that matches best. Votes are crowd feedback the maintainer later
 * reviews before promoting a winner to the default — the app never auto-changes
 * it (lyrics purity: a human confirms first).
 *
 * Props:
 *   song          – the current track (needs id / artistName / trackName / jiosaavnUrl)
 *   currentSource – the source string currently displayed (for a "Showing" tag)
 *   onUse(norm, label) – switch the player's lyrics to a chosen version
 *   onClose       – dismiss
 */
export default function LyricVersions({ song, currentSource, onUse, onClose }) {
  const { requireAuth } = useAuthGate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // { songId, chosen, versions }
  const [voted, setVoted] = useState(null); // source the user voted for this session
  const [voting, setVoting] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getLyricVersions({
      id: song?.id,
      artist: song?.artistName,
      song: song?.trackName,
      url: song?.jiosaavnUrl,
    })
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message || "Couldn’t load versions."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [song?.id]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const versions = data?.versions || [];

  const castVote = async (v) => {
    if (!data?.songId || voting) return;
    setVoting(v.source);
    setVoted(v.source);
    // Optimistic bump — a lost vote is harmless, so we don't roll back on error.
    setData((cur) => ({
      ...cur,
      versions: cur.versions.map((x) =>
        x.source === v.source ? { ...x, votes: (x.votes || 0) + 1 } : x
      ),
    }));
    try {
      await sendLyricFeedback({ songId: data.songId, source: v.source });
    } catch {
      /* keep the optimistic count */
    } finally {
      setVoting(null);
    }
  };

  // Voting requires an account — pops the sign-in sheet when signed out, then
  // casts the vote automatically once the user is authenticated.
  const vote = (v) => requireAuth(() => castVote(v), { reason: "vote" });

  const preview = (v) =>
    String(v.plain || v.plainRoman || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[94] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="glass-strong flex max-h-[82vh] w-full max-w-lg flex-col rounded-3xl border border-white/10 p-5 shadow-glass"
        >
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Lyrics versions</h2>
              <p className="mt-0.5 text-xs text-white/50">
                Pick the version that matches best — your vote helps set the default.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          <div className="no-scrollbar mt-3 flex-1 space-y-3 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-white/60">
                <Loader2 size={20} className="animate-spin" /> Loading versions…
              </div>
            ) : error ? (
              <div className="glass rounded-2xl p-6 text-center text-sm text-white/60">{error}</div>
            ) : versions.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center text-sm text-white/60">
                No alternate lyric versions for this track.
              </div>
            ) : (
              versions.map((v) => {
                const showing = v.source === currentSource;
                return (
                  <div key={v.source} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white">{v.label}</span>
                        {v.isChosen && (
                          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">
                            Default
                          </span>
                        )}
                        {showing && !v.isChosen && (
                          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                            Showing
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-xs text-white/50">
                        <ThumbsUp size={12} /> {v.votes}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {v.hasSynced && <Badge>Synced</Badge>}
                      {v.hasTelugu && <Badge>తెలుగు</Badge>}
                      {v.hasRoman && <Badge>Romanized</Badge>}
                    </div>

                    <div className="mt-2 space-y-0.5 text-xs leading-relaxed text-white/45">
                      {preview(v).map((line, i) => (
                        <p key={i} className="truncate">
                          {line}
                        </p>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onUse?.(normalizeVersion(v), v.label)}
                        className="btn-glossy rounded-full px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                      >
                        View this
                      </button>
                      <button
                        type="button"
                        onClick={() => vote(v)}
                        disabled={voting === v.source || voted === v.source}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                          voted === v.source
                            ? "bg-accent/20 text-accent"
                            : "bg-white/10 text-white/80 hover:bg-white/15"
                        }`}
                      >
                        {voted === v.source ? <Check size={13} /> : <ThumbsUp size={13} />}
                        {voted === v.source ? "Voted" : "Best"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}

function Badge({ children }) {
  return (
    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/60">
      {children}
    </span>
  );
}
