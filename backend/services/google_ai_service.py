"""
Modern Google GenAI Service for NeuroBridge.
Powered by the official `google-genai` SDK.

Supports:
- Gemini 2.5 Flash for rapid agentic reasoning & function calling
- Gemini 2.5 Pro for deep academic syllabus/assignment decomposition
- Gemini Multimodal Vision for OCR, assignment parsing, and dyslexia reading simplification
- Vertex AI Text Embeddings for semantic strategy and preference retrieval
- Configurable switching between Google AI Studio and Google Cloud Vertex AI
"""

from __future__ import annotations

import base64
import contextlib
import json
import math
import os
import re
import time
from typing import Any, List, Optional
from pydantic import BaseModel

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from . import google_cloud

# Centralized Model Registry — GEMINI_MODEL_NAME is the single knob the agent,
# OCD helpers and document pipeline all share.
MODEL_FLASH = os.getenv("GEMINI_MODEL_NAME") or os.getenv("GEMINI_FLASH_MODEL") or "gemini-2.5-flash"
MODEL_PRO = os.getenv("GEMINI_PRO_MODEL", "gemini-2.5-pro")
MODEL_EMBEDDING = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")

_TIMEOUT_SECONDS = float(os.getenv("AGENT_LLM_TIMEOUT_MS", "15000")) / 1000.0

# Transient = worth one retry. Shared by agent_service and ai_service.
TRANSIENT_ERRORS: tuple = (genai_errors.ServerError, httpx.TimeoutException, httpx.NetworkError, TimeoutError, ConnectionError)

_client_cache: dict[tuple, genai.Client] = {}


def use_vertex() -> bool:
    return os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("true", "1") and bool(_vertex_project())


def _vertex_project() -> str:
    return os.getenv("VERTEX_AI_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT") or ""


def backend_name() -> Optional[str]:
    if use_vertex():
        return "vertex_ai"
    if os.getenv("GEMINI_API_KEY"):
        return "gemini_api"
    return None


def is_configured() -> bool:
    return backend_name() is not None


def get_genai_client() -> Optional[genai.Client]:
    """Single, cached google-genai client for the whole backend.

    1. Vertex AI (GOOGLE_GENAI_USE_VERTEXAI=true + VERTEX_AI_PROJECT/GOOGLE_CLOUD_PROJECT),
       authenticated by the Cloud Run service account / ADC — no API key at all.
    2. Gemini Developer API via GEMINI_API_KEY (local dev / AI Studio).
    """
    if use_vertex():
        key = ("vertex", _vertex_project(), os.getenv("VERTEX_AI_LOCATION", "us-central1"))
        if key not in _client_cache:
            _client_cache[key] = genai.Client(vertexai=True, project=key[1], location=key[2])
        return _client_cache[key]
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        key = ("api", api_key)
        if key not in _client_cache:
            _client_cache[key] = genai.Client(api_key=api_key)
        return _client_cache[key]
    return None


@contextlib.contextmanager
def observe(operation: str, model: str):
    """Latency + status for every Google AI call -> Cloud Logging / Monitoring / BigQuery.
    Never records prompts or outputs."""
    start = time.monotonic()
    status = "ok"
    try:
        yield
    except Exception as e:
        status = type(e).__name__
        raise
    finally:
        google_cloud.emit_event(
            "ai_call", tool=operation, model=model, status=status,
            latency_ms=int((time.monotonic() - start) * 1000), source=backend_name(),
        )


# ---------------------------------------------------------------------------
# Clinical Anti-Reassurance Guard (OCD / ERP Safety)
# ---------------------------------------------------------------------------
REASSURANCE_PATTERN = re.compile(
    r"(you('re| are) safe|nothing bad|it'?s? okay|everything will|don'?t worry|you'?ll be fine|"
    r"i (can |)guarantee|definitely (safe|fine|okay)|100% (safe|certain|sure))",
    re.IGNORECASE,
)


def contains_reassurance(text: str) -> bool:
    return bool(text) and bool(REASSURANCE_PATTERN.search(text))


# ---------------------------------------------------------------------------
# Core Generation Capabilities
# ---------------------------------------------------------------------------

