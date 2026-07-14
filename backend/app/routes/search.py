"""HTTP route definitions for the Swara (Telugu) music API."""
import httpx
from fastapi import APIRouter, HTTPException, Query

from app.schemas import LookupResponse, SearchResponse, SongDetails
from app.services import lyrica
from app.services.lyrica import LyricaError, LyricaTimeout, SongNotFound

router = APIRouter(prefix="/api", tags=["music"])


@router.get("/health")
async def health() -> dict:
    """Liveness probe — useful for containers and quick checks."""
    return {"status": "ok", "service": "swara-music", "source": "lyrica"}


@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description="Free-text search term"),
    limit: int = Query(25, ge=1, le=50, description="Number of results (1–50)"),
) -> SearchResponse:
    """Telugu-biased search via Lyrica.

    The raw query is normalized server-side (see ``lyrica.normalize_query``) so
    the returned catalog stays Telugu-focused, then enriched with JioSaavn
    artwork + stream handles for instant, full-length playback.
    """
    try:
        return await lyrica.search_songs(q, limit)
    except LyricaTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except LyricaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Lyrica upstream error: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="Unexpected error") from exc


@router.get("/trending", response_model=SearchResponse)
async def trending(
    q: str | None = Query(None, description="Optional shelf query (JioSaavn-backed)"),
    limit: int = Query(25, ge=1, le=50, description="Number of results (1–50)"),
) -> SearchResponse:
    """Curated default list of popular Telugu tracks for the home page.

    With no ``q``, returns a Telugu-biased JioSaavn search ("latest telugu
    songs") — real, artwork-rich tracks for the hero. With ``q`` (used by the
    Home mood shelves), searches JioSaavn for that vibe. Always reflects the
    live catalog rather than a hard-coded list.
    """
    try:
        if q:
            return await lyrica.search_jiosaavn_tracks(q, limit)
        return await lyrica.get_trending(limit)
    except LyricaTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except LyricaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Lyrica upstream error: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="Unexpected error") from exc


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
    """Resolve a track into a full-length stream + synced/plain lyrics + metadata.

    Required: ``artist`` and one of ``song`` / ``title`` / ``track``.
    Successes are cached in-memory (keyed by normalized artist+song) so repeats
    are fast and upstream-friendly. A successful resolution with no stream URL
    still returns ``200`` with ``hasFullStream=false``; only when *both* lyrics
    and stream are unresolvable do we return ``404``.
    """
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
    except LyricaTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except LyricaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Lyrica upstream error: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="Unexpected error") from exc


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
    """Best-effort artist/album lookup resolved by name against Lyrica/JioSaavn.

    The Lyrica/JioSaavn catalog has no artist/album ids, so browsing is done by
    name: ``type=artist`` resolves an artist page (JioSaavn search filtered to
    that artist); ``type=album`` resolves an album page (JioSaavn search filtered
    to that album, optionally disambiguated by ``artist``). A legacy numeric
    ``id`` with no name returns a safe empty envelope so old deep links never
    hard-crash.
    """
    target = name or album or artist or q
    if not target:
        # No resolvable target (legacy id only) → safe empty shell.
        return LookupResponse(type=type, title="", results=[])
    try:
        if type == "album":
            return await lyrica.lookup_album(target, artist=artist, limit=limit)
        return await lyrica.lookup_artist(target, limit=limit)
    except LyricaTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except LyricaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Lyrica upstream error: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="Unexpected error") from exc
