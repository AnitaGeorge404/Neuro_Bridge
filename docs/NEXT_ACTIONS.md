# NeuroBridge — Next Actions

## You
Follow **`docs/USER_CLOUD_DEPLOYMENT_GUIDE.md`** (step-by-step, prioritized). Check progress any time with `backend\venv\Scripts\python.exe -m backend.scripts.verify_google`.

## Verification checklist (flip scorecard rows to VERIFIED)
- Sign in with Google → `/api/google/status` → POST `/api/google/selftest` (Gemini + embedding live).
- Upload a syllabus on ADHD → Task breakdown; check the object in GCS, the doc in Firestore and the steps saved.
- Ask Bri "what's due for my essay class?" (runs `search_my_documents`).
- Cloud Logging: `jsonPayload.nb_event="ai_call"`; Monitoring: metric `logging/user/nb_ai_call_latency`, uptime check green.
- BigQuery: `SELECT event_name, COUNT(*) FROM neurobridge_analytics.product_events GROUP BY 1`.
- Analytics DebugView shows `document_analyzed`, `focus_session_started`.
- Set `FIREBASE_APP_CHECK_MODE=enforce` once `app_check.verified` > 0 in `/api/google/status`.

## Agent follow-ups
- Run the frontend test suite (`npx vitest run`) once `npm install` completes.
- Optional: Cloud TTS for the Dyslexia reader; Cloud Scheduler job for weekly BigQuery cohort rollups.
