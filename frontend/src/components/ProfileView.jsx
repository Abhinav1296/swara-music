import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, LogOut, Pencil, RefreshCw, UserRound, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import GoogleSignInButton from "./GoogleSignInButton";

// Suggested singers to seed the "favorites" picker (users can add any others).
const SUGGESTED_SINGERS = [
  "Sid Sriram",
  "Anirudh Ravichander",
  "Devi Sri Prasad",
  "S. Thaman",
  "Shreya Ghoshal",
  "Anurag Kulkarni",
  "S. P. Balasubrahmanyam",
  "Chinmayi",
  "Karthik",
  "Kaala Bhairava",
  "Sunidhi Chauhan",
  "Armaan Malik",
];

/** Account / profile page — sign-in card when logged out, editor when logged in. */
export default function ProfileView() {
  const { user, isAuthed, loading, login, logout } = useAuth();
  const [loginErr, setLoginErr] = useState(null);

  const onCredential = async (idToken) => {
    setLoginErr(null);
    try {
      await login(idToken);
    } catch (e) {
      setLoginErr(e.message || "Sign-in failed. Please try again.");
    }
  };

  if (!isAuthed) {
    return (
      <div className="pt-2">
        <div className="mx-auto mt-6 max-w-md">
          <div className="glass relative overflow-hidden rounded-3xl p-8 text-center">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
            <div className="relative">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full glass-glossy">
                <UserRound size={30} className="text-white" />
              </div>
              <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-white">
                Sign in to Swara
              </h1>
              <p className="mx-auto mt-2 max-w-xs text-sm text-white/55">
                Save your playlists, pick your favorite singers, and sync across devices.
              </p>
              <div className="mt-6 flex justify-center">
                {loading ? (
                  <Loader2 size={22} className="animate-spin text-white/60" />
                ) : (
                  <GoogleSignInButton onCredential={onCredential} onError={setLoginErr} />
                )}
              </div>
              {loginErr && <p className="mt-3 text-xs text-red-400">{loginErr}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <ProfileEditor key={user.id} logout={logout} />;
}

/** The signed-in editor: header, name edit, favorite singers, account actions. */
function ProfileEditor({ logout }) {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.name || "");
  const [editingName, setEditingName] = useState(false);
  const [fav, setFav] = useState(() => user.favoriteSingers || []);
  const [savingName, setSavingName] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user.name) {
      setEditingName(false);
      setName(user.name || "");
      return;
    }
    setSavingName(true);
    try {
      await updateProfile({ name: trimmed });
      setEditingName(false);
    } catch {
      /* keep editing on failure */
    } finally {
      setSavingName(false);
    }
  };

  const toggleFav = async (singer) => {
    const has = fav.some((s) => s.toLowerCase() === singer.toLowerCase());
    const next = has
      ? fav.filter((s) => s.toLowerCase() !== singer.toLowerCase())
      : [...fav, singer];
    setFav(next); // optimistic
    try {
      await updateProfile({ favoriteSingers: next });
    } catch {
      setFav(fav); // revert on failure
    }
  };

  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  const chips = Array.from(new Set([...fav, ...SUGGESTED_SINGERS]));

  return (
    <div className="pt-2">
      {/* Header */}
      <div className="relative mb-8 overflow-hidden rounded-3xl">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
        <div className="glass relative flex flex-col items-center gap-5 p-7 text-center sm:flex-row sm:gap-6 sm:text-left">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
            {user.picture && imgOk ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setImgOk(false)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/50 to-accent/20 text-3xl font-bold text-white">
                {initial}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/45">Profile</p>
            {editingName ? (
              <div className="mt-1 flex items-center justify-center gap-2 sm:justify-start">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && saveName()}
                  className="w-full max-w-xs rounded-xl bg-white/10 px-3 py-1.5 text-lg font-bold text-white outline-none ring-1 ring-white/15 focus:ring-white/30"
                />
                <button
                  type="button"
                  onClick={saveName}
                  disabled={savingName}
                  aria-label="Save name"
                  className="btn-glossy rounded-full p-2 text-white disabled:opacity-50"
                >
                  {savingName ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingName(false);
                    setName(user.name || "");
                  }}
                  aria-label="Cancel"
                  className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-center gap-2 sm:justify-start">
                <h1 className="truncate text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                  {user.name}
                </h1>
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  aria-label="Edit name"
                  className="rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                >
                  <Pencil size={15} />
                </button>
              </div>
            )}
            <p className="mt-1 truncate text-sm text-white/55">{user.email}</p>
          </div>
        </div>
      </div>

      {/* Favorite singers */}
      <section className="mb-8">
        <div className="mb-1 px-1">
          <h2 className="text-lg font-bold tracking-tight text-white">Favorite singers</h2>
          <p className="text-sm text-white/45">
            Tap to add — we’ll use these to tune your recommendations later.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {chips.map((singer) => {
            const active = fav.some((s) => s.toLowerCase() === singer.toLowerCase());
            return (
              <button
                key={singer}
                type="button"
                onClick={() => toggleFav(singer)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "glass-glossy text-white ring-1 ring-accent/60"
                    : "glass-glossy text-white/60 hover:text-white"
                }`}
              >
                {active && <Check size={14} className="text-accent" />}
                {singer}
              </button>
            );
          })}
        </div>
      </section>

      {/* Account actions */}
      <section className="mb-8">
        <h2 className="mb-3 px-1 text-lg font-bold tracking-tight text-white">Account</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={logout}
            className="glass-glossy flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white/80 transition hover:text-white"
          >
            <RefreshCw size={17} /> Switch account
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex items-center justify-center gap-2 rounded-2xl bg-red-500/15 px-5 py-3 text-sm font-semibold text-red-300 ring-1 ring-red-500/25 transition hover:bg-red-500/25"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </section>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="px-1 text-[11px] text-white/30"
      >
        Signed in with Google. Your playlists will sync to this account.
      </motion.p>
    </div>
  );
}
