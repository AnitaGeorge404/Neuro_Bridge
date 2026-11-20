"""
Document Router — the integrated Google document workflow:

  upload -> Google Cloud Storage (users/<uid>/documents/...)
         -> Gemini multimodal structured extraction (Gemini API or Vertex AI)
         -> real ADHD TaskBreakdown + TaskSteps (on user approval / auto_save)
         -> Firestore library mirror
         -> gemini-embedding-001 semantic memory (Bri can recall it later)
         -> privacy-safe product events (Cloud Logging / BigQuery)
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import CurrentUser, get_current_user
from ..database import get_db
from ..models import adhd_models, google_models
from ..services import firebase_service, google_ai_service, google_cloud, semantic_memory
from ..services.rate_limiter import SlidingWindowRateLimiter

router = APIRouter()

_rate_limiter = SlidingWindowRateLimiter(
    max_events=int(os.getenv("DOCUMENT_AI_RATE_LIMIT_PER_HOUR", "30")),
    window_seconds=3600,
    message="You have uploaded several documents recently — please wait a moment before analyzing another.",
)

_ALLOWED_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"}
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


def _fallback_result() -> google_ai_service.SyllabusDecompositionResult:
    return google_ai_service.SyllabusDecompositionResult(
        course_title="Course Syllabus (Extracted)",
        summary="Course schedule processed. Focus on starting the first assignment with small micro-actions.",
        overwhelm_reduction_advice="Take this one milestone at a time. Never look at the entire semester at once.",
        tasks=[
            google_ai_service.SyllabusTaskItem(
                title="Assignment 1 Initiation",
                description="Review the assignment rubric and create a folder.",
                estimated_difficulty="low",
                estimated_minutes=15,
                due_date_hint="Next Week",
                first_micro_step="Open text editor and write the document title (3 mins).",
            )
        ],
    )


def _save_breakdown(db: Session, user_id: str, analysis: dict) -> int:
    breakdown = adhd_models.TaskBreakdown(user_id=user_id, original_task=f"Course: {analysis.get('course_title', 'Document')}")
    db.add(breakdown)
    db.flush()
    for t in analysis.get("tasks", []):
        due = f" (due {t['due_date_hint']})" if t.get("due_date_hint") else ""
        db.add(adhd_models.TaskStep(
            breakdown_id=breakdown.id,
            description=f"{t['title']}{due} — start: {t['first_micro_step']}",
            estimated_minutes=int(t.get("estimated_minutes") or 5),
        ))
    db.commit()
    return breakdown.id


def _doc_out(doc: google_models.StoredDocument) -> dict:
    return {
        "id": doc.id, "filename": doc.filename, "mime_type": doc.mime_type, "size_bytes": doc.size_bytes,
        "course_title": doc.course_title, "ai_source": doc.ai_source, "stored_in_gcs": bool(doc.gcs_uri),
        "breakdown_id": doc.breakdown_id, "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "analysis": doc.analysis,
    }


@router.post("/analyze-syllabus")
async def analyze_syllabus(
    file: UploadFile = File(...),
    auto_save_tasks: bool = False,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """Upload + analyze a syllabus/assignment. With auto_save_tasks=true the
    extracted micro-steps become a real ADHD task breakdown immediately;
    otherwise the client shows them for approval and calls /{id}/approve."""
    _rate_limiter.check(user.id)

    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in _ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Unsupported file type ({mime_type}). Please upload a PDF, image, or text file.")
    file_bytes = await file.read()
    if len(file_bytes) > _MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File size exceeds the 10 MB limit.")

    gcs_uri = None if user.is_demo else firebase_service.upload_user_file(user.id, file_bytes, mime_type, file.filename or "")

    result = google_ai_service.analyze_multimodal_document(file_bytes=file_bytes, mime_type=mime_type)
    ai_source = google_ai_service.backend_name() if result else "fallback"
    result = result or _fallback_result()
    analysis = result.model_dump()

    doc = google_models.StoredDocument(
        user_id=user.id, filename=(file.filename or "")[:200], mime_type=mime_type, size_bytes=len(file_bytes),
        gcs_uri=gcs_uri, course_title=result.course_title, analysis=analysis, ai_source=ai_source,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    if auto_save_tasks and result.tasks:
        doc.breakdown_id = _save_breakdown(db, user.id, analysis)
        db.commit()

    indexed = 0
    if ai_source != "fallback":
        indexed = semantic_memory.index_texts(
            db, user.id, "document_task",
            [f"{result.course_title}: {t.title}. {t.description} Due: {t.due_date_hint or 'n/a'}" for t in result.tasks]
            + [f"{result.course_title} summary: {result.summary}"],
            ref_id=doc.id,
        )
    mirrored = firebase_service.mirror_document_analysis(
        user.id, doc.id, {"course_title": result.course_title, "task_count": len(result.tasks), "ai_source": ai_source, "gcs_uri": gcs_uri},
    )
    google_cloud.emit_event("document_analyzed", module="documents", status=ai_source, count=len(result.tasks))

    return {
        "status": "success",
        "document_id": doc.id,
        "analysis": analysis,
        "saved_breakdown_id": doc.breakdown_id,
        "google": {"ai_source": ai_source, "gcs_uri": gcs_uri, "firestore_mirrored": mirrored, "embeddings_indexed": indexed},
    }


@router.post("/{doc_id}/approve")
def approve_document_tasks(doc_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    doc = db.query(google_models.StoredDocument).filter_by(id=doc_id, user_id=user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not doc.breakdown_id:
        doc.breakdown_id = _save_breakdown(db, user.id, doc.analysis or {})
        db.commit()
        google_cloud.emit_event("document_tasks_approved", module="documents", count=len((doc.analysis or {}).get("tasks", [])))
    return {"status": "success", "breakdown_id": doc.breakdown_id}


@router.get("")
def list_documents(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    docs = (db.query(google_models.StoredDocument).filter_by(user_id=user.id)
              .order_by(google_models.StoredDocument.id.desc()).limit(50).all())
    return {"documents": [_doc_out(d) for d in docs]}


@router.get("/{doc_id}/download-url")
def document_download_url(doc_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    doc = db.query(google_models.StoredDocument).filter_by(id=doc_id, user_id=user.id).first()
    if not doc or not doc.gcs_uri:
        raise HTTPException(status_code=404, detail="No stored file for this document.")
    url = firebase_service.signed_download_url(user.id, doc.gcs_uri)
    if not url:
        raise HTTPException(status_code=503, detail="Cloud Storage is not available right now.")
    return {"url": url, "expires_in_seconds": 600}


class SearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5


@router.post("/search")
def search_documents(body: SearchRequest, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="Query is required.")
    results = semantic_memory.search(db, user.id, body.query, top_k=min(body.top_k or 5, 10))
    google_cloud.emit_event("semantic_search", module="documents", count=len(results))
    return {"results": results, "embedding_model": google_ai_service.MODEL_EMBEDDING}
