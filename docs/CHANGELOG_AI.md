# NEUROBRIDGE — AI CHANGELOG

## 2026-11-20 — 14 Google Ecosystem Integrations Execution
- **Gemini API Live Verification:** Live production connectivity verified against Google GenAI API with active `GEMINI_API_KEY`. Text generation, structured output (`TaskBreakdownPlan`), function calling (`start_focus_session`), and dense embeddings (`gemini-embedding-001`, 768 dims) all return live production results.
- **Model Fallback Chain & Resilience:** Configured `gemini-3.5-flash-lite` as default responsive model (<2s response) with fallback chain (`gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.8-flash`). Enhanced `is_model_unavailable()` to catch transient 503/504 errors, timeouts, network disconnects, and upstream socket drops.
- **Vertex AI Vector Search Abstraction:** Created `backend/services/vector_search_service.py` introducing `VectorSearchProvider` with dual backends: `LocalExactVectorSearch` (in-DB exact cosine scan, $0 cost) and `VertexAIVectorSearch` (Google Cloud Matching Engine with strict metadata filter `user_id == current_user.id`). Wired into `semantic_memory.py` and `/api/google/status`. Added 5 automated unit/fallback tests (`test_vector_search.py`).
- **Documentation Master Suite Created:**
  - `docs/GOOGLE_INTEGRATION_EXECUTION_TRACKER.md`: 14 detailed workstream trackers with status, architecture, and blockers.
  - `docs/GOOGLE_INTEGRATION_SETUP.md`: Step-by-step service-by-service setup guide and free-tier cost controls.
  - `docs/GOOGLE_INTEGRATION_ARCHITECTURE.md`: End-to-end architectural diagram and data-flow specifications.
  - `docs/GOOGLE_INTEGRATION_VERIFICATION.md`: Verification report with live transcripts and test evidence.
  - Updated `docs/GOOGLE_INTEGRATION_SCORECARD.md` with live active statuses.
- **Test Suite Results:** 262/262 backend tests pass (100% pass rate). Frontend production build succeeds cleanly.

## 2026-11-20 — UK deployment guide + London defaults
- New `docs/USER_CLOUD_DEPLOYMENT_GUIDE.md` (16 user actions, UK data-location table, costs, UK GDPR checklist). `USER_ACTION_REQUIRED.md` now points to it.
- Deploy scripts default to `europe-west2`: Secret Manager UK-only replication, UK log bucket (30 days), BigQuery in London, image cleanup policy, budget alert, Cloud Run max 3 instances / concurrency 40, rate-limit env. The Gemini key is no longer uploaded unless `-IncludeGeminiApiKey`.
- New `deploy/preflight.ps1`, `deploy/redeploy.ps1`, `deploy/verify.ps1`. Firebase Storage rules removed (unused).
- Model defaults changed to `gemini-3.8-flash` (2.5 models closed to new users). Analytics is now opt-in (`VITE_FIREBASE_ANALYTICS=true`). Dyspraxia dev port fixed to 8000. Test DB path overridable via `NB_TEST_DB`.
- Live finding: the new Gemini key is valid, but a stale Windows-level `GEMINI_API_KEY` overrides `.env` (guide step B1).

## 2026-11-20 — Bri Agent V2 + optional Gemini Live
- **Bri V2** (`backend/services/bri_v2/`), behind `BRI_AGENT_V2_ENABLED` (default on). V1 stays intact as the fallback, both for any V2 fault before a write and when the flag is off.
- **Follow-ups:** persisted per-conversation state (new table `agent_conversation_states`).
  - Deterministic handling of yes / no / not now / the first one / I finished it / what next.
  - Gemini gets the backend's interpretation of accepted offers, choices, "still stuck", "make it easier" and corrections.
  - Declined approaches are not re-offered.
- **Action policy:**
  - LOW/MODERATE/HIGH tiers, enforced on the backend.
  - Argument validation, a per-turn tool budget, and blocking of a duplicate write in the same turn.
  - Writes are verified against the database before Bri can report success.
  - A typed "yes" executes the pending confirmation; the new `POST /tool/decline` clears it on the server.
- **New tools (V2-only):** `complete_task_step`, and `save_user_preference` (whitelisted keys, only on an explicit request).
- **Bug fix:** chat history fed Gemini the *oldest* 10 messages instead of the most recent, so longer conversations lost context. It now sends the latest 12.
- **Gemini Live (optional, `GEMINI_LIVE_ENABLED`, default off):**
  - Ephemeral-token endpoint with server-locked model, prompt and tools.
  - Live tool relay through the V2 policy.
  - Transcripts persisted to the conversation.
  - Browser client and a chat header button, with automatic fallback to the existing chat and voice input.
