import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

/**
 * Lightweight modal for creating or renaming a playlist. Premium frosted
 * surface; focus is captured on the text input and Enter submits.
 *
 * Props:
 *   open        – whether the modal is visible
 *   title       – heading text
 *   submitLabel – button text (e.g. "Create" / "Rename")
 *   initialName – pre-filled name when renaming
 *   onSubmit(name) – called with the trimmed name on confirm
 *   onClose     – called on cancel / backdrop click / Esc
 *   nameTaken(name) – optional; return true if the trimmed name already exists.
 *                     When it does, submit is blocked and an inline hint shows.
 */
export default function PlaylistModal({
  open,
  title = "New Playlist",
  submitLabel = "Create",
  initialName = "",
  onSubmit,
  onClose,
  nameTaken,
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef(null);

  // Sync the input whenever the modal opens (e.g. switching to rename mode).
  useEffect(() => {
    if (open) {
      setName(initialName);
      // Defer focus until after the open animation mounts the input.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const trimmed = name.trim();
  const taken = Boolean(trimmed) && Boolean(nameTaken?.(trimmed));

  const submit = (e) => {
    e.preventDefault();
    if (!trimmed || taken) return;
    onSubmit?.(trimmed);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <div
            className="fixed inset-0 z-[91] flex items-center justify-center p-4"
            onClick={onClose}
          >
          <motion.div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="glass-strong w-full max-w-sm rounded-3xl border border-white/10 p-6 shadow-glass"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submit}>
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Playlist name"
                aria-label="Playlist name"
                maxLength={60}
                aria-invalid={taken}
                className={`w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 transition placeholder:text-white/40 focus:bg-white/15 ${
                  taken
                    ? "ring-accent/70 focus:ring-accent"
                    : "ring-white/10 focus:ring-white/25"
                }`}
              />
              {taken && (
                <p className="mt-2 px-1 text-xs font-medium text-accent">
                  You already have a playlist named “{trimmed}”.
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-4 py-2 text-sm font-medium text-white/60 transition hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!trimmed || taken}
                  className="btn-glossy rounded-full px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-30"
                >
                  {submitLabel}
                </button>
              </div>
            </form>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
