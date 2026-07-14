# UI Design System

A dark, glassmorphic Apple Music–style look. Tokens are defined in
`tailwind.config.js` + `src/index.css` (`@layer components`). Keep new UI
consistent with these — do not introduce new color/radius/blur values ad hoc.

## Color

- Base background (in `index.css` `body`): near-black `#08080c` with two radial
  accent glows (accent red + violet), `background-attachment: fixed`.
- Accent: `#fa233b` (pink/red). Tailwind token `accent` (DEFAULT) + `accent.soft`
  (`#ff375f`). Used sparingly for emphasis: active states, primary buttons,
  progress fill, equalizer bars, glow shadows.
- Text: `text-white` for primary, `text-white/50`–`/60` for secondary,
  `text-white/30`–`/40` for tertiary/hints.

## Glass surfaces

Defined in `src/index.css`:
```css
.glass        { @apply border border-white/10 bg-white/5 backdrop-blur-2xl; }
.glass-strong { @apply border border-white/10 bg-white/10 backdrop-blur-2xl; }
```
- Use `.glass` for cards, bars, panels; `.glass-strong` for popovers/modals that
  must read above other glass.
- Borders: `border-white/10`. Background fills: `bg-white/5` (cards) or
  `bg-white/10` (stronger). Consistent with the task spec.

## Radius

- Small controls / thumbnails: `rounded-xl` (12px).
- Cards / panels: `rounded-2xl` (16px).
- Heroes / modals / big art: `rounded-3xl` (24px).
- Pills / buttons: `rounded-full`.

## Blur & shadows

- `backdrop-blur-2xl` is the standard glass blur; `backdrop-blur-xl` on the
  search input. `backdropBlur.xs = 2px` is configured but rarely used.
- `shadow-glass` (`0 8px 32px rgba(0,0,0,0.37)`) for floating surfaces.
- `shadow-glow` (`0 0 40px rgba(250,35,59,0.35)`) for accent/primary buttons and
  the Liked Songs hero gradient tile.

## Motion (Framer Motion)

- **View/route transitions**: simple `initial={{opacity:0}} animate={{opacity:1}}`
  fades (e.g. track lists, SearchView results).
- **Cards**: `whileHover={{ y: -6 }}` spring lift on `SongCard`/`ArtistCard`.
- **Now Playing expand**: `FullScreenPlayer` slides `y: "100%" → 0` with a spring
  (`stiffness 260, damping 32`); close reverses. `AnimatePresence` wraps it.
- **Popovers/menus/modals**: scale+opacity (`scale 0.95 → 1`, `duration 0.15`).
- **Equalizer**: CSS keyframe `equalizer` (`0.8s` infinite) on 3 bars while a
  track plays (`TrackRow`).
- **Nav active pill**: `layoutId="nav-active"` shared-layout motion in `Sidebar`.
- Respect "keep it minimal": no page-wide route transition library.

## Reusable components (one file each in `src/components/`)

| Component          | Role |
|--------------------|------|
| `Sidebar`          | Desktop left nav (Home/Search/Library) + brand |
| `MobileNav`        | Bottom tab bar (md and below) |
| `TopBar`           | Sticky search bar + recent/suggestions dropdown |
| `NowPlayingBar`    | Mini player (fixed bottom) |
| `FullScreenPlayer` | Immersive player (portal, z-80) |
| `QueuePanel`       | Slide-in Up Next (portal, z-50) |
| `SongCard`         | Grid tile (art, hover play, like, "•••") |
| `TrackRow`         | List row (index/equalizer, art, like, "•••") |
| `LikeButton`       | Heart toggle (animated) |
| `TrackMenu`        | "•••" popover: Play Next / Queue / Add to Playlist / Like / Go to… |
| `PlaylistModal`    | Create/rename playlist dialog (portal) |
| `PlaylistView`     | Playlist detail page (header, Play All/Shuffle, kebab) |
| `LibraryView`      | Library: Liked + Playlists + Recently Played |
| `HomeView`         | Hero + Trending + mood shelves + Popular Artists |
| `SearchView`       | Search results grid + empty/error/loading |
| `DetailView`       | Shared Artist/Album page (header + track list + skeletons) |
| `ArtistView`/`AlbumView` | thin wrappers → `DetailView` |
| `Section`          | Horizontal scrolling shelf (fetches or accepts `songs`) |
| `ArtistCard`       | Circular artist tile |
| `SkeletonCard`     | Loading placeholder for `SongCard` |

## Icons
`lucide-react` is the only icon source. Keep imports from `lucide-react`.

## Layout / responsive notes
- App shell: `Sidebar` (hidden `md:` below) + content + `NowPlayingBar`
  (fixed bottom) + `MobileNav` (`md:hidden`). Content `main` scrolls;
  `pb-44` (mobile) / `pb-40` (desktop) clears the bars.
- Grids: `grid-cols-2 sm:3 lg:4 xl:5 2xl:6`.
- Horizontal shelves use `.no-scrollbar` (scrollbar hidden, scroll preserved).
- Z-index order (high→low): PlaylistModal/confirm `z-[90/91]` > FullScreenPlayer
  `z-[80]` > TrackMenu `z-[60/61]` > QueuePanel `z-50` > MobileNav `z-40` >
  NowPlayingBar/TopBar `z-30`.
