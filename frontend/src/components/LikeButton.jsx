import { Heart } from "lucide-react";
import { motion } from "framer-motion";
import { useLibrary } from "../context/LibraryContext";

/** Heart toggle for liking/unliking a song. Animates on state change. */
export default function LikeButton({ song, className = "", size = 18 }) {
  const { isLiked, toggleLike } = useLibrary();
  if (!song) return null;
  const liked = isLiked(song.id);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleLike(song);
      }}
      aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
      className={`flex items-center justify-center rounded-full transition ${className}`}
    >
      <motion.span
        key={liked ? "on" : "off"}
        initial={{ scale: 0.6 }}
        animate={{ scale: liked ? [1, 1.35, 1] : 1 }}
        transition={{ duration: 0.3 }}
      >
        <Heart
          size={size}
          className={liked ? "fill-accent text-accent" : "text-white/70 hover:text-white"}
        />
      </motion.span>
    </button>
  );
}
