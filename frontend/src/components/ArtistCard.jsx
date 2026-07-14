import { motion } from "framer-motion";
import { useRouter } from "../context/RouterContext";

/** Circular, tappable artist tile used in the Popular Artists shelf. */
export default function ArtistCard({ artist }) {
  const { navigate } = useRouter();
  if (!artist?.name) return null;

  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      onClick={() => navigate("artist", { name: artist.name })}
      className="group flex w-40 shrink-0 cursor-pointer flex-col items-center gap-3"
    >
      <div className="relative h-40 w-40 overflow-hidden rounded-full bg-white/5 shadow-lg ring-1 ring-white/10 transition group-hover:ring-accent/40">
        <img
          src={artist.artwork}
          alt={artist.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <p className="w-40 truncate text-center text-sm font-semibold text-white">{artist.name}</p>
      <p className="text-xs text-white/40">Artist</p>
    </motion.div>
  );
}
