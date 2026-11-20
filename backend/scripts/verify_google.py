"""
Live check of every Google integration. Prints PASS / FAIL / SKIP per service.
Never prints secret values. Safe to share the output.

    backend\\venv\\Scripts\\python.exe -m backend.scripts.verify_google
"""

from __future__ import annotations

import os
import sys
import time
import uuid

from dotenv import load_dotenv

load_dotenv(override=True)

results: list[tuple[str, str, str]] = []


def check(name: str):
    def deco(fn):
        try:
            out = fn()
            results.append((name, "SKIP" if out is None else "PASS", "" if out is None else str(out)))
        except _Skip as s:
            results.append((name, "SKIP", str(s)))
        except Exception as e:
            msg = str(e).split("\n")[0][:140]
            results.append((name, "FAIL", f"{type(e).__name__}: {msg}"))
        return fn
    return deco


class _Skip(Exception):
    pass


def need(*vars_):
    missing = [v for v in vars_ if not os.getenv(v)]
    if missing:
        raise _Skip("set " + ", ".join(missing))


from backend.services import google_ai_service as g  # noqa: E402
from backend.services import google_cloud  # noqa: E402

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("FIREBASE_PROJECT_ID") or ""


@check("Gemini generation (google-genai)")
def _gen():
    if not g.is_configured():
        raise _Skip("set GEMINI_API_KEY (or Vertex env)")
    text = g.generate_text("Reply with exactly: ok")
    assert text, "empty response"
    return f"{g.backend_name()} / {g.MODEL_FLASH}: {text.strip()[:30]}"


@check("Gemini structured output")
def _structured():
    if not g.is_configured():
        raise _Skip("needs Gemini")
    plan = g.generate_structured("Task: write essay intro", response_schema=g.TaskBreakdownPlan)
    assert plan and len(plan.steps) > 0, "empty plan"
    return f"{len(plan.steps)} steps"


@check("Gemini function calling")
def _tools():
    if not g.is_configured():
        raise _Skip("needs Gemini")
    from backend.services import genai_compat
    from backend.services.agent_tools import build_gemini_tool_declarations
    model = genai_compat.GenerativeModel(g.MODEL_FLASH, tools=build_gemini_tool_declarations(),
                                         system_instruction="Use tools when helpful.")
    resp = model.start_chat().send_message("Start a 25 minute focus session for me.")
    calls = [p.function_call.name for p in resp.candidates[0].content.parts if p.function_call]
    assert calls, "model answered without calling a tool"
    return ",".join(calls)


@check("Gemini embeddings")
def _embed():
    if not g.is_configured():
        raise _Skip("needs Gemini")
    client = g.get_genai_client()
    from google.genai import types
    r = client.models.embed_content(model=g.MODEL_EMBEDDING, contents=["focus"],
                                    config=types.EmbedContentConfig(output_dimensionality=768))
    return f"{len(r.embeddings[0].values)} dims"


@check("Vector Search")
def _vector_search():
    from backend.services import vector_search_service
    provider = vector_search_service.get_vector_search_provider()
    if isinstance(provider, vector_search_service.VertexAIVectorSearch):
        need("GOOGLE_CLOUD_PROJECT", "VERTEX_VECTOR_SEARCH_ENDPOINT_ID")
        return f"Vertex AI Endpoint: {vector_search_service.VERTEX_VECTOR_SEARCH_ENDPOINT_ID[:12]}..."
    return "LocalExactVectorSearch (active, zero-cost)"


@check("Vertex AI")
def _vertex():
    need("GOOGLE_CLOUD_PROJECT")
    from google import genai
    c = genai.Client(vertexai=True, project=PROJECT, location=os.getenv("VERTEX_AI_LOCATION", "us-central1"))
    r = c.models.generate_content(model=g.MODEL_FLASH, contents="Reply with exactly: ok")
    assert r.text
    return "ok"


@check("Firebase Admin (Auth backend)")
def _fb():
    need("FIREBASE_PROJECT_ID")
    from backend import auth
    assert auth._FIREBASE_INITIALIZED, "firebase-admin not initialized"
    from firebase_admin import auth as fa
    fa.list_users(max_results=1)
    return "token verification ready"


@check("Firebase web config (frontend)")
def _fbweb():
    need("VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_AUTH_DOMAIN")
    extras = [v for v in ("VITE_FIREBASE_MEASUREMENT_ID", "VITE_FIREBASE_APPCHECK_SITE_KEY") if os.getenv(v)]
    return "present (+" + ",".join(x.replace("VITE_FIREBASE_", "") for x in extras) + ")"


@check("Cloud Firestore")
def _firestore():
    need("FIREBASE_PROJECT_ID", "GOOGLE_CLOUD_PROJECT")
    from backend.services import firebase_service
    db = firebase_service.firestore_client()
    assert db is not None, "client unavailable"
    ref = db.collection("_healthcheck").document(uuid.uuid4().hex)
    ref.set({"t": time.time()})
    assert ref.get().exists
    ref.delete()
    return "write/read/delete ok"


@check("Cloud Storage")
def _gcs():
    need("GCS_BUCKET")
    from backend.services import firebase_service
    b = firebase_service.storage_bucket()
    blob = b.blob(f"_healthcheck/{uuid.uuid4().hex}.txt")
    blob.upload_from_string(b"ok", content_type="text/plain")
    assert blob.download_as_bytes() == b"ok"
    blob.delete()
    return firebase_service.GCS_BUCKET


@check("Secret Manager")
def _sm():
    need("GOOGLE_CLOUD_PROJECT")
    from google.cloud import secretmanager
    c = secretmanager.SecretManagerServiceClient()
    names = [s.name.rsplit("/", 1)[-1] for s in c.list_secrets(parent=f"projects/{PROJECT}")]
    return f"{len(names)} secrets visible"


@check("BigQuery")
def _bq():
    need("GOOGLE_CLOUD_PROJECT", "BIGQUERY_DATASET")
    from google.cloud import bigquery
    c = bigquery.Client(project=PROJECT)
    errors = c.insert_rows_json(google_cloud._bq_table_id(),
                                [{"event_name": "healthcheck", "event_ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "verify"}])
    assert not errors, errors
    return google_cloud._bq_table_id()


@check("Cloud Run deployment")
def _run():
    need("CLOUD_RUN_URL")
    import httpx
    h = httpx.get(os.environ["CLOUD_RUN_URL"].rstrip("/") + "/api/health", timeout=20).json()
    assert h.get("status") == "healthy"
    return f"backend={h.get('google_ai_backend')} secrets={h.get('secrets_from_secret_manager')}"


if __name__ == "__main__":
    width = max(len(n) for n, _, _ in results)
    for name, status, detail in results:
        print(f"{status:4}  {name.ljust(width)}  {detail}")
    passed = sum(1 for _, s, _ in results if s == "PASS")
    print(f"\n{passed}/{len(results)} live checks passed")
    sys.exit(0 if not any(s == "FAIL" for _, s, _ in results) else 1)
