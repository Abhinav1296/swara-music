import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend calls the backend via a relative "/api" path.
// In dev, Vite proxies "/api" to the FastAPI server on :8000 so there
// are no CORS surprises and no hard-coded localhost URLs in the app code.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
