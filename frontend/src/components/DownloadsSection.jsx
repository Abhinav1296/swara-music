import { ArrowDownToLine, Music2, Play, Trash2 } from "lucide-react";
import { useOffline } from "../context/OfflineContext";
import { usePlayer } from "../context/PlayerContext";
import { formatTime } from "../utils/format";

/**
 * "Downloads" — songs saved for offline playback (B2). Native/APK only: off
 * native `capable` is false and this renders nothing, so the web app never shows
 * it. Downloaded songs play through the same player, which prefers the local
 * file with no network (see offline/downloads.js + the PlayerContext resolve
 * path). Items come straight from the offline store's { [id]: record } map —
 * each record is already a playable song — newest download first.
 */
export default function DownloadsSection() {
  const { capable, downloads, remove } = useOffline();
  const { current, isPlaying, play } = usePlayer();

  if (!capable) return null;

  const songs = Object.values(downloads).sort(
    (a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0)
  );

  return (
    <section className="mb-8 mt-10">
      <div className="mb-4 min-w-0">
        <h2 className="text-xl font-bold text-white">Downloads</h2>
        <p className="mt-0.5 text-sm text-white/40">
          {songs.length === 0
            ? "Saved for offline"
            : `${songs.length} ${songs.length === 1 ? "song" : "songs"} on this device`}
        </p>
      </div>

      {songs.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
            <ArrowDownToLine size={24} className="text-white/40" />
          </div>
          <p className="text-white/70">No downloads yet.</p>
          <p className="max-w-xs text-sm text-white/30">
            Tap the <span className="text-white/50">⋮</span> on any song and choose{" "}
            <span className="text-white/50">Download</span> to save it here for offline,
            no-network playback.
          </p>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          {songs.map((song, index) => {
            const isActive = current?.id === song.id;
            const isPlayingThis = isActive && isPlaying;
            return (
              <div
                key={song.id}
                onClick={() => play(song, songs)}
                className={`group flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${
                  isActive ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                {/* index / equalizer / play */}
                <div className="flex w-6 shrink-0 items-center justify-center">
                  {isPlayingThis ? (
                    <span className="flex items-end gap-0.5" aria-hidden="true">
                      <span className="h-3 w-0.5 animate-equalizer rounded-full bg-accent" />
                      <span
                        className="h-3 w-0.5 animate-equalizer rounded-full bg-accent"
                        style={{ animationDelay: "0.2s" }}
                      />
                      <span
                        className="h-3 w-0.5 animate-equalizer rounded-full bg-accent"
                        style={{ animationDelay: "0.4s" }}
                      />
                    </span>
                  ) : (
                    <>
                      <span
                        className={`text-sm tabular-nums group-hover:hidden ${
                          isActive ? "text-accent" : "text-white/40"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="hidden text-white group-hover:block">
                        <Play size={16} fill="white" className="ml-0.5" />
                      </span>
                    </>
                  )}
                </div>

                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-white/15 to-white/5">
                  {song.artworkUrl600 ? (
                    <img src={song.artworkUrl600} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Music2 size={18} className="text-white/70" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${
                      isActive ? "text-accent" : "text-white"
                    }`}
                    title={song.trackName}
                  >
                    {song.trackName}
                  </p>
                  <p className="truncate text-xs text-white/50" title={song.artistName}>
                    {song.artistName}
                  </p>
                </div>

                {song.trackTimeMillis ? (
                  <span className="hidden shrink-0 text-xs tabular-nums text-white/40 sm:block">
                    {formatTime(song.trackTimeMillis / 1000)}
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(song.id);
                  }}
                  aria-label="Remove download"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
