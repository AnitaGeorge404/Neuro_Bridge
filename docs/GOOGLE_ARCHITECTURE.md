# NeuroBridge — Google Architecture (as built)

```
Browser (React/Vite on Firebase Hosting)
  ├─ Firebase Auth (Google Sign-In) ──► ID token ─────────────┐
  ├─ Firebase App Check (reCAPTCHA Ent.) ► X-Firebase-AppCheck ┤
  ├─ Google Analytics for Firebase (allow-listed events only)  │
  └─ /api/** ── Firebase Hosting rewrite ──────────────────────▼
Cloud Run: FastAPI (Dockerfile, service account neurobridge-api)
  boot: Secret Manager → env  (GCP_SECRET_NAMES)
  auth.py: firebase-admin verify_id_token / verify App Check (fallbacks: Supabase, demo)
  google_ai_service.get_genai_client(): Vertex AI (ADC) | Gemini API key
     ├─ Bri orchestrator (agent_service via genai_compat) — function calling, risk tiers
     ├─ structured output: TaskBreakdownPlan, SyllabusDecompositionResult
     └─ gemini-embedding-001 → semantic_memory (SQL, cosine) → tool search_my_documents
  document_router: upload → Cloud Storage (users/<uid>/documents/) → Gemini multimodal
                   → user approves → TaskBreakdown/TaskStep → Firestore mirror → embeddings
  google_router: /status, /selftest, /profile (Firestore adaptive profile)
  google_cloud: JSON logs → Cloud Logging → log-based metrics → Cloud Monitoring (+ uptime check)
                emit_event → BigQuery neurobridge_analytics.product_events (no user ids/text)
SQL (Supabase Postgres / SQLite) remains the system of record for tasks, sessions, agent state.
```

## Key decisions
- **One client, two backends.** `GOOGLE_GENAI_USE_VERTEXAI=true` on Cloud Run means no API key in production; `GEMINI_API_KEY` stays for local dev.
- **Adapter, not rewrite.** `genai_compat.py` keeps the orchestrator's chat/tool call shape on `google-genai`, so ~180 behavioral tests guard the migration. SDK auto function-calling is disabled; the orchestrator keeps ownership of confirmation gates and audit logs.
- **Firestore complements SQL**, never duplicates it: profile + library feed only.
- **Privacy:** events pass a field allow-list; prompts, outputs, document text and user ids never reach logs, Analytics or BigQuery. `DELETE /api/privacy/data` also purges Firestore docs and the user's GCS prefix.
- **Cost:** Cloud Run min-instances 0, no Vector Search endpoint, BigQuery streaming at event granularity only.
- **Demo users** (`demo:` ids) never write to Cloud Storage or Firestore.

## Env reference (backend)
`GOOGLE_CLOUD_PROJECT`, `GOOGLE_GENAI_USE_VERTEXAI`, `VERTEX_AI_LOCATION`, `GEMINI_API_KEY`, `GEMINI_MODEL_NAME`, `GEMINI_PRO_MODEL`, `GEMINI_EMBEDDING_MODEL`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_CHECK_MODE`, `GCS_BUCKET`, `BIGQUERY_DATASET`, `GCP_SECRET_NAMES`, `LOG_FORMAT`.
Frontend: `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_APP_ID`, `_MEASUREMENT_ID`, `_APPCHECK_SITE_KEY`.
