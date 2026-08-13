"""Account-backed playlist sync (per user).

GET  /api/playlists  -> { playlists: [...] }   (the caller's synced playlists)
PUT  /api/playlists  -> { playlists: [...] }   (replace with the given array)

Both require a `Bearer <session-jwt>` header; the user id is resolved with the
same helper the auth routes use.
"""
import asyncio
from typing import Any, List, Optional

from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.routes.auth import _current_uid
from app.services import playlists as playlists_svc

router = APIRouter(prefix="/api", tags=["playlists"])


class PlaylistsBody(BaseModel):
    # Playlists are passed through verbatim (nested Song objects included); the
    # service layer sanitizes and bounds them before storage.
    playlists: List[Any] = []


@router.get("/playlists")
async def list_playlists(authorization: Optional[str] = Header(default=None)) -> dict:
    uid = await _current_uid(authorization)
    items = await asyncio.to_thread(playlists_svc.get_playlists, uid)
    return {"playlists": items}


@router.put("/playlists")
async def replace_playlists(
    body: PlaylistsBody, authorization: Optional[str] = Header(default=None)
) -> dict:
    uid = await _current_uid(authorization)
    items = await asyncio.to_thread(playlists_svc.save_playlists, uid, body.playlists)
    return {"playlists": items}
