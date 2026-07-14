"""FastAPI application entrypoint.

Run with:  uvicorn app.main:app --reload --port 8000
Docs at:   http://localhost:8000/docs
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

import logging
import time
import uuid

from app.config import settings
from app.routes import search
from app.services.lyrica import _request_id_ctx

# Diagnostic perf logging (safe to remove). Ensures our [perf] logs are emitted.
logging.getLogger("swara").setLevel(logging.INFO)
logger = logging.getLogger("swara.perf")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "A thin proxy + helper API for browsing, streaming, and reading lyrics "
        "for Telugu songs. Backed by a personal Lyrica instance (LRCLib/MusicBrainz "
        "lyrics + JioSaavn audio)."
    ),
)

# Enable CORS so the Vite dev server (and any static build) can call us directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)


@app.middleware("http")
async def perf_timing(request: Request, call_next):
    """Diagnostic middleware: log path, status, and total request time.

    Sets a per-request correlation id in a contextvar so the upstream timings
    logged inside app.services.lyrica can be tied back to this request.
    (DIAGNOSTIC ONLY — remove this middleware + the contextvar when done.)
    """
    rid = uuid.uuid4().hex[:8]
    request.state.rid = rid
    _request_id_ctx.set(rid)
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "[perf] %s %s %s -> %d in %.1fms",
        rid,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


@app.get("/")
async def root() -> dict:
    """Human-friendly landing pointing at the API docs."""
    return {
        "message": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "source": "lyrica",
        "docs": "/docs",
        "try": "/api/trending",
    }
