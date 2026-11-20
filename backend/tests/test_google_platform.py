"""Offline tests for the Google platform wiring (no live Google calls)."""

import io
import sys
import types as pytypes

from fastapi.testclient import TestClient

from backend.main import app
from backend.services import genai_compat, google_ai_service, google_cloud
from backend.services.agent_tools import TOOL_REGISTRY, build_gemini_tool_declarations

client = TestClient(app)
DEMO = {"Authorization": "Bearer demo:nb-user-042:gp-session"}


def _fake_embed(texts, task_type="RETRIEVAL_DOCUMENT"):
    vocab = ["essay", "math", "quiz", "lab", "reading", "history"]
    return [[float(t.lower().count(w)) + 0.01 for w in vocab] for t in texts]


def _install_fake_ai(monkeypatch):
    result = google_ai_service.SyllabusDecompositionResult(
        course_title="HIST 210", summary="History course with essays.", overwhelm_reduction_advice="One week at a time.",
        tasks=[
            google_ai_service.SyllabusTaskItem(title="Essay 1", description="Write a history essay", estimated_difficulty="medium",
                                               estimated_minutes=60, due_date_hint="Oct 3", first_micro_step="Open a blank doc"),
            google_ai_service.SyllabusTaskItem(title="Math quiz", description="Statistics quiz", estimated_difficulty="low",
                                               estimated_minutes=20, due_date_hint=None, first_micro_step="Find chapter 2"),
        ],
    )
    monkeypatch.setattr(google_ai_service, "analyze_multimodal_document", lambda **kw: result)
    monkeypatch.setattr(google_ai_service, "backend_name", lambda: "vertex_ai")
    monkeypatch.setattr(google_ai_service, "generate_embeddings", _fake_embed)
    monkeypatch.setattr(google_ai_service, "generate_embedding",
                        lambda text, task_type="RETRIEVAL_QUERY": _fake_embed([text])[0])


def test_compat_converts_tools_to_google_genai_function_declarations():
    tools = genai_compat._to_tools(build_gemini_tool_declarations())
    names = {d.name for d in tools[0].function_declarations}
    assert names == {n for n, t in TOOL_REGISTRY.items() if not getattr(t, "v2_only", False)}
    assert "search_my_documents" in names


def test_compat_converts_function_response_content_to_parts():
    content = genai_compat.protos.Content(parts=[genai_compat.protos.Part(
        function_response=genai_compat.protos.FunctionResponse(name="get_recent_tasks", response={"result": {"n": 1}}))])
    parts = genai_compat._to_parts(content)
    assert parts[0].function_response.name == "get_recent_tasks"


