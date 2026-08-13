"""Authentication — verify Google ID tokens and mint/verify our own sessions.

Flow:
  1. The app signs in with Google (native on the APK, GIS on web) and gets an
     **ID token** whose audience is our Google *Web* client id.
  2. It POSTs that token to /api/auth/google. We verify it here against
     `GOOGLE_CLIENT_ID` (signature + audience + expiry, via google-auth).
  3. We upsert the user and issue our OWN short signed session JWT (HS256) that
     the app sends as `Authorization: Bearer …` on later calls.

Heavy deps (google-auth, PyJWT) are imported lazily inside the functions so the
app still boots if they aren't installed yet — run `pip install -r
requirements.txt` before using login.
"""
from __future__ import annotations

import time
from typing import Any, Dict

from app.config import settings


class AuthError(Exception):
    """Raised for any invalid/expired token or missing server config."""


def verify_google_id_token(token: str) -> Dict[str, Any]:
    """Verify a Google ID token and return its claims, or raise AuthError."""
    if not settings.GOOGLE_CLIENT_ID:
        raise AuthError("Server is missing GOOGLE_CLIENT_ID")
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
    except ImportError as exc:  # dependency not installed yet
        raise AuthError(
            "google-auth is not installed — run pip install -r requirements.txt"
        ) from exc
    try:
        claims = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )
    except Exception as exc:  # invalid signature / audience / expiry
        raise AuthError(f"Invalid Google token: {exc}") from exc
    # verify_oauth2_token already checks aud/exp/signature; double-check issuer.
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise AuthError("Untrusted token issuer")
    return claims


def issue_session(user: Dict[str, Any]) -> str:
    """Mint a signed session JWT for a user document."""
    import jwt

    now = int(time.time())
    payload = {
        "sub": user.get("_id") or user.get("id"),
        "email": user.get("email"),
        "iat": now,
        "exp": now + settings.SESSION_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.SESSION_SECRET, algorithm="HS256")


def verify_session(token: str) -> Dict[str, Any]:
    """Decode + validate one of our session JWTs, or raise AuthError."""
    import jwt

    try:
        return jwt.decode(token, settings.SESSION_SECRET, algorithms=["HS256"])
    except Exception as exc:
        raise AuthError(f"Invalid session: {exc}") from exc
