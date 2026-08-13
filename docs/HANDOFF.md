# Handoff — Start Here

A concise onboarding for the next AI session. Read this, then the files listed
under "Read first". The codebase is small and self-contained; most questions
are answered by the docs in this `/docs` folder.

## What NOT to break

1. **The thin-proxy contract**: backend stays a free, keyless Lyrica proxy
   (Lyrica → LRCLib/MusicBrainz lyrics + JioSaavn audio). Do not swap the music
   provider or add API keys unless explicitly approved.
2. **localStorage schemas** (see STORAGE.md / DATA_MODELS.md): `swara:*` keys and
   shapes. Changing them risks reading stale user data with no migration layer.
3. **The single shared `<audio>` element + three-part queue** in
   `PlayerContext` (current/upcoming/played). Playback bugs are easy to
   introduce here — preserve `transportRef`/`goNextRef` stale-closure guards.
4. **No auth / no accounts**: the product is deliberately device-local. Don't
   add login or a backend DB unless the user asks.
5. **Design tokens** (UI_DESIGN_SYSTEM.md): use `.glass`/`.glass-strong`,
   `accent #fa233b`, `rounded-2xl/3xl`, `border-white/10`. Don't scatter new
   ad-hoc colors/radii.
6. **Dependencies**: intentionally minimal (React, Vite, Tailwind, Framer
   Motion, lucide-react, fastapi, uvicorn, httpx, python-dotenv). Don't add
   heavy libs (no router lib, no Redux, no UI kit) without approval.
7. **Legal bridge only**: external links open search URLs in a new tab; never
   add in-app lyrics/audio *scraping* of those services. In-app audio is the
   full JioSaavn stream resolved through Lyrica — no iTunes previews.

## Run commands

```bash
# Terminal 1 — backend (FastAPI, :8000)
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend (Vite, :5173)
cd frontend
npm install
npm run dev                        # http://localhost:5173  (proxies /api → :8000)

# Production build / preview
cd frontend && npm run build && npm run preview
```
- Frontend dev server proxies `/api` → `http://localhost:8000` (no CORS config
  needed in the browser). Swagger docs at `http://localhost:8000/docs`.
- No env files required (sensible defaults). Optional `.env` / `.env.example`
  exist for both packages.

## Read first (in this order)

1. `docs/ARCHITECTURE.md` — structure, providers, audio architecture.
2. `docs/PLAYER_SYSTEM.md` — the most stateful/risky code.
3. `frontend/src/App.jsx` — provider nesting + view switch (the map of the app).
4. `frontend/src/context/PlayerContext.jsx` — playback + persistence.
5. `frontend/src/context/RouterContext.jsx` — routes/deep links.
6. `docs/DATA_MODELS.md` + `docs/STORAGE.md` — shapes and persistence.
7. `backend/app/services/itunes.py` + `routes/search.py` — API behavior.
8. `frontend/src/lyrics/lyrics.js` + `src/utils/externalLinks.js` — Phase 4 lyrics + links.

Skip-reading the component files is fine; they are one-file-per-component and
mostly presentational. `FullScreenPlayer`, `PlaylistView`, `TrackMenu`,
`PlaylistContext` are the Phase 3 additions.

## Testing checklist (manual, browser)

- [ ] `npm run build` passes (no type/import errors).
- [ ] Home loads: hero + Trending + mood shelves + Popular Artists.
- [ ] Search: type a term → live results; Enter saves to recents; refresh on
      `/search?q=…` restores the view.
- [ ] Play a song → mini bar shows art/title; Space toggles play/pause.
- [ ] Open full-screen player (click art / expand) → controls, seek, volume,
      Up Next; Esc/minimize returns to mini bar.
- [ ] Like a song → appears in Library "Liked Songs"; reload persists.
- [ ] Create a playlist (Library → New) → add a song via "•••" → Add to
      Playlist; open playlist → Play All; reload persists.
- [ ] Rename / delete a playlist (playlist "•••") → confirm on delete.
- [ ] Queue: Play Next / Add to Queue → QueuePanel shows order; remove/clear.
- [ ] Deep link `/artist?name=…` and `/album?name=…[&artist=…]` from a track's
      "•••" → Go to… works; refresh keeps the view.
- [ ] Reload mid-playback → queue + current track restored (paused; press play
      resumes from saved position).
- [ ] Back/Forward buttons navigate route history correctly.
- [ ] Track `•••` → `Open In` → YouTube / Spotify / Apple Music opens a new tab.
- [ ] Full-screen player → Lyrics tab shows real synced/plain lyrics from Lyrica
      (when available); active line highlights + auto-scrolls; tapping a line
      seeks.

## Highest-value next tasks (suggested, not started)

1. **Caching / perf for Home** — reduce the ~8 cold-load requests (cache
   searches, memoize Popular Artists). The local "Because You Liked" shelf
   (built from local likes, no backend) is DONE; it self-defers so it never
   slows cold-load. Remaining: cache the mood/Popular-Artists fetches more
   aggressively.
- **Phase 4 DONE** — Video Song Mode (full-screen Video tab: YouTube search
  embed, pauses in-app audio while open, "Play Video Song" in TrackMenu) and the
  local "Because You Liked" shelf on Home. Branch `worktree-perf-stabilization`
  now targets `main` (created at the playback-robustness baseline).
2. **Playlist quality-of-life** — reorder tracks (drag), duplicate-song
   indicators, and a "playlist from Liked" shortcut. Keep localStorage model.
3. **Accessibility & keyboard nav** — focus management in modals/menus,
   `aria` improvements, visible focus rings; currently Space/keys are partially
   handled.
4. **Resilient storage** — add a tiny versioned migration for `swara:*` keys so
   future schema changes don't read stale data.
5. **Artist / Album deep links — DONE** — browsing now navigates by
   `artistName` / `collectionName` (Lyrica/JioSaavn have no ids). `/api/lookup`
   gained `type=artist|album` and resolves by name; `DetailView`, `TrackMenu`,
   `SongCard`, `TrackRow`, and `ArtistCard` all navigate by name. URLs are
   `/artist?name=…` and `/album?name=…[&artist=…]`; refresh restores the view.
   Residual: album links are best-effort (only when JioSaavn returns album
   metadata); artist pages are a filtered JioSaavn search, not a canonical
   discography. See KNOWN_LIMITATIONS.md.
6. **Real lyrics provider — DONE** — lyrics now come from Lyrica/LRCLib on every
   play (synced + plain), rendered in the full-screen Lyrics tab. `demoLyrics` is
   no longer the primary path; keep it only as a future fallback.

Avoid these unless asked: full-track playback (impossible on free API), accounts
/sync (changes the whole architecture), and swapping the music provider.

## Uncertainties found while documenting

- The "Phase 2" vs "Phase 3" split is inferred from code + the project brief;
  there is no `CHANGELOG`/git history (the repo is not a git repository). Treat
  phase attribution as descriptive, not authoritative.
- `backend/app/__pycache__` and `frontend/dist` contain build artifacts; the
  repo is not under version control, so there is no commit trail to confirm
  what changed when.
- `detail` route with a valid `id` but a deleted/renamed playlist relies on
  localStorage; if a user manually edits `swara:playlists`, `getPlaylist` safely
  returns a "not found" state.
