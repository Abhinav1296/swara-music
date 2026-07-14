"""Pydantic response models.

These define the *clean* shape the frontend receives. We intentionally keep the
legacy iTunes-era field names (`trackName`, `artistName`, `artworkUrl600`,
`previewUrl`, `trackTimeMillis`, `artistId`, `collectionId`) as **aliases** so the
React layer keeps working unchanged, while also exposing the canonical Swara
shape (`title`, `artist`, `album`, `artwork`, `durationMs`, `streamUrl`,
`hasFullStream`, `source`, `lyricsAvailable`).

Source of truth is now **Lyrica** (lyrics/metadata) + **JioSaavn** (audio).
"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SyncedLine(BaseModel):
    """One timestamped lyric line, time in milliseconds."""

    timeMs: int
    text: str


class LyricsPayload(BaseModel):
    """Normalized lyrics object returned by /api/song-details."""

    synced: List[SyncedLine] = Field(default_factory=list)
    plain: Optional[str] = None
    source: Optional[str] = None
    available: bool = False


class Song(BaseModel):
    """A single music track with the fields the UI cares about.

    Carries both canonical Swara fields and iTunes-era aliases so existing
    components (SongCard, TrackRow, NowPlayingBar, FullScreenPlayer, …) need no
    rewrite. New playback code reads `streamUrl` / `hasFullStream`; legacy code
    reads `previewUrl` (kept equal to `streamUrl` when a stream exists).
    """

    # Canonical Swara shape
    id: str
    title: str
    artist: str
    album: str = ""
    artwork: str = ""
    durationMs: Optional[int] = None
    streamUrl: Optional[str] = None
    hasFullStream: bool = False
    source: str = "lyrica"
    lyricsAvailable: bool = False

    # Legacy aliases (read by existing presentational components)
    trackName: Optional[str] = None
    artistName: Optional[str] = None
    collectionName: Optional[str] = None
    artworkUrl100: Optional[str] = None
    artworkUrl600: Optional[str] = None
    previewUrl: Optional[str] = None
    trackTimeMillis: Optional[int] = None
    artistId: Optional[Any] = None
    collectionId: Optional[Any] = None

    # Lyrica/JioSaavn-specific handle used to resolve the full stream quickly
    # at play time (a JioSaavn `perma_url`). Best-effort; may be null.
    jiosaavnUrl: Optional[str] = None


class SongDetails(Song):
    """Full resolution of a track: stream + lyrics + metadata.

    Extends :class:`Song` with the lyrics payload and extra Lyrica metadata so
    the player can render synced lyrics and rich info without further calls.
    """

    lyricsSynced: bool = False
    lyrics: LyricsPayload = Field(default_factory=LyricsPayload)
    mood: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class SearchResponse(BaseModel):
    """Standard envelope returned by /api/search and /api/trending."""

    query: str
    count: int
    results: List[Song]
    source: str = "lyrica"


class LookupResponse(BaseModel):
    """Envelope for /api/lookup (artist or album detail pages).

    `type` is "artist" or "album"; `title` is the resolved name and
    `artworkUrl600` the header artwork. `results` are the tracks.
    """

    type: str = "artist"
    title: str = ""
    artworkUrl600: Optional[str] = None
    results: List[Song] = Field(default_factory=list)
    source: str = "lyrica"
