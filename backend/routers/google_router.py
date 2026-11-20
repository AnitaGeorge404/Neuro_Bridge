"""Google integration endpoints: live status for the demo and the Firestore-backed adaptive profile."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import auth
from ..auth import CurrentUser, get_current_user
from ..database import get_db
from ..services import firebase_service, google_ai_service, google_cloud, semantic_memory, vector_search_service

router = APIRouter()


@router.get("/status")
def google_status():
    """Configuration snapshot only — no secrets, no user data."""
    return {
        "genai": {
            "backend": google_ai_service.backend_name(),
            "model": google_ai_service.MODEL_FLASH,
            "document_model": google_ai_service.MODEL_PRO,
            "embedding_model": google_ai_service.MODEL_EMBEDDING,
        },
        "firebase_auth": auth._FIREBASE_INITIALIZED,
        "app_check": {"mode": auth.APP_CHECK_MODE, **auth.app_check_stats},
        "vector_search": {
            "provider": type(vector_search_service.get_vector_search_provider()).__name__,
            "vertex_enabled": vector_search_service.VERTEX_VECTOR_SEARCH_ENABLED,
            "endpoint_configured": bool(vector_search_service.VERTEX_VECTOR_SEARCH_ENDPOINT_ID),
        },
        **firebase_service.status(),
        "cloud": google_cloud.status(),
    }


@router.post("/selftest")
def google_selftest(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """One-click live verification of the AI chain for the signed-in user:
    Gemini generation -> structured output -> embedding round-trip."""
    if not google_ai_service.is_configured():
        raise HTTPException(status_code=503, detail="Google GenAI is not configured.")
    text = google_ai_service.generate_text("Reply with exactly: NeuroBridge online")
    vec = google_ai_service.generate_embedding("focus session for an essay")
    return {"backend": google_ai_service.backend_name(), "generation_ok": bool(text), "generation": text[:80],
            "embedding_dims": len(vec)}


@router.get("/profile")
def get_profile(user: CurrentUser = Depends(get_current_user)):
    if user.is_demo:
        return {"profile": {}, "source": "demo"}
    profile = firebase_service.get_profile(user.id)
    if profile is None:
        raise HTTPException(status_code=503, detail="Firestore is not configured.")
    return {"profile": profile, "source": "firestore"}


@router.put("/profile")
def put_profile(body: dict, user: CurrentUser = Depends(get_current_user)):
    if user.is_demo:
        return {"profile": {}, "source": "demo"}
    saved = firebase_service.save_profile(user.id, body or {})
    if saved is None:
        raise HTTPException(status_code=503, detail="Firestore is not configured.")
    google_cloud.emit_event("adaptive_profile_saved", module="profile", count=len(saved))
    return {"profile": saved, "source": "firestore"}
