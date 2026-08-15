import { useRef } from "react";
import { FolderPlus, Loader2, Music2, Play, Trash2 } from "lucide-react";
import { useLocalSongs } from "../context/LocalSongsContext";
import { usePlayer } from "../context/PlayerContext";
import { formatTime } from "../utils/format";

/**
 * "Local Files" — import and play the user's own audio files from the device
 * (B3). Native/APK only: off native `capable` is false and this renders nothing,
 * so the web app never shows it. Imported songs play through the same player as
 * everything else (the play path routes local files with no network — see
 * PlayerContext.playLocalIfAvailable).
 */
export default function LocalFilesSection() {
  const { capable, songs, importing, importFiles, remove } = useLocalSongs();
  const { current, isPlaying, play } = usePlayer();
  const inputRef = useRef(null);

  if (!capable) return null;

  const onPick = (e) => {
    importFiles(e.target.files);
    // Reset so re-picking the same file fires change again.
    e.target.value = "";
  };

  return (
    <section className="mb-8 mt-10">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={onPick}
        className="hidden"
      />

      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-white">Local Files</h2>
          <p className="mt-0.5 text-sm text-white/40">
            {importing > 0
              ? `Importing ${importing} ${importing === 1 ? "file" : "files"}…`
              : `${songs.length} on this device`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
        >
          {importing > 0 ? (
            <Loader2 size={16} className="animate-spin text-accent" />
          ) : (
            <FolderPlus size={16} />
          )}
          Add
        </button>
      </div>

      {songs.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
            <Music2 size={24} className="text-white/40" />
          </div>
          <p className="text-white/70">No local songs yet.</p>
          <p className="max-w-xs text-sm text-white/30">
            Tap <span className="text-white/50">Add</span> to import audio files from your
            device. They play offline, no network needed.
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

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-white/15 to-white/5">
                  <Music2 size={18} className="text-white/70" />
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
                  aria-label="Remove local song"
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
