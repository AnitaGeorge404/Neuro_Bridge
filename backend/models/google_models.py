from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Integer, String, Text

from ..database import Base


class StoredDocument(Base):
    """An uploaded study document. Bytes live in Google Cloud Storage
    (gs://<bucket>/users/<uid>/documents/...); this row is the user-scoped index."""

    __tablename__ = "google_stored_documents"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    filename = Column(String)
    mime_type = Column(String)
    size_bytes = Column(Integer)
    gcs_uri = Column(String, nullable=True)  # null when Cloud Storage isn't configured
    course_title = Column(String, nullable=True)
    analysis = Column(JSON, nullable=True)
    ai_source = Column(String, nullable=True)  # gemini_api | vertex_ai | fallback
    breakdown_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SemanticMemory(Base):
    """Per-user embedding store (gemini-embedding-001) for Bri's contextual recall."""

    __tablename__ = "google_semantic_memory"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    kind = Column(String, index=True)  # document_task | document_summary | task_breakdown
    ref_id = Column(Integer, nullable=True)
    text = Column(Text)
    embedding = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
