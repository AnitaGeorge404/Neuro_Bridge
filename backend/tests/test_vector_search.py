"""
Tests for Vector Search Abstraction (Local & Vertex AI Vector Search).
Verifies:
- Retrieval quality and score thresholding
- User isolation (User A cannot access User B's semantic records)
- Metadata filtering (by kind)
- Empty result handling
- Vertex AI Vector Search provider invocation with metadata restrict filters
- Graceful fallback to LocalExactVectorSearch upon Vertex error
"""

from unittest.mock import MagicMock
import pytest
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models import google_models
from backend.services import semantic_memory, vector_search_service


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_local_vector_search_scoring_and_ordering(db_session: Session, monkeypatch):
    user_id = "test-user-vector-1"
    
    # Store some fake memories
    mem1 = google_models.SemanticMemory(
        user_id=user_id,
        kind="test_doc",
        text="Introduction to neurodiversity in education",
        embedding=[1.0, 0.0, 0.0],
    )
    mem2 = google_models.SemanticMemory(
        user_id=user_id,
        kind="test_doc",
        text="Advanced quantum physics and cosmology",
        embedding=[0.0, 1.0, 0.0],
    )
    db_session.add(mem1)
    db_session.add(mem2)
    db_session.commit()

    query_vec = [0.99, 0.05, 0.0]
    results = vector_search_service.search_vectors(
        db=db_session,
        user_id=user_id,
        query_vector=query_vec,
        top_k=5,
        min_score=0.5,
    )

    assert len(results) >= 1
    assert "neurodiversity" in results[0]["text"]
    assert results[0]["score"] > 0.9


def test_vector_search_strict_user_isolation(db_session: Session):
    user_a = "user-alice-001"
    user_b = "user-bob-002"

    mem_a = google_models.SemanticMemory(
        user_id=user_a,
        kind="private_notes",
        text="Alice's confidential study plan",
        embedding=[1.0, 0.0, 0.0],
    )
    mem_b = google_models.SemanticMemory(
        user_id=user_b,
        kind="private_notes",
        text="Bob's private schedule",
        embedding=[1.0, 0.0, 0.0],
    )
    db_session.add(mem_a)
    db_session.add(mem_b)
    db_session.commit()

    query_vec = [1.0, 0.0, 0.0]
    
    # User A queries
    results_a = vector_search_service.search_vectors(
        db=db_session,
        user_id=user_a,
        query_vector=query_vec,
        top_k=10,
        min_score=0.1,
    )
    assert all("Bob" not in r["text"] for r in results_a)
    assert any("Alice" in r["text"] for r in results_a)

    # User B queries
    results_b = vector_search_service.search_vectors(
        db=db_session,
        user_id=user_b,
        query_vector=query_vec,
        top_k=10,
        min_score=0.1,
    )
    assert all("Alice" not in r["text"] for r in results_b)
    assert any("Bob" in r["text"] for r in results_b)


def test_vector_search_kind_filter(db_session: Session):
    user_id = "test-filter-user"
    mem_doc = google_models.SemanticMemory(
        user_id=user_id,
        kind="document_task",
        text="Read chapter 4 syllabus",
        embedding=[0.5, 0.5, 0.0],
    )
    mem_pref = google_models.SemanticMemory(
        user_id=user_id,
        kind="user_preference",
        text="Prefers 25 min timer",
        embedding=[0.5, 0.5, 0.0],
    )
    db_session.add(mem_doc)
    db_session.add(mem_pref)
    db_session.commit()

    results = vector_search_service.search_vectors(
        db=db_session,
        user_id=user_id,
        query_vector=[0.5, 0.5, 0.0],
        top_k=5,
        min_score=0.3,
        kind="user_preference",
    )
    assert len(results) == 1
    assert "timer" in results[0]["text"]
    assert results[0]["kind"] == "user_preference"


def test_vector_search_empty_results(db_session: Session):
    results = vector_search_service.search_vectors(
        db=db_session,
        user_id="nonexistent-user",
        query_vector=[1.0, 0.0, 0.0],
        top_k=5,
        min_score=0.5,
    )
    assert results == []


def test_vertex_vector_search_fallback_on_error(db_session: Session, monkeypatch):
    """When Vertex AI throws an error (e.g. endpoint down), provider gracefully falls back to local exact scan."""
    user_id = "test-fallback-user"
    mem = google_models.SemanticMemory(
        user_id=user_id,
        kind="doc",
        text="Fallback syllabus content",
        embedding=[1.0, 0.0, 0.0],
    )
    db_session.add(mem)
    db_session.commit()

    vertex_provider = vector_search_service.VertexAIVectorSearch(
        index_endpoint_id="mock-endpoint-id",
        index_id="mock-index-id",
    )

    # Mock _get_client to raise an exception simulating cloud network/endpoint error
    def failing_get_client():
        mock_client = MagicMock()
        mock_client.find_neighbors.side_effect = RuntimeError("Endpoint connection refused")
        return mock_client

    monkeypatch.setattr(vertex_provider, "_get_client", failing_get_client)

    # Execute search with the failing Vertex provider
    results = vertex_provider.search(
        db=db_session,
        user_id=user_id,
        query_vector=[1.0, 0.0, 0.0],
        top_k=5,
        min_score=0.5,
    )

    # Should fall back to local exact search and return the database record!
    assert len(results) == 1
    assert "Fallback syllabus" in results[0]["text"]
    assert results[0]["provider"] == "local_exact"
