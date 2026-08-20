import { Disc3, Home, Library, Search, UserRound } from "lucide-react";
import { useRouter } from "../context/RouterContext";
import { useAuth } from "../context/AuthContext";
import CachedImage from "./CachedImage";

const ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "albums", label: "Albums", icon: Disc3 },
  { id: "library", label: "Library", icon: Library },
  { id: "profile", label: "You", icon: UserRound },
];

/** Bottom tab bar for mobile (md and below). Mirrors the desktop sidebar. */
export default function MobileNav() {
  const { route, navigate } = useRouter();
  const { user, isAuthed } = useAuth();
  const active = route.name;

  return (
    <nav className="glass fixed bottom-0 left-0 right-0 z-40 flex h-[calc(4rem_+_env(safe-area-inset-bottom))] border-t pb-[env(safe-area-inset-bottom)] md:hidden">
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        const showAvatar = id === "profile" && isAuthed && user?.picture;
        return (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
              isActive ? "text-accent" : "text-white/55"
            }`}
          >
            {showAvatar ? (
              <CachedImage
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className={`h-[22px] w-[22px] rounded-full object-cover ${
                  isActive ? "ring-2 ring-accent" : "ring-1 ring-white/20"
                }`}
              />
            ) : (
              <Icon size={22} />
            )}
            {label}
          </button>
        );
      })}
    </nav>
  );
}
