/** Loading placeholder that mirrors the SongCard silhouette. */
export default function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-3xl p-3 glass">
      <div className="aspect-square animate-pulse rounded-2xl bg-white/5" />
      <div className="space-y-2 px-1 pb-1">
        <div className="h-3 w-3/4 animate-pulse rounded bg-white/5" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
      </div>
    </div>
  );
}
