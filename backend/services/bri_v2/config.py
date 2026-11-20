"""Feature flags for Bri V2. Read at call time so they can be flipped per
deploy (or per test) without a code change. Defaults keep the app usable
with zero Google credentials: V2 on (it degrades to V1 internally), Live off."""

import os


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def v2_enabled() -> bool:
    return _flag("BRI_AGENT_V2_ENABLED", True)


def fallback_enabled() -> bool:
    return _flag("BRI_AGENT_FALLBACK_ENABLED", True)


def live_enabled() -> bool:
    return _flag("GEMINI_LIVE_ENABLED", False)


def live_model() -> str:
    return os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")


def live_session_minutes() -> int:
    try:
        return max(1, min(30, int(os.getenv("GEMINI_LIVE_SESSION_MINUTES", "10"))))
    except ValueError:
        return 10


def live_sessions_per_hour() -> int:
    try:
        return max(1, int(os.getenv("GEMINI_LIVE_SESSIONS_PER_HOUR", "6")))
    except ValueError:
        return 6