- **Tests:** 257 backend tests pass (58 new). One existing test now uses a non-explicit request, because an explicit "break down…" request runs directly under the new policy. 4 frontend failures were already there and are unrelated (TaskBreakdown work in progress; a duplicate sr-only announcement in an AgentChat test).

## 2026-11-20 — Google platform integration (Batch 1–4)
- **SDK:** all Gemini calls moved to `google-genai` (`services/genai_compat.py` adapter, `google_ai_service.py` cached client, Vertex AI switch, `observe()` telemetry). Tests swapped to the adapter; conftest blanks Google env so tests never hit live APIs.
- **Bri:** new READ tool `search_my_documents` (embeddings); `create_task_breakdown` now uses Gemini structured output.
- **Documents:** `document_router.py` rewritten (GCS upload → Gemini → approve → TaskSteps → Firestore → embeddings; list/download-url/search). Fixed a crash where `auto_save_tasks` assigned dicts to the `steps` relationship.
- **Platform:** `services/google_cloud.py` (Secret Manager boot, JSON Cloud Logging, BigQuery events), `services/firebase_service.py` (Firestore + GCS), `routers/google_router.py`, App Check dependency in `auth.py`, privacy export/delete covers the new tables + Firestore + GCS.
- **Frontend:** `src/lib/firebase.js` (Google Sign-In, App Check, Analytics), `loginWithGoogle`, `SyllabusPlanner` on Task Breakdown, analytics events.
- **Deploy:** `Dockerfile`, `.dockerignore`, `cloudbuild.yaml`, `firebase.json`, Firestore/Storage rules, `deploy/gcp-setup.ps1`. Start scripts fixed (backend port 8000 to match the frontend; `start-dev.sh` now runs uvicorn, not a non-existent Flask app).
- **Tests:** 199 backend passing (190 existing + 9 new in `test_google_platform.py`).


## 2026-11-20 — Full System Audit, Vision Reconstruction & Foundation Alignment

### Objective
Perform an exhaustive technical audit of NeuroBridge, inspect backend/frontend architectures, verify test suites, check Google API status, construct project memory documentation, and formulate the BuildTHON strategy without introducing breaking code changes.

### Files Inspected
- Root: `package.json`, `README.md`, `start-dev.ps1`, `start-dev.sh`, `vite.config.js`, `vitest.config.js`, `.env`, `.env.example`, `.env.production`
- Backend: `backend/main.py`, `backend/database.py`, `backend/auth.py`, `backend/requirements.txt`, `backend/services/agent_service.py`, `backend/services/ai_service.py`, `backend/services/agent_tools.py`, `backend/routers/ai_proxy_router.py`, `backend/routers/privacy_router.py`, `backend/models/*`
- Frontend: `src/App.jsx`, `src/components/AppLayout.jsx`, `src/components/AgentChat.jsx`, `src/lib/featureRegistry.js`, `src/context/AuthContext.jsx`, `src/pages/*`
- Existing Audits: `docs/privacy-security-audit.md`, `docs/accessibility-audit.md`, `docs/redesign-research.md`

### Files Created
- `docs/PROJECT_MEMORY.md` — Core memory, philosophy, architectural decisions.
- `docs/FEATURE_TRACKER.md` — Status and verification tracking across all modules.
- `docs/ARCHITECTURE.md` — Detailed frontend, backend, data, and AI flow diagrams.
- `docs/BUILDTHON_ROADMAP.md` — Ranked BuildTHON features and demonstration narrative.
- `docs/CHANGELOG_AI.md` — Chronological log of engineering actions and audit findings.
- `docs/NEXT_ACTIONS.md` — Concrete, separated AI agent vs. User actions.

### Key Discoveries & Test Results
1. **Backend Tests:** Ran `pytest backend/tests` via `backend/venv`. Result: **184 passed** (100% pass rate).
2. **Framework Reality Check:** Backend is FastAPI (`backend/main.py`), not Flask as legacy docs and `start-dev.ps1` claimed.
3. **Port Mismatch:** `vite.config.js` runs on port 8080 (proxies `/api` to 5000), while `start-dev.ps1` referenced 5173.
4. **Gemini API Connectivity:** Executed live RPC probe using current `GEMINI_API_KEY` in `.env`. Failed with `400 API_KEY_INVALID`.
5. **Google SDK Warning:** Legacy `google-generativeai` package is deprecated; migration to `google-genai` is recommended.
6. **Frontend Dependencies:** `node_modules` was missing from local workspace; npm network timeout occurred during initial install.

### Remaining Tasks
- Obtain valid `GEMINI_API_KEY` from user to unblock live LLM tool orchestration.
- Update `start-dev.ps1` and `start-dev.sh` to launch FastAPI via Uvicorn correctly.
