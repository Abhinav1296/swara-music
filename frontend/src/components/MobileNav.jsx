import { Disc3, Home, Library, Search } from "lucide-react";
import { useRouter } from "../context/RouterContext";

const ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "albums", label: "Albums", icon: Disc3 },
  { id: "library", label: "Library", icon: Library },
];

/** Bottom tab bar for mobile (md and below). Mirrors the desktop sidebar. */
export default function MobileNav() {
  const { route, navigate } = useRouter();
  const active = route.name;

  return (
    <nav className="glass fixed bottom-0 left-0 right-0 z-40 flex border-t md:hidden">
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
              isActive ? "text-accent" : "text-white/55"
            }`}
          >
            <Icon size={22} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
