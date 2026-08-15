import { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { UserRound, X } from "lucide-react";
import { useAuth } from "./AuthContext";
import GoogleSignInButton from "../components/GoogleSignInButton";
import NativeGoogleSignInButton from "../components/NativeGoogleSignInButton";
import { isNativePlatform } from "../auth/nativeGoogleSignIn";

/**
 * Login gate. Some actions (creating a playlist, voting on lyrics) require an
 * account. Instead of each call site wiring its own sign-in modal, they call
 * `requireAuth(action, { reason })`:
 *   - already signed in  → the action runs immediately.
 *   - signed out         → a Google sign-in sheet pops up; once the user logs in
 *                          the pending action runs automatically ("continue").
 *
 * One shared sheet is rendered here at app root (portaled above everything), so
 * it sits over the player, the lyrics-versions modal, track menus, etc.
 */
const AuthGateContext = createContext(null);

// Per-reason copy for the sheet header.
const REASONS = {
  playlist: {
    title: "Sign in to create playlists",
    blurb: "Your playlists sync to your account and follow you across devices.",
  },
  vote: {
    title: "Sign in to vote",
    blurb: "Voting helps pick the best lyrics for everyone — sign in so your vote counts.",
  },
  default: {
    title: "Sign in to Swara",
    blurb: "Sign in to save your music and sync across devices.",
  },
};

export function AuthGateProvider({ children }) {
  const { isAuthed, login } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("default");
  const [err, setErr] = useState(null);
  const pendingRef = useRef(null); // action to resume after a successful login

  const requireAuth = useCallback(
    (action, opts = {}) => {
      if (isAuthed) {
        action?.();
        return;
      }
      pendingRef.current = typeof action === "function" ? action : null;
      setReason(opts.reason || "default");
      setErr(null);
      setOpen(true);
    },
    [isAuthed]
  );

  const close = useCallback(() => {
    pendingRef.current = null;
    setErr(null);
    setOpen(false);
  }, []);

  const onCredential = useCallback(
    async (idToken) => {
      setErr(null);
      try {
        await login(idToken);
        setOpen(false);
        const run = pendingRef.current;
        pendingRef.current = null;
        // Defer so this sheet unmounts before the resumed action opens its own UI.
        if (run) setTimeout(run, 0);
      } catch (e) {
        setErr(e?.message || "Sign-in failed. Please try again.");
      }
    },
    [login]
  );

  const info = REASONS[reason] || REASONS.default;

  return (
    <AuthGateContext.Provider value={{ requireAuth }}>
      {children}
      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm"
                onClick={close}
              />
              <div
                className="fixed inset-0 z-[111] flex items-center justify-center p-4"
                onClick={close}
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  onClick={(e) => e.stopPropagation()}
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  className="glass-strong relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 p-7 text-center shadow-glass"
                >
                  <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/25 blur-3xl" />
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    className="absolute right-3 top-3 rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                  <div className="relative">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full glass-glossy">
                      <UserRound size={26} className="text-white" />
                    </div>
                    <h2 className="mt-4 text-xl font-extrabold tracking-tight text-white">
                      {info.title}
                    </h2>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-white/55">{info.blurb}</p>
                    <div className="mt-6 flex justify-center">
                      {isNativePlatform() ? (
                        <NativeGoogleSignInButton onCredential={onCredential} onError={setErr} />
                      ) : (
                        <GoogleSignInButton onCredential={onCredential} onError={setErr} />
                      )}
                    </div>
                    {err && <p className="mt-3 text-xs text-red-400">{err}</p>}
                  </div>
                </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </AuthGateContext.Provider>
  );
}

export function useAuthGate() {
  const ctx = useContext(AuthGateContext);
  if (!ctx) throw new Error("useAuthGate must be used within an AuthGateProvider");
  return ctx;
}
