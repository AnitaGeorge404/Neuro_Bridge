# NeuroBridge — Google Integration Scorecard

> **Updated:** 2026-11-20  
> **Rule:** `VERIFIED` = a live call to the Google service returned real production data.  
> **Live Active:** Gemini API is now **LIVE VERIFIED** (Text Generation, Structured Outputs, Bri Function Calling, and 768-dim Embeddings).  
> **Test Suite:** 262/262 backend tests passing, frontend builds cleanly.

| # | Google Technology | Purpose in NeuroBridge | Status | Live Status | Verification / Evidence |
|---|---|---|---|---|---|
| **01** | **Gemini API (`google-genai`)** | Bri's primary AI intelligence & reasoning | **VERIFIED** | Live Active | Live text generation on `gemini-3.5-flash-lite`, function calling (`start_focus_session`), structured output (4-step task plan). |
| **02** | **Firebase Authentication** | Google Sign-In & cryptographically verified identity | **CONNECTED / TESTED** | Blocked on Project | Frontend popup flow (`src/lib/firebase.js`) + backend ID token verification (`backend/auth.py`), user isolation (`firebase:<uid>`). |
| **03** | **Cloud Firestore** | Cross-device adaptive UI profile & document catalog | **CONNECTED / TESTED** | Blocked on Project | Synced adaptive profile (`/api/google/profile`), document library mirror, privacy export/delete. Fails soft when offline. |
| **04** | **Firebase App Check** | ReDoS & automated API abuse protection | **CONNECTED / TESTED** | Blocked on Site Key | reCAPTCHA Enterprise provider + `X-Firebase-AppCheck` injection; backend verification with `off/monitor/enforce` modes. |
| **05** | **Firebase Analytics** | Consent-gated, privacy-conscious telemetry | **CONNECTED** | Blocked on Measurement ID | Strictly consent-gated (`VITE_FIREBASE_ANALYTICS=true`), zero clinical/chat data logged, whitelisted product events only. |
| **06** | **Google Cloud Storage** | Secure, private student document & syllabus storage | **CONNECTED / TESTED** | Blocked on Bucket | Private bucket uploads (`users/<uid>/documents/...`), V4 signed download URLs (10-min expiry), privacy scrub. |
| **07** | **Vertex AI (Gemini on Vertex)** | Enterprise Cloud Run AI inference via IAM | **CONNECTED / TESTED** | Blocked on Cloud Run | Dual-mode client factory in `google_ai_service.py` (`vertexai=True`), service account ADC authentication without API keys. |
| **08** | **Vertex AI Embeddings** | Dense semantic vectors for academic memory recall | **VERIFIED** | Live Active | Live generation of 768-dimensional dense vectors on `gemini-embedding-001`. Semantic document recall operational. |
| **09** | **Vertex AI Vector Search** | Scalable semantic retrieval & local exact scan | **IMPLEMENTED / TESTED** | Local Exact Active | Pluggable `VectorSearchProvider` with `LocalExactVectorSearch` (in-DB exact cosine scan, $0 cost) & `VertexAIVectorSearch` (Matching Engine with metadata filter `user_id == current_user.id`). 5 unit tests pass. |
| **10** | **Cloud Run** | Managed serverless backend hosting | **CONFIGURED / TESTED** | Ready to Deploy | Production non-root `Dockerfile`, dynamic `$PORT` binding, fast `/api/health` probe, memory/concurrency limits. |
| **11** | **Secret Manager** | Secure runtime credential injection | **CONNECTED / TESTED** | Blocked on Project | `load_secrets_into_env()` boots at application startup, pulls comma-delimited `GCP_SECRET_NAMES`. Fallback to local `.env`. |
| **12** | **Cloud Logging** | Structured JSON logs with trace correlation | **CONNECTED / TESTED** | Verified Locally | Structured `_CloudJsonFormatter` outputting severity, trace correlation (`logging.googleapis.com/trace`), and sanitized metadata. |
| **13** | **Cloud Monitoring** | Operational observability, health & alerting | **CONFIGURED** | Blocked on Project | Health check `/api/health`, structured log metrics (`nb_ai_call_latency`, `nb_ai_call_errors`, `nb_event`), uptime checks. |
| **14** | **BigQuery** | Privacy-minimized product analytics & event aggregation | **CONNECTED / TESTED** | Blocked on Project | Streaming background queue thread with allow-listed telemetry fields (`event_name`, `latency_ms`, `module`). Zero PII, no user IDs. |

---

## Operational Guide
- Run live Google status check:
  ```powershell
  backend\venv\Scripts\python.exe -m backend.scripts.verify_google
  ```
- Run automated test suite:
  ```powershell
  backend\venv\Scripts\python.exe -m pytest backend/tests
  ```
- Deploy to GCP:
  ```powershell
  .\deploy\gcp-setup.ps1 -ProjectId "<YOUR_GCP_PROJECT_ID>"
  ```
