# Telugu Apple Music — Frontend (React + Vite)

An Apple Music–style UI for browsing and playing Telugu songs, built with
React, Vite, Tailwind CSS, and Framer Motion. Heavy glassmorphism, dark by
default. Playback streams full JioSaavn tracks (resolved via the Lyrica
backend), not 30-second previews.

## Run

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 — the dev server proxies `/api` to the
FastAPI backend on http://localhost:8000 (see `vite.config.js`).

## Scripts
- `npm run dev` — start the Vite dev server (with /api proxy)
- `npm run build` — production build into `dist/`
- `npm run preview` — preview the production build

## Notes
- No authentication. No accounts. All library data lives in `localStorage`.
- The backend must be running on :8000 for search/trending/song-details to work
  in dev.