def test_document_flow_upload_approve_and_semantic_search(monkeypatch):
    _install_fake_ai(monkeypatch)
    r = client.post("/api/documents/analyze-syllabus", headers=DEMO,
                    files={"file": ("s.txt", io.BytesIO(b"syllabus"), "text/plain")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["google"]["ai_source"] == "vertex_ai"
    assert body["google"]["embeddings_indexed"] == 3
    assert body["saved_breakdown_id"] is None  # needs approval

    approved = client.post(f"/api/documents/{body['document_id']}/approve", headers=DEMO).json()
    assert approved["breakdown_id"]

    hits = client.post("/api/documents/search", headers=DEMO, json={"query": "history essay"}).json()["results"]
    assert any("Essay 1" in h["text"] for h in hits[:2])
    assert all("Math quiz" not in h["text"] for h in hits[:2])

    other = {"Authorization": "Bearer demo:nb-user-042:someone-else"}
    assert client.post(f"/api/documents/{body['document_id']}/approve", headers=other).status_code == 404
    assert client.post("/api/documents/search", headers=other, json={"query": "history essay"}).json()["results"] == []


def test_auto_save_creates_real_task_steps(monkeypatch):
    _install_fake_ai(monkeypatch)
    r = client.post("/api/documents/analyze-syllabus?auto_save_tasks=true", headers=DEMO,
                    files={"file": ("s.txt", io.BytesIO(b"syllabus"), "text/plain")})
    bid = r.json()["saved_breakdown_id"]
    from backend.database import SessionLocal
    from backend.models import adhd_models
    db = SessionLocal()
    try:
        steps = db.query(adhd_models.TaskStep).filter_by(breakdown_id=bid).all()
        assert len(steps) == 2 and "Open a blank doc" in steps[0].description
    finally:
        db.close()


def test_bri_search_my_documents_tool_is_user_scoped(monkeypatch):
    _install_fake_ai(monkeypatch)
    client.post("/api/documents/analyze-syllabus", headers=DEMO, files={"file": ("s.txt", io.BytesIO(b"x"), "text/plain")})
    from backend.auth import CurrentUser
    from backend.database import SessionLocal
    from backend.services.agent_tools import ToolContext
    db = SessionLocal()
    try:
        mine = TOOL_REGISTRY["search_my_documents"].handler(
            {"query": "math quiz"}, ToolContext(db=db, user=CurrentUser(id="demo:nb-user-042:gp-session", is_demo=True)))
        theirs = TOOL_REGISTRY["search_my_documents"].handler(
            {"query": "math quiz"}, ToolContext(db=db, user=CurrentUser(id="demo:nb-user-011:x", is_demo=True)))
    finally:
        db.close()
    assert "Math quiz" in mine["matches"][0]["text"]
    assert theirs["matches"] == []


def test_app_check_enforce_rejects_missing_token(monkeypatch):
    from backend import auth
    monkeypatch.setattr(auth, "APP_CHECK_MODE", "enforce")
    monkeypatch.setattr(auth, "_FIREBASE_INITIALIZED", True)
    r = client.post("/api/documents/search", headers=DEMO, json={"query": "x"})
    assert r.status_code == 401


def test_bigquery_events_are_privacy_filtered(monkeypatch):
    inserted = []

    class FakeBQ:
        def insert_rows_json(self, table, rows):
            inserted.extend(rows)
            return []

    monkeypatch.setattr(google_cloud, "BQ_DATASET", "nb")
    monkeypatch.setattr(google_cloud, "GCP_PROJECT", "proj")
    monkeypatch.setattr(google_cloud, "_bq_client", FakeBQ())
    google_cloud.emit_event("document_analyzed", module="documents", count=2, message="SECRET USER TEXT", email="a@b.c")
    import time
    for _ in range(40):
        if inserted:
            break
        time.sleep(0.1)
    assert inserted and inserted[0]["event_name"] == "document_analyzed"
    assert "message" not in inserted[0] and "email" not in inserted[0]


def test_secret_manager_loads_missing_secrets(monkeypatch):
    class Resp:
        payload = pytypes.SimpleNamespace(data=b"from-secret-manager\n")

    class FakeClient:
        def access_secret_version(self, name):
            assert name == "projects/proj/secrets/NB_TEST_SECRET/versions/latest"
            return Resp()

    fake_mod = pytypes.ModuleType("google.cloud.secretmanager")
    fake_mod.SecretManagerServiceClient = FakeClient
    monkeypatch.setitem(sys.modules, "google.cloud.secretmanager", fake_mod)
    import google.cloud
    monkeypatch.setattr(google.cloud, "secretmanager", fake_mod, raising=False)
    monkeypatch.setenv("GCP_SECRET_NAMES", "NB_TEST_SECRET")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
    monkeypatch.delenv("NB_TEST_SECRET", raising=False)
    assert google_cloud.load_secrets_into_env() == ["NB_TEST_SECRET"]
    import os
    assert os.environ["NB_TEST_SECRET"] == "from-secret-manager"
    monkeypatch.delenv("NB_TEST_SECRET")


def test_google_status_endpoint_exposes_no_secrets():
    body = client.get("/api/google/status").json()
    assert "genai" in body and "cloud" in body
    assert "key" not in str(body).lower().replace("monkey", "")
