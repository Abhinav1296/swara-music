# Routing

A dependency-free client-side router (`context/RouterContext.jsx`). No router
library is used. Routes are "named" with optional params and synced to the
browser History API so back/forward work.

## Routes / views

| Route `name` | View component        | Params        | Sidebar / Mobile nav |
|--------------|-----------------------|---------------|----------------------|
| `home`       | `HomeView`            | —             | Home                 |
| `search`     | `SearchView`          | `q`           | Search               |
| `library`    | `LibraryView`         | —             | Library              |
| `playlist`   | `PlaylistView`        | `id`, `name?` | (opened from Library)|
| `artist`     | `ArtistView`→`DetailView` | `name`        | —                  |
| `album`      | `AlbumView`→`DetailView`  | `name`, `artist?` | —              |

`App.jsx` switches on `route.name` to render the active view. `ArtistView` and
`AlbumView` are thin wrappers that pass `route.params` into `DetailView`.

## Deep-link URL formats

| View     | URL                                      | Notes |
|----------|------------------------------------------|-------|
| Home     | `/`                                      | |
| Search   | `/search?q=<encoded term>`               | `q` required for results |
| Library  | `/library`                               | |
| Playlist | `/playlist?id=<id>&name=<name>`          | `id` required; `name` optional display hint |
| Artist   | `/artist?name=<name>`                    | `name` required |
| Album    | `/album?name=<name>&artist=<artist>`    | `name` required; `artist` optional disambiguation |

- Paths are lowercase route names; params are query strings (`?name=…&artist=…`).
- On **cold boot**, `routeFromLocation()` parses `window.location` into
  `{name, params}`. A detail route without its required param (`name` for
  artist/album, `id` for playlist) falls back to `home` (a meaningless deep link).
  Legacy URLs that carry both `id` **and** `name` still boot correctly — the
  `name` is what `DetailView`/`/api/lookup` actually resolve by.
- Artist/album views are addressed by **name** (Lyrica/JioSaavn have no ids).
  `DetailView` calls `/api/lookup` with `type=artist|album` + `name` (and an
  optional `artist` hint for albums); the backend resolves by JioSaavn search.
  This fixes the post-migration regression where `Song.id` was a hash and
  `artistId`/`collectionId` were `null`. Playlists resolve from localStorage via
  `id` (unaffected).

## Back / forward behavior
- `navigate(name, params, opts)` calls `history.pushState` (or `replaceState`
  when `opts.replace`, e.g. typing more in an already-open search) and sets
  React state.
- `popstate` restores the route from `e.state` (which holds the full
  `{name, params}` object). If state is missing, it falls back to
  `routeFromLocation()`.
- On mount, the provider does **one** `history.replaceState` with the booted
  route so the first Back press has a real state to return to (otherwise the
  initial history entry has no state).
- Because each navigation pushes full state, Back/Forward are stable and never
  lose params.

## How RouterContext works (pseudo-code)

```js
KNOWN = { home, search, library, artist, album, playlist }

function urlFor(name, params):
  if name == "home": return "/"
  if name == "search" && params.q: return `/search?q=${enc(params.q)}`
  if name == "playlist" && params.id:
      u = `/playlist?id=${enc(params.id)}`
      if params.name: u += `&name=${enc(params.name)}`
      return u
  if name in {artist, album} && params.name:
      u = `/${name}?name=${enc(params.name)}`
      if name == "album" && params.artist: u += `&artist=${enc(params.artist)}`
      return u
  return `/${name}`

function routeFromLocation():
  path = location.pathname.split("/")[0] || "home"
  name = KNOWN.has(path) ? path : "home"
  qs   = new URLSearchParams(location.search)
  params = {}
  if name == "search":  params.q = qs.get("q")
  if name == "playlist" && qs.get("id"):
      params.id = qs.get("id")
      params.name = qs.get("name")   // optional
  if name in {artist, album} && qs.get("name"):
      params.name = qs.get("name")
      if name == "album": params.artist = qs.get("artist")  // optional
  if name == "playlist" && !params.id: return { name: "home", params: {} }
  if name in {artist, album} && !params.name: return { name: "home", params: {} }
  return { name, params }

Provider:
  route = useState(routeFromLocation())        // boot from URL
  useEffect(mount): history.replaceState(route, "", urlFor(route))

  navigate(name, params, {replace}):
      next = {name, params}
      setRoute(next)
      replace ? history.replaceState(next, "", url)
              : history.pushState(next, "", url)

  onPopState(e):
      e.state?.name ? setRoute(e.state) : setRoute(routeFromLocation())

value = { route, navigate }
```

## Gotchas
- `navigate` is `useCallback([])` stable; views should not rely on it changing.
- `Sidebar`/`MobileNav` compute "active" from `route.name` only (a playlist is
  not a primary nav item, so it won't highlight a nav button — by design).
- The `<audio>` element and player state live outside routing; navigating
  between views never stops playback.
- Vite dev server serves `index.html` for unknown paths (SPA fallback), so deep
  links like `/artist?name=…` resolve to the app on refresh.
