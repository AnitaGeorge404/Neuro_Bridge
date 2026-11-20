"""
Semantic recall for Bri: embeds the user's study material and task plans with
gemini-embedding-001 (Vertex AI or Gemini API) and retrieves by cosine
similarity. Per-user and small (hundreds of vectors), so an in-DB brute-force
scan is exact, free, and fast — Vertex AI Vector Search would add a paid,
always-on index endpoint for no gain at this scale.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..models import google_models
from . import google_ai_service

MAX_SCAN = 500


def index_texts(db: Session, user_id: str, kind: str, texts: list[str], ref_id: Optional[int] = None) -> int:
    texts = [t.strip()[:2000] for t in texts if t and t.strip()]
    vectors = google_ai_service.generate_embeddings(texts, task_type="RETRIEVAL_DOCUMENT")
    if len(vectors) != len(texts):
        return 0
    for text, vec in zip(texts, vectors):
        db.add(google_models.SemanticMemory(user_id=user_id, kind=kind, ref_id=ref_id, text=text, embedding=vec))
    db.commit()
    return len(texts)


def search(db: Session, user_id: str, query: str, top_k: int = 5, min_score: float = 0.35) -> list[dict]:
    rows = (
        db.query(google_models.SemanticMemory)
        .filter_by(user_id=user_id)
        .order_by(google_models.SemanticMemory.id.desc())
        .limit(MAX_SCAN)
        .all()
    )
    if not rows:
        return []
    qvec = google_ai_service.generate_embedding(query, task_type="RETRIEVAL_QUERY")
    if not qvec:
        return []
    scored = [
        {"text": r.text, "kind": r.kind, "ref_id": r.ref_id, "score": round(google_ai_service.cosine_similarity(qvec, r.embedding or []), 4)}
        for r in rows
    ]
    scored = [s for s in scored if s["score"] >= min_score]
    scored.sort(key=lambda s: s["score"], reverse=True)
    return scored[:top_k]
