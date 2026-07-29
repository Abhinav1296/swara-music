"""HTTP route definitions for the Swara (Telugu) music API."""
import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.schemas import LookupResponse, SearchResponse, SongDetails, StreamResponse
from app.services import lyrica
from app.services.lyrica import (
    LyricaError,
    LyricaRateLimited,
    LyricaTimeout,
    SongNotFound,
)

router = APIRouter(prefix="/api", tags=["music"])


def _handle_upstream_exception(exc: Exception) -> HTTPException:
    """Map service-layer exceptions to appropriate HTTPExceptions."""
    if isinstance(exc, LyricaRateLimited):
        headers = {}
        if exc.retry_after_seconds is not None:
            headers["Retry-After"] = str(int(exc.retry_after_seconds))
        return HTTPException(status_code=429, detail=str(exc), headers=headers)
    if isinstance(exc, LyricaTimeout):
        return HTTPException(status_code=504, detail=str(exc))
    if isinstance(exc, LyricaError):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, httpx.HTTPError):
        return HTTPException(status_code=502, detail=f"Lyrica upstream error: {exc}")
    return HTTPException(status_code=500, detail="Unexpected error")


@router.get("/health")
async def health() -> dict:
    """Liveness probe — useful for containers and quick checks."""
    return {"status": "ok", "service": "swara-music", "source": "lyrica"}


@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description="Free-text search term"),
    limit: int = Query(25, ge=1, le=50, description="Number of results (1–50)"),
) -> SearchResponse:
    try:
        return await lyrica.search_songs(q, limit)
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise _handle_upstream_exception(exc) from exc


@router.get("/trending", response_model=SearchResponse)
async def trending(
    q: str | None = Query(None, description="Optional shelf query (JioSaavn-backed)"),
    limit: int = Query(25, ge=1, le=50, description="Number of results (1–50)"),
) -> SearchResponse:
    try:
        if q:
            return await lyrica.search_jiosaavn_tracks(q, limit)
        return await lyrica.get_trending(limit)
    except Exception as exc:
        raise _handle_upstream_exception(exc) from exc


@router.get("/song-details", response_model=SongDetails)
async def song_details(
    artist: str = Query(..., min_length=1, description="Track artist"),
    song: str | None = Query(None, description="Track title (aliased by `title`/`track`)"),
    title: str | None = Query(None, alias="title", description="Alias of `song`"),
    track: str | None = Query(None, alias="track", description="Alias of `song`"),
    url: str | None = Query(
        None,
        description="Optional JioSaavn perma_url for fast stream resolution",
    ),
) -> SongDetails:
    effective_song = song or title or track
    if not effective_song:
        raise HTTPException(
            status_code=422,
            detail="`song` (or `title`/`track`) is required",
        )
    try:
        return await lyrica.get_song_details(artist, effective_song, url)
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise _handle_upstream_exception(exc) from exc


@router.get("/stream", response_model=StreamResponse)
async def stream(
    artist: str = Query(..., min_length=1, description="Track artist"),
    song: str | None = Query(None, description="Track title (aliased by `title`/`track`)"),
    title: str | None = Query(None, alias="title", description="Alias of `song`"),
    track: str | None = Query(None, alias="track", description="Alias of `song`"),
    url: str | None = Query(
        None,
        description="Optional JioSaavn perma_url for fast stream resolution",
    ),
):
    """
    Resolve ONLY the stream URL + minimal metadata for fast playback start.
    Returns 404 with a proper JSON body `{status: "not_found", ...}` when no
    stream can be resolved. Never returns 500 for "not found" cases.
    """
    effective_song = song or title or track
    if not effective_song:
        raise HTTPException(
            status_code=422,
            detail="`song` (or `title`/`track`) is required",
        )
    try:
        details = await lyrica.get_stream_details(artist, effective_song, url)
        return details
    except SongNotFound:
        # Return a proper JSON body (not stuffed into "detail") so the frontend
        # can read {status: "not_found", ...} directly from the response.
        return JSONResponse(
            status_code=404,
            content={
                "status": "not_found",
                "stream_url": None,
                "artist": artist,
                "title": effective_song,
                "album": None,
                "artwork": None,
                "durationMs": None,
                "source": "lyrica",
            },
        )
    except Exception as exc:
        raise _handle_upstream_exception(exc) from exc


@router.get("/lookup", response_model=LookupResponse)
async def lookup(
    type: str = Query("artist", pattern="^(artist|album)$", description="artist | album"),
    id: str | None = Query(None, description="Legacy numeric id (unused — best effort)"),
    artist: str | None = Query(None, description="Artist name; also disambiguates album lookups"),
    name: str | None = Query(None, description="Artist or album name to resolve"),
    q: str | None = Query(None, description="Free-text alias of `name`"),
    album: str | None = Query(None, description="Album name alias of `name`"),
    entity: str = Query("song", description="Unused legacy entity param"),
    limit: int = Query(25, ge=1, le=50, description="Number of results (1–50)"),
) -> LookupResponse:
    """Best-effort artist/album lookup resolved by name against Lyrica/JioSaavn."""
    target = name or album or artist or q
    if not target:
        return LookupResponse(type=type, title="", results=[])
    try:
        if type == "album":
            return await lyrica.lookup_album(target, artist=artist, limit=limit)
        return await lyrica.lookup_artist(target, limit=limit)
    except Exception as exc:
        raise _handle_upstream_exception(exc) from exc