import { useEffect, useRef, useState } from "react";
import { Clock, Search, TrendingUp, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRecentSearches } from "../hooks/useRecentSearches";

// Curated, always-available Telugu search suggestions.
const SUGGESTIONS = [
  "Sid Sriram",
  "Anirudh Ravichander",
  "Anurag Kulkarni",
  "Devi Sri Prasad",
  "S. Thaman",
  "Shreya Ghoshal",
  "S. P. Balasubrahmanyam",
  "Romantic Telugu",
  "Mass Telugu Songs",
  "Melody Telugu",
  "Latest Telugu Songs",
  "Telugu Devotional",
];

// Search debounce config
const DEBOUNCE_MS = 700;
const MIN_CHARS = 3;

/**
 * Sticky glass top bar with a debounced, live-search field.
 * - Typing (after DEBOUNCE_MS pause AND >= MIN_CHARS) triggers a search.
 * - Skips identical consecutive queries to avoid duplicate fetches.
 * - Focusing shows a dropdown: recent searches + curated suggestions.
 * - Enter / clicking a suggestion always searches (bypasses min-chars).
 */
export default function TopBar({ onSearch }) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [debounced, setDebounced] = useState("");
  const wrapRef = useRef(null);
  const lastFiredRef = useRef("");

  const { items: recent, add: addRecent, clear: clearRecent, remove: removeRecent } =
    useRecentSearches();

  // Debounce the input.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  // Fire the search only when:
  // - debounced value has at least MIN_CHARS
  // - it is different from the last fired query (skip identical repeats)
  useEffect(() => {
    const term = debounced.trim();
    if (term.length < MIN_CHARS) return;
    if (term === lastFiredRef.current) return;
    lastFiredRef.current = term;
    onSearch(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Close dropdown on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Explicit search (Enter / suggestion click) bypasses min-chars gate.
  const runSearch = (q) => {
    const term = (q || "").trim();
    if (!term) return;
    setValue(term);
    addRecent(term);
    setFocused(false);
    lastFiredRef.current = term;
    onSearch(term);
  };

  const submit = (e) => {
    e.preventDefault();
    runSearch(value);
  };

  const term = value.trim().toLowerCase();
  const filtered = SUGGESTIONS.filter((s) => s.toLowerCase().includes(term));
  const showDropdown = focused;

  return (
    <header className="glass sticky top-0 z-30 flex items-center border-b px-4 pb-3 pt-[calc(0.75rem_+_env(safe-area-inset-top))] md:px-6 md:pb-4 md:pt-[calc(1rem_+_env(safe-area-inset-top))]">
      <div ref={wrapRef} className="relative w-full max-w-xl">
        <form onSubmit={submit}>
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search Telugu songs, artists, albums…"
            aria-label="Search Telugu music"
            className="w-full rounded-full bg-white/10 py-2.5 pl-11 pr-10 text-sm text-white outline-none ring-1 ring-white/10 backdrop-blur-xl transition placeholder:text-white/40 focus:bg-white/15 focus:ring-white/25"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                lastFiredRef.current = "";
              }}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 transition hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </form>

        <AnimatePresence>
          {showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="glass-strong absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-2xl p-2 shadow-glass"
            >
              {term === "" && recent.length > 0 && (
                <div className="mb-1">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-white/40">
                      Recent
                    </span>
                    <button
                      type="button"
                      onClick={clearRecent}
                      className="text-xs text-white/40 transition hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                  {recent.map((r) => (
                    <div
                      key={r}
                      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10"
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => runSearch(r)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-white/80"
                      >
                        <Clock size={15} className="shrink-0 text-white/40" />
                        <span className="truncate">{r}</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => removeRecent(r)}
                        aria-label="Remove"
                        className="text-white/30 opacity-0 transition hover:text-white group-hover:opacity-100"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                {term === "" && (
                  <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/40">
                    Suggestions
                  </div>
                )}
                {filtered.length === 0 && (
                  <p className="px-2 py-3 text-sm text-white/40">No suggestions.</p>
                )}
                {filtered.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => runSearch(s)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                  >
                    <TrendingUp size={15} className="shrink-0 text-white/40" />
                    <span className="truncate">{s}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}