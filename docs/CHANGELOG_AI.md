# NEUROBRIDGE — AI CHANGELOG

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