def generate_text(prompt: str, model: str = MODEL_FLASH, system_instruction: Optional[str] = None) -> str:
    """Execute a text generation call with modern google-genai client."""
    client = get_genai_client()
    if not client:
        return ""

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.4,
    )

    try:
        with observe("generate_text", model):
            response = client.models.generate_content(model=model, contents=prompt, config=config)
        return response.text or ""
    except Exception as e:
        print(f"[GoogleGenAI] Text generation error: {e}")
        return ""


def generate_structured(
    prompt: str,
    response_schema: type[BaseModel],
    model: str = MODEL_FLASH,
    system_instruction: Optional[str] = None,
) -> Optional[BaseModel]:
    """Generate structured JSON conforming strictly to a Pydantic schema."""
    client = get_genai_client()
    if not client:
        return None

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        response_mime_type="application/json",
        response_schema=response_schema,
        temperature=0.2,
    )

    try:
        with observe("generate_structured", model):
            response = client.models.generate_content(model=model, contents=prompt, config=config)
        raw_json = response.text
        if not raw_json:
            return None
        return response_schema.model_validate_json(raw_json)
    except Exception as e:
        print(f"[GoogleGenAI] Structured generation error: {e}")
        return None


# ---------------------------------------------------------------------------
# Multimodal Document Analysis (Syllabi, PDFs, Worksheets)
# ---------------------------------------------------------------------------

class BreakdownStep(BaseModel):
    description: str
    estimated_minutes: int


class TaskBreakdownPlan(BaseModel):
    steps: List[BreakdownStep]


class SyllabusTaskItem(BaseModel):
    title: str
    description: str
    estimated_difficulty: str  # 'low', 'medium', 'high'
    estimated_minutes: int
    due_date_hint: Optional[str] = None
    first_micro_step: str


class SyllabusDecompositionResult(BaseModel):
    course_title: str
    summary: str
    overwhelm_reduction_advice: str
    tasks: List[SyllabusTaskItem]


def analyze_multimodal_document(
    file_bytes: bytes,
    mime_type: str,
    prompt: Optional[str] = None,
) -> Optional[SyllabusDecompositionResult]:
    """Analyze an uploaded academic syllabus/assignment document using Gemini Multimodal.

    Decomposes large academic documents into digestible, low-overwhelm tasks
    with concrete 5-minute initiation micro-steps.
    """
    client = get_genai_client()
    if not client:
        return None

    user_prompt = prompt or (
        "You are an expert accessibility and neurodivergent academic coach. "
        "Analyze this academic document (syllabus, assignment, or schedule). "
        "Extract the course title, provide a gentle 2-sentence summary, actionable overwhelm-reduction advice, "
        "and break down major deadlines into small tasks. For each task, define a concrete, non-threatening "
        "'first_micro_step' that takes 5 minutes or less to help overcome initiation paralysis."
    )

    contents = [
        types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
        user_prompt,
    ]

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=SyllabusDecompositionResult,
        temperature=0.2,
    )

    try:
        with observe("analyze_document", MODEL_PRO):
            response = client.models.generate_content(model=MODEL_PRO, contents=contents, config=config)
        if not response.text:
            return None
        return SyllabusDecompositionResult.model_validate_json(response.text)
    except Exception as e:
        print(f"[GoogleGenAI] Multimodal document analysis error: {e}")
        return None


# ---------------------------------------------------------------------------
# Semantic Embeddings (Vertex AI / Google AI Embeddings)
# ---------------------------------------------------------------------------

def generate_embeddings(texts: List[str], task_type: str = "RETRIEVAL_DOCUMENT") -> List[List[float]]:
    """Batch embeddings (gemini-embedding-001 on Vertex AI or the Gemini API)."""
    client = get_genai_client()
    if not client or not texts:
        return []
    try:
        with observe("embed_content", MODEL_EMBEDDING):
            response = client.models.embed_content(
                model=MODEL_EMBEDDING,
                contents=texts,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=768),
            )
        return [list(e.values or []) for e in (response.embeddings or [])]
    except Exception as e:
        print(f"[GoogleGenAI] Embeddings generation error: {e}")
        return []


def generate_embedding(text: str, task_type: str = "RETRIEVAL_QUERY") -> List[float]:
    vectors = generate_embeddings([text], task_type=task_type)
    return vectors[0] if vectors else []


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0
