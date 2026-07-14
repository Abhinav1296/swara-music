# Data Models

All shapes are plain JSON-serializable objects. The frontend stores the
**full** Song object everywhere (likes, recents, playlists) so playback needs
no extra lookups.

## Song (from backend; also the unit stored client-side)

Mirrors `backend/app/schemas.py::Song` (after `lyrica._to_search_song` /
`_build_song_details` flatten it). It carries both canonical Swara fields and
legacy iTunes-era aliases so existing components keep working.

```ts
interface Song {
  // canonical Swara fields
  id: string;               // stable hash of artist|title (never 0/empty)
  title: string;
  artist: string;
  album: string;
  artwork: string;          // JioSaavn/Lyrica art, or a placeholder data URI
  durationMs: number | null;
  streamUrl: string | null; // full-length JioSaavn stream (null until resolved)
  hasFullStream: boolean;
  source: "lyrica";
  lyricsAvailable: boolean;

  // legacy aliases (read by presentational components)
  trackName: string;
  artistName: string;
  collectionName: string;
  artworkUrl100: string;
  artworkUrl600: string;
  previewUrl: string | null;     // == streamUrl when a stream exists
  trackTimeMillis: number | null;
  artistId: string | null;       // null now (no iTunes ids)
  collectionId: string | null;
  jiosaavnUrl: string | null;    // JioSaavn perma_url for fast stream resolve
}
```

- `id` is a **stable string** (hash of `artist|title`). It is the de-dupe /
  identity key everywhere client-side. Old iTunes-era library items may still
  carry a numeric `id`; both coexist in the liked/playlist maps.
- During playback, the player resolves `streamUrl` + synced lyrics via
  `/api/song-details` and updates `current` in place (preserving its `id`).
- `artworkUrl600` is preferred for large art; the frontend adapter guarantees a
  deterministic placeholder when `artwork` is empty, so `<img>` never breaks.

## Playlist (client-only, localStorage)

```ts
interface Playlist {
  id: string;            // crypto.randomUUID() (fallback random+Date)
  name: string;
  songs: Song[];         // FULL song objects, de-duplicated by Song.id
  createdAt: number;     // Date.now()
}
```

- Stored as `Playlist[]` under `swara:playlists`.
- `addToPlaylist` skips a song already present (`s.id === song.id`).
- Songs are full objects on purpose: no id-only store means offline/instant
  playback and no extra `/api/lookup`.

## Queue (client-only, localStorage — best effort)

```ts
interface QueueSnapshot {
  current: Song | null;
  upcoming: Song[];      // queued after current
  played: Song[];        // history before current
  progress: number;      // seconds into current at save time
}
```

- Stored under `swara:queue`.
- Restored on boot; `progress` is re-applied once the restored track's metadata
  loads. No autoplay (see PLAYER_SYSTEM.md).

## Router state (in-memory; mirrored to history state)

```ts
type RouteName = "home" | "search" | "library" | "playlist" | "artist" | "album";

interface Route {
  name: RouteName;
  params: {
    q?: string;          // search
    id?: string;         // artist | album | playlist
    name?: string;       // optional display name for deep links
  };
}
```

- `RouterContext` keeps `route` in React state and pushes/pops it via the
  History API (`pushState`/`replaceState`/`popstate`). See ROUTING.md.

## Likes (client-only, localStorage)

```ts
type LikedMap = { [songId: string]: Song };   // swara:liked (id is a string hash)
```

- Stored as an object (O(1) toggle) and reversed to an array for display
  (most-recently-liked first).

## Recently played (client-only, localStorage)

```ts
type RecentList = Song[];   // swara:recent, most-recent-first, capped at 25
```

- `addRecentlyPlayed` prepends and de-dupes by `Song.id`, capped (`MAX_RECENT`).

## Recent searches (client-only, localStorage)

```ts
type RecentSearches = string[];   // swara:recentSearches, most-recent-first, capped 10
```

## localStorage keys and value formats

| Key                     | Value                                   | Written by |
|-------------------------|-----------------------------------------|------------|
| `swara:liked`           | `{ [id]: Song }`                        | LibraryContext |
| `swara:recent`          | `Song[]` (≤25)                          | LibraryContext |
| `swara:recentSearches`  | `string[]` (≤10)                        | useRecentSearches |
| `swara:volume`          | `number` (0..1)                         | PlayerContext |
| `swara:shuffle`         | `"true"` / `"false"` (string!)          | PlayerContext |
| `swara:repeat`          | `"off"` \| `"all"` \| `"one"`           | PlayerContext |
| `swara:playlists`       | `Playlist[]`                            | PlaylistContext |
| `swara:queue`           | `QueueSnapshot`                         | PlayerContext |

Notes:
- `shuffle` is persisted as a **string** (`String(bool)`) by design; read back
  with `Boolean(...)`.
- All reads go through `utils/storage.js::loadJSON(key, fallback)` which catches
  parse/storage errors and returns the fallback (so corrupt storage never
  crashes the app).
