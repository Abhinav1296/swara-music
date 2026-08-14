import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend calls the backend via a relative "/api" path.
// In dev, Vite proxies "/api" to the backend so there are no CORS surprises
// and no hard-coded backend URLs in the app code.
//
// Target defaults to the local FastAPI server on :8000. Override it to point a
// phone/LAN preview at the HOSTED backend (no local backend needed, and no CORS
// because the browser only ever talks to this same-origin dev server):
//   VITE_DEV_PROXY_TARGET=https://swara-backend-9kra.onrender.com npm run dev -- --host
const PROXY_TARGET = process.env.VITE_DEV_PROXY_TARGET || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: PROXY_TARGET,
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
