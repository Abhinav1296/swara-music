import { useMemo } from "react";
import { VideoOff, Youtube } from "lucide-react";
import { buildExternalLinks } from "../utils/externalLinks";

/**
 * Full-screen player "Video" tab body.
 *
 * Video source strategy (in priority order):
 *   1) A direct video URL if the (future) Lyrica payload carries one — we check
 *      a small set of defensive field names on `song.metadata` / `song`.
 *   2) Otherwise a YouTube search embed built from the track name + artist.
 *
 * We never break audio playback: FullScreenPlayer pauses the in-app <audio>
 * element while this tab is open and restores it on close. This panel only
 * renders the embed + a graceful fallback link.
 */

// Candidate direct-video URL fields, in priority order. None are guaranteed to
// exist in today's Lyrica payload (its metadata.links are itunes/lastfm/etc.),
// so this list is purely forward-compatible.
const DIRECT_VIDEO_FIELDS = [
  "videoUrl",
  "video_url",
  "youtubeUrl",
  "youtube_url",
  "playable_url",
  "stream_url_video",
];

function findDirectVideoUrl(song) {
  const meta = song?.metadata;
  if (meta && typeof meta === "object") {
    for (const f of DIRECT_VIDEO_FIELDS) {
      const v = meta[f];
      if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
    }
  }
  for (const f of DIRECT_VIDEO_FIELDS) {
    const v = song?.[f];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

export default function VideoPanel({ current }) {
  const external = buildExternalLinks(current);

  const { directUrl, embedUrl, query } = useMemo(() => {
    const q = `${current?.trackName || ""} ${current?.artistName || ""} telugu official video`.trim();
    const direct = findDirectVideoUrl(current);
    const list = encodeURIComponent(q);
    return {
      directUrl: direct,
      embedUrl: direct || `https://www.youtube.com/embed?listType=search&list=${list}`,
      query: q,
    };
  }, [current]);

  // Graceful "Video unavailable" state when there is no track to build a query.
  if (!current?.trackName && !current?.artistName) {
    return (
      <div className="glass flex h-full flex-col items-center justify-center gap-2 rounded-2xl py-12 text-center">
        <VideoOff size={24} className="text-white/40" />
        <p className="text-sm text-white/60">Video unavailable</p>
        <p className="max-w-[15rem] text-xs text-white/30">No track is loaded.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative w-full overflow-hidden rounded-2xl bg-black aspect-video">
        <iframe
          key={embedUrl}
          src={embedUrl}
          title={`${current.trackName} — video`}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          frameBorder="0"
        />
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <p className="truncate text-xs text-white/40">
          {directUrl ? "Source video" : `YouTube search · ${query}`}
        </p>
        <a
          href={external.youtube}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <Youtube size={14} /> Open on YouTube
        </a>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-white/30">
        Some videos can’t be embedded and will show “Video unavailable” inside the
        frame — use “Open on YouTube” to watch there.
      </p>
    </div>
  );
}
