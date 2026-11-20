# NeuroBridge — Google Integration Scorecard

> Updated 2026-11-20. **VERIFIED = a live call to the Google service returned real data.** Nothing is VERIFIED yet:
> this machine has no `gcloud`/ADC credentials, no Firebase web config, and the `.env` `GEMINI_API_KEY` is rejected (`API_KEY_INVALID`).
> TESTED = exercised by automated tests with the Google client faked at its boundary (`backend/tests/test_google_platform.py`).
> Running `deploy/gcp-setup.ps1` + the Firebase steps in `NEXT_ACTIONS.md` is what flips these to VERIFIED.

| # | Google Technology | Purpose in NeuroBridge | Status | Verification / evidence |
|---|---|---|---|---|
| 1 | **Google GenAI SDK (`google-genai`)** | Single SDK for every AI call; deprecated `google-generativeai` removed from runtime | TESTED | 199 backend tests pass through `genai_compat` adapter; live call reached Google and returned `API_KEY_INVALID` |
| 2 | **Gemini function calling (Bri)** | Bri plans and runs real app tools (risk-tiered, confirmation-gated) | TESTED | Tool declarations to `types.FunctionDeclaration` conversion tested; orchestrator suite green. Live: **BLOCKED (key)** |
| 3 | **Gemini structured output** | Task breakdown (`TaskBreakdownPlan`) and syllabus extraction use `response_schema` | IMPLEMENTED | Live: **BLOCKED (key)** |
| 4 | **Gemini multimodal document understanding** | PDF/image syllabus to assignments, deadlines, 5-min first steps | TESTED | Upload → approve → real `TaskStep` rows test. Live: **BLOCKED (key)** |
| 5 | **Vertex AI (Gemini on Vertex)** | Production inference with service-account auth (no API key) on Cloud Run | IMPLEMENTED | `GOOGLE_GENAI_USE_VERTEXAI=true` path in `get_genai_client`; enabled by deploy script |
| 6 | **Gemini embeddings + semantic retrieval** | `gemini-embedding-001` vectors for uploaded courses; Bri tool `search_my_documents` + `/api/documents/search` | TESTED | Ranking + per-user isolation tests |
| 7 | **Firebase Authentication** | Google Sign-In; backend verifies ID tokens (`firebase-admin`) → `firebase:<uid>` identity | IMPLEMENTED | Needs Firebase web config + Google provider enabled |
| 8 | **Cloud Firestore** | Cross-device adaptive profile (`/api/google/profile`), document library mirror, privacy delete | IMPLEMENTED | Needs project/ADC |
| 9 | **Cloud Storage** | Private, user-prefixed syllabus storage; V4 signed download URLs; privacy delete | IMPLEMENTED | Needs bucket (script creates it) |
| 10 | **Secret Manager** | `GCP_SECRET_NAMES` loaded into env at boot, before auth/AI modules import | TESTED | Fake-client test; `/api/health` reports loaded names |
| 11 | **Cloud Logging** | Structured JSON logs (severity, trace correlation, per-request latency, AI-call events), no user content | TESTED | JSON output verified locally with `K_SERVICE` set |
| 12 | **Cloud Monitoring** | Log-based metrics (`nb_ai_call_latency`, `nb_ai_call_errors`, `nb_documents_analyzed`) + `/api/health` uptime check | CONFIGURED | Created by `deploy/gcp-setup.ps1` |
| 13 | **BigQuery** | Partitioned `product_events` table, batched streaming inserts, field allow-list (no user ids/text) | TESTED | Fake-client test proves privacy filtering |
| 14 | **Cloud Run** | Backend hosting (`Dockerfile`, non-root, `$PORT`, JSON logs) | CONFIGURED | Image not built here (no Docker/gcloud) |
| 15 | **Cloud Build + Artifact Registry** | `cloudbuild.yaml`: test → build → push → deploy | CONFIGURED | |
| 16 | **Firebase App Check** | reCAPTCHA Enterprise token on AI/agent/document routes; `off/monitor/enforce` | TESTED | Enforce-mode rejection test; frontend attaches `X-Firebase-AppCheck` |
| 17 | **Google Analytics for Firebase** | Allow-listed events: login, document_analyzed, tasks_approved, semantic_search, focus_session_started, bri_message_sent | IMPLEMENTED | Needs `VITE_FIREBASE_MEASUREMENT_ID` |
| 18 | **Firebase Hosting** | Serves `dist/`, rewrites `/api/**` → Cloud Run (same origin, no CORS) | CONFIGURED | `firebase.json`, Firestore/Storage rules |

**Deliberately not integrated:** Vertex AI Vector Search (paid always-on endpoint; an exact per-user scan over a few hundred vectors is free), Document AI (Gemini multimodal already does extraction with fewer moving parts), Cloud Tasks/Pub/Sub/Scheduler (no async workload needs them yet), ADK and Firebase AI Logic (would duplicate Bri's tested orchestrator and the backend-only key policy).
