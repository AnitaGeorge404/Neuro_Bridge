"""
Backend authentication: validates the Supabase access token the frontend
attaches as `Authorization: Bearer <token>` on every request.

We don't hold a JWT signing secret locally, so verification is delegated to
Supabase itself (GET /auth/v1/user) using the project's anon key. This is a
network round trip per (uncached) request, so successful lookups are cached
briefly in-process to keep the agent responsive under repeated calls in one
session.
"""

import os
import time
from typing import Optional

import httpx
from fastapi import Header, HTTPException, status
from pydantic import BaseModel

try:
    import firebase_admin
    from firebase_admin import auth as firebase_auth, credentials

    if not firebase_admin._apps:
        cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path and os.path.exists(cred_path):
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        elif os.getenv("FIREBASE_PROJECT_ID"):
            firebase_admin.initialize_app(options={"projectId": os.getenv("FIREBASE_PROJECT_ID")})
        else:
            # Default initialization if environment credentials are present
            try:
                firebase_admin.initialize_app()
            except Exception:
                pass
    _FIREBASE_INITIALIZED = bool(firebase_admin._apps)
except Exception:
    _FIREBASE_INITIALIZED = False

# Firebase App Check: "off" (default, local dev), "monitor" (verify + log only), "enforce" (reject).
APP_CHECK_MODE = os.getenv("FIREBASE_APP_CHECK_MODE", "off").lower()
app_check_stats = {"verified": 0, "missing": 0, "invalid": 0}


def verify_app_check(x_firebase_appcheck: Optional[str] = Header(default=None)) -> Optional[str]:
    """FastAPI dependency guarding the AI/agent/document endpoints against
    scripted abuse: the browser attaches a Firebase App Check token
    (reCAPTCHA Enterprise attested) as X-Firebase-AppCheck."""
    if APP_CHECK_MODE == "off" or not _FIREBASE_INITIALIZED:
        return None
    if not x_firebase_appcheck:
        app_check_stats["missing"] += 1
        if APP_CHECK_MODE == "enforce":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="App verification required.")
        return None
    try:
        from firebase_admin import app_check
        claims = app_check.verify_token(x_firebase_appcheck)
        app_check_stats["verified"] += 1
        return claims.get("app_id")
    except Exception:
        app_check_stats["invalid"] += 1
        if APP_CHECK_MODE == "enforce":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="App verification failed.")
        return None

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

_TOKEN_CACHE_TTL_SECONDS = 60
_token_cache: dict[str, tuple[float, "CurrentUser"]] = {}

# Mirrors the "user"-role mock accounts hardcoded in src/context/AuthContext.jsx's
# MOCK_USERS. There's no real credential behind these — anyone can construct a
# demo token for one of these roles — so this must stay restricted to the
# handful of known, non-sensitive demo personas, never to arbitrary strings
# (which could otherwise be used to try to collide with a real user's id).
DEMO_ROLE_IDS = {"nb-user-042", "nb-user-011", "nb-user-088"}


class CurrentUser(BaseModel):
    id: str
    email: Optional[str] = None
    is_demo: bool = False


def _validate_with_firebase(token: str) -> Optional[CurrentUser]:
    """Validate a Firebase ID token using firebase-admin."""
    if not _FIREBASE_INITIALIZED:
        return None
    try:
        decoded = firebase_auth.verify_id_token(token)
        uid = decoded.get("uid")
        if not uid:
            return None
        return CurrentUser(
            id=f"firebase:{uid}",
            email=decoded.get("email"),
            is_demo=False,
        )
    except Exception:
        return None


def _validate_with_supabase(token: str) -> CurrentUser:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Backend auth is not configured (SUPABASE_URL/SUPABASE_ANON_KEY missing).",
        )

    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
            timeout=5.0,
        )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the authentication service. Please try again.",
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired or is invalid. Please sign in again.",
        )

    data = response.json()
    user_id = data.get("id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.")

    return CurrentUser(id=str(user_id), email=data.get("email"))


def _resolve_demo_user(token: str) -> CurrentUser:
    """Resolve a `demo:<role_id>:<session_id>` pseudo-token into an isolated demo identity.

    No credential is checked here — that's the point of demo mode — but the
    resulting id is namespaced under "demo:" (a prefix no real Supabase UUID
    can ever produce) and requires a per-browser random session_id, so two
    different demo visitors never share the same backend data even though
    they picked the same demo role.
    """
    parts = token.split(":", 2)
    if len(parts) != 3:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid demo session.")
    _, role_id, session_id = parts
    if role_id not in DEMO_ROLE_IDS or not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid demo session.")
    return CurrentUser(id=f"demo:{role_id}:{session_id}", email=None, is_demo=True)


def get_current_user(authorization: Optional[str] = Header(default=None)) -> CurrentUser:
    """FastAPI dependency: raises 401 unless a valid Supabase session token — or a
    well-formed demo pseudo-token — is present."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with your NeuroBridge account to use this feature.",
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing session token.")

    if token.startswith("demo:"):
        return _resolve_demo_user(token)

    now = time.monotonic()
    cached = _token_cache.get(token)
    if cached and cached[0] > now:
        return cached[1]

    # Try Firebase Auth token verification first if initialized
    fb_user = _validate_with_firebase(token)
    if fb_user:
        _token_cache[token] = (now + _TOKEN_CACHE_TTL_SECONDS, fb_user)
        return fb_user

    # Fall back to Supabase session validation
    user = _validate_with_supabase(token)
    _token_cache[token] = (now + _TOKEN_CACHE_TTL_SECONDS, user)
    return user
