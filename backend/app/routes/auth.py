"""Auth routes — Google login → our session, plus profile read/update."""
import asyncio
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.services import auth as auth_svc
from app.services import users as users_svc

router = APIRouter(prefix="/api/auth", tags=["auth"])


class GoogleLoginRequest(BaseModel):
    idToken: str


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    favoriteSingers: Optional[List[str]] = None
    # A base64 data URL for a custom avatar, or "" to clear it back to the
    # Google photo. Validated/size-capped in users_svc.update_profile.
    avatar: Optional[str] = None


async def _current_uid(authorization: Optional[str]) -> str:
    """Resolve the caller's user id from a `Bearer <session-jwt>` header."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = auth_svc.verify_session(token)
    except auth_svc.AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid session")
    return uid


@router.post("/google")
async def google_login(body: GoogleLoginRequest) -> dict:
    """Exchange a Google ID token for a Swara session + user profile."""
    try:
        claims = await asyncio.to_thread(auth_svc.verify_google_id_token, body.idToken)
    except auth_svc.AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = await asyncio.to_thread(users_svc.upsert_user_from_google, claims)
    token = auth_svc.issue_session(user)
    return {"token": token, "user": users_svc.public_user(user)}


@router.get("/me")
async def me(authorization: Optional[str] = Header(default=None)) -> dict:
    """Return the current user (validates the session)."""
    uid = await _current_uid(authorization)
    user = await asyncio.to_thread(users_svc.get_user, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user": users_svc.public_user(user)}


@router.patch("/profile")
async def update_profile(
    body: ProfileUpdate, authorization: Optional[str] = Header(default=None)
) -> dict:
    """Update the current user's display name and/or favorite singers."""
    uid = await _current_uid(authorization)
    user = await asyncio.to_thread(
        users_svc.update_profile, uid, body.name, body.favoriteSingers, body.avatar
    )
    return {"user": users_svc.public_user(user)}
