"""Account-backed liked-songs sync (per user).

GET  /api/likes  -> { likes: [...] }   (the caller's liked songs)
PUT  /api/likes  -> { likes: [...] }   (replace with the given array)

Both require a `Bearer <session-jwt>` header; the user id is resolved with the
same helper the auth routes use.
"""
import asyncio
from typing import Any, List, Optional

from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.routes.auth import _current_uid
from app.services import likes as likes_svc

router = APIRouter(prefix="/api", tags=["likes"])


class LikesBody(BaseModel):
    # Songs are passed through verbatim (full Song objects); the service layer
    # sanitizes and bounds them before storage.
    likes: List[Any] = []


@router.get("/likes")
async def list_likes(authorization: Optional[str] = Header(default=None)) -> dict:
    uid = await _current_uid(authorization)
    items = await asyncio.to_thread(likes_svc.get_likes, uid)
    return {"likes": items}


@router.put("/likes")
async def replace_likes(
    body: LikesBody, authorization: Optional[str] = Header(default=None)
) -> dict:
    uid = await _current_uid(authorization)
    items = await asyncio.to_thread(likes_svc.save_likes, uid, body.likes)
    return {"likes": items}
