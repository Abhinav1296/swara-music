import { motion } from "framer-motion";
import { useRouter } from "../context/RouterContext";
import { placeholderArtwork } from "../utils/trackAdapter";

/**
 * Square, tappable album tile for the Albums browse grid. Navigates to the
 * album detail page by (name, year) so same-named films stay disambiguated.
 */
export default function AlbumCard({ album }) {
  const { navigate } = useRouter();
  if (!album?.name) return null;
  const art = album.artworkUrl600 || placeholderArtwork(album.name);

  return (
    <motion.button
      type="button"
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      onClick={() =>
        navigate("album", {
          name: album.name,
          year: album.year ?? undefined,
          // New-releases cards resolve by JioSaavn album id, not (name, year).
          saavnId: album.albumId ?? undefined,
        })
      }
      className="group flex w-full flex-col gap-2 rounded-2xl p-2 text-left transition hover:bg-white/5"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/5 shadow-lg ring-1 ring-white/10 transition group-hover:ring-accent/40">
        <img
          src={art}
          alt={album.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-semibold text-white">{album.name}</p>
        <p className="truncate text-xs text-white/45">
          {album.year ? `${album.year} · ` : ""}
          {album.count} song{album.count === 1 ? "" : "s"}
        </p>
      </div>
    </motion.button>
  );
}
