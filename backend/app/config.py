"""Application configuration loaded from environment variables.

We keep configuration simple and explicit: values are read from the
environment (and an optional `.env` file) with sensible defaults so the
app runs out-of-the-box with `uvicorn app.main:app`.

The backend is now a thin proxy in front of a personal **Lyrica** instance
(https://github.com/.../lyrica), which in turn pulls lyrics/metadata from
LRCLib/MusicBrainz and full-length audio streams from JioSaavn.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load variables from a local .env file if present (never overrides real env).
load_dotenv()
# Also load the scraper's .env — the single shared secrets file (MONGODB_URI,
# GOOGLE_CLIENT_ID, SESSION_SECRET, …). Explicit path because a bare
# load_dotenv() won't find a sibling directory's .env.
load_dotenv(Path(__file__).resolve().parents[2] / "scraper" / ".env")


class Settings:
    """Runtime settings for the Swara (Telugu) music proxy."""

    PROJECT_NAME: str = "Swara Music API"
    VERSION: str = "2.0.0"

    # Where songs/lyrics/audio come from:
    #   "mongo"  -> our own precomputed catalog in MongoDB (swara.songs)   [default]
    #   "lyrica" -> the old live-proxy path (Lyrica on Render -> JioSaavn)
    DATA_SOURCE: str = os.getenv("SWARA_SOURCE", "mongo").strip().lower()

    # Lyrica base URL — a personal instance that proxies lyrics + JioSaavn audio.
    # Override with LYRICA_URL if you self-host or use a different deployment.
    LYRICA_URL: str = os.getenv("LYRICA_URL", "https://lyrica-jwtd.onrender.com").rstrip("/")

    # Networking — split connect/read so a slow stream lookup does not hang the
    # worker forever, while still allowing the (sometimes slow) upstream to reply.
    LYRICA_CONNECT_TIMEOUT: float = float(os.getenv("LYRICA_CONNECT_TIMEOUT", "5"))
    LYRICA_READ_TIMEOUT: float = float(os.getenv("LYRICA_READ_TIMEOUT", "20"))

    # Optional extra headers forwarded to Lyrica (e.g. an auth token if the
    # instance is protected). Left empty by default — no secrets are hard-coded.
    LYRICA_EXTRA_HEADERS: dict = {}
    _extra = os.getenv("LYRICA_EXTRA_HEADERS")
    if _extra:
        # Minimal "Key: Value" newline-separated parsing; keep it simple on purpose.
        for _line in _extra.splitlines():
            if ":" in _line:
                _k, _v = _line.split(":", 1)
                LYRICA_EXTRA_HEADERS[_k.strip()] = _v.strip()

    # Pagination / limits
    DEFAULT_LIMIT: int = int(os.getenv("DEFAULT_LIMIT", "25"))
    MAX_LIMIT: int = int(os.getenv("MAX_LIMIT", "50"))

    # Song-details in-memory cache TTL (seconds). Successes are cached so that
    # repeated (artist, song) lookups are fast and upstream-friendly.
    SONG_CACHE_TTL: int = int(os.getenv("SONG_CACHE_TTL", str(60 * 60 * 6)))

    # Upstream concurrency cap. A single asyncio.Semaphore bounds how many
    # simultaneous Lyrica/JioSaavn calls we issue, so a burst of Home requests
    # can't overload the personal Lyrica instance.
    MAX_CONCURRENT_UPSTREAM: int = int(os.getenv("MAX_CONCURRENT_UPSTREAM", "4"))

    # TTL cache for the read-heavy list endpoints. These are safe to cache
    # because the catalog moves slowly relative to a request burst and the
    # values are cheap to recompute on a miss.
    SEARCH_CACHE_TTL: int = int(os.getenv("SEARCH_CACHE_TTL", str(15 * 60)))  # 15 min
    TRENDING_CACHE_TTL: int = int(os.getenv("TRENDING_CACHE_TTL", str(10 * 60)))  # 10 min
    LOOKUP_CACHE_TTL: int = int(os.getenv("LOOKUP_CACHE_TTL", str(30 * 60)))  # 30 min

    # Hard cap on entries per in-memory cache. When exceeded we evict expired
    # entries first, then the oldest (LRU by insertion order), to bound memory.
    CACHE_MAX_ENTRIES: int = int(os.getenv("CACHE_MAX_ENTRIES", "256"))

    # CORS — the Vite dev server origin(s). For the Capacitor APK, also allow the
    # native WebView origin, e.g. CORS_ORIGINS="http://localhost:5173,https://localhost".
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ]

    # ── Auth (Google Sign-In + our own session) ──────────────────────────────
    # The Google **Web** OAuth client id. It is used BOTH as the app's
    # `serverClientId` (so the ID token's audience is this id) AND here to verify
    # incoming ID tokens. Safe to expose (it's embedded in the app); set via env.
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    # Secret used to SIGN our own session JWTs (HS256). MUST be a strong random
    # value in production and NEVER committed — override with the env var.
    SESSION_SECRET: str = os.getenv("SESSION_SECRET", "dev-insecure-change-me")
    # How long a login session stays valid (seconds). Default 30 days.
    SESSION_TTL_SECONDS: int = int(os.getenv("SESSION_TTL_SECONDS", str(60 * 60 * 24 * 30)))

    @property
    def lyrica_timeout(self) -> tuple[float, float]:
        return (self.LYRICA_CONNECT_TIMEOUT, self.LYRICA_READ_TIMEOUT)


# Single shared instance used across the app.
settings = Settings()
