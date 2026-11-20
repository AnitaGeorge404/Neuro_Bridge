"""
Verification Tests for Google Technologies in NeuroBridge:
- Google GenAI SDK (Model Registry, Pydantic schemas)
- Gemini Multimodal Document Extraction (Syllabus Decomposition)
- Health check probe (/api/health)
- Document Router (/api/documents/analyze-syllabus)
- Firebase Auth Token Bridge
- Vertex AI Embeddings interface
"""

import io
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import google_ai_service

client = TestClient(app)


def test_api_health_endpoint():
    """Verify that /api/health responds with expected Google Cloud / service status."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "NeuroBridge API"
    assert "google_ai_configured" in data
    assert data["database"] == "connected"


def test_google_genai_model_registry():
    """Verify that centralized Google GenAI model constants are configured."""
    assert google_ai_service.MODEL_FLASH.startswith("gemini-")
    assert google_ai_service.MODEL_PRO.startswith("gemini-")
    assert "embedding" in google_ai_service.MODEL_EMBEDDING


def test_clinical_anti_reassurance_guard():
    """Verify that clinical safety guard blocks toxic reassurance for OCD users."""
    assert google_ai_service.contains_reassurance("Don't worry, you are safe.") is True
    assert google_ai_service.contains_reassurance("Everything will definitely be fine.") is True
    assert google_ai_service.contains_reassurance("I can guarantee you won't get sick.") is True
    assert google_ai_service.contains_reassurance("Practice touching the door handle and notice your feelings.") is False


def test_document_syllabus_extraction_endpoint():
    """Verify multipart syllabus upload through /api/documents/analyze-syllabus."""
    demo_auth = {"Authorization": "Bearer demo:nb-user-042:session_test_doc_01"}
    fake_syllabus_content = b"""
    SYLLABUS: Computer Science 101 - Fall 2026
    Week 1: Introduction to Algorithms. Read Chapter 1.
    Week 2: Assignment 1 due Friday (Writing sorting algorithms).
    Week 3: Midterm Project Proposal due.
    """
    files = {
        "file": ("syllabus.txt", io.BytesIO(fake_syllabus_content), "text/plain")
    }
    response = client.post(
        "/api/documents/analyze-syllabus?auto_save_tasks=true",
        headers=demo_auth,
        files=files,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "analysis" in data
    analysis = data["analysis"]
    assert "course_title" in analysis
    assert "tasks" in analysis
    assert len(analysis["tasks"]) >= 1
    assert "first_micro_step" in analysis["tasks"][0]
    assert data["saved_breakdown_id"] is not None


def test_document_syllabus_rejects_unsupported_file_types():
    """Verify that executable or unapproved file formats are rejected with 400."""
    demo_auth = {"Authorization": "Bearer demo:nb-user-042:session_test_doc_02"}
    files = {
        "file": ("malicious.exe", io.BytesIO(b"MZ..."), "application/x-msdownload")
    }
    response = client.post(
        "/api/documents/analyze-syllabus",
        headers=demo_auth,
        files=files,
    )
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_embeddings_interface():
    """Verify that embedding generation interface exists and returns empty list when key is unset or graceful."""
    # When no key or offline, it gracefully returns an empty list without crashing
    vec = google_ai_service.generate_embedding("Task initiation strategies for ADHD")
    assert isinstance(vec, list)
