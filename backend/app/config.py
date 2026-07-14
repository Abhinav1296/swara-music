"""Application configuration loaded from environment variables.

We keep configuration simple and explicit: values are read from the
environment (and an optional `.env` file) with sensible defaults so the
app runs out-of-the-box with `uvicorn app.main:app`.

The backend is now a thin proxy in front of a personal **Lyrica** instance
(https://github.com/.../lyrica), which in turn pulls lyrics/metadata from
LRCLib/MusicBrainz and full-length audio streams from JioSaavn.
"""
import os

from dotenv import load_dotenv

# Load variables from a local .env file if present (never overrides real env).
load_dotenv()


class Settings:
    """Runtime settings for the Swara (Telugu) music proxy."""

    PROJECT_NAME: str = "Swara Music API"
    VERSION: str = "2.0.0"

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

    # CORS — the Vite dev server origin(s)
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ]

    @property
    def lyrica_timeout(self) -> tuple[float, float]:
        return (self.LYRICA_CONNECT_TIMEOUT, self.LYRICA_READ_TIMEOUT)


# Single shared instance used across the app.
settings = Settings()
