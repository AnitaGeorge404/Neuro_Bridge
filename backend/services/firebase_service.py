"""
Firebase / Google Cloud data services: Cloud Firestore (adaptive profile +
document analysis mirror) and Google Cloud Storage (user-scoped uploads).

SQL stays the system of record for agent/task data (no duplicate migration).
Firestore holds what genuinely benefits from a document store synced across
devices: the adaptive profile (UI presets, sensory/reading prefs) and a
lightweight per-user document library feed. All calls fail soft.
"""

from __future__ import annotations

import datetime as _dt
import os
import uuid
from typing import Any, Optional

from . import google_cloud

GCS_BUCKET = os.getenv("GCS_BUCKET") or os.getenv("FIREBASE_STORAGE_BUCKET") or ""

_firestore_client = None
_storage_client = None


def _safe_uid(user_id: str) -> str:
    # Firestore doc ids / GCS prefixes can't contain "/"; ids look like "firebase:<uid>" or a UUID.
    return user_id.replace("/", "_")


def firestore_client():
    global _firestore_client
    if _firestore_client is not None:
        return _firestore_client
    try:
        import firebase_admin
        from firebase_admin import firestore
        if firebase_admin._apps and os.getenv("FIRESTORE_ENABLED", "true").lower() != "false" and google_cloud.GCP_PROJECT:
            _firestore_client = firestore.client()
    except Exception as e:
        google_cloud.log_structured("firestore unavailable", error=type(e).__name__)
    return _firestore_client


def storage_bucket():
    global _storage_client
    if not GCS_BUCKET:
        return None
    try:
        if _storage_client is None:
            from google.cloud import storage
            _storage_client = storage.Client(project=google_cloud.GCP_PROJECT or None)
        return _storage_client.bucket(GCS_BUCKET)
    except Exception as e:
        google_cloud.log_structured("cloud storage unavailable", error=type(e).__name__)
        return None


# ---------------------------------------------------------------- Firestore

PROFILE_ALLOWED_KEYS = {
    "presentation_preset", "theme", "font_scale", "reduced_motion", "dyslexia_font", "line_spacing",
    "reading_level", "focus_default_minutes", "voice_enabled", "modules", "sensory", "adaptive",
}


def get_profile(user_id: str) -> Optional[dict]:
    db = firestore_client()
    if db is None:
        return None
    snap = db.collection("users").document(_safe_uid(user_id)).get()
    return (snap.to_dict() or {}).get("adaptive_profile", {}) if snap.exists else {}


def save_profile(user_id: str, profile: dict) -> Optional[dict]:
    db = firestore_client()
    if db is None:
        return None
    clean = {k: v for k, v in profile.items() if k in PROFILE_ALLOWED_KEYS}
    from firebase_admin import firestore
    db.collection("users").document(_safe_uid(user_id)).set(
        {"adaptive_profile": clean, "updated_at": firestore.SERVER_TIMESTAMP}, merge=True
    )
    return clean


def mirror_document_analysis(user_id: str, doc_id: int, summary: dict) -> bool:
    db = firestore_client()
    if db is None:
        return False
    try:
        from firebase_admin import firestore
        (db.collection("users").document(_safe_uid(user_id)).collection("documents")
           .document(str(doc_id)).set({**summary, "created_at": firestore.SERVER_TIMESTAMP}))
        return True
    except Exception as e:
        google_cloud.log_structured("firestore mirror failed", error=type(e).__name__)
        return False


def delete_user_data(user_id: str) -> dict:
    """Privacy: remove the user's Firestore tree and Cloud Storage prefix."""
    result = {"firestore_docs": 0, "gcs_objects": 0}
    db = firestore_client()
    if db is not None:
        try:
            user_ref = db.collection("users").document(_safe_uid(user_id))
            for d in user_ref.collection("documents").stream():
                d.reference.delete()
                result["firestore_docs"] += 1
            user_ref.delete()
            result["firestore_docs"] += 1
        except Exception as e:
            google_cloud.log_structured("firestore delete failed", error=type(e).__name__)
    bucket = storage_bucket()
    if bucket is not None:
        try:
            for blob in bucket.list_blobs(prefix=f"users/{_safe_uid(user_id)}/"):
                blob.delete()
                result["gcs_objects"] += 1
        except Exception as e:
            google_cloud.log_structured("gcs delete failed", error=type(e).__name__)
    return result


# ---------------------------------------------------------------- Cloud Storage

def upload_user_file(user_id: str, data: bytes, mime_type: str, filename: str) -> Optional[str]:
    bucket = storage_bucket()
    if bucket is None:
        return None
    safe_name = "".join(c for c in (filename or "upload") if c.isalnum() or c in "._-")[:80] or "upload"
    path = f"users/{_safe_uid(user_id)}/documents/{uuid.uuid4().hex}-{safe_name}"
    try:
        blob = bucket.blob(path)
        blob.upload_from_string(data, content_type=mime_type)
        return f"gs://{bucket.name}/{path}"
    except Exception as e:
        google_cloud.log_structured("gcs upload failed", error=type(e).__name__)
        return None


def signed_download_url(user_id: str, gcs_uri: str, minutes: int = 10) -> Optional[str]:
    bucket = storage_bucket()
    prefix = f"gs://{GCS_BUCKET}/users/{_safe_uid(user_id)}/"
    if bucket is None or not gcs_uri.startswith(prefix):  # enforce user scoping
        return None
    blob = bucket.blob(gcs_uri[len(f"gs://{GCS_BUCKET}/"):])
    try:
        return blob.generate_signed_url(version="v4", expiration=_dt.timedelta(minutes=minutes), method="GET")
    except Exception:
        # On Cloud Run there's no private key locally; sign via IAM Credentials API.
        try:
            import google.auth
            from google.auth.transport import requests as ga_requests
            creds, _ = google.auth.default()
            creds.refresh(ga_requests.Request())
            return blob.generate_signed_url(
                version="v4", expiration=_dt.timedelta(minutes=minutes), method="GET",
                service_account_email=getattr(creds, "service_account_email", None), access_token=creds.token,
            )
        except Exception as e:
            google_cloud.log_structured("signed url failed", error=type(e).__name__)
            return None


def status() -> dict[str, Any]:
    return {"firestore": firestore_client() is not None, "cloud_storage_bucket": GCS_BUCKET or None}
