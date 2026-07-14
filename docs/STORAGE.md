# Storage

All persistence is `localStorage` (no backend DB, no accounts). Helpers live in
`frontend/src/utils/storage.js`. There is **no IndexedDB, no cookies, no
sessionStorage** in use.

## Helpers

```js
loadJSON(key, fallback)
  // try JSON.parse(localStorage.getItem(key)); on ANY error return fallback
  // (parse error, missing key, storage disabled) — never throws

saveJSON(key, value)
  // try localStorage.setItem(key, JSON.stringify(value)); ignore quota/errors
```

Both are wrapped in try/catch, so corrupt or unavailable storage degrades
gracefully (the app boots with defaults) rather than crashing.

## Every localStorage key

| Key                     | Type                         | Default       | Writer            |
|-------------------------|------------------------------|---------------|-------------------|
| `swara:liked`           | `{ [id:string]: Song }`      | `{}`          | LibraryContext    |
| `swara:recent`          | `Song[]` (≤25, newest first) | `[]`          | LibraryContext    |
| `swara:recentSearches`  | `string[]` (≤10, newest first)| `[]`        | useRecentSearches|
| `swara:volume`          | `number` (0..1)              | `0.8`         | PlayerContext     |
| `swara:shuffle`         | `"true"` / `"false"` (string)| `"false"`   | PlayerContext     |
| `swara:repeat`          | `"off"`\|`"all"`\|`"one"`    | `"off"`       | PlayerContext     |
| `swara:playlists`       | `Playlist[]`                 | `[]`          | PlaylistContext   |
| `swara:queue`           | `{current,upcoming,played,progress}` | `null` | PlayerContext |

`STORAGE_KEYS` in `storage.js` is the single source of truth for the key names.

## Read/write patterns per context

- **LibraryContext**: `likedMap`/`recent` initialized from `loadJSON` in
  `useState`; each change persisted via a `useEffect(() => saveJSON(...))`.
- **PlaylistContext**: `playlists` same pattern (init + effect-on-change).
- **PlayerContext**: `volume`/`shuffle`/`repeat` init from `loadJSON` and persist
  on change. The **queue** persists on change (after restore) **and** on
  `beforeunload`; see PLAYER_SYSTEM.md.

## Persistence guarantees

- **Guaranteed**: likes, recently played, recent searches, playlists, and player
  prefs (volume/shuffle/repeat) survive reloads and browser restarts. They are
  written on every state change via effects.
- **Best effort**: the queue snapshot (`swara:queue`) is written on every
  change and on `beforeunload`. The exact `progress` is captured at unload (not
  on every tick) to avoid thrashing storage.
- **No autoplay on restore**: a restored queue loads paused; the user resumes
  manually. `progress` is re-applied once the restored track's audio metadata
  loads. If the saved `current` has no `previewUrl`, only the queue is restored.

## Persistence non-guarantees / limits

- **Per-device only**: nothing syncs across browsers or machines (no account).
- **Not encrypted**: everything is plaintext in the user's own localStorage.
- **No schema migration**: if a future version changes a stored shape, old data
  is read as-is. Writers are defensive (e.g. `Array.isArray(saved.upcoming)`
  guards) but there is no migration layer. Bump behavior by reading defensively.
- **Quota**: localStorage is ~5MB; with full Song objects in playlists this is
  plenty, but extremely large playlists could hit the limit (errors are ignored).
- **No eviction policy** except caps: `recent` ≤ 25 (`MAX_RECENT` in
  LibraryContext), `recentSearches` ≤ 10. Playlists are unbounded.
