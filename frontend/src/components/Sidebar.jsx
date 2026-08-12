import { Disc3, Home, Library, Music2, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "../context/RouterContext";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "albums", label: "Albums", icon: Disc3 },
  { id: "library", label: "Library", icon: Library },
];

/**
 * Left navigation rail with a frosted-glass surface.
 * Desktop-first: hidden on small screens (the MobileNav replaces it).
 */
export default function Sidebar() {
  const { route, navigate } = useRouter();

  return (
    <aside className="glass hidden w-60 shrink-0 flex-col gap-2 border-r p-4 md:flex">
      {/* Brand */}
      <div className="flex items-center gap-3 px-3 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent shadow-glow">
          <Music2 size={18} className="text-white" />
        </div>
        <span className="text-lg font-bold tracking-tight">
          Swara<span className="text-accent">.</span>
        </span>
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex flex-col gap-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = route.name === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id)}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "text-white" : "text-white/55 hover:text-white"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-xl bg-white/10"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Icon size={20} className="relative z-10" />
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto px-3 py-3 text-[11px] leading-relaxed text-white/30">
        Powered by Lyrica + JioSaavn. Full Telugu tracks, streamed.
      </div>
    </aside>
  );
}
